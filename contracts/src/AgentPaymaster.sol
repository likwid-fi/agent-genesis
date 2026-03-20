// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BasePaymaster} from "@account-abstraction/contracts/core/BasePaymaster.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IPairPositionManager} from "@likwid-fi/core/interfaces/IPairPositionManager.sol";
import {IBasePositionManager} from "@likwid-fi/core/interfaces/IBasePositionManager.sol";
import {IVault} from "@likwid-fi/core/interfaces/IVault.sol";
import {PoolKey} from "@likwid-fi/core/types/PoolKey.sol";
import {PoolId} from "@likwid-fi/core/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@likwid-fi/core/types/Currency.sol";
import {StateLibrary} from "@likwid-fi/core/libraries/StateLibrary.sol";
import {SwapMath} from "@likwid-fi/core/libraries/SwapMath.sol";
import {Reserves} from "@likwid-fi/core/types/Reserves.sol";

import {AgentGenesisCoin} from "./AgentGenesisCoin.sol";

contract AgentPaymaster is BasePaymaster {
    using SafeERC20 for IERC20;

    IERC20 public immutable AGC_TOKEN;
    IVault public immutable VAULT;
    IPairPositionManager public immutable POSITION_MANAGER;
    PoolId public immutable POOL_ID;
    uint24 public immutable POOL_FEE;

    uint256 public constant POST_OP_GAS = 500000;

    constructor(IEntryPoint _entryPoint, address _agcToken) BasePaymaster(_entryPoint) Ownable(msg.sender) {
        AGC_TOKEN = IERC20(_agcToken);
        AgentGenesisCoin agc = AgentGenesisCoin(payable(address(_agcToken)));
        POOL_FEE = agc.POOL_FEE();
        POOL_ID = PoolKey({
                currency0: CurrencyLibrary.ADDRESS_ZERO,
                currency1: Currency.wrap(_agcToken),
                fee: POOL_FEE,
                marginFee: agc.POOL_MARGIN_FEE()
            }).toId();
        POSITION_MANAGER = IPairPositionManager(agc.LIKWID_POSITION_MANAGER());
        VAULT = IVault(IBasePositionManager(address(POSITION_MANAGER)).vault());
    }

    // Check if the operation is entirely composed of free mine() calls
    function _isFreeMine(bytes calldata callData) internal view returns (bool) {
        if (callData.length < 4) return false;

        bytes4 outerSelector = bytes4(callData[0:4]);

        // SimpleAccount execute: execute(address dest, uint256 value, bytes func) (0xb61d27f6)
        if (outerSelector == 0xb61d27f6) {
            if (callData.length < 100) return false;
            address parsedDest = address(bytes20(callData[16:36]));

            uint256 dataOffset = uint256(bytes32(callData[68:100])) + 4; // Add 4 for the outer selector
            if (callData.length < dataOffset + 32) return false;

            uint256 dataLength = uint256(bytes32(callData[dataOffset:dataOffset + 32]));
            if (dataLength >= 4 && callData.length >= dataOffset + 36) {
                bytes4 innerSelector = bytes4(callData[dataOffset + 32:dataOffset + 36]);
                return parsedDest == address(AGC_TOKEN) && innerSelector == AgentGenesisCoin.mine.selector;
            }
            return false;
        }
        // SimpleAccount executeBatch: executeBatch(address[] dest, bytes[] func) (0x47e1da2a)
        else if (outerSelector == 0x47e1da2a) {
            if (callData.length < 68) return false;

            (address[] memory targets, bytes[] memory datas) = abi.decode(callData[4:], (address[], bytes[]));
            if (targets.length == 0 || targets.length != datas.length) return false;

            for (uint256 i = 0; i < targets.length; i++) {
                if (targets[i] != address(AGC_TOKEN)) return false;
                if (datas[i].length < 4) return false;
                bytes4 innerSelector = bytes4(datas[i]);
                if (innerSelector != AgentGenesisCoin.mine.selector) return false;
            }
            return true;
        }

        return false;
    }

    function _validatePaymasterUserOp(
        UserOperation calldata userOp,
        bytes32,
        /*userOpHash*/
        uint256 maxCost
    )
        internal
        override
        returns (bytes memory context, uint256 validationData)
    {
        // Mode 0: mine() is permanently FREE
        if (_isFreeMine(userOp.callData)) {
            context = abi.encode(uint8(0), userOp.sender, uint256(0), uint256(0));
            return (context, 0); // 0 means signature validation success (we don't need additional paymaster sigs here)
        }

        // Mode 1 = Charge AGC
        require(userOp.verificationGasLimit > POST_OP_GAS, "Paymaster: gas too low for postOp");

        Reserves pairReserves = StateLibrary.getPairReserves(VAULT, POOL_ID);
        Reserves truncatedReserves = StateLibrary.getTruncatedReserves(VAULT, POOL_ID);

        // Calculate maxCost in AGC (currency1, so zeroForOne = false)
        (uint256 amountIn,,) = SwapMath.getAmountIn(pairReserves, truncatedReserves, POOL_FEE, false, maxCost);
        amountIn = amountIn * 110 / 100; // Add 10% slippage tolerance

        // Deduct AGC tokens from sender
        AGC_TOKEN.safeTransferFrom(userOp.sender, address(this), amountIn);

        context = abi.encode(uint8(1), userOp.sender, amountIn, maxCost);
        return (context, 0);
    }

    function _postOp(
        PostOpMode,
        /* mode */
        bytes calldata context,
        uint256 actualGasCost
    )
        internal
        override
    {
        (uint8 paymasterMode, address sender, uint256 amountIn, uint256 maxCost) =
            abi.decode(context, (uint8, address, uint256, uint256));

        // If it's a Likwid protocol call (Mode 1), charge the AGC
        if (paymasterMode == 1) {
            // Approve PM to use our AGC tokens
            AGC_TOKEN.forceApprove(address(POSITION_MANAGER), amountIn);

            // Add estimated overhead cost for the postOp swap and subsequent operations
            uint256 overheadCost = POST_OP_GAS * tx.gasprice;
            uint256 totalCostToRecover = actualGasCost + overheadCost;

            if (totalCostToRecover > maxCost) {
                totalCostToRecover = maxCost;
            }

            // Swap AGC to get exactly actualGasCost of ETH
            IPairPositionManager.SwapOutputParams memory params = IPairPositionManager.SwapOutputParams({
                poolId: POOL_ID,
                zeroForOne: false,
                to: address(this),
                amountInMax: amountIn,
                amountOut: totalCostToRecover,
                deadline: block.timestamp + 30
            });

            // This swap will trigger receive() and deposit ETH to EntryPoint automatically
            try POSITION_MANAGER.exactOutput(params) returns (uint24, uint256, uint256 amountInUsed) {
                // Clear remaining allowance
                AGC_TOKEN.forceApprove(address(POSITION_MANAGER), 0);

                // Refund the unused AGC back to the sender
                if (amountIn > amountInUsed) {
                    AGC_TOKEN.safeTransfer(sender, amountIn - amountInUsed);
                }
            } catch {
                IPairPositionManager.SwapInputParams memory inputParams = IPairPositionManager.SwapInputParams({
                    poolId: POOL_ID,
                    zeroForOne: false,
                    to: address(this),
                    amountIn: amountIn,
                    amountOutMin: 0,
                    deadline: block.timestamp + 30
                });
                try POSITION_MANAGER.exactInput(inputParams) {} catch {}

                AGC_TOKEN.forceApprove(address(POSITION_MANAGER), 0);
            }
        }
        // If Mode 0 (Free mine), do nothing, we eat the ETH cost.
    }

    /**
     * @dev Any ETH sent to this contract (including from swaps) is automatically
     * deposited to the EntryPoint to replenish the paymaster's balance.
     */
    receive() external payable {
        if (msg.value > 0) {
            entryPoint.depositTo{value: msg.value}(address(this));
        }
    }
}

