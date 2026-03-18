// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OFT} from "@layerzerolabs/oft-evm/contracts/OFT.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IPairPositionManager} from "@likwid-fi/core/interfaces/IPairPositionManager.sol";
import {PoolKey} from "@likwid-fi/core/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@likwid-fi/core/types/Currency.sol";

contract AgentGenesisCoin is OFT, ERC20Permit, ReentrancyGuard, IERC721Receiver {
    using ECDSA for bytes32;

    // --- Custom Errors ---
    error InvalidPaymasterAddress();
    error InvalidMineSignerAddress();
    error InvalidPositionManagerAddress();
    error InvalidEpochLength();
    error WaitCooldown();
    error NonceAlreadyUsed();
    error InvalidSignature();
    error ETHRefundFailed();

    // --- Config ---
    address public mineSigner; // Likwid Oracle address for signing compute score mines
    address public paymaster; // AgentPaymaster address to allow auto-approvals
    address public immutable LIKWID_POSITION_MANAGER;

    uint256 public constant MAX_SUPPLY = 21_000_000_000 ether;
    uint256 public constant LP_INITIAL_ALLOCATION = 1_050_000_000 ether; // 5%
    uint256 public constant VAULT_ALLOCATION = 1_050_000_000 ether; // 5%
    uint256 public constant ECOSYSTEM_FUND_ALLOCATION = 3_150_000_000 ether; // 15%
    uint256 public constant MINING_ALLOCATION = 15_750_000_000 ether; // 75%

    uint256 public constant DEFAULT_LAST_SCORE = 100; // Default score for first-time miners to prevent zero rewards
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
    uint256 public epochLength = 1 days; // 24 hours
    uint256 public currentEpochEndTime;
    uint256 public totalScoreInCurrentEpoch;
    uint256 public totalScoreInLastEpoch;

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
    event EpochLengthUpdated(uint256 oldValue, uint256 newValue);
    event PaymasterUpdated(address indexed oldPaymaster, address indexed newPaymaster);
    event SignerUpdated(address indexed oldSigner, address indexed newSigner);

    constructor(address _mineSigner, address _likwidPm, address _lzEndpoint)
        OFT("Agent Genesis Coin", "AGC", _lzEndpoint, msg.sender)
        ERC20Permit("Agent Genesis Coin")
        Ownable(msg.sender)
    {
        if (_mineSigner == address(0)) revert InvalidMineSignerAddress();
        if (_likwidPm == address(0)) revert InvalidPositionManagerAddress();

        mineSigner = _mineSigner;
        LIKWID_POSITION_MANAGER = _likwidPm;
        currentEpochEndTime = block.timestamp + epochLength;
        totalScoreInLastEpoch = DEFAULT_LAST_SCORE;

        // --- Initial Allocations ---
        _mint(msg.sender, LP_INITIAL_ALLOCATION + VAULT_ALLOCATION);

        // --- Ecosystem Fund Setup ---
        ecosystemFundStartTime = block.timestamp;

        // --- Initial Mining Reward Setup ---
        // baseReward starts at 210M, which is part of the MINING_ALLOCATION.
    }

    // --- Admin ---
    function setPaymaster(address _paymaster) external onlyOwner {
        if (_paymaster == address(0)) revert InvalidPaymasterAddress();
        paymaster = _paymaster;
        emit PaymasterUpdated(paymaster, _paymaster);
    }

    function setMineSigner(address _signer) external onlyOwner {
        if (_signer == address(0)) revert InvalidMineSignerAddress();
        mineSigner = _signer;
        emit SignerUpdated(mineSigner, _signer);
    }

    function setEpochLength(uint256 _newEpochLength) external onlyOwner {
        if (_newEpochLength == 0) revert InvalidEpochLength();
        uint256 oldValue = epochLength;
        epochLength = _newEpochLength;
        emit EpochLengthUpdated(oldValue, _newEpochLength);
    }

    function releaseEcosystemFund(address recipient) external onlyOwner {
        uint256 amount = getClaimableEcosystemFund();
        if (amount == 0) return;

        ecosystemFundReleased += amount;
        _mint(recipient, amount);
        emit EcosystemFundReleased(recipient, amount);
    }

    // --- View Functions ---

    function getEstimatedReward(uint256 score) public view returns (uint256) {
        if (score == 0) return 0;
        uint256 currentScore = totalScoreInCurrentEpoch;
        uint256 lastScore = totalScoreInLastEpoch;
        if (block.timestamp > currentEpochEndTime) {
            lastScore = currentScore > 0 ? currentScore : DEFAULT_LAST_SCORE;
            currentScore = 0;
        }
        currentScore += score;
        uint256 numerator = baseReward * lastScore;
        uint256 denominator = currentScore + (lastScore * lastScore);
        return (numerator * score) / denominator;
    }

    function getTimeUntilCanMine(address user) public view returns (uint256) {
        uint256 nextAvailableTime = lastMineTime[user] + epochLength;
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

    function mine(uint256 score, bytes calldata signature, uint256 nonce) external payable nonReentrant {
        // 1. Frequency Check
        if (score == 0) revert InvalidSignature(); // Prevent zero-score mines
        if (block.timestamp < lastMineTime[msg.sender] + epochLength) revert WaitCooldown();
        lastMineTime[msg.sender] = block.timestamp;

        // 2. Replay Check (Using Verifier Nonce)
        if (usedNonces[msg.sender][nonce]) revert NonceAlreadyUsed();
        usedNonces[msg.sender][nonce] = true;

        // 3. Epoch Rotation Check
        if (block.timestamp > currentEpochEndTime) {
            totalScoreInLastEpoch = totalScoreInCurrentEpoch > 0 ? totalScoreInCurrentEpoch : DEFAULT_LAST_SCORE;
            totalScoreInCurrentEpoch = 0;
            currentEpochEndTime = block.timestamp + epochLength;
            emit EpochRotated(totalScoreInLastEpoch, block.timestamp);
        }

        // 4. Verify Signature

        bytes32 hash = _getHash(msg.sender, nonce, score);
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(hash);
        address signer = ECDSA.recover(ethSignedMessageHash, signature);
        if (signer != mineSigner) revert InvalidSignature();

        // 5. Calculate Reward
        uint256 reward = _applyScoreAndCalculateReward(score);

        // 6. Update Decay
        minedTotal += reward;
        if (minedTotal >= nextDecayThreshold) {
            baseReward = (baseReward * DECAY_RATE) / 1000;
            nextDecayThreshold += baseReward;
            emit DecayTriggered(baseReward, nextDecayThreshold);
        }

        // 7. Distribution Logic
        uint256 gasPart = (reward * 2) / 100;

        _mint(msg.sender, gasPart);

        if (msg.value > 0) {
            // --- Option A: Full Alignment ---
            uint256 liquidPart = (reward * 15) / 100; // 15% for liquidity
            uint256 vestedPart = reward - gasPart - liquidPart; // 83% goes to vesting
            _handleLiquidityProvision(liquidPart, vestedPart);
            emit Mined(msg.sender, reward, true);
        } else {
            // --- Option B: Quick Exit ---
            // vestedPart is effectively burned (never minted)
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

    // Hash: keccak256(msg.sender, nonce)
    function _getHash(address signer, uint256 nonce, uint256 score) internal pure returns (bytes32 hash) {
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, shl(96, signer))
            mstore(add(ptr, 20), nonce)
            mstore(add(ptr, 52), score)
            hash := keccak256(ptr, 84)
        }
    }

    function _applyScoreAndCalculateReward(uint256 score) internal returns (uint256) {
        if (score == 0) return 0;
        totalScoreInCurrentEpoch += score;
        uint256 numerator = baseReward * totalScoreInLastEpoch;
        uint256 denominator = totalScoreInCurrentEpoch + (totalScoreInLastEpoch * totalScoreInLastEpoch);
        uint256 reward = (numerator * score) / denominator;

        if (totalSupply() + reward > MAX_SUPPLY) {
            uint256 remaining = MAX_SUPPLY - totalSupply();
            return remaining >= MIN_REWARD_THRESHOLD ? remaining : 0;
        }
        return reward;
    }

    function _handleLiquidityProvision(uint256 liquidSyn, uint256 vestedSyn) internal {
        _mint(address(this), liquidSyn);
        _approve(address(this), LIKWID_POSITION_MANAGER, liquidSyn);

        // Params for Likwid
        uint256 amount0 = msg.value; // ETH
        uint256 amount1 = liquidSyn; // SYN

        VestingSchedule storage schedule = vestingSchedules[msg.sender];
        uint256 tokenId = schedule.lpTokenId;

        if (tokenId == 0) {
            PoolKey memory poolKey = PoolKey({
                currency0: CurrencyLibrary.ADDRESS_ZERO,
                currency1: Currency.wrap(address(this)),
                fee: POOL_FEE,
                marginFee: POOL_MARGIN_FEE
            });
            // Add Liquidity
            (uint256 newTokenId,) = IPairPositionManager(LIKWID_POSITION_MANAGER).addLiquidity{value: msg.value}(
                poolKey, address(this), amount0, amount1, 0, liquidSyn, block.timestamp
            );
            schedule.lpTokenId = newTokenId;
        } else {
            // Increase Liquidity
            IPairPositionManager(LIKWID_POSITION_MANAGER).increaseLiquidity{value: msg.value}(
                tokenId, amount0, amount1, 0, liquidSyn, block.timestamp
            );
        }

        // Setup Vesting
        _setupVesting(msg.sender, vestedSyn);

        // Refund Excess ETH
        uint256 ethRefund = address(this).balance;
        if (ethRefund > 0) {
            (bool success,) = msg.sender.call{value: ethRefund}("");
            if (!success) revert ETHRefundFailed();
        }
    }

    function _setupVesting(address user, uint256 amount) internal {
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
            _mint(user, payout);
        }
    }

    // --- ERC721 Receiver ---
    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return this.onERC721Received.selector;
    }

    receive() external payable {}
}
