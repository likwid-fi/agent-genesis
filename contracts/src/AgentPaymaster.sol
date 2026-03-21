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

    mapping(address => bool) public hasFreeMined;

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

    function _slice(bytes memory data, uint256 start) internal pure returns (bytes memory) {
        bytes memory result = new bytes(data.length - start);
        for (uint256 i = 0; i < result.length; i++) {
            result[i] = data[i + start];
        }
        return result;
    }

    // Check if the operation is entirely composed of free mine() calls
    function _isFreeMine(bytes calldata callData, address sender) internal view returns (bool) {
        if (callData.length < 4) return false;

        bytes4 outerSelector = bytes4(callData[0:4]);

        // SimpleAccount execute: execute(address dest, uint256 value, bytes func) (0xb61d27f6)
        if (outerSelector == 0xb61d27f6) {
            (address dest,, bytes memory func) = abi.decode(callData[4:], (address, uint256, bytes));
            if (dest == address(AGC_TOKEN) && func.length >= 4) {
                bytes4 innerSelector;
                assembly {
                    innerSelector := mload(add(func, 32))
                }
                if (innerSelector == AgentGenesisCoin.mine.selector) {
                    (uint256 score, bytes memory signature, uint256 nonce) =
                        abi.decode(_slice(func, 4), (uint256, bytes, uint256));
                    return
                        AgentGenesisCoin(payable(address(AGC_TOKEN)))
                            .verifyMineSignature(sender, score, signature, nonce);
                }
            }
            return false;
        }
        // SimpleAccount executeBatch: executeBatch(address[] dest, bytes[] func) (0x47e1da2a)
        else if (outerSelector == 0x47e1da2a) {
            (address[] memory targets, bytes[] memory datas) = abi.decode(callData[4:], (address[], bytes[]));
            if (targets.length == 0 || targets.length != datas.length) return false;

            for (uint256 i = 0; i < targets.length; i++) {
                if (targets[i] != address(AGC_TOKEN)) return false;
                if (datas[i].length < 4) return false;

                bytes4 innerSelector;
                bytes memory funcData = datas[i];
                assembly {
                    innerSelector := mload(add(funcData, 32))
                }
                if (innerSelector != AgentGenesisCoin.mine.selector) return false;

                (uint256 score, bytes memory signature, uint256 nonce) =
                    abi.decode(_slice(funcData, 4), (uint256, bytes, uint256));
                if (!AgentGenesisCoin(payable(address(AGC_TOKEN))).verifyMineSignature(sender, score, signature, nonce))
                {
                    return false;
                }
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
        // Mode 0: mine() is permanently FREE for the first time
        if (_isFreeMine(userOp.callData, userOp.sender) && !hasFreeMined[userOp.sender]) {
            hasFreeMined[userOp.sender] = true;
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
                Reserves pairReserves = StateLibrary.getPairReserves(VAULT, POOL_ID);
                Reserves truncatedReserves = StateLibrary.getTruncatedReserves(VAULT, POOL_ID);
                (uint256 expectedOut,,) =
                    SwapMath.getAmountOut(pairReserves, truncatedReserves, POOL_FEE, false, amountIn);

                uint256 minOut = expectedOut * 80 / 100;

                IPairPositionManager.SwapInputParams memory inputParams = IPairPositionManager.SwapInputParams({
                    poolId: POOL_ID,
                    zeroForOne: false,
                    to: address(this),
                    amountIn: amountIn,
                    amountOutMin: minOut,
                    deadline: block.timestamp + 30
                });
                try POSITION_MANAGER.exactInput(inputParams) {} catch {}

                AGC_TOKEN.forceApprove(address(POSITION_MANAGER), 0);
            }
        }
        // If Mode 0 (Free mine), do nothing, we eat the ETH cost.
    }

    function rescueFunds(address token, address recipient, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool success,) = recipient.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }
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

