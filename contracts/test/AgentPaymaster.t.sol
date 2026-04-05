// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentPaymaster} from "../src/AgentPaymaster.sol";
import {AgentGenesisCoin} from "../src/AgentGenesisCoin.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract AgentPaymasterHarness is AgentPaymaster {
    constructor(IEntryPoint _entryPoint, address _agcToken) AgentPaymaster(_entryPoint, _agcToken) {}

    function isFreeMine(bytes calldata callData, address sender) external view returns (bool) {
        return _isFreeMine(callData, sender);
    }
}

contract AgentPaymasterTest is Test {
    AgentPaymasterHarness public paymaster;
    AgentGenesisCoin public coin;
    address public signer;
    uint256 public signerKey;
    address public entryPoint;
    address public user = address(0x456);

    function setUp() public {
        signerKey = 0xABCD;
        signer = vm.addr(signerKey);

        // Deploy mocked dependencies
        address mockPm = address(new MockPositionManager());

        // Deploy coin
        coin = new AgentGenesisCoin(signer, mockPm);

        // Deploy a mock EntryPoint that supports IERC165
        entryPoint = address(new MockEntryPoint());

        // Deploy paymaster harness
        paymaster = new AgentPaymasterHarness(IEntryPoint(entryPoint), address(coin));
    }

    // Helper to generate a valid signature for the mine() function
    function _generateSignature(address _sender, uint256 _nonce, uint256 _score) internal view returns (bytes memory) {
        bytes32 hash = keccak256(abi.encodePacked(_sender, _nonce, _score));
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(hash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, ethSignedMessageHash);
        return abi.encodePacked(r, s, v);
    }

    function testIsFreeMineExecute() public view {
        uint256 score = 50;
        uint256 nonce = 1;
        bytes memory signature = _generateSignature(user, nonce, score);

        // Encode the mine() call
        bytes memory mineCall = abi.encodeWithSelector(AgentGenesisCoin.mine.selector, score, signature, nonce);

        // Encode the execute() call: execute(address dest, uint256 value, bytes func) (0xb61d27f6)
        bytes memory executeCall = abi.encodeWithSelector(
            0xb61d27f6,
            address(coin),
            0,
            mineCall
        );

        // Test with the correct sender
        bool isFree = paymaster.isFreeMine(executeCall, user);
        assertTrue(isFree, "Should be true for valid mine call and correct sender");

        // Test with a wrong sender
        bool isFreeWrongSender = paymaster.isFreeMine(executeCall, address(0x789));
        assertFalse(isFreeWrongSender, "Should be false for incorrect sender (signature mismatch)");
    }

    function testIsFreeMineExecuteBatch() public view {
        uint256 score1 = 50;
        uint256 nonce1 = 1;
        bytes memory signature1 = _generateSignature(user, nonce1, score1);
        bytes memory mineCall1 = abi.encodeWithSelector(AgentGenesisCoin.mine.selector, score1, signature1, nonce1);

        uint256 score2 = 60;
        uint256 nonce2 = 2;
        bytes memory signature2 = _generateSignature(user, nonce2, score2);
        bytes memory mineCall2 = abi.encodeWithSelector(AgentGenesisCoin.mine.selector, score2, signature2, nonce2);

        // Encode v0.8 executeBatch: executeBatch((address,uint256,bytes)[]) (0x34fcd5be)
        AgentPaymaster.Call[] memory calls = new AgentPaymaster.Call[](2);
        calls[0] = AgentPaymaster.Call({target: address(coin), value: 0, data: mineCall1});
        calls[1] = AgentPaymaster.Call({target: address(coin), value: 0, data: mineCall2});

        bytes memory executeBatchCall = abi.encodeWithSelector(0x34fcd5be, calls);

        // Test with the correct sender
        bool isFree = paymaster.isFreeMine(executeBatchCall, user);
        assertTrue(isFree, "Should be true for valid mine batch and correct sender");

        // Test with a wrong sender
        bool isFreeWrongSender = paymaster.isFreeMine(executeBatchCall, address(0x789));
        assertFalse(isFreeWrongSender, "Should be false for incorrect sender (signature mismatch)");
    }

    function testIsFreeMineExecuteNotMine() public view {
        // Encode a random non-mine call
        bytes memory notMineCall = abi.encodeWithSignature("transfer(address,uint256)", address(0x111), 100);

        bytes memory executeCall = abi.encodeWithSelector(
            0xb61d27f6, // execute
            address(coin),
            0,
            notMineCall
        );

        bool isFree = paymaster.isFreeMine(executeCall, user);
        assertFalse(isFree, "Should be false for non-mine execute");
    }

    function testIsFreeMineExecuteBatchMixed() public view {
        uint256 score1 = 50;
        uint256 nonce1 = 1;
        bytes memory signature1 = _generateSignature(user, nonce1, score1);
        bytes memory mineCall1 = abi.encodeWithSelector(AgentGenesisCoin.mine.selector, score1, signature1, nonce1);

        bytes memory notMineCall = abi.encodeWithSignature("transfer(address,uint256)", address(0x111), 100);

        // Encode v0.8 executeBatch with mixed calls
        AgentPaymaster.Call[] memory calls = new AgentPaymaster.Call[](2);
        calls[0] = AgentPaymaster.Call({target: address(coin), value: 0, data: mineCall1});
        calls[1] = AgentPaymaster.Call({target: address(coin), value: 0, data: notMineCall});

        bytes memory executeBatchCall = abi.encodeWithSelector(0x34fcd5be, calls);

        bool isFree = paymaster.isFreeMine(executeBatchCall, user);
        assertFalse(isFree, "Should be false for mixed executeBatch");
    }
}

contract MockPositionManager {
    function vault() external pure returns (address) {
        return address(0x111);
    }
}

contract MockEntryPoint {
    // Implement IERC165.supportsInterface to return true for IEntryPoint
    function supportsInterface(bytes4) external pure returns (bool) {
        return true;
    }

    // Minimal stubs required by BasePaymaster
    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }

    function depositTo(address) external payable {}

    function addStake(uint32) external payable {}

    function unlockStake() external {}

    function withdrawStake(address payable) external {}

    function withdrawTo(address payable, uint256) external {}

    function getNonce(address, uint192) external pure returns (uint256) {
        return 0;
    }
}
