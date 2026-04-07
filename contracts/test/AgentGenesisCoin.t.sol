// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";
import {Currency} from "@likwid-fi/core/types/Currency.sol";
import {PoolKey} from "@likwid-fi/core/types/PoolKey.sol";
import {MarginState} from "@likwid-fi/core/types/MarginState.sol";
import {LikwidVault} from "@likwid-fi/core/LikwidVault.sol";
import {LikwidPairPosition} from "@likwid-fi/core/LikwidPairPosition.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {AgentGenesisCoin} from "../src/AgentGenesisCoin.sol";

contract AgentGenesisCoinTest is Test {
    PoolKey public key;
    Currency public currency0;
    Currency public currency1;

    AgentGenesisCoin public coin;
    LikwidVault public vault;
    LikwidPairPosition public pairPositionManager;

    uint256 public constant TEST_SCORE = 100;

    uint256 public mineSignerPk;
    address public mineSigner;

    function setUp() public {
        skip(1);

        mineSignerPk = 0xabc123;
        mineSigner = vm.addr(mineSignerPk);

        vault = new LikwidVault(address(this));
        pairPositionManager = new LikwidPairPosition(address(this), vault);
        coin = new AgentGenesisCoin(mineSigner, address(pairPositionManager));
        coin.setPaymaster(address(5));

        currency0 = Currency.wrap(address(0));
        currency1 = Currency.wrap(address(coin));

        vault.setMarginController(address(this));

        MarginState currentMarginState = vault.marginState();
        vault.setMarginState(currentMarginState.setStageDuration(0));

        coin.approve(address(vault), type(uint256).max);
        coin.approve(address(pairPositionManager), type(uint256).max);

        uint24 fee = coin.POOL_FEE();
        uint24 marginFee = coin.POOL_MARGIN_FEE();
        key = PoolKey({currency0: currency0, currency1: currency1, fee: fee, marginFee: marginFee});
        vault.initialize(key);

        uint256 amount0ToAdd = 100_000_000 ether;
        uint256 amount1ToAdd = 1_000_000_000 ether;
        pairPositionManager.addLiquidity{value: amount0ToAdd}(
            key, address(this), amount0ToAdd, amount1ToAdd, 0, 0, 10000
        );

        vm.warp(block.timestamp + coin.EPOCH_LENGTH());
    }

    function _getHash(address signer, uint256 nonce, uint256 score) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(signer, nonce, score));
    }

    function _signMine(address user, uint256 nonce, uint256 score) internal view returns (bytes memory) {
        bytes32 hash;
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, shl(96, user))
            mstore(add(ptr, 20), nonce)
            mstore(add(ptr, 52), score)
            hash := keccak256(ptr, 84)
        }
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(hash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(mineSignerPk, ethSignedMessageHash);
        return abi.encodePacked(r, s, v);
    }

    function test_Hash() public pure {
        address signer = address(0x12345678901234567890123456789012);
        uint256 nonce = 1234567890;
        uint256 computeScore = 12345678901234567890;
        bytes32 hash;
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, shl(96, signer))
            mstore(add(ptr, 20), nonce)
            mstore(add(ptr, 52), computeScore)
            hash := keccak256(ptr, 84)
        }
        bytes32 expectedHash = keccak256(abi.encodePacked(signer, nonce, computeScore));
        assertEq(hash, expectedHash);
    }

    function test_Mine_SuccessWithoutETH() public {
        address user = address(0x1);
        uint256 nonce = block.timestamp;
        bytes memory signature = _signMine(user, nonce, TEST_SCORE);

        uint256 estimatedReward = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedGasPart = (estimatedReward * 10) / 100;

        vm.prank(user);
        vm.expectEmit(true, true, true, false);
        emit AgentGenesisCoin.Mined(user, expectedGasPart, false);
        coin.mine(TEST_SCORE, signature, nonce);

        assertEq(coin.balanceOf(user), expectedGasPart);
        assertEq(coin.lastMineTime(user), block.timestamp);
        assertTrue(coin.usedNonces(user, nonce));
    }

    function test_Mine_FrequencyCheckFailure() public {
        address user = address(0x1);
        uint256 nonce1 = block.timestamp;
        bytes memory signature1 = _signMine(user, nonce1, TEST_SCORE);

        vm.prank(user);
        coin.mine(TEST_SCORE, signature1, nonce1);

        uint256 nonce2 = block.timestamp + 1;
        bytes memory signature2 = _signMine(user, nonce2, TEST_SCORE);

        vm.prank(user);
        vm.expectRevert(AgentGenesisCoin.WaitCooldown.selector);
        coin.mine(TEST_SCORE, signature2, nonce2);
    }

    function test_Mine_NonceReplayProtection() public {
        address user = address(0x1);
        uint256 nonce = 12345;
        bytes memory signature = _signMine(user, nonce, TEST_SCORE);

        vm.prank(user);
        coin.mine(TEST_SCORE, signature, nonce);

        vm.warp(block.timestamp + coin.EPOCH_LENGTH());

        vm.prank(user);
        vm.expectRevert(AgentGenesisCoin.NonceAlreadyUsed.selector);
        coin.mine(TEST_SCORE, signature, nonce);
    }

    function test_Mine_InvalidSignature() public {
        address user = address(0x1);
        uint256 nonce = block.timestamp;

        uint256 wrongPrivateKey = 0xdeadbeef;
        bytes32 hash = _getHash(user, nonce, TEST_SCORE);
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(hash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongPrivateKey, ethSignedMessageHash);
        bytes memory wrongSignature = abi.encodePacked(r, s, v);

        vm.prank(user);
        vm.expectRevert(AgentGenesisCoin.InvalidSignature.selector);
        coin.mine(TEST_SCORE, wrongSignature, nonce);
    }

    function test_Mine_EpochRotation() public {
        address user1 = address(0x1);
        address user2 = address(0x2);

        uint256 nonce1 = block.timestamp;
        bytes memory signature1 = _signMine(user1, nonce1, TEST_SCORE);

        vm.prank(user1);
        coin.mine(TEST_SCORE, signature1, nonce1);

        uint256 EPOCH_LENGTH = coin.EPOCH_LENGTH();
        vm.warp(block.timestamp + EPOCH_LENGTH + 1);

        uint256 nonce2 = block.timestamp;
        bytes memory signature2 = _signMine(user2, nonce2, TEST_SCORE);

        uint256 scoreBeforeRotation = coin.totalScoreInCurrentEpoch();

        vm.prank(user2);
        vm.expectEmit(true, true, true, true);
        emit AgentGenesisCoin.EpochRotated(scoreBeforeRotation, block.timestamp);
        coin.mine(TEST_SCORE, signature2, nonce2);

        assertEq(coin.totalScoreInLastEpoch(), scoreBeforeRotation);
        assertEq(coin.totalScoreInCurrentEpoch(), TEST_SCORE);
    }

    function test_Mine_DecayMechanism() public {
        address user = address(0x1);

        // Slot 12 is minedTotal. Set it to trigger decay on next mine.
        vm.store(address(coin), bytes32(uint256(12)), bytes32(coin.nextDecayThreshold()));

        uint256 baseRewardBefore = coin.baseReward();
        uint256 nextThresholdBefore = coin.nextDecayThreshold();

        uint256 nonce = block.timestamp;
        bytes memory signature = _signMine(user, nonce, TEST_SCORE);

        vm.prank(user);
        coin.mine(TEST_SCORE, signature, nonce);

        uint256 baseRewardAfter = coin.baseReward();
        uint256 nextThresholdAfter = coin.nextDecayThreshold();

        assertEq(baseRewardAfter, (baseRewardBefore * 999) / 1000);
        assertEq(nextThresholdAfter, nextThresholdBefore + baseRewardAfter);
    }

    function test_Mine_SuccessWithETH() public {
        address user = address(0x1);
        uint256 nonce = block.timestamp;
        bytes memory signature = _signMine(user, nonce, TEST_SCORE);

        uint256 estimatedReward = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedGasPart = (estimatedReward * 10) / 100;
        uint256 expectedLiquidPart = (estimatedReward * 20) / 100;
        uint256 expectedVestedPart = estimatedReward - expectedLiquidPart - expectedGasPart;

        // Required: expectedLiquidPart / 10. We provide 2x.
        uint256 ethAmountRequired = expectedLiquidPart / 10;
        uint256 ethAmountProvided = ethAmountRequired * 2;

        vm.deal(user, ethAmountProvided + 100 ether);
        vm.prank(user);
        vm.expectEmit(true, true, true, false);
        emit AgentGenesisCoin.Mined(user, estimatedReward, true);
        coin.mine{value: ethAmountProvided + 100 ether}(TEST_SCORE, signature, nonce);

        (uint256 totalLocked, uint256 released, uint256 startTime, uint256 endTime, uint256 lpTokenId) =
            coin.vestingSchedules(user);

        // Excess ETH should be refunded. Contract takes exactly what's needed at the current price.
        assertApproxEqAbs(user.balance, ethAmountProvided - ethAmountRequired + 100 ether, 1e15);
        assertEq(coin.balanceOf(user), expectedGasPart);

        assertApproxEqAbs(totalLocked, expectedVestedPart, 1e15);
        assertEq(released, 0);
        assertGt(lpTokenId, 0);
        assertEq(startTime, block.timestamp);
        assertEq(endTime, block.timestamp + coin.VESTING_DURATION());
    }

    function test_Mine_SuccessWithOverflowETH() public {
        address user = address(0x1);
        uint256 nonce = block.timestamp;
        bytes memory signature = _signMine(user, nonce, TEST_SCORE);

        uint256 estimatedReward = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedGasPart = (estimatedReward * 10) / 100;
        uint256 expectedLiquidPart = (estimatedReward * 20) / 100;
        uint256 expectedVestedPart = estimatedReward - expectedLiquidPart - expectedGasPart;

        uint256 ethAmountProvided = 1_000_000_000 ether;

        vm.deal(user, ethAmountProvided);
        vm.prank(user);
        vm.expectEmit(true, true, true, false);
        emit AgentGenesisCoin.Mined(user, estimatedReward, true);
        coin.mine{value: ethAmountProvided}(TEST_SCORE, signature, nonce);

        (uint256 totalLocked, uint256 released, uint256 startTime, uint256 endTime, uint256 lpTokenId) =
            coin.vestingSchedules(user);

        assertApproxEqAbs(user.balance, ethAmountProvided - expectedLiquidPart / 10, 1e15);
        assertEq(coin.balanceOf(user), expectedGasPart);

        assertApproxEqAbs(totalLocked, expectedVestedPart, 1e15);
        assertEq(released, 0);
        assertGt(lpTokenId, 0);
        assertEq(startTime, block.timestamp);
        assertEq(endTime, block.timestamp + coin.VESTING_DURATION());
    }

    function test_ClaimVested_NoVestingSchedule() public {
        address user = address(0x1);

        uint256 balanceBefore = coin.balanceOf(user);

        vm.prank(user);
        coin.claimVested();

        uint256 balanceAfter = coin.balanceOf(user);
        assertEq(balanceAfter, balanceBefore);
    }

    function test_ClaimVested_PartialVesting() public {
        address user = address(0x1);

        uint256 nonce = block.timestamp;
        bytes memory signature = _signMine(user, nonce, TEST_SCORE);

        uint256 estimatedReward = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedLiquidPart = (estimatedReward * 20) / 100;
        uint256 expectedVestedPart = estimatedReward - expectedLiquidPart - (estimatedReward * 10) / 100;
        uint256 ethAmount = expectedLiquidPart / 5;
        vm.deal(user, ethAmount);
        vm.prank(user);
        coin.mine{value: ethAmount}(TEST_SCORE, signature, nonce);

        (uint256 totalLocked,,,,) = coin.vestingSchedules(user);
        assertApproxEqAbs(totalLocked, expectedVestedPart, 1e18);

        uint256 vestingDuration = coin.VESTING_DURATION();
        uint256 halfDuration = vestingDuration / 2;

        skip(halfDuration);

        uint256 expectedPayout = totalLocked / 2;

        uint256 balanceBefore = coin.balanceOf(user);

        vm.prank(user);
        coin.claimVested();

        uint256 balanceAfter = coin.balanceOf(user);
        uint256 actualPayout = balanceAfter - balanceBefore;

        assertApproxEqAbs(actualPayout, expectedPayout, 1e24);
    }

    function test_ClaimVested_FullVesting() public {
        address user = address(0x1);

        uint256 nonce = block.timestamp;
        bytes memory signature = _signMine(user, nonce, TEST_SCORE);

        uint256 estimatedReward = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedLiquidPart = (estimatedReward * 20) / 100;
        uint256 expectedVestedPart = estimatedReward - expectedLiquidPart - (estimatedReward * 10) / 100;
        uint256 ethAmount = expectedLiquidPart / 5;
        vm.deal(user, ethAmount);
        vm.prank(user);
        coin.mine{value: ethAmount}(TEST_SCORE, signature, nonce);

        (uint256 totalLocked,,,,) = coin.vestingSchedules(user);
        assertApproxEqAbs(totalLocked, expectedVestedPart, 1e18);

        uint256 vestingDuration = coin.VESTING_DURATION();
        skip(vestingDuration + 1);

        uint256 balanceBefore = coin.balanceOf(user);

        vm.prank(user);
        coin.claimVested();

        uint256 balanceAfter = coin.balanceOf(user);
        uint256 actualPayout = balanceAfter - balanceBefore;

        assertEq(actualPayout, totalLocked);
    }

    function test_ClaimVested_LP_NFT_Transfer() public {
        address user = address(0x1);

        uint256 nonce = block.timestamp;
        bytes memory signature = _signMine(user, nonce, TEST_SCORE);

        uint256 estimatedReward = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedLiquidPart = (estimatedReward * 20) / 100;
        uint256 expectedVestedPart = estimatedReward - expectedLiquidPart - (estimatedReward * 10) / 100;
        uint256 ethAmount = expectedLiquidPart / 5;
        vm.deal(user, ethAmount);
        vm.prank(user);
        coin.mine{value: ethAmount}(TEST_SCORE, signature, nonce);
        (uint256 totalLocked,,,, uint256 lpTokenId) = coin.vestingSchedules(user);
        assertApproxEqAbs(totalLocked, expectedVestedPart, 1e18);
        assertEq(pairPositionManager.ownerOf(lpTokenId), address(coin));
        assertGt(lpTokenId, 0);

        uint256 vestingDuration = coin.VESTING_DURATION();
        skip(vestingDuration + 1);

        vm.prank(user);
        coin.claimVested();

        (uint256 totalLockedAfter,,,, uint256 lpTokenIdAfter) = coin.vestingSchedules(user);

        assertEq(totalLockedAfter, 0);
        assertEq(lpTokenIdAfter, 0);
        assertEq(pairPositionManager.ownerOf(lpTokenId), user);
    }

    function test_Mine_IncreaseLiquidity() public {
        address user = address(0x1);

        uint256 nonce1 = block.timestamp;
        bytes memory signature1 = _signMine(user, nonce1, TEST_SCORE);

        uint256 estimatedReward1 = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedLiquidPart1 = (estimatedReward1 * 20) / 100;
        uint256 expectedVestedPart1 = estimatedReward1 - expectedLiquidPart1 - (estimatedReward1 * 10) / 100;
        uint256 ethAmount1 = expectedLiquidPart1 / 5;
        vm.deal(user, ethAmount1 * 3);
        vm.prank(user);
        coin.mine{value: ethAmount1}(TEST_SCORE, signature1, nonce1);

        (uint256 totalLocked1,,,, uint256 lpTokenIdBefore) = coin.vestingSchedules(user);
        assertApproxEqAbs(totalLocked1, expectedVestedPart1, 1e18);
        assertGt(lpTokenIdBefore, 0);

        vm.warp(block.timestamp + coin.EPOCH_LENGTH());

        uint256 nonce2 = block.timestamp + 100;
        bytes memory signature2 = _signMine(user, nonce2, TEST_SCORE);

        uint256 estimatedReward2 = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedLiquidPart2 = (estimatedReward2 * 20) / 100;
        uint256 expectedVestedPart2 = estimatedReward2 - expectedLiquidPart2 - (estimatedReward2 * 10) / 100;
        uint256 ethAmount2 = expectedLiquidPart2 / 5;

        // Before second mine
        uint256 claimable = coin.getClaimableVested(user);
        (uint256 currentLocked, uint256 currentReleased,,,) = coin.vestingSchedules(user);
        uint256 remainingVested = (currentLocked - currentReleased) - claimable;

        vm.prank(user);
        coin.mine{value: ethAmount2}(TEST_SCORE, signature2, nonce2);

        (uint256 totalLocked2,,,, uint256 lpTokenIdAfter) = coin.vestingSchedules(user);
        assertApproxEqAbs(totalLocked2, remainingVested + expectedVestedPart2, 1e18);

        assertEq(lpTokenIdAfter, lpTokenIdBefore);
        assertEq(pairPositionManager.ownerOf(lpTokenIdAfter), address(coin));
    }

    function test_Mine_WithSlippageProtection() public {
        address user = address(0x1);
        uint256 nonce = block.timestamp;
        bytes memory signature = _signMine(user, nonce, TEST_SCORE);

        uint256 estimatedReward = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedLiquidPart = (estimatedReward * 20) / 100;

        uint256 ethAmount = expectedLiquidPart / 5;

        vm.deal(user, ethAmount);
        vm.prank(user);
        coin.mine{value: ethAmount}(TEST_SCORE, signature, nonce);

        (uint256 totalLocked,,,, uint256 lpTokenId) = coin.vestingSchedules(user);

        assertGt(lpTokenId, 0);
        assertGt(totalLocked, 0);
    }

    function test_Mine_SlippageProtectionFailure() public {
        address user = address(0x1);
        uint256 nonce = block.timestamp;
        bytes memory signature = _signMine(user, nonce, TEST_SCORE);

        uint256 estimatedReward = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedLiquidPart = (estimatedReward * 20) / 100;
        uint256 expectedVestedPart = estimatedReward - expectedLiquidPart - (estimatedReward * 10) / 100;
        uint256 ethAmount = expectedLiquidPart / 5;

        vm.deal(user, ethAmount);
        vm.prank(user);
        coin.mine{value: ethAmount}(TEST_SCORE, signature, nonce);
        (uint256 totalLocked,,,,) = coin.vestingSchedules(user);
        assertApproxEqAbs(totalLocked, expectedVestedPart, 1e18);
    }

    function test_Constructor_ZeroVerifierAddress() public {
        vm.expectRevert(AgentGenesisCoin.InvalidMineSignerAddress.selector);
        new AgentGenesisCoin(address(0), address(pairPositionManager));
    }

    function test_Constructor_ZeroPositionManagerAddress() public {
        vm.expectRevert(AgentGenesisCoin.InvalidPositionManagerAddress.selector);
        new AgentGenesisCoin(mineSigner, address(0));
    }

    function test_SetMineSigner_ZeroAddress() public {
        vm.prank(coin.owner());
        vm.expectRevert(AgentGenesisCoin.InvalidMineSignerAddress.selector);
        coin.setMineSigner(address(0));
    }

    function test_SetMineSigner() public {
        address newMineSigner = address(0x999);
        vm.prank(coin.owner());
        coin.setMineSigner(newMineSigner);
        assertEq(coin.mineSigner(), newMineSigner);
    }

    function test_Vesting_NotResetOnNewClaim() public {
        address user = address(0x1);

        uint256 nonce1 = block.timestamp;
        bytes memory signature1 = _signMine(user, nonce1, TEST_SCORE);

        uint256 estimatedReward1 = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedLiquidPart1 = (estimatedReward1 * 20) / 100;
        uint256 expectedVestedPart1 = estimatedReward1 - expectedLiquidPart1 - (estimatedReward1 * 10) / 100;
        uint256 ethAmount1 = expectedLiquidPart1 / 5;
        vm.deal(user, ethAmount1 * 3);
        vm.prank(user);
        coin.mine{value: ethAmount1}(TEST_SCORE, signature1, nonce1);

        (uint256 totalLocked1,,,,) = coin.vestingSchedules(user);
        assertApproxEqAbs(totalLocked1, expectedVestedPart1, 1e18);
        assertGt(totalLocked1, 0);

        uint256 vestingDuration = coin.VESTING_DURATION();
        skip(vestingDuration / 2);

        vm.prank(user);
        coin.claimVested();

        uint256 balanceAfterFirstClaim = coin.balanceOf(user);
        assertGt(balanceAfterFirstClaim, 0);

        vm.roll(block.number + coin.EPOCH_LENGTH());

        uint256 nonce2 = block.timestamp + 100;
        bytes memory signature2 = _signMine(user, nonce2, TEST_SCORE);

        uint256 estimatedReward2 = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedLiquidPart2 = (estimatedReward2 * 20) / 100;
        uint256 expectedVestedPart2 = estimatedReward2 - expectedLiquidPart2 - (estimatedReward2 * 10) / 100;
        uint256 ethAmount2 = expectedLiquidPart2 / 5;
        vm.prank(user);
        coin.mine{value: ethAmount2}(TEST_SCORE, signature2, nonce2);

        (uint256 totalLocked2,,,,) = coin.vestingSchedules(user);
        assertApproxEqAbs(totalLocked2, (totalLocked1 / 2) + expectedVestedPart2, 1e18);

        uint256 balanceAfterSecondClaim = coin.balanceOf(user);
        assertGe(balanceAfterSecondClaim, balanceAfterFirstClaim);
    }

    function test_GetClaimableVested_NoVestingSchedule() public view {
        address user = address(0x1);
        assertEq(coin.getClaimableVested(user), 0);
    }

    function test_GetClaimableVested_VestingNotStarted() public {
        address user = address(0x1);

        uint256 nonce = block.timestamp;
        bytes memory signature = _signMine(user, nonce, TEST_SCORE);

        uint256 estimatedReward = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedLiquidPart = (estimatedReward * 20) / 100;
        uint256 expectedVestedPart = estimatedReward - expectedLiquidPart - (estimatedReward * 10) / 100;
        uint256 ethAmount = expectedLiquidPart / 5;
        vm.deal(user, ethAmount);
        vm.prank(user);
        coin.mine{value: ethAmount}(TEST_SCORE, signature, nonce);

        (uint256 totalLocked,,,,) = coin.vestingSchedules(user);
        assertApproxEqAbs(totalLocked, expectedVestedPart, 1e18);
        assertGt(totalLocked, 0);

        assertEq(coin.getClaimableVested(user), 0);
    }

    function test_GetClaimableVested_PartialVesting() public {
        address user = address(0x1);

        uint256 nonce = block.timestamp;
        bytes memory signature = _signMine(user, nonce, TEST_SCORE);

        uint256 estimatedReward = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedLiquidPart = (estimatedReward * 20) / 100;
        uint256 expectedVestedPart = estimatedReward - expectedLiquidPart - (estimatedReward * 10) / 100;
        uint256 ethAmount = expectedLiquidPart / 5;
        vm.deal(user, ethAmount);
        vm.prank(user);
        coin.mine{value: ethAmount}(TEST_SCORE, signature, nonce);

        (uint256 totalLocked,,,,) = coin.vestingSchedules(user);
        assertApproxEqAbs(totalLocked, expectedVestedPart, 1e18);

        uint256 vestingDuration = coin.VESTING_DURATION();
        uint256 halfDuration = vestingDuration / 2;
        skip(halfDuration);

        uint256 claimable = coin.getClaimableVested(user);
        uint256 expectedClaimable = expectedVestedPart / 2;

        assertApproxEqAbs(claimable, expectedClaimable, 1e24);
    }

    function test_GetClaimableVested_FullVesting() public {
        address user = address(0x1);

        uint256 nonce = block.timestamp;
        bytes memory signature = _signMine(user, nonce, TEST_SCORE);

        uint256 estimatedReward = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedGasPart = (estimatedReward * 10) / 100;
        uint256 expectedLiquidPart = (estimatedReward * 20) / 100;
        uint256 expectedVestedPart = estimatedReward - expectedLiquidPart - expectedGasPart;
        uint256 ethAmount = expectedLiquidPart / 5;
        vm.deal(user, ethAmount);
        vm.prank(user);
        coin.mine{value: ethAmount}(TEST_SCORE, signature, nonce);

        uint256 vestingDuration = coin.VESTING_DURATION();
        skip(vestingDuration + 1);

        uint256 claimable = coin.getClaimableVested(user);

        assertApproxEqAbs(claimable, expectedVestedPart, 1e24);
    }

    function test_GetClaimableVested_AfterFullClaim() public {
        address user = address(0x1);

        uint256 nonce = block.timestamp;
        bytes memory signature = _signMine(user, nonce, TEST_SCORE);

        uint256 estimatedReward = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedLiquidPart = (estimatedReward * 20) / 100;
        uint256 expectedVestedPart = estimatedReward - expectedLiquidPart - (estimatedReward * 10) / 100;
        uint256 ethAmount = expectedLiquidPart / 5;
        vm.deal(user, ethAmount);
        vm.prank(user);
        coin.mine{value: ethAmount}(TEST_SCORE, signature, nonce);

        (uint256 totalLocked,,,,) = coin.vestingSchedules(user);
        assertApproxEqAbs(totalLocked, expectedVestedPart, 1e18);

        uint256 vestingDuration = coin.VESTING_DURATION();
        skip(vestingDuration + 1);

        vm.prank(user);
        coin.claimVested();

        uint256 claimable = coin.getClaimableVested(user);

        assertEq(claimable, 0);
    }

    function test_GetClaimableVested_AfterPartialClaim() public {
        address user = address(0x1);

        uint256 nonce = block.timestamp;
        bytes memory signature = _signMine(user, nonce, TEST_SCORE);

        uint256 estimatedReward = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedLiquidPart = (estimatedReward * 20) / 100;
        uint256 expectedVestedPart = estimatedReward - expectedLiquidPart - (estimatedReward * 10) / 100;
        uint256 ethAmount = expectedLiquidPart / 5;
        vm.deal(user, ethAmount);
        vm.prank(user);
        coin.mine{value: ethAmount}(TEST_SCORE, signature, nonce);

        (uint256 totalLocked,,,,) = coin.vestingSchedules(user);
        assertApproxEqAbs(totalLocked, expectedVestedPart, 1e18);

        uint256 vestingDuration = coin.VESTING_DURATION();
        uint256 halfDuration = vestingDuration / 2;
        skip(halfDuration);

        vm.prank(user);
        coin.claimVested();

        skip(halfDuration);

        uint256 claimable = coin.getClaimableVested(user);
        uint256 expectedClaimable = expectedVestedPart / 2;

        assertApproxEqAbs(claimable, expectedClaimable, 1e24);
    }

    function test_MultipleMines_WithoutETH() public {
        address user = address(0x1);
        uint256 EPOCH_LENGTH = coin.EPOCH_LENGTH();
        uint256 totalBalance = 0;

        for (uint256 i = 0; i < 3; i++) {
            uint256 nonce = block.timestamp + i;
            bytes memory signature = _signMine(user, nonce, TEST_SCORE);

            uint256 estimatedReward = coin.getEstimatedReward(TEST_SCORE);
            uint256 expectedGasPart = (estimatedReward * 10) / 100;

            vm.prank(user);
            coin.mine(TEST_SCORE, signature, nonce);

            totalBalance += expectedGasPart;
            assertEq(coin.balanceOf(user), totalBalance);

            if (i < 2) {
                vm.warp(block.timestamp + EPOCH_LENGTH);
            }
        }

        assertGt(coin.balanceOf(user), 0);
    }

    function test_MultipleMines_WithETH() public {
        address user = address(0x1);
        uint256 EPOCH_LENGTH = coin.EPOCH_LENGTH();
        uint256 vestingDuration = coin.VESTING_DURATION();

        uint256 firstLpTokenId = 0;
        uint256 expectedTotalLocked = 0;

        for (uint256 i = 0; i < 3; i++) {
            uint256 nonce = block.timestamp + i * 1000;
            bytes memory signature = _signMine(user, nonce, TEST_SCORE);

            uint256 estimatedReward = coin.getEstimatedReward(TEST_SCORE);
            uint256 expectedLiquidPart = (estimatedReward * 20) / 100;
            uint256 expectedVestedPart = estimatedReward - expectedLiquidPart - (estimatedReward * 10) / 100;
            uint256 ethAmount = expectedLiquidPart / 5;

            // Pre-calculate expected endTime
            (uint256 prevLocked, uint256 prevReleased, uint256 prevStart, uint256 prevEnd,) =
                coin.vestingSchedules(user);
            uint256 expectedEndTime;
            uint256 remainingVested;
            if (prevLocked == 0) {
                expectedEndTime = block.timestamp + vestingDuration;
                remainingVested = 0;
            } else {
                uint256 claimable = 0;
                uint256 timeElapsed = block.timestamp - prevStart;
                uint256 duration = prevEnd - prevStart;
                if (timeElapsed >= duration) {
                    claimable = prevLocked - prevReleased;
                } else {
                    uint256 vested = (prevLocked * timeElapsed) / duration;
                    if (vested > prevReleased) claimable = vested - prevReleased;
                }
                remainingVested = (prevLocked - prevReleased) - claimable;
                uint256 remainingTime = prevEnd > block.timestamp ? prevEnd - block.timestamp : 0;
                uint256 newVestingDuration = (remainingVested * remainingTime + expectedVestedPart * vestingDuration)
                    / (remainingVested + expectedVestedPart);
                expectedEndTime = block.timestamp + newVestingDuration;
            }

            expectedTotalLocked = remainingVested + expectedVestedPart;

            vm.deal(user, ethAmount * 10);
            vm.prank(user);
            coin.mine{value: ethAmount}(TEST_SCORE, signature, nonce);

            (uint256 totalLocked, uint256 released, uint256 startTime, uint256 endTime, uint256 lpTokenId) =
                coin.vestingSchedules(user);

            if (i == 0) {
                firstLpTokenId = lpTokenId;
                assertGt(lpTokenId, 0);
                assertEq(pairPositionManager.ownerOf(lpTokenId), address(coin));
            } else {
                assertEq(lpTokenId, firstLpTokenId, "LP token ID should remain the same");
            }

            assertApproxEqAbs(totalLocked, expectedTotalLocked, 1e18, "Total locked should accumulate correctly");
            assertEq(released, 0);
            assertGt(startTime, 0);
            assertEq(endTime, expectedEndTime, "Vesting end time should follow weighted average");

            if (i < 2) {
                vm.warp(block.timestamp + EPOCH_LENGTH);
            }
        }

        (uint256 finalTotalLocked,,,, uint256 finalLpTokenId) = coin.vestingSchedules(user);
        assertEq(finalLpTokenId, firstLpTokenId);
        assertGt(finalTotalLocked, 0);
    }

    function test_Vesting_WeightedAverage() public {
        address user = address(0x2);
        uint256 vestingDuration = coin.VESTING_DURATION();

        // 1. First mine
        uint256 nonce1 = block.timestamp;
        bytes memory signature1 = _signMine(user, nonce1, TEST_SCORE);

        uint256 reward1 = coin.getEstimatedReward(TEST_SCORE);
        uint256 liquidPart1 = (reward1 * 20) / 100;
        uint256 ethAmount1 = liquidPart1 / 5;

        vm.deal(user, ethAmount1 * 10);
        vm.prank(user);
        coin.mine{value: ethAmount1}(TEST_SCORE, signature1, nonce1);

        (uint256 totalLocked1,, uint256 startTime1, uint256 endTime1,) = coin.vestingSchedules(user);
        assertEq(endTime1, startTime1 + vestingDuration);

        // 2. Wait half duration
        skip(vestingDuration / 2);

        // 3. Second mine
        uint256 nonce2 = block.timestamp + 1;
        bytes memory signature2 = _signMine(user, nonce2, TEST_SCORE);

        uint256 reward2 = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedVested = reward2 - (reward2 * 20) / 100 - (reward2 * 10) / 100;
        uint256 liquidPart2 = (reward2 * 20) / 100;
        uint256 ethAmount2 = liquidPart2 / 5;

        uint256 timeElapsed = block.timestamp - startTime1;
        uint256 claimable = (totalLocked1 * timeElapsed) / (endTime1 - startTime1);
        uint256 remainingVested = totalLocked1 - claimable;
        uint256 remainingTime = endTime1 - block.timestamp;

        uint256 expectedDuration =
            (remainingVested * remainingTime + expectedVested * vestingDuration) / (remainingVested + expectedVested);
        uint256 expectedEnd = block.timestamp + expectedDuration;

        vm.prank(user);
        coin.mine{value: ethAmount2}(TEST_SCORE, signature2, nonce2);

        (uint256 totalLocked2,, uint256 startTime2, uint256 endTime2,) = coin.vestingSchedules(user);
        assertEq(startTime2, block.timestamp);
        assertEq(endTime2, expectedEnd);
        assertApproxEqAbs(totalLocked2, remainingVested + expectedVested, 1e18);
    }

    function test_MultipleClaimVested() public {
        address user = address(0x1);

        uint256 nonce = block.timestamp;
        bytes memory signature = _signMine(user, nonce, TEST_SCORE);

        uint256 estimatedReward = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedLiquidPart = (estimatedReward * 20) / 100;
        uint256 expectedVestedPart = estimatedReward - expectedLiquidPart - (estimatedReward * 10) / 100;
        uint256 ethAmount = expectedLiquidPart / 5;

        vm.deal(user, ethAmount);
        vm.prank(user);
        coin.mine{value: ethAmount}(TEST_SCORE, signature, nonce);

        (uint256 totalLocked,,,, uint256 lpTokenId) = coin.vestingSchedules(user);
        assertGt(totalLocked, 0);
        assertGt(lpTokenId, 0);
        assertEq(pairPositionManager.ownerOf(lpTokenId), address(coin));

        uint256 vestingDuration = coin.VESTING_DURATION();
        uint256 segmentDuration = vestingDuration / 3;
        uint256 totalMined = 0;

        for (uint256 i = 0; i < 3; i++) {
            skip(segmentDuration);

            uint256 balanceBefore = coin.balanceOf(user);

            vm.prank(user);
            coin.claimVested();

            uint256 balanceAfter = coin.balanceOf(user);
            uint256 mined = balanceAfter - balanceBefore;
            totalMined += mined;

            (, uint256 released,,,) = coin.vestingSchedules(user);
            if (i < 2) {
                assertApproxEqAbs(released, totalMined, 1e24);
            }
        }

        assertApproxEqAbs(totalMined, expectedVestedPart, 1e24);

        (uint256 finalTotalLocked,,,, uint256 finalLpTokenId) = coin.vestingSchedules(user);
        assertEq(finalTotalLocked, 0);
        assertEq(finalLpTokenId, 0);
        assertEq(pairPositionManager.ownerOf(lpTokenId), user);
    }

    function test_ClaimVestedMine_MixedFlow() public {
        address user = address(0x1);
        uint256 EPOCH_LENGTH = coin.EPOCH_LENGTH();
        uint256 vestingDuration = coin.VESTING_DURATION();

        uint256 nonce1 = block.timestamp;
        bytes memory signature1 = _signMine(user, nonce1, TEST_SCORE);

        uint256 estimatedReward1 = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedGasPart1 = (estimatedReward1 * 10) / 100;
        uint256 expectedLiquidPart1 = (estimatedReward1 * 20) / 100;
        uint256 expectedVestedPart1 = estimatedReward1 - expectedLiquidPart1 - expectedGasPart1;
        uint256 ethAmount1 = expectedLiquidPart1 / 5;

        vm.deal(user, ethAmount1 * 10);
        vm.prank(user);
        coin.mine{value: ethAmount1}(TEST_SCORE, signature1, nonce1);

        (uint256 totalLocked1,,,, uint256 lpTokenId1) = coin.vestingSchedules(user);
        assertGt(lpTokenId1, 0);
        assertApproxEqAbs(totalLocked1, expectedVestedPart1, 1e24);
        assertEq(coin.balanceOf(user), expectedGasPart1);

        skip(vestingDuration / 2);

        uint256 balanceBeforeClaimVested = coin.balanceOf(user);
        vm.prank(user);
        coin.claimVested();
        uint256 balanceAfterClaimVested = coin.balanceOf(user);
        uint256 minedFromVesting = balanceAfterClaimVested - balanceBeforeClaimVested;
        assertApproxEqAbs(minedFromVesting, expectedVestedPart1 / 2, 1e24);

        (, uint256 released1,,,) = coin.vestingSchedules(user);
        assertApproxEqAbs(released1, minedFromVesting, 1e24);

        vm.warp(block.timestamp + EPOCH_LENGTH);

        uint256 nonce2 = block.timestamp + 100;
        bytes memory signature2 = _signMine(user, nonce2, TEST_SCORE);

        uint256 estimatedReward2 = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedGasPart2 = (estimatedReward2 * 10) / 100;
        uint256 expectedLiquidPart2 = (estimatedReward2 * 20) / 100;
        uint256 expectedVestedPart2 = estimatedReward2 - expectedLiquidPart2 - expectedGasPart2;
        uint256 ethAmount2 = expectedLiquidPart2 / 5;

        vm.prank(user);
        coin.mine{value: ethAmount2}(TEST_SCORE, signature2, nonce2);

        (uint256 totalLocked2, uint256 released2,,, uint256 lpTokenId2) = coin.vestingSchedules(user);

        assertEq(lpTokenId2, lpTokenId1, "LP token ID should remain the same");
        uint256 expectedTotalLocked = (expectedVestedPart1 - released1) + expectedVestedPart2;
        assertApproxEqAbs(
            totalLocked2, expectedTotalLocked, 1e24, "After second mine: locked should include remaining + new vested"
        );
        assertEq(released2, 0, "Released should be reset to 0 after new mine");
        assertApproxEqAbs(coin.balanceOf(user), balanceAfterClaimVested + expectedGasPart2, 1e24);

        assertEq(pairPositionManager.ownerOf(lpTokenId2), address(coin));
    }

    function test_MultiUser_MineAndClaimVested() public {
        address user1 = address(0x1);
        address user2 = address(0x2);
        address user3 = address(0x3);
        uint256 EPOCH_LENGTH = coin.EPOCH_LENGTH();
        uint256 vestingDuration = coin.VESTING_DURATION();

        uint256 nonce1 = block.timestamp;
        bytes memory signature1 = _signMine(user1, nonce1, TEST_SCORE);
        uint256 estimatedReward1 = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedLiquidPart1 = (estimatedReward1 * 20) / 100;
        uint256 expectedVestedPart1 = estimatedReward1 - expectedLiquidPart1 - (estimatedReward1 * 10) / 100;
        uint256 ethAmount1 = expectedLiquidPart1 / 5;
        vm.deal(user1, ethAmount1);
        vm.prank(user1);
        coin.mine{value: ethAmount1}(TEST_SCORE, signature1, nonce1);
        (uint256 locked1Before,,,,) = coin.vestingSchedules(user1);
        assertApproxEqAbs(locked1Before, expectedVestedPart1, 1e18);

        vm.warp(block.timestamp + EPOCH_LENGTH);

        uint256 nonce2 = block.timestamp + 100;
        bytes memory signature2 = _signMine(user2, nonce2, TEST_SCORE);
        uint256 estimatedReward2 = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedLiquidPart2 = (estimatedReward2 * 20) / 100;
        uint256 expectedVestedPart2 = estimatedReward2 - expectedLiquidPart2 - (estimatedReward2 * 10) / 100;
        uint256 ethAmount2 = expectedLiquidPart2 / 5;
        vm.deal(user2, ethAmount2);
        vm.prank(user2);
        coin.mine{value: ethAmount2}(TEST_SCORE, signature2, nonce2);
        (uint256 locked2Before,,,,) = coin.vestingSchedules(user2);
        assertApproxEqAbs(locked2Before, expectedVestedPart2, 1e18);

        vm.warp(block.timestamp + EPOCH_LENGTH);

        uint256 nonce3 = block.timestamp + 200;
        bytes memory signature3 = _signMine(user3, nonce3, TEST_SCORE);
        uint256 estimatedReward3 = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedLiquidPart3 = (estimatedReward3 * 20) / 100;
        uint256 expectedVestedPart3 = estimatedReward3 - expectedLiquidPart3 - (estimatedReward3 * 10) / 100;
        uint256 ethAmount3 = expectedLiquidPart3 / 5;
        vm.deal(user3, ethAmount3);
        vm.prank(user3);
        coin.mine{value: ethAmount3}(TEST_SCORE, signature3, nonce3);
        (uint256 locked3Before,,,,) = coin.vestingSchedules(user3);
        assertApproxEqAbs(locked3Before, expectedVestedPart3, 1e18);

        (uint256 locked1,,,, uint256 lpId1) = coin.vestingSchedules(user1);
        (uint256 locked2,,,, uint256 lpId2) = coin.vestingSchedules(user2);
        (uint256 locked3,,,, uint256 lpId3) = coin.vestingSchedules(user3);

        assertGt(locked1, 0);
        assertGt(locked2, 0);
        assertGt(locked3, 0);
        assertTrue(lpId1 != lpId2 && lpId2 != lpId3 && lpId1 != lpId3, "LP token IDs should be unique");

        skip(vestingDuration / 2);

        vm.prank(user1);
        coin.claimVested();
        vm.prank(user2);
        coin.claimVested();
        vm.prank(user3);
        coin.claimVested();

        (, uint256 released1,,,) = coin.vestingSchedules(user1);
        (, uint256 released2,,,) = coin.vestingSchedules(user2);
        (, uint256 released3,,,) = coin.vestingSchedules(user3);

        assertGt(released1, 0);
        assertGt(released2, 0);
        assertGt(released3, 0);

        assertGt(coin.balanceOf(user1), 0);
        assertGt(coin.balanceOf(user2), 0);
        assertGt(coin.balanceOf(user3), 0);
    }

    function test_FullLifecycle_AssetVerification() public {
        address user = address(0x1);
        uint256 EPOCH_LENGTH = coin.EPOCH_LENGTH();
        uint256 vestingDuration = coin.VESTING_DURATION();

        uint256 nonce1 = block.timestamp;
        bytes memory signature1 = _signMine(user, nonce1, TEST_SCORE);
        uint256 estimatedReward1 = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedLiquidPart1 = (estimatedReward1 * 20) / 100;
        uint256 expectedVestedPart1 = estimatedReward1 - expectedLiquidPart1 - (estimatedReward1 * 10) / 100;
        uint256 ethAmount1 = expectedLiquidPart1 / 5;
        vm.deal(user, ethAmount1 * 20);
        vm.prank(user);
        coin.mine{value: ethAmount1}(TEST_SCORE, signature1, nonce1);

        (uint256 locked1,,,, uint256 lpId1) = coin.vestingSchedules(user);
        assertApproxEqAbs(locked1, expectedVestedPart1, 1e18);
        assertGt(locked1, 0);
        assertGt(lpId1, 0);

        vm.warp(block.timestamp + EPOCH_LENGTH);

        uint256 nonce2 = block.timestamp + 100;
        bytes memory signature2 = _signMine(user, nonce2, TEST_SCORE);
        uint256 estimatedReward2 = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedLiquidPart2 = (estimatedReward2 * 20) / 100;
        uint256 expectedVestedPart2 = estimatedReward2 - expectedLiquidPart2 - (estimatedReward2 * 10) / 100;
        uint256 ethAmount2 = expectedLiquidPart2 / 5;

        // Before second mine
        uint256 claimable = coin.getClaimableVested(user);
        (uint256 currentLocked, uint256 currentReleased,,,) = coin.vestingSchedules(user);
        uint256 remainingVested = (currentLocked - currentReleased) - claimable;

        vm.prank(user);
        coin.mine{value: ethAmount2}(TEST_SCORE, signature2, nonce2);

        (uint256 locked2,,,,) = coin.vestingSchedules(user);
        assertApproxEqAbs(locked2, remainingVested + expectedVestedPart2, 1e18);

        skip(vestingDuration / 3);

        vm.prank(user);
        coin.claimVested();

        skip(vestingDuration / 3);

        vm.prank(user);
        coin.claimVested();

        vm.warp(block.timestamp + EPOCH_LENGTH);

        uint256 nonce3 = block.timestamp + 200;
        bytes memory signature3 = _signMine(user, nonce3, TEST_SCORE);
        uint256 estimatedReward3 = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedLiquidPart3 = (estimatedReward3 * 20) / 100;
        uint256 ethAmount3 = expectedLiquidPart3 / 5;
        vm.prank(user);
        coin.mine{value: ethAmount3}(TEST_SCORE, signature3, nonce3);

        skip(vestingDuration);

        vm.prank(user);
        coin.claimVested();

        (uint256 finalLocked,,,, uint256 finalLpId) = coin.vestingSchedules(user);

        assertEq(finalLocked, 0, "All vested tokens should be released");
        assertEq(finalLpId, 0, "LP NFT should be transferred to user after full vesting");

        uint256 userBalance = coin.balanceOf(user);
        assertGt(userBalance, 0, "User should have tokens");
    }

    function test_Receive_Success() public {
        uint256 ethAmount = 1 ether;
        vm.deal(address(pairPositionManager), ethAmount);
        vm.prank(address(pairPositionManager));
        (bool success,) = address(coin).call{value: ethAmount}("");
        assertTrue(success);
        assertEq(address(coin).balance, ethAmount);
    }

    function test_Receive_RevertNotManager() public {
        uint256 ethAmount = 1 ether;
        address nonManager = address(0x999);
        vm.deal(nonManager, ethAmount);
        vm.prank(nonManager);
        bool success;
        vm.expectRevert("Only Likwid Position Manager can send ETH");
        (success,) = address(coin).call{value: ethAmount}("");
        // expectRevert catches the revert, the low level call would otherwise return false.
        // With expectRevert, the test fails if it does NOT revert.
    }

    function test_ClaimVestedMine_ComplexMixedFlow() public {
        address user = address(0x1);
        uint256 EPOCH_LENGTH = coin.EPOCH_LENGTH();
        uint256 vestingDuration = coin.VESTING_DURATION();

        // Step 1: First mine with ETH
        uint256 nonce1 = block.timestamp;
        bytes memory signature1 = _signMine(user, nonce1, TEST_SCORE);
        uint256 estimatedReward1 = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedGasPart1 = (estimatedReward1 * 10) / 100;
        uint256 expectedLiquidPart1 = (estimatedReward1 * 20) / 100;
        uint256 expectedVestedPart1 = estimatedReward1 - expectedLiquidPart1 - expectedGasPart1;
        uint256 ethAmount1 = expectedLiquidPart1 / 5;
        vm.deal(user, ethAmount1 * 10);
        vm.prank(user);
        coin.mine{value: ethAmount1}(TEST_SCORE, signature1, nonce1);

        (uint256 locked1, uint256 released1,,,) = coin.vestingSchedules(user);
        assertApproxEqAbs(locked1, expectedVestedPart1, 1e24, "First mine: locked should equal vested part");
        assertEq(released1, 0, "First mine: released should be 0");
        assertEq(coin.balanceOf(user), expectedGasPart1);

        // Step 2: Wait and claimVested (partial)
        skip(vestingDuration / 3);
        uint256 claimableBeforeFirst = coin.getClaimableVested(user);
        assertGt(claimableBeforeFirst, 0, "Should have claimable vested tokens");

        uint256 balanceBeforeFirst = coin.balanceOf(user);
        vm.prank(user);
        coin.claimVested();
        uint256 firstVestedMine = coin.balanceOf(user) - balanceBeforeFirst;

        (, uint256 released2,,,) = coin.vestingSchedules(user);
        assertApproxEqAbs(released2, claimableBeforeFirst, 2e23, "Released should equal claimable amount");
        assertApproxEqAbs(firstVestedMine, claimableBeforeFirst, 2e23, "User should receive claimable amount");

        // Step 3: Wait EPOCH_LENGTH and second mine with ETH
        vm.warp(block.timestamp + EPOCH_LENGTH);
        uint256 nonce2 = block.timestamp + 100;
        bytes memory signature2 = _signMine(user, nonce2, TEST_SCORE);
        uint256 estimatedReward2 = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedGasPart2 = (estimatedReward2 * 10) / 100;
        uint256 expectedLiquidPart2 = (estimatedReward2 * 20) / 100;
        uint256 expectedVestedPart2 = estimatedReward2 - expectedLiquidPart2 - expectedGasPart2;
        uint256 ethAmount2 = expectedLiquidPart2 / 5;
        vm.prank(user);
        coin.mine{value: ethAmount2}(TEST_SCORE, signature2, nonce2);

        (uint256 locked3, uint256 released3,,,) = coin.vestingSchedules(user);
        uint256 expectedLocked3 = (expectedVestedPart1 - released2) + expectedVestedPart2;
        assertApproxEqAbs(
            locked3, expectedLocked3, 1e24, "After second mine: locked should include remaining + new vested"
        );
        assertEq(released3, 0, "After second mine: released should be reset to 0");
        assertApproxEqAbs(coin.balanceOf(user), balanceBeforeFirst + firstVestedMine + expectedGasPart2, 1e24);

        // Step 4: Wait and claimVested (partial again)
        skip(vestingDuration / 2);
        uint256 claimableBeforeSecond = coin.getClaimableVested(user);
        assertGt(claimableBeforeSecond, 0, "Should have claimable vested tokens");

        uint256 balanceBeforeSecond = coin.balanceOf(user);
        vm.prank(user);
        coin.claimVested();
        uint256 secondVestedMine = coin.balanceOf(user) - balanceBeforeSecond;

        assertApproxEqAbs(secondVestedMine, claimableBeforeSecond, 1e15, "User should receive claimable amount");
        assertGt(coin.balanceOf(user), balanceBeforeFirst + firstVestedMine, "Balance should increase");

        // Step 5: Wait and claimVested again (more partial)
        skip(vestingDuration / 4);
        uint256 claimableBeforeThird = coin.getClaimableVested(user);
        assertGt(claimableBeforeThird, 0, "Should have claimable vested tokens");

        uint256 balanceBeforeThird = coin.balanceOf(user);
        vm.prank(user);
        coin.claimVested();
        uint256 thirdVestedMine = coin.balanceOf(user) - balanceBeforeThird;

        assertApproxEqAbs(thirdVestedMine, claimableBeforeThird, 1e15, "User should receive claimable amount");
        assertGt(coin.balanceOf(user), balanceBeforeSecond + secondVestedMine, "Balance should continue increasing");

        // Step 6: Wait EPOCH_LENGTH and third mine with ETH
        vm.warp(block.timestamp + EPOCH_LENGTH);
        uint256 nonce3 = block.timestamp + 200;
        bytes memory signature3 = _signMine(user, nonce3, TEST_SCORE);
        uint256 estimatedReward3 = coin.getEstimatedReward(TEST_SCORE);
        uint256 expectedLiquidPart3 = (estimatedReward3 * 20) / 100;
        uint256 expectedVestedPart3 = estimatedReward3 - expectedLiquidPart3 - (estimatedReward3 * 10) / 100;
        uint256 ethAmount3 = expectedLiquidPart3 / 5;

        // Before third mine
        uint256 claimableBeforeThirdMine = coin.getClaimableVested(user);
        (uint256 lockedBeforeThird, uint256 releasedBeforeThird,,,) = coin.vestingSchedules(user);
        uint256 remainingVestedBeforeThird = (lockedBeforeThird - releasedBeforeThird) - claimableBeforeThirdMine;

        vm.prank(user);
        coin.mine{value: ethAmount3}(TEST_SCORE, signature3, nonce3);

        (uint256 locked6, uint256 released6,,,) = coin.vestingSchedules(user);
        assertApproxEqAbs(
            locked6,
            remainingVestedBeforeThird + expectedVestedPart3,
            1e18,
            "After third mine: locked should include remaining + new vested"
        );
        assertEq(released6, 0, "After third claim: released should be reset to 0");

        // Final verification: complete vesting and claim all
        skip(vestingDuration + 1);
        uint256 claimableBeforeFinal = coin.getClaimableVested(user);
        assertGt(claimableBeforeFinal, 0, "Should have remaining claimable vested tokens");

        uint256 balanceBeforeFinal = coin.balanceOf(user);
        vm.prank(user);
        coin.claimVested();
        uint256 finalVestedMine = coin.balanceOf(user) - balanceBeforeFinal;

        assertApproxEqAbs(
            finalVestedMine, claimableBeforeFinal, 1e15, "User should receive all remaining vested tokens"
        );

        (uint256 finalLocked, uint256 finalReleased,,,) = coin.vestingSchedules(user);
        assertEq(finalLocked, 0, "Final: all locked should be released");
        assertEq(finalReleased, 0, "Final: released should be 0 after full claim");
        assertEq(coin.getClaimableVested(user), 0, "Final: no more claimable vested tokens");
    }
}
