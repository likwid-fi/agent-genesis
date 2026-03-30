// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library MineSignatureLib {
    function getHash(address sender, uint256 nonce, uint256 score) internal pure returns (bytes32 hash) {
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, shl(96, sender))
            mstore(add(ptr, 20), nonce)
            mstore(add(ptr, 52), score)
            hash := keccak256(ptr, 84)
        }
    }
}
