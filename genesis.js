const { createSmartAccountClient } = require("permissionless");
const { signerToSimpleSmartAccount } = require("permissionless/accounts");
const { createPimlicoBundlerClient } = require("permissionless/clients/pimlico");
const {
  createPublicClient,
  http,
  parseEther,
  encodeFunctionData,
  parseAbi,
  keccak256,
  encodeAbiParameters,
} = require("viem");
const { sepolia } = require("viem/chains");
const { privateKeyToAccount, generatePrivateKey } = require("viem/accounts");
const fs = require("fs");
const path = require("path");
const os = require("os");
const axios = require("axios");

// ======================= CONFIGURATION =======================
const RPC_URL = process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const PIMLICO_API_KEY = process.env.PIMLICO_API_KEY || "pim_KpSstT3FhZNDhk8PxECxQG";
const BUNDLER_URL = `https://api.pimlico.io/v2/11155111/rpc?apikey=${PIMLICO_API_KEY}`;

const WALLET_FILE = path.join(os.homedir(), ".openclaw", ".likwid_genesis_wallet.json");
const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";

const AGC_TOKEN_ADDRESS = process.env.AGC_TOKEN_ADDRESS || "0x9Ba992CA612788FA58476ddEa382C32AB2255ca3";
const AGENT_PAYMASTER_ADDRESS = process.env.AGENT_PAYMASTER_ADDRESS || "0x33eeD2A4D3D6B9E101bdC689e8BD7260F2485613";
// Likwid DeFi Constants
const LIKWID_HELPER_ADDRESS = process.env.LIKWID_HELPER_ADDRESS || "0x6407CDAAe652Ac601Df5Fba20b0fDf072Edd2013";
const LIKWID_PAIR_POSITION = process.env.LIKWID_PAIR_POSITION || "0xA8296e28c62249f89188De0499a81d6AD993a515";
const LIKWID_MARGIN_POSITION = process.env.LIKWID_MARGIN_POSITION || "0x6a2666cA9D5769069762225161D454894fCe617c";
const LIKWID_LEND_POSITION = process.env.LIKWID_LEND_POSITION || "0xd04C34F7F57cAC394eC170C4Fe18A8B0330A2F37";

// ERC-4337 Infrastructure
const ENTRY_POINT_ADDRESS = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"; // EntryPoint v0.6
const SMART_ACCOUNT_FACTORY_ADDRESS = "0x9406Cc6185a346906296840746125a0E44976454"; // Smart Account Factory

const POOL_KEY = {
  currency0: NATIVE_TOKEN_ADDRESS,
  currency1: AGC_TOKEN_ADDRESS,
  fee: 3000,
  marginFee: 3000,
};

const POOL_ID = keccak256(
  encodeAbiParameters(
    [
      { name: "currency0", type: "address" },
      { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "marginFee", type: "uint24" },
    ],
    [POOL_KEY.currency0, POOL_KEY.currency1, POOL_KEY.fee, POOL_KEY.marginFee],
  ),
);
// ======================= ABIs =======================
const AGC_ABI = parseAbi([
  "function mine(uint256 computeScore, bytes calldata signature, uint256 nonce) external",
  "function hasMined(address account) external view returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
]);

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
]);

const LIKWID_PAIR_ABI = parseAbi([
  "function exactInput((bytes32 poolId, bool zeroForOne, address to, uint256 amountIn, uint256 amountOutMin, uint256 deadline) params) external payable returns (uint24 swapFee, uint256 feeAmount, uint256 amountOut)",
  "function addLiquidity((address currency0, address currency1, uint24 fee, uint24 marginFee) key, address recipient, uint256 amount0, uint256 amount1, uint256 amount0Min, uint256 amount1Min, uint256 deadline) external payable returns (uint256 tokenId, uint128 liquidity)",
]);

const LIKWID_MARGIN_ABI = parseAbi([
  "function addMargin((address currency0, address currency1, uint24 fee, uint24 marginFee) key, (bool marginForOne, uint24 leverage, uint256 marginAmount, uint256 borrowAmount, uint256 borrowAmountMax, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint256 borrowAmount, uint256 swapFeeAmount)",
  "function liquidateBurn(uint256 tokenId, uint256 deadline) external returns (uint256 profit)",
  "function nextId() external view returns (uint256)",
]);

const LIKWID_LEND_ABI = parseAbi([
  "function addLending((address currency0, address currency1, uint24 fee, uint24 marginFee) key, bool lendForOne, address recipient, uint256 amount, uint256 deadline) external payable returns (uint256 tokenId)",
]);

const LIKWID_HELPER_ABI = parseAbi([
  "function getAmountOut(bytes32 poolId, bool zeroForOne, uint256 amountIn, bool dynamicFee) external view returns (uint256 amountOut, uint24 fee, uint256 feeAmount)",
  "function checkMarginPositionLiquidate(uint256 tokenId) external view returns (bool liquidated)",
  "function getPoolStateInfo(bytes32 poolId) external view returns ((uint128 totalSupply, uint32 lastUpdated, uint24 lpFee, uint24 marginFee, uint24 protocolFee, uint128 realReserve0, uint128 realReserve1, uint128 mirrorReserve0, uint128 mirrorReserve1, uint128 pairReserve0, uint128 pairReserve1, uint128 truncatedReserve0, uint128 truncatedReserve1, uint128 lendReserve0, uint128 lendReserve1, uint128 interestReserve0, uint128 interestReserve1, int128 insuranceFund0, int128 insuranceFund1, uint256 borrow0CumulativeLast, uint256 borrow1CumulativeLast, uint256 deposit0CumulativeLast, uint256 deposit1CumulativeLast) stateInfo)",
]);

// ======================= UTILS =======================
const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(RPC_URL),
});

const pimlicoBundlerClient = createPimlicoBundlerClient({
  transport: http(BUNDLER_URL),
  entryPoint: ENTRY_POINT_ADDRESS,
});

// AgentPaymaster is used for gas sponsorship

function getWalletInstance() {
  if (fs.existsSync(WALLET_FILE)) {
    const data = JSON.parse(fs.readFileSync(WALLET_FILE, "utf8"));
    let pk = data.privateKey;
    if (!pk.startsWith("0x")) pk = "0x" + pk;
    return privateKeyToAccount(pk);
  }
  return null;
}

async function getSmartAccount(signer) {
  return await signerToSimpleSmartAccount(publicClient, {
    entryPoint: ENTRY_POINT_ADDRESS,
    signer: signer,
    factoryAddress: SMART_ACCOUNT_FACTORY_ADDRESS,
  });
}

async function runUserOp(account, calls, description) {
  const smartAccountClient = createSmartAccountClient({
    account,
    entryPoint: ENTRY_POINT_ADDRESS,
    chain: sepolia,
    bundlerTransport: http(BUNDLER_URL),
    middleware: {
      sponsorUserOperation: async ({ userOperation }) => {
        console.log(`> Estimating gas and attaching custom paymaster (${description})...`);
        const gasPrices = await pimlicoBundlerClient.getUserOperationGasPrice();

        const opToEstimate = {
          ...userOperation,
          paymasterAndData: AGENT_PAYMASTER_ADDRESS,
          maxFeePerGas: gasPrices.fast.maxFeePerGas,
          maxPriorityFeePerGas: gasPrices.fast.maxPriorityFeePerGas,
        };

        const estimate = await pimlicoBundlerClient.estimateUserOperationGas({
          userOperation: opToEstimate,
        });

        return {
          ...estimate,
          verificationGasLimit:
            BigInt(estimate.verificationGasLimit) > 600000n ? estimate.verificationGasLimit : 600000n,
          ...gasPrices.fast,
          paymasterAndData: AGENT_PAYMASTER_ADDRESS,
        };
      },
    },
  });

  console.log(`> Packaging UserOperation for ${description}...`);
  try {
    const userOpHash = await smartAccountClient.sendUserOperation({
      userOperation: { callData: await account.encodeCallData(calls) },
    });
    console.log(`> UserOperation submitted! Hash: ${userOpHash}`);
    console.log("> Waiting for receipt...");
    const receipt = await pimlicoBundlerClient.waitForUserOperationReceipt({ hash: userOpHash, timeout: 120_000 });
    console.log(`\n> ✅ ${description} Successful! Tx Hash: ${receipt.receipt.transactionHash}`);
    return true;
  } catch (e) {
    console.error(`> ${description} execution failed:`, e.stack || e.message || e);
    return false;
  }
}

async function getApprovalCall(accountAddress, tokenAddress, spenderAddress, requiredAmount) {
  const allowance = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [accountAddress, spenderAddress],
  });

  if (allowance < requiredAmount) {
    return {
      to: tokenAddress,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spenderAddress, 115792089237316195423570985008687907853269984665640564039457584007913129639935n], // Max uint256
      }),
    };
  }
  return null;
}

// ======================= OUTPUT HELPERS =======================

function formatError(msg) {
  console.log(JSON.stringify({ error: msg }, null, 2));
}

function formatHumanSeconds(seconds) {
  const s = Number(seconds);
  if (s <= 0) return "0s";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ======================= ATOMIC ACTIONS =======================

async function check_wallet() {
  const signer = getWalletInstance();
  if (signer) {
    const account = await getSmartAccount(signer);

    let ethBalEOA = 0n, ethBalSA = 0n, agcBalEOA = 0n, agcBalSA = 0n;
    try {
      [ethBalEOA, ethBalSA] = await Promise.all([
        publicClient.getBalance({ address: signer.address }),
        publicClient.getBalance({ address: account.address }),
      ]);
      [agcBalEOA, agcBalSA] = await Promise.all([
        publicClient.readContract({ address: AGC_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [signer.address] }),
        publicClient.readContract({ address: AGC_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] }),
      ]);
    } catch (e) { /* contract may not exist yet */ }

    console.log(`> 🔑 Wallet Status: Found`);
    console.log(`>`);
    console.log(`> 🔐 Smart Account (ERC-4337):`);
    console.log(`> Address: ${account.address}`);
    console.log(`> ETH Balance: ${(Number(ethBalSA) / 1e18).toFixed(6)} ETH`);
    console.log(`> AGC Balance: ${(Number(agcBalSA) / 1e18).toFixed(6)} AGC`);
    console.log(`>`);
    console.log(`> 🔑 EOA Signer:`);
    console.log(`> Address: ${signer.address}`);
    console.log(`> ETH Balance: ${(Number(ethBalEOA) / 1e18).toFixed(6)} ETH`);
    console.log(`> AGC Balance: ${(Number(agcBalEOA) / 1e18).toFixed(6)} AGC`);
    console.log(`>`);
    console.log(`> 📁 Stored at: ${WALLET_FILE}`);
  } else {
    console.log(`> 🔑 Wallet Status: Not Found`);
    console.log(`> Run 'create_wallet' to generate one.`);
  }
}

async function create_wallet() {
  let signer = getWalletInstance();

  if (signer) {
    console.log(`> ⏭️ Wallet already exists.`);
    console.log(`> EOA Address: ${signer.address}`);
  } else {
    const dir = path.dirname(WALLET_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const privateKey = generatePrivateKey();
    const newSigner = privateKeyToAccount(privateKey);
    const data = { address: newSigner.address, privateKey: privateKey };
    fs.writeFileSync(WALLET_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });

    console.log(`> ✅ Wallet Created`);
    console.log(`> EOA Address: ${newSigner.address}`);
    console.log(`> Stored at: ${WALLET_FILE}`);
  }
}

async function get_smart_account() {
  const signer = getWalletInstance();
  if (!signer) return formatError("No EOA wallet found. Run create_wallet first.");

  const account = await getSmartAccount(signer);
  console.log(`> 🔐 My Smart Account (ERC-4337):`);
  console.log(`> ${account.address}`);
  console.log(`> 🔑 My EOA Signer:`);
  console.log(`> ${signer.address}`);
}

// ======================= MINING WORKFLOW =======================

const VERIFIER_URL = "https://verifier.likwid.fi";

async function status() {
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found. Run create_wallet first.");
  const account = await getSmartAccount(signer);

  const ethBal = await publicClient.getBalance({ address: account.address });
  let agcBal = 0n,
    cooldownSec = 0n,
    vest = null;

  try {
    agcBal = await publicClient.readContract({
      address: AGC_TOKEN_ADDRESS,
      abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
      functionName: "balanceOf",
      args: [account.address],
    });
    cooldownSec = await publicClient.readContract({
      address: AGC_TOKEN_ADDRESS,
      abi: parseAbi(["function getTimeUntilCanMine(address) view returns (uint256)"]),
      functionName: "getTimeUntilCanMine",
      args: [account.address],
    });
    const v = await publicClient.readContract({
      address: AGC_TOKEN_ADDRESS,
      abi: parseAbi([
        "function vestingSchedules(address) view returns (uint256 totalLocked, uint256 released, uint256 startTime, uint256 endTime, uint256 lpTokenId)",
      ]),
      functionName: "vestingSchedules",
      args: [account.address],
    });
    if (v[0] > 0n) {
      vest = {
        totalLocked: (Number(v[0]) / 1e18).toFixed(6),
        released: (Number(v[1]) / 1e18).toFixed(6),
        fullyVestedAt: new Date(Number(v[3]) * 1000).toISOString(),
        lpTokenId: v[4].toString(),
      };
    }
  } catch (e) {
    // Contract may not be deployed yet
  }

  const miningStatus = cooldownSec === 0n
    ? "✅ Yes"
    : `⏳ No — ${formatHumanSeconds(cooldownSec)} remaining`;

  console.log(`> 📊 Account Status`);
  console.log(`> Address: ${account.address}`);
  console.log(`> ETH Balance: ${(Number(ethBal) / 1e18).toFixed(6)} ETH`);
  console.log(`> AGC Balance: ${(Number(agcBal) / 1e18).toFixed(6)} AGC`);
  console.log(`>`);
  console.log(`> ⛏️ Mining:`);
  console.log(`> Can Mine: ${miningStatus}`);
  if (vest) {
    console.log(`>`);
    console.log(`> 🔒 Vesting:`);
    console.log(`> Total Locked: ${vest.totalLocked} AGC`);
    console.log(`> Released: ${vest.released} AGC`);
    console.log(`> Fully Vested: ${vest.fullyVestedAt}`);
    console.log(`> LP Token ID: ${vest.lpTokenId}`);
  }
}

async function challenge() {
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await getSmartAccount(signer);
  try {
    const res = await axios.get(`${VERIFIER_URL}/challenge?address=${account.address}`);
    const d = res.data;
    console.log(`> 🧩 Challenge Received`);
    if (d.intro) console.log(`> Intro: ${d.intro}`);
    if (d.required_word) console.log(`> Required Word: ${d.required_word}`);
    if (d.constraints) console.log(`> Constraints: ${d.constraints}`);
    // Also output raw JSON for programmatic use
    console.log(`> ---`);
    console.log(JSON.stringify(d, null, 2));
  } catch (e) {
    formatError(`Verifier unreachable: ${e.message}`);
  }
}

async function verify(answer, constraints) {
  if (!answer || !constraints) return formatError("Usage: verify <answer> <constraints>");
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await getSmartAccount(signer);
  try {
    const res = await axios.post(`${VERIFIER_URL}/verify`, {
      wallet_address: account.address,
      answer_text: answer,
      constraints: constraints,
    });
    const d = res.data;
    if (d.success) {
      console.log(`> ✅ Verification Passed`);
      console.log(`> Score: ${d.score}`);
      console.log(`> Nonce: ${d.nonce}`);
      console.log(`> Signature: ${d.signature}`);
    } else {
      console.log(`> ❌ Verification Failed`);
      if (d.message) console.log(`> Reason: ${d.message}`);
    }
    // Also output raw JSON for programmatic use
    console.log(`> ---`);
    console.log(JSON.stringify(d, null, 2));
  } catch (e) {
    formatError(`Verification failed: ${e.response?.data?.message || e.message}`);
  }
}

async function cost() {
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found. Run create_wallet first.");
  const account = await getSmartAccount(signer);

  try {
    const estReward = await publicClient.readContract({
      address: AGC_TOKEN_ADDRESS,
      abi: parseAbi(["function getEstimatedReward(uint256) view returns (uint256)"]),
      functionName: "getEstimatedReward",
      args: [1n],
    });
    const liquidPart = (estReward * 15n) / 100n;
    const gasPart = (estReward * 2n) / 100n;
    const vestPart = (estReward * 83n) / 100n;
    const state = await publicClient.readContract({
      address: LIKWID_HELPER_ADDRESS,
      abi: LIKWID_HELPER_ABI,
      functionName: "getPoolStateInfo",
      args: [POOL_ID],
    });
    const r0 = BigInt(state.pairReserve0);
    const r1 = BigInt(state.pairReserve1);
    let ethCost = 0n;
    if (r1 > 0n) ethCost = (liquidPart * r0) / r1;

    const ethBalance = await publicClient.getBalance({ address: account.address });
    const deficit = ethCost > ethBalance ? ethCost - ethBalance : 0n;

    console.log(`> 💰 Mining Cost Estimate`);
    console.log(`> Total Reward: ${(Number(estReward) / 1e18).toFixed(6)} AGC`);
    console.log(`>`);
    console.log(`> 📋 Full Alignment Breakdown (2/15/83):`);
    console.log(`>   2% Liquid (gas capital): ${(Number(gasPart) / 1e18).toFixed(6)} AGC`);
    console.log(`>   15% LP Paired with ETH: ${(Number(liquidPart) / 1e18).toFixed(6)} AGC`);
    console.log(`>   83% Vesting (83 days):  ${(Number(vestPart) / 1e18).toFixed(6)} AGC`);
    console.log(`>`);
    console.log(`> 💎 ETH Required for LP: ${(Number(ethCost) / 1e18).toFixed(6)} ETH`);
    console.log(`>`);
    console.log(`> 🏦 Smart Account: ${account.address}`);
    console.log(`> 💳 Current ETH Balance: ${(Number(ethBalance) / 1e18).toFixed(6)} ETH`);
    if (deficit > 0n) {
      console.log(`> ⚠️  ETH Deficit: ${(Number(deficit) / 1e18).toFixed(6)} ETH — please top up your Smart Account before mining with Full Alignment.`);
    } else {
      console.log(`> ✅ ETH Balance sufficient for Full Alignment.`);
    }
  } catch (e) {
    formatError(`Failed to calc cost: ${e.message}`);
  }
}

async function cooldown() {
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await getSmartAccount(signer);
  try {
    const time = await publicClient.readContract({
      address: AGC_TOKEN_ADDRESS,
      abi: parseAbi(["function getTimeUntilCanMine(address) view returns (uint256)"]),
      functionName: "getTimeUntilCanMine",
      args: [account.address],
    });
    if (time === 0n) {
      console.log(`> ✅ Cooldown complete — ready to mine!`);
    } else {
      console.log(`> ⏳ Cooldown: ${formatHumanSeconds(time)} remaining`);
    }
  } catch (e) {
    formatError(e.message);
  }
}

async function reward() {
  try {
    const rw = await publicClient.readContract({
      address: AGC_TOKEN_ADDRESS,
      abi: parseAbi(["function getEstimatedReward(uint256) view returns (uint256)"]),
      functionName: "getEstimatedReward",
      args: [1n],
    });
    console.log(`> 🎁 Estimated Reward: ${(Number(rw) / 1e18).toFixed(6)} AGC (for score=1)`);
  } catch (e) {
    formatError(e.message);
  }
}

async function claimVested() {
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await getSmartAccount(signer);
  const call = {
    to: AGC_TOKEN_ADDRESS,
    value: 0n,
    data: encodeFunctionData({
      abi: parseAbi(["function claimVested() external"]),
      functionName: "claimVested",
    }),
  };
  await runUserOp(account, call, "Claim Vested AGC");
}

async function claimable() {
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await getSmartAccount(signer);
  try {
    const amt = await publicClient.readContract({
      address: AGC_TOKEN_ADDRESS,
      abi: parseAbi(["function getClaimableVested(address) view returns (uint256)"]),
      functionName: "getClaimableVested",
      args: [account.address],
    });
    console.log(`> 🔓 Claimable Vested: ${(Number(amt) / 1e18).toFixed(6)} AGC`);
  } catch (e) {
    formatError(e.message);
  }
}

async function mine(scoreStr, signature, nonceStr, ethAmountStr) {
  if (!scoreStr || !signature || !nonceStr) {
    return formatError("Usage: mine <score> <signature> <nonce> [ethAmount]");
  }
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await getSmartAccount(signer);

  const score = BigInt(scoreStr);
  const nonce = BigInt(nonceStr);
  const ethAmount = ethAmountStr ? parseEther(ethAmountStr) : 0n;

  const mode = ethAmount > 0n ? "Full Alignment" : "Quick Exit";
  console.log(`> ⛏️ Mining AGC (${mode})...`);
  console.log(`> Score: ${scoreStr}, Nonce: ${nonceStr}, ETH: ${ethAmountStr || "0"}`);

  const mineCall = {
    to: AGC_TOKEN_ADDRESS,
    value: ethAmount,
    data: encodeFunctionData({
      abi: parseAbi(["function mine(uint256 score, bytes calldata signature, uint256 nonce) external payable"]),
      functionName: "mine",
      args: [score, signature, nonce],
    }),
  };

  await runUserOp(account, mineCall, "Mine AGC");
}

// ======================= DEFI ACTIONS =======================

async function swap_command(direction, amountStr, slippageStr = "1") {
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await getSmartAccount(signer);

  const zeroForOne = direction === "eth-agc";
  const amountIn = parseEther(amountStr || "0");
  const slippage = BigInt(slippageStr);

  const fromToken = zeroForOne ? "ETH" : "AGC";
  const toToken = zeroForOne ? "AGC" : "ETH";

  console.log(`> 🔄 Swap: ${amountStr} ${fromToken} → ${toToken}`);
  let amountOut;
  try {
    const res = await publicClient.readContract({
      address: LIKWID_HELPER_ADDRESS,
      abi: LIKWID_HELPER_ABI,
      functionName: "getAmountOut",
      args: [POOL_ID, zeroForOne, amountIn, true],
    });
    amountOut = res[0];
  } catch (e) {
    return formatError(`Simulation failed: ${e.message || e}`);
  }

  console.log(`> Simulated output: ~${(Number(amountOut) / 1e18).toFixed(6)} ${toToken} (${slippageStr}% slippage)`);

  const amountOutMin = (amountOut * (100n - slippage)) / 100n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  if (!zeroForOne) {
    const approval = await getApprovalCall(account.address, AGC_TOKEN_ADDRESS, LIKWID_PAIR_POSITION, amountIn);
    if (approval) {
      const ok = await runUserOp(account, approval, `Approve AGC for Swap`);
      if (!ok) return;
    }
  }

  const swapCall = {
    to: LIKWID_PAIR_POSITION,
    value: zeroForOne ? amountIn : 0n,
    data: encodeFunctionData({
      abi: LIKWID_PAIR_ABI,
      functionName: "exactInput",
      args: [
        {
          poolId: POOL_ID,
          zeroForOne,
          to: account.address,
          amountIn,
          amountOutMin,
          deadline,
        },
      ],
    }),
  };

  await runUserOp(account, swapCall, `Swap ${direction}`);
}

async function lp_add(amountEthStr, slippageStr = "1") {
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await getSmartAccount(signer);

  const amount0 = parseEther(amountEthStr || "0");
  const slippage = BigInt(slippageStr);

  console.log(`> 💧 Adding Liquidity: ${amountEthStr} ETH + matching AGC`);
  const stateInfo = await publicClient.readContract({
    address: LIKWID_HELPER_ADDRESS,
    abi: LIKWID_HELPER_ABI,
    functionName: "getPoolStateInfo",
    args: [POOL_ID],
  });

  const reserve0 = stateInfo.pairReserve0;
  const reserve1 = stateInfo.pairReserve1;
  let amount1 = 0n;
  if (reserve0 > 0n) {
    amount1 = (amount0 * BigInt(reserve1)) / BigInt(reserve0);
  } else {
    amount1 = amount0 * 210000000n;
  }

  console.log(`> Required AGC: ~${(Number(amount1) / 1e18).toFixed(6)} AGC`);

  const amount0Min = (amount0 * (100n - slippage)) / 100n;
  const amount1Min = (amount1 * (100n - slippage)) / 100n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  const approval = await getApprovalCall(account.address, AGC_TOKEN_ADDRESS, LIKWID_PAIR_POSITION, amount1);
  if (approval) {
    const ok = await runUserOp(account, approval, `Approve AGC for LP`);
    if (!ok) return;
  }

  const lpCall = {
    to: LIKWID_PAIR_POSITION,
    value: amount0,
    data: encodeFunctionData({
      abi: LIKWID_PAIR_ABI,
      functionName: "addLiquidity",
      args: [POOL_KEY, account.address, amount0, amount1, amount0Min, amount1Min, deadline],
    }),
  };

  await runUserOp(account, lpCall, `Add Liquidity`);
}

async function margin_open(direction, amountStr, leverageStr = "2") {
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await getSmartAccount(signer);

  const marginForOne = direction === "agc";
  const marginAmount = parseEther(amountStr || "0");
  const leverage = parseInt(leverageStr || "2");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  const asset = marginForOne ? "AGC" : "ETH";
  console.log(`> 📈 Opening Margin: ${amountStr} ${asset} @ ${leverage}x leverage`);

  if (marginForOne) {
    const approval = await getApprovalCall(account.address, AGC_TOKEN_ADDRESS, LIKWID_MARGIN_POSITION, marginAmount);
    if (approval) {
      const ok = await runUserOp(account, approval, `Approve AGC for Margin`);
      if (!ok) return;
    }
  }

  const marginCall = {
    to: LIKWID_MARGIN_POSITION,
    value: marginForOne ? 0n : marginAmount,
    data: encodeFunctionData({
      abi: LIKWID_MARGIN_ABI,
      functionName: "addMargin",
      args: [
        POOL_KEY,
        {
          marginForOne,
          leverage,
          marginAmount,
          borrowAmount: 0n,
          borrowAmountMax: marginForOne ? parseEther("1000000000") : parseEther("1000"),
          recipient: account.address,
          deadline,
        },
      ],
    }),
  };

  await runUserOp(account, marginCall, `Open Margin ${direction} ${leverageStr}x`);
}

async function lend_open(asset, amountStr) {
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await getSmartAccount(signer);

  const lendForOne = asset === "agc";
  const amount = parseEther(amountStr || "0");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  const assetLabel = lendForOne ? "AGC" : "ETH";
  console.log(`> 🏦 Lending: ${amountStr} ${assetLabel}`);

  if (lendForOne) {
    const approval = await getApprovalCall(account.address, AGC_TOKEN_ADDRESS, LIKWID_LEND_POSITION, amount);
    if (approval) {
      const ok = await runUserOp(account, approval, `Approve AGC for Lend`);
      if (!ok) return;
    }
  }

  const lendCall = {
    to: LIKWID_LEND_POSITION,
    value: lendForOne ? 0n : amount,
    data: encodeFunctionData({
      abi: LIKWID_LEND_ABI,
      functionName: "addLending",
      args: [POOL_KEY, lendForOne, account.address, amount, deadline],
    }),
  };

  await runUserOp(account, lendCall, `Lend ${asset}`);
}

async function liquidate_position(tokenIdStr) {
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await getSmartAccount(signer);

  const tokenId = BigInt(tokenIdStr || "0");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  console.log(`> ⚡ Liquidating Position #${tokenIdStr}...`);

  const liquidateCall = {
    to: LIKWID_MARGIN_POSITION,
    value: 0n,
    data: encodeFunctionData({
      abi: LIKWID_MARGIN_ABI,
      functionName: "liquidateBurn",
      args: [tokenId, deadline],
    }),
  };

  await runUserOp(account, liquidateCall, `Liquidate Position #${tokenIdStr}`);
}

async function scan_liquidations(scanWindowStr = "100") {
  const scanWindow = parseInt(scanWindowStr);
  console.log(`> 🔍 Scanning positions (last ${scanWindow})...`);

  let nextId;
  try {
    nextId = await publicClient.readContract({
      address: LIKWID_MARGIN_POSITION,
      abi: LIKWID_MARGIN_ABI,
      functionName: "nextId",
    });
  } catch (e) {
    return formatError(`Could not get nextId: ${e.message}`);
  }

  const maxId = Number(nextId);
  const startId = Math.max(1, maxId - scanWindow);

  console.log(`> Range: #${startId} to #${maxId - 1}`);
  const liquidatable = [];

  for (let id = startId; id < maxId; id++) {
    try {
      const isLiquidatable = await publicClient.readContract({
        address: LIKWID_HELPER_ADDRESS,
        abi: LIKWID_HELPER_ABI,
        functionName: "checkMarginPositionLiquidate",
        args: [BigInt(id)],
      });
      if (isLiquidatable) {
        liquidatable.push(id);
      }
    } catch (e) {}
  }

  if (liquidatable.length > 0) {
    console.log(`> Found ${liquidatable.length} liquidatable positions: ${liquidatable.map(id => `#${id}`).join(", ")}`);
  } else {
    console.log(`> No liquidatable positions found.`);
  }
}

// ======================= CLI ROUTER =======================
const args = process.argv.slice(2);
const command = args[0];

if (!command) {
  console.log(`Likwid Agent Genesis CLI

Usage: node genesis.js <command> [args]

Setup:
  check_wallet              Check if an EOA wallet exists.
  create_wallet             Create a new EOA wallet.
  get_smart_account         Display EOA and Smart Account addresses.

Mining Workflow:
  status                    Full account status (balances, cooldown, vesting).
  challenge                 Request a PoA challenge from the verifier.
  verify <ans> <constraints> Submit solution to get a mining signature.
  cost                      Calculate ETH required for full-alignment LP mine.
  mine <score> <sig> <nonce> [eth]  Submit the mine transaction.

Vesting:
  claimable                 Check claimable vested AGC balance.
  vest                      Claim vested AGC tokens.

Info:
  cooldown                  Check time until next mining opportunity.
  reward                    Check estimated reward for score=1.

DeFi Actions:
  swap <dir> <amt>          Swap between ETH and AGC (eth-agc / agc-eth).
  lp_add <eth>              Add liquidity to ETH/AGC pool.
  margin_open <dir> <amt> [lev]  Open a margin position.
  lend_open <asset> <amt>   Lend ETH or AGC.
  liquidate <id>            Liquidate a margin position.
  scan [window]             Scan for liquidation opportunities.
`);
  process.exit(0);
}

switch (command) {
  case "check_wallet":
    check_wallet();
    break;
  case "create_wallet":
    create_wallet();
    break;
  case "get_smart_account":
    get_smart_account();
    break;
  case "status":
    status();
    break;
  case "challenge":
    challenge();
    break;
  case "verify":
    verify(args[1], args[2]);
    break;
  case "cost":
    cost();
    break;
  case "cooldown":
    cooldown();
    break;
  case "reward":
    reward();
    break;
  case "mine":
    mine(args[1], args[2], args[3], args[4]);
    break;
  case "vest":
    claimVested();
    break;
  case "claimable":
    claimable();
    break;
  case "swap":
    swap_command(args[1], args[2], args[3]);
    break;
  case "lp_add":
    lp_add(args[1], args[2]);
    break;
  case "margin_open":
    margin_open(args[1], args[2], args[3]);
    break;
  case "lend_open":
    lend_open(args[1], args[2]);
    break;
  case "liquidate":
    liquidate_position(args[1]);
    break;
  case "scan":
    scan_liquidations(args[1]);
    break;
  default:
    console.log("Unknown command:", command);
}
