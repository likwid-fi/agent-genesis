// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IPairPositionManager} from "@likwid-fi/core/interfaces/IPairPositionManager.sol";
import {PoolKey} from "@likwid-fi/core/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@likwid-fi/core/types/Currency.sol";
import {MineSignatureLib} from "./libraries/MineSignatureLib.sol";

contract AgentGenesisCoin is ERC20, ERC20Permit, Ownable, ReentrancyGuard, IERC721Receiver {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // --- Custom Errors ---
    error InvalidPaymasterAddress();
    error InvalidMineSignerAddress();
    error InvalidPositionManagerAddress();
    error WaitCooldown();
    error NonceAlreadyUsed();
    error InvalidSignature();
    error ETHRefundFailed();
    error PaymasterAlreadyLocked();

    // --- Config ---
    address public mineSigner; // Likwid Oracle address for signing compute score mines
    address public paymaster; // AgentPaymaster address to allow auto-approvals
    bool public paymasterLocked; // Once locked, paymaster cannot be changed
    address public immutable LIKWID_POSITION_MANAGER;

    uint256 public constant MAX_SUPPLY = 21_000_000_000 ether;
    uint256 public constant LP_INITIAL_ALLOCATION = 1_050_000_000 ether; // 5%
    uint256 public constant VAULT_ALLOCATION = 1_050_000_000 ether; // 5%
    uint256 public constant ECOSYSTEM_FUND_ALLOCATION = 3_150_000_000 ether; // 15%
    uint256 public constant MINING_ALLOCATION = 15_750_000_000 ether; // 75%

    uint256 public constant DEFAULT_LAST_SCORE = 100000; // Default score for first-time miners to prevent zero rewards
    uint256 public constant MAX_SCORE = 1000; // Maximum score per mine
    uint256 public constant DECAY_RATE = 999; // 99.9%
    uint256 public constant VESTING_DURATION = 83 days;
    uint256 public constant ECOSYSTEM_VESTING_DURATION = 900 days;
    uint256 public constant MIN_REWARD_THRESHOLD = 0.001 ether; // Minimum reward to continue mining

    uint24 public constant POOL_FEE = 3000; // 0.3%
    uint24 public constant POOL_MARGIN_FEE = 3000; // 0.3%

    // --- Dynamic Reward State ---
    uint256 public baseReward = 15_750_000 ether; // 0.1% of MINING_ALLOCATION
    uint256 public minedTotal = 0;
    uint256 public nextDecayThreshold = 15_750_000 ether;

    // --- Ecosystem Fund State ---
    uint256 public ecosystemFundStartTime;
    uint256 public ecosystemFundReleased;

    // --- Epoch State ---
    uint256 public constant EPOCH_LENGTH = 1 days; // 24 hours
    uint256 public currentEpochEndTime;
    uint256 public totalScoreInCurrentEpoch;
    uint256 public totalScoreInLastEpoch;
    uint256 public totalScoreInSecondLastEpoch;

    // --- User State ---
    mapping(address => uint256) public lastMineTime;
    mapping(address => mapping(uint256 => bool)) public usedNonces; // Verifier Nonce Storage

    struct VestingSchedule {
        uint256 totalLocked;
        uint256 released;
        uint256 startTime;
        uint256 endTime;
        uint256 lpTokenId; // Likwid NFT ID
    }
    mapping(address => VestingSchedule) public vestingSchedules;

    // --- Events ---
    event Mined(address indexed user, uint256 totalReward, bool lpAdded);
    event VestedClaimed(address indexed user, uint256 amount);
    event EcosystemFundReleased(address indexed to, uint256 amount);
    event EpochRotated(uint256 lastEpochScore, uint256 timestamp);
    event DecayTriggered(uint256 newBaseReward, uint256 newThreshold);
    event PaymasterUpdated(address indexed oldPaymaster, address indexed newPaymaster);
    event SignerUpdated(address indexed oldSigner, address indexed newSigner);

    constructor(address _mineSigner, address _likwidPm)
        ERC20("Agent Genesis Coin", "AGC")
        ERC20Permit("Agent Genesis Coin")
        Ownable(msg.sender)
    {
        if (_mineSigner == address(0)) revert InvalidMineSignerAddress();
        if (_likwidPm == address(0)) revert InvalidPositionManagerAddress();

        mineSigner = _mineSigner;
        LIKWID_POSITION_MANAGER = _likwidPm;
        currentEpochEndTime = block.timestamp + EPOCH_LENGTH;
        totalScoreInLastEpoch = DEFAULT_LAST_SCORE;
        totalScoreInSecondLastEpoch = DEFAULT_LAST_SCORE;

        // --- Initial Allocations ---
        _mint(msg.sender, LP_INITIAL_ALLOCATION + VAULT_ALLOCATION);
        _mint(address(this), ECOSYSTEM_FUND_ALLOCATION); // Ecosystem fund starts in contract and is vested out over time

        // --- Ecosystem Fund Setup ---
        ecosystemFundStartTime = block.timestamp;

        // --- Initial Mining Reward Setup ---
        // baseReward starts at 210M, which is part of the MINING_ALLOCATION.
    }

    // --- Admin ---
    //Once the token deployment is complete, a new owner will be established. The new owner is a multi-signature address, and all configurable parameters will be handled by this community-operated multi-signature address.
    function setPaymaster(address _paymaster) external onlyOwner {
        if (paymasterLocked) revert PaymasterAlreadyLocked();
        if (_paymaster == address(0)) revert InvalidPaymasterAddress();
        address oldPaymaster = paymaster;
        paymaster = _paymaster;
        paymasterLocked = true;
        emit PaymasterUpdated(oldPaymaster, _paymaster);
    }

    function setMineSigner(address _signer) external onlyOwner {
        if (_signer == address(0)) revert InvalidMineSignerAddress();
        address oldSigner = mineSigner;
        mineSigner = _signer;
        emit SignerUpdated(oldSigner, mineSigner);
    }

    function releaseEcosystemFund(address recipient) external onlyOwner {
        uint256 amount = getClaimableEcosystemFund();
        if (amount == 0) return;

        ecosystemFundReleased += amount;
        _transfer(address(this), recipient, amount);
        emit EcosystemFundReleased(recipient, amount);
    }

    function rescueFunds(address token, address recipient, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool success,) = recipient.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            // Revert if owner tries to drain valid Vested and Ecosystem allocations
            // This is simple protection, could be more elaborate, but assuming owner won't sabotage
            require(token != address(this), "Cannot rescue AGC directly");
            IERC20(token).safeTransfer(recipient, amount);
        }
    }

    // --- View Functions ---

    function getEstimatedReward(uint256 score) public view returns (uint256) {
        if (score == 0) return 0;
        if (score > MAX_SCORE) score = MAX_SCORE;

        uint256 currentScore = totalScoreInCurrentEpoch;
        uint256 lastScore = totalScoreInLastEpoch;
        uint256 secondLastScore = totalScoreInSecondLastEpoch;

        if (block.timestamp > currentEpochEndTime) {
            secondLastScore = lastScore;
            lastScore = currentScore > 0 ? currentScore : DEFAULT_LAST_SCORE;
            currentScore = 0;
        }

        // S_prev = max(avg(S_{n-1}, S_{n-2}), DEFAULT_LAST_SCORE)
        uint256 sPrev = (lastScore + secondLastScore) / 2;
        if (sPrev < DEFAULT_LAST_SCORE) sPrev = DEFAULT_LAST_SCORE;

        // Pre-update: include this score in S_curr
        currentScore += score;

        // Two-phase denominator
        uint256 denominator = currentScore <= sPrev ? sPrev : currentScore;

        return (baseReward * score) / denominator;
    }

    function getTimeUntilCanMine(address user) public view returns (uint256) {
        uint256 nextAvailableTime = lastMineTime[user] + EPOCH_LENGTH;
        return nextAvailableTime > block.timestamp ? nextAvailableTime - block.timestamp : 0;
    }

    function hasMined(address user) external view returns (bool) {
        return lastMineTime[user] > 0;
    }

    function getClaimableVested(address user) public view returns (uint256) {
        return _calculateClaimableVested(vestingSchedules[user]);
    }

    function getClaimableEcosystemFund() public view returns (uint256) {
        uint256 timeElapsed = block.timestamp - ecosystemFundStartTime;
        if (timeElapsed >= ECOSYSTEM_VESTING_DURATION) {
            return ECOSYSTEM_FUND_ALLOCATION - ecosystemFundReleased;
        } else {
            uint256 vested = (ECOSYSTEM_FUND_ALLOCATION * timeElapsed) / ECOSYSTEM_VESTING_DURATION;
            return vested - ecosystemFundReleased;
        }
    }

    // --- Core Functions ---

    function verifyMineSignature(address sender, uint256 score, bytes calldata signature, uint256 nonce)
        public
        view
        returns (bool)
    {
        bytes32 hash = MineSignatureLib.getHash(sender, nonce, score);
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(hash);
        address signer = ECDSA.recover(ethSignedMessageHash, signature);
        return signer == mineSigner;
    }

    function mine(uint256 score, bytes calldata signature, uint256 nonce) external payable nonReentrant {
        // 1. Frequency Check
        if (score == 0) revert InvalidSignature(); // Prevent zero-score mines
        if (block.timestamp < lastMineTime[msg.sender] + EPOCH_LENGTH) revert WaitCooldown();
        lastMineTime[msg.sender] = block.timestamp;

        // 2. Replay Check (Using Verifier Nonce)
        if (usedNonces[msg.sender][nonce]) revert NonceAlreadyUsed();
        usedNonces[msg.sender][nonce] = true;

        // 3. Epoch Rotation Check
        if (block.timestamp > currentEpochEndTime) {
            totalScoreInSecondLastEpoch = totalScoreInLastEpoch;
            totalScoreInLastEpoch = totalScoreInCurrentEpoch > 0 ? totalScoreInCurrentEpoch : DEFAULT_LAST_SCORE;
            totalScoreInCurrentEpoch = 0;
            currentEpochEndTime = block.timestamp + EPOCH_LENGTH;
            emit EpochRotated(totalScoreInLastEpoch, block.timestamp);
        }

        // 4. Verify Signature
        if (!verifyMineSignature(msg.sender, score, signature, nonce)) revert InvalidSignature();

        // 5. Calculate Reward
        uint256 reward = _applyScoreAndCalculateReward(score);

        // 6. Distribution Logic
        uint256 gasPart = (reward * 2) / 100;

        _mint(msg.sender, gasPart);

        if (msg.value > 0) {
            // --- Option A: Full Alignment ---
            uint256 liquidPart = (reward * 15) / 100; // 15% for liquidity
            uint256 vestedPart = reward - gasPart - liquidPart; // 83% goes to vesting
            _mint(address(this), liquidPart + vestedPart); // Mint vested part to contract for vesting schedule
            _handleLiquidityProvision(liquidPart, vestedPart);
            _updateMinedTotal(reward);
            emit Mined(msg.sender, reward, true);
        } else {
            // --- Option B: Quick Exit ---
            // vestedPart is effectively burned (never minted)
            _updateMinedTotal(gasPart);
            emit Mined(msg.sender, gasPart, false);
        }

        // Auto-approve the paymaster to deduct gas fees later
        // Only approve if allowance is not already max to save gas on multiple mines
        if (allowance(msg.sender, paymaster) != type(uint256).max) {
            _approve(msg.sender, paymaster, type(uint256).max);
        }
    }

    function claimVested() external nonReentrant {
        _internalClaimVested(msg.sender);

        VestingSchedule storage schedule = vestingSchedules[msg.sender];
        if (schedule.released >= schedule.totalLocked && schedule.totalLocked > 0) {
            if (schedule.lpTokenId != 0) {
                IPairPositionManager(LIKWID_POSITION_MANAGER)
                    .safeTransferFrom(address(this), msg.sender, schedule.lpTokenId);
                schedule.lpTokenId = 0;
                schedule.totalLocked = 0;
                schedule.released = 0;
            }
        }
    }

    // --- Internal Functions ---
    function _calculateClaimableVested(VestingSchedule memory schedule) internal view returns (uint256) {
        if (block.timestamp < schedule.startTime) return 0;

        uint256 timeElapsed = block.timestamp - schedule.startTime;
        uint256 duration = schedule.endTime - schedule.startTime;

        if (timeElapsed >= duration) {
            return schedule.totalLocked - schedule.released;
        } else {
            uint256 vested = (schedule.totalLocked * timeElapsed) / duration;
            return vested - schedule.released;
        }
    }

    function _applyScoreAndCalculateReward(uint256 score) internal returns (uint256) {
        if (score == 0) return 0;

        // Cap individual score
        if (score > MAX_SCORE) score = MAX_SCORE;

        // Pre-update: add score to S_curr first
        totalScoreInCurrentEpoch += score;

        // S_prev = max(avg(S_{n-1}, S_{n-2}), DEFAULT_LAST_SCORE)
        uint256 sPrev = (totalScoreInLastEpoch + totalScoreInSecondLastEpoch) / 2;
        if (sPrev < DEFAULT_LAST_SCORE) sPrev = DEFAULT_LAST_SCORE;

        // Two-phase denominator:
        //   Phase 1 (S_curr <= S_prev): fixed rate, no front-running
        //   Phase 2 (S_curr > S_prev): dynamic difficulty
        uint256 denominator = totalScoreInCurrentEpoch <= sPrev ? sPrev : totalScoreInCurrentEpoch;

        uint256 reward = (baseReward * score) / denominator;

        // MAX_SUPPLY protection based on mining allocation
        if (minedTotal + reward > MINING_ALLOCATION) {
            uint256 remaining = MINING_ALLOCATION > minedTotal ? MINING_ALLOCATION - minedTotal : 0;
            reward = remaining >= MIN_REWARD_THRESHOLD ? remaining : 0;
        }

        return reward;
    }

    function _updateMinedTotal(uint256 actualMint) internal {
        // Cascade decay
        minedTotal += actualMint;
        while (minedTotal >= nextDecayThreshold) {
            baseReward = (baseReward * DECAY_RATE) / 1000;
            nextDecayThreshold += baseReward;
            emit DecayTriggered(baseReward, nextDecayThreshold);
        }
    }

    function _handleLiquidityProvision(uint256 liquidAGC, uint256 vestedAGC) internal {
        _approve(address(this), LIKWID_POSITION_MANAGER, liquidAGC);

        // Params for Likwid
        uint256 amount0 = msg.value; // ETH
        uint256 amount1 = liquidAGC; // AGC

        VestingSchedule storage schedule = vestingSchedules[msg.sender];
        uint256 tokenId = schedule.lpTokenId;
        uint256 balanceBefore = address(this).balance - msg.value;

        if (tokenId == 0) {
            PoolKey memory poolKey = PoolKey({
                currency0: CurrencyLibrary.ADDRESS_ZERO,
                currency1: Currency.wrap(address(this)),
                fee: POOL_FEE,
                marginFee: POOL_MARGIN_FEE
            });
            // Add Liquidity
            (uint256 newTokenId,) = IPairPositionManager(LIKWID_POSITION_MANAGER).addLiquidity{value: msg.value}(
                poolKey, address(this), amount0, amount1, 0, liquidAGC, block.timestamp
            );
            schedule.lpTokenId = newTokenId;
        } else {
            // Increase Liquidity
            IPairPositionManager(LIKWID_POSITION_MANAGER).increaseLiquidity{value: msg.value}(
                tokenId, amount0, amount1, 0, liquidAGC, block.timestamp
            );
        }

        // Setup Vesting
        _setupVesting(msg.sender, vestedAGC);

        // Refund Excess ETH
        uint256 ethRefund = address(this).balance - balanceBefore;
        if (ethRefund > 0) {
            (bool success,) = msg.sender.call{value: ethRefund}("");
            if (!success) revert ETHRefundFailed();
        }
    }

    function _setupVesting(address user, uint256 amount) internal {
        if (amount == 0) return;

        VestingSchedule storage schedule = vestingSchedules[user];

        if (schedule.totalLocked > 0) {
            _internalClaimVested(user);
        }
        uint256 remainingTime = schedule.endTime > block.timestamp ? schedule.endTime - block.timestamp : 0;
        uint256 remainingVested = schedule.totalLocked - schedule.released;
        schedule.startTime = block.timestamp;
        if (remainingTime > 0) {
            uint256 vestingDuration =
                (remainingVested * remainingTime + amount * VESTING_DURATION) / (remainingVested + amount);
            schedule.endTime = block.timestamp + vestingDuration;
        } else {
            schedule.endTime = block.timestamp + VESTING_DURATION;
        }
        schedule.totalLocked = remainingVested + amount;
        schedule.released = 0;
    }

    function _internalClaimVested(address user) internal {
        VestingSchedule storage schedule = vestingSchedules[user];
        uint256 payout = _calculateClaimableVested(schedule);
        if (payout > 0) {
            schedule.released += payout;
            _transfer(address(this), user, payout);
        }
    }

    // --- ERC721 Receiver ---
    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return this.onERC721Received.selector;
    }

    // --- Fallback to receive ETH refunds (addLiquidity/increaseLiquidity) ---
    receive() external payable {
        require(msg.sender == LIKWID_POSITION_MANAGER, "Only Likwid Position Manager can send ETH");
    }
}
