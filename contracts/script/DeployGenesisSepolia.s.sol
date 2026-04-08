// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {AgentGenesisCoin} from "../src/AgentGenesisCoin.sol";
import {AgentPaymaster, IEntryPoint} from "../src/AgentPaymaster.sol";
import {IPairPositionManager} from "@likwid-fi/core/interfaces/IPairPositionManager.sol";
import {IBasePositionManager} from "@likwid-fi/core/interfaces/IBasePositionManager.sol";
import {IVault} from "@likwid-fi/core/interfaces/IVault.sol";
import {PoolKey} from "@likwid-fi/core/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@likwid-fi/core/types/Currency.sol";

// forge script script/DeployGenesisSepolia.s.sol --broadcast --rpc-url https://sepolia.drpc.org --private-key $PRIVATE_KEY
contract DeployGenesisScript is Script {
    address public likwidPairPosition = 0xA8296e28c62249f89188De0499a81d6AD993a515;
    address public mineSinger = 0x13f2FB603b07bCfB9dE165884717feE84B17D1C8;
    // EntryPoint v0.9 on Sepolia
    address public constant entryPoint = 0x433709009B8330FDa32311DF1C2AFA402eD8D009;

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

        // Initialize Pool (ETH/AGC)
        IPairPositionManager pm = IPairPositionManager(likwidPairPosition);
        IVault vault = IBasePositionManager(address(pm)).vault();
        PoolKey memory poolKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(agc)),
            fee: agc.POOL_FEE(),
            marginFee: agc.POOL_MARGIN_FEE()
        });
        vault.initialize(poolKey);
        console.log("Pool initialized");

        // Add initial liquidity: 1 ETH = 1,000,000 AGC
        uint256 ethAmount = 1 ether;
        uint256 agcAmount = 1_000_000 ether;
        agc.approve(address(pm), agcAmount);
        (uint256 tokenId,) =
            pm.addLiquidity{value: ethAmount}(poolKey, deployer, ethAmount, agcAmount, 0, 0, block.timestamp + 300);
        console.log("LP added, tokenId:", tokenId);

        // Update Paymaster cached reserves after LP is added
        paymaster.updateCachedReserves();
        console.log("Paymaster cached reserves updated");

        // Fund Paymaster with 0.1 ETH (deposit for gas payments)
        (bool success,) = address(paymaster).call{value: 0.1 ether}("");
        require(success, "Funding Paymaster failed");
        console.log("AgentPaymaster funded with 0.1 ETH");

        // Stake on EntryPoint (one-time, required because paymaster returns context)
        paymaster.addStake{value: 0.01 ether}(86400);
        console.log("AgentPaymaster staked 0.01 ETH (unstake delay: 1 day)");

        vm.stopBroadcast();
    }
}
