// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {AgentPaymaster} from "../src/AgentPaymaster.sol";
import {AgentGenesisCoin} from "../src/AgentGenesisCoin.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IPairPositionManager} from "@likwid-fi/core/interfaces/IPairPositionManager.sol";

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
    address public entryPoint = address(0x123);
    address public user = address(0x456);

    function setUp() public {
        signerKey = 0xABCD;
        signer = vm.addr(signerKey);

        // Deploy mocked dependencies
        address mockPm = address(new MockPositionManager());
        address mockLz = address(new MockEndpoint());

        // Deploy coin
        coin = new AgentGenesisCoin(signer, mockPm, mockLz);

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

    function testIsFreeMineExecute() public {
        uint256 score = 50;
        uint256 nonce = 1;
        bytes memory signature = _generateSignature(user, nonce, score);

        // Encode the mine() call
        bytes memory mineCall = abi.encodeWithSelector(AgentGenesisCoin.mine.selector, score, signature, nonce);

        // Encode the SimpleAccount execute() call
        // execute(address dest, uint256 value, bytes func)
        bytes memory executeCall = abi.encodeWithSelector(
            0xb61d27f6, // execute
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

    function testIsFreeMineExecuteBatch() public {
        uint256 score1 = 50;
        uint256 nonce1 = 1;
        bytes memory signature1 = _generateSignature(user, nonce1, score1);
        bytes memory mineCall1 = abi.encodeWithSelector(AgentGenesisCoin.mine.selector, score1, signature1, nonce1);

        uint256 score2 = 60;
        uint256 nonce2 = 2;
        bytes memory signature2 = _generateSignature(user, nonce2, score2);
        bytes memory mineCall2 = abi.encodeWithSelector(AgentGenesisCoin.mine.selector, score2, signature2, nonce2);

        address[] memory targets = new address[](2);
        targets[0] = address(coin);
        targets[1] = address(coin);

        bytes[] memory datas = new bytes[](2);
        datas[0] = mineCall1;
        datas[1] = mineCall2;

        // Encode the SimpleAccount executeBatch() call
        // executeBatch(address[] dest, bytes[] func)
        bytes memory executeBatchCall = abi.encodeWithSelector(
            0x47e1da2a, // executeBatch
            targets,
            datas
        );

        // Test with the correct sender
        bool isFree = paymaster.isFreeMine(executeBatchCall, user);
        assertTrue(isFree, "Should be true for valid mine batch and correct sender");

        // Test with a wrong sender
        bool isFreeWrongSender = paymaster.isFreeMine(executeBatchCall, address(0x789));
        assertFalse(isFreeWrongSender, "Should be false for incorrect sender (signature mismatch)");
    }

    function testIsFreeMineExecuteNotMine() public {
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

    function testIsFreeMineExecuteBatchMixed() public {
        uint256 score1 = 50;
        uint256 nonce1 = 1;
        bytes memory signature1 = _generateSignature(user, nonce1, score1);
        bytes memory mineCall1 = abi.encodeWithSelector(AgentGenesisCoin.mine.selector, score1, signature1, nonce1);

        bytes memory notMineCall = abi.encodeWithSignature("transfer(address,uint256)", address(0x111), 100);

        address[] memory targets = new address[](2);
        targets[0] = address(coin);
        targets[1] = address(coin);

        bytes[] memory datas = new bytes[](2);
        datas[0] = mineCall1;
        datas[1] = notMineCall;

        bytes memory executeBatchCall = abi.encodeWithSelector(
            0x47e1da2a, // executeBatch
            targets,
            datas
        );

        bool isFree = paymaster.isFreeMine(executeBatchCall, user);
        assertFalse(isFree, "Should be false for mixed executeBatch");
    }
}

contract MockPositionManager {
    function vault() external pure returns (address) {
        return address(0x111);
    }
}

contract MockEndpoint {
    function setDelegate(address) external {}
}
