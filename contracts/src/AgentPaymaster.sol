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

    // Parse the inner transaction details from SimpleAccount's execute()
    function _decodeExecute(bytes calldata callData) internal pure returns (address dest, bytes4 selector) {
        require(callData.length >= 100, "Paymaster: callData too short");
        // SimpleAccount execute selector is 0xb61d27f6: execute(address dest, uint256 value, bytes func)
        require(bytes4(callData[0:4]) == 0xb61d27f6, "Paymaster: Must use execute()");

        dest = address(bytes20(callData[16:36]));

        // Extract the bytes func from callData to get the inner selector
        // callData layout: selector(4) + dest(32) + value(32) + offsetToFunc(32) + funcLength(32) + funcBytes
        // Offset to func Length is at callData[68:100]
        uint256 dataOffset = uint256(bytes32(callData[68:100])) + 4; // Add 4 for the outer selector

        if (callData.length < dataOffset + 32) {
            return (dest, bytes4(0));
        }

        uint256 dataLength = uint256(bytes32(callData[dataOffset:dataOffset + 32]));

        if (dataLength >= 4) {
            selector = bytes4(callData[dataOffset + 32:dataOffset + 36]);
        } else {
            selector = bytes4(0);
        }
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
        (address dest, bytes4 selector) = _decodeExecute(userOp.callData);

        // Rule A: mine() is permanently FREE
        if (dest == address(AGC_TOKEN) && selector == AgentGenesisCoin.mine.selector) {
            // Mode 0 = Free
            context = abi.encode(uint8(0), userOp.sender, uint256(0));
            return (context, 0); // 0 means signature validation success (we don't need additional paymaster sigs here)
        }

        // Mode 1 = Charge AGC
        require(userOp.verificationGasLimit > POST_OP_GAS, "Paymaster: gas too low for postOp");

        Reserves pairReserves = StateLibrary.getPairReserves(VAULT, POOL_ID);
        Reserves truncatedReserves = StateLibrary.getTruncatedReserves(VAULT, POOL_ID);

        // Calculate maxCost in AGC (currency1, so zeroForOne = false)
        (uint256 amountIn,,) = SwapMath.getAmountIn(pairReserves, truncatedReserves, POOL_FEE, false, maxCost);

        // Deduct AGC tokens from sender
        AGC_TOKEN.safeTransferFrom(userOp.sender, address(this), amountIn);

        context = abi.encode(uint8(1), userOp.sender, amountIn);
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
        (uint8 paymasterMode, address sender, uint256 amountIn) = abi.decode(context, (uint8, address, uint256));

        // If it's a Likwid protocol call (Mode 1), charge the AGC
        if (paymasterMode == 1) {
            // Approve PM to use our AGC tokens
            AGC_TOKEN.forceApprove(address(POSITION_MANAGER), amountIn);

            // Swap AGC to get exactly actualGasCost of ETH
            IPairPositionManager.SwapOutputParams memory params = IPairPositionManager.SwapOutputParams({
                poolId: POOL_ID,
                zeroForOne: false,
                to: address(this),
                amountInMax: amountIn,
                amountOut: actualGasCost,
                deadline: block.timestamp + 30
            });

            // This swap will trigger receive() and deposit ETH to EntryPoint automatically
            (,, uint256 amountInUsed) = POSITION_MANAGER.exactOutput(params);

            // Clear remaining allowance
            AGC_TOKEN.forceApprove(address(POSITION_MANAGER), 0);

            // Refund the unused AGC back to the sender
            if (amountIn > amountInUsed) {
                AGC_TOKEN.safeTransfer(sender, amountIn - amountInUsed);
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
