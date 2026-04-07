// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {AgentGenesisCoin} from "../src/AgentGenesisCoin.sol";
import {AgentPaymaster, IEntryPoint} from "../src/AgentPaymaster.sol";
import {IPairPositionManager} from "@likwid-fi/core/interfaces/IPairPositionManager.sol";
import {IVault} from "@likwid-fi/core/interfaces/IVault.sol";
import {PoolKey} from "@likwid-fi/core/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@likwid-fi/core/types/Currency.sol";

// forge script script/DeployGenesisBase.s.sol --broadcast --rpc-url https://base.drpc.org --private-key $PRIVATE_KEY
contract DeployGenesisScript is Script {
    address public constant likwidPairPosition = 0xB397FE16BE79B082f17F1CD96e6489df19E07BCD;
    // EntryPoint v0.9 on Base
    address public constant entryPoint = 0x433709009B8330FDa32311DF1C2AFA402eD8D009;

    address public constant mineSinger = 0x964718f13616f76D77bB0F4367d2fdb0FB74d006;
    address public constant agcHolder = 0xEA7744c4FA1101f9E6dF5688fc19e3EE94106439;

    function run() external {
        address deployer = msg.sender;
        console.log("Deployer address:", deployer);

        vm.startBroadcast();

        // Deploy AGC Token
        AgentGenesisCoin agc = new AgentGenesisCoin(mineSinger, likwidPairPosition);
        console.log("AgentGenesisCoin deployed at:", address(agc));

        // Deploy AgentPaymaster
        AgentPaymaster paymaster = new AgentPaymaster(IEntryPoint(entryPoint), address(agc));
        console.log("AgentPaymaster deployed at:", address(paymaster));

        agc.setPaymaster(address(paymaster));
        console.log("Paymaster set in AGC");

        // Fund Paymaster with 0.1 ETH (deposit for gas payments)
        (bool success,) = address(paymaster).call{value: 0.1 ether}("");
        require(success, "Funding Paymaster failed");
        console.log("AgentPaymaster funded with 0.1 ETH");

        // Stake on EntryPoint (one-time, required because paymaster returns context)
        paymaster.addStake{value: 0.01 ether}(86400);
        console.log("AgentPaymaster staked 0.01 ETH (unstake delay: 1 day)");

        // Transfer AGC balance to holder
        uint256 agcBalance = agc.balanceOf(deployer);
        console.log("Deployer AGC balance:", agcBalance);
        agc.transfer(agcHolder, agcBalance);
        console.log("Transferred AGC balance to holder:", agcHolder);

        agc.transferOwnership(agcHolder);
        console.log("Transferred AGC ownership to holder:", agcHolder);

        vm.stopBroadcast();
    }
}
