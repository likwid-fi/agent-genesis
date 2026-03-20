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

const AGC_TOKEN_ADDRESS = process.env.AGC_TOKEN_ADDRESS || "0x33657d1629913DeD856A7f0040dA1159Aa06f47d";
const AGENT_PAYMASTER_ADDRESS = process.env.AGENT_PAYMASTER_ADDRESS || "0x7a4Ee392DF05355a179ae16558e86EAEDAd3b753";
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
  "function removeLiquidity(uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) external returns (uint256 amount0, uint256 amount1)",
  "function getPositionState(uint256 positionId) external view returns ((uint128 liquidity, uint256 totalInvestment) state)",
  "function nextId() external view returns (uint256)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
]);

const LIKWID_MARGIN_ABI = parseAbi([
  "function addMargin((address currency0, address currency1, uint24 fee, uint24 marginFee) key, (bool marginForOne, uint24 leverage, uint256 marginAmount, uint256 borrowAmount, uint256 borrowAmountMax, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint256 borrowAmount, uint256 swapFeeAmount)",
  "function close(uint256 tokenId, uint24 closeMillionth, uint256 closeAmountMin, uint256 deadline) external",
  "function liquidateBurn(uint256 tokenId, uint256 deadline) external returns (uint256 profit)",
  "function getPositionState(uint256 tokenId) external view returns ((bool marginForOne, uint128 marginAmount, uint128 marginTotal, uint256 depositCumulativeLast, uint128 debtAmount, uint256 borrowCumulativeLast) state)",
  "function nextId() external view returns (uint256)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
]);

const LIKWID_LEND_ABI = parseAbi([
  "function addLending((address currency0, address currency1, uint24 fee, uint24 marginFee) key, bool lendForOne, address recipient, uint256 amount, uint256 deadline) external payable returns (uint256 tokenId)",
  "function withdraw(uint256 tokenId, uint256 amount, uint256 deadline) external",
  "function getPositionState(uint256 positionId) external view returns ((uint128 lendAmount, uint256 depositCumulativeLast) state)",
  "function nextId() external view returns (uint256)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
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
    return receipt;
  } catch (e) {
    console.error(`> ${description} execution failed:`, e.stack || e.message || e);
    return null;
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

    let ethBalEOA = 0n,
      ethBalSA = 0n,
      agcBalEOA = 0n,
      agcBalSA = 0n;
    try {
      [ethBalEOA, ethBalSA] = await Promise.all([
        publicClient.getBalance({ address: signer.address }),
        publicClient.getBalance({ address: account.address }),
      ]);
      [agcBalEOA, agcBalSA] = await Promise.all([
        publicClient.readContract({
          address: AGC_TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [signer.address],
        }),
        publicClient.readContract({
          address: AGC_TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [account.address],
        }),
      ]);
    } catch (e) {
      /* contract may not exist yet */
    }

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

  const miningStatus = cooldownSec === 0n ? "✅ Yes" : `⏳ No — ${formatHumanSeconds(cooldownSec)} remaining`;

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

  // Scan positions summary
  try {
    const [marginPositions, lpPositions, lendPositions] = await Promise.all([
      scanUserPositions(LIKWID_MARGIN_POSITION, LIKWID_MARGIN_ABI, account.address, 200),
      scanUserPositions(LIKWID_PAIR_POSITION, LIKWID_PAIR_ABI, account.address, 200),
      scanUserPositions(LIKWID_LEND_POSITION, LIKWID_LEND_ABI, account.address, 200),
    ]);

    if (marginPositions.length > 0 || lpPositions.length > 0 || lendPositions.length > 0) {
      console.log(`>`);
      console.log(`> 📋 DeFi Positions:`);
      if (marginPositions.length > 0) {
        console.log(`>   📈 Margin: ${marginPositions.length} position(s)`);
        for (const p of marginPositions) {
          const dir = p.marginForOne ? "Long AGC" : "Long ETH";
          console.log(
            `>     #${p.id} ${dir} | Margin: ${(Number(p.marginAmount) / 1e18).toFixed(4)} | Debt: ${(Number(p.debtAmount) / 1e18).toFixed(4)}`,
          );
        }
      }
      if (lpPositions.length > 0) {
        console.log(`>   💧 LP: ${lpPositions.length} position(s)`);
        for (const p of lpPositions) {
          console.log(`>     #${p.id} Liq: ${(Number(p.liquidity) / 1e18).toFixed(4)}`);
        }
      }
      if (lendPositions.length > 0) {
        console.log(`>   🏦 Lend: ${lendPositions.length} position(s)`);
        for (const p of lendPositions) {
          console.log(`>     #${p.id} Amount: ${(Number(p.lendAmount) / 1e18).toFixed(4)}`);
        }
      }
    }
  } catch (e) {
    // Position scanning is best-effort
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

async function cost(score) {
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found. Run create_wallet first.");
  const account = await getSmartAccount(signer);
  const scoreVal = BigInt(score || 1);

  try {
    const estReward = await publicClient.readContract({
      address: AGC_TOKEN_ADDRESS,
      abi: parseAbi(["function getEstimatedReward(uint256) view returns (uint256)"]),
      functionName: "getEstimatedReward",
      args: [scoreVal],
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

    console.log(`> 💰 Mining Cost Estimate (score=${scoreVal})`);
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
      console.log(
        `> ⚠️  ETH Deficit: ${(Number(deficit) / 1e18).toFixed(6)} ETH — please top up your Smart Account before mining with Full Alignment.`,
      );
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

async function reward(score) {
  const scoreVal = BigInt(score || 1);
  try {
    const rw = await publicClient.readContract({
      address: AGC_TOKEN_ADDRESS,
      abi: parseAbi(["function getEstimatedReward(uint256) view returns (uint256)"]),
      functionName: "getEstimatedReward",
      args: [scoreVal],
    });
    console.log(`> 🎁 Estimated Reward: ${(Number(rw) / 1e18).toFixed(6)} AGC (for score=${scoreVal})`);
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
  const swapCalls = [];
  let description = ``;

  if (!zeroForOne) {
    const approval = await getApprovalCall(account.address, AGC_TOKEN_ADDRESS, LIKWID_PAIR_POSITION, amountIn);
    if (approval) {
      console.log(`> Approving AGC for Swap...`);
      description += `Approve AGC for Swap + `;
      swapCalls.push(approval);
    }
    // Also approve Paymaster to spend AGC for sponsorship
    const pmApproval = await getApprovalCall(account.address, AGC_TOKEN_ADDRESS, AGENT_PAYMASTER_ADDRESS, parseEther("1000000")); // Approve a large amount
    if (pmApproval) {
      console.log(`> Approving AGC for Paymaster sponsorship...`);
      description += `Approve AGC for Paymaster + `;
      swapCalls.push(pmApproval);
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
  swapCalls.push(swapCall);
  description += `Swap ${direction}`;
  await runUserOp(account, swapCalls, description);
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

  const lpCalls = [];
  let description = "";

  const approval = await getApprovalCall(account.address, AGC_TOKEN_ADDRESS, LIKWID_PAIR_POSITION, amount1);
  if (approval) {
    console.log(`> Approving AGC for LP...`);
    lpCalls.push(approval);
    description += "Approve AGC for LP + ";
  }

  // Also approve Paymaster to spend AGC for sponsorship
  const pmApproval = await getApprovalCall(account.address, AGC_TOKEN_ADDRESS, AGENT_PAYMASTER_ADDRESS, parseEther("1000000"));
  if (pmApproval) {
    console.log(`> Approving AGC for Paymaster sponsorship...`);
    lpCalls.push(pmApproval);
    description += "Approve AGC for Paymaster + ";
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
  lpCalls.push(lpCall);
  description += "Add Liquidity";

  await runUserOp(account, lpCalls, description);
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

  const marginCalls = [];
  let description = "";

  if (marginForOne) {
    const approval = await getApprovalCall(account.address, AGC_TOKEN_ADDRESS, LIKWID_MARGIN_POSITION, marginAmount);
    if (approval) {
      console.log(`> Approving AGC for Margin...`);
      marginCalls.push(approval);
      description += "Approve AGC for Margin + ";
    }
  }

  // Also approve Paymaster to spend AGC for sponsorship
  const pmApproval = await getApprovalCall(account.address, AGC_TOKEN_ADDRESS, AGENT_PAYMASTER_ADDRESS, parseEther("1000000"));
  if (pmApproval) {
    console.log(`> Approving AGC for Paymaster sponsorship...`);
    marginCalls.push(pmApproval);
    description += "Approve AGC for Paymaster + ";
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
  marginCalls.push(marginCall);
  description += `Open Margin ${direction} ${leverageStr}x`;

  await runUserOp(account, marginCalls, description);
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

  const lendCalls = [];
  let description = "";

  if (lendForOne) {
    const approval = await getApprovalCall(account.address, AGC_TOKEN_ADDRESS, LIKWID_LEND_POSITION, amount);
    if (approval) {
      console.log(`> Approving AGC for Lend...`);
      lendCalls.push(approval);
      description += "Approve AGC for Lend + ";
    }
  }

  // Also approve Paymaster to spend AGC for sponsorship
  const pmApproval = await getApprovalCall(account.address, AGC_TOKEN_ADDRESS, AGENT_PAYMASTER_ADDRESS, parseEther("1000000"));
  if (pmApproval) {
    console.log(`> Approving AGC for Paymaster sponsorship...`);
    lendCalls.push(pmApproval);
    description += "Approve AGC for Paymaster + ";
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
  lendCalls.push(lendCall);
  description += `Lend ${asset}`;

  await runUserOp(account, lendCalls, description);
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
    console.log(
      `> Found ${liquidatable.length} liquidatable positions: ${liquidatable.map((id) => `#${id}`).join(", ")}`,
    );
  } else {
    console.log(`> No liquidatable positions found.`);
  }
}

// ======================= POSITION MANAGEMENT =======================

async function scanUserPositions(contractAddress, abi, ownerAddress, scanWindow = 200) {
  let nextId;
  try {
    nextId = await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: "nextId",
    });
  } catch (e) {
    return [];
  }

  const maxId = Number(nextId);
  const startId = Math.max(1, maxId - scanWindow);
  const positions = [];

  for (let id = startId; id < maxId; id++) {
    try {
      const owner = await publicClient.readContract({
        address: contractAddress,
        abi,
        functionName: "ownerOf",
        args: [BigInt(id)],
      });
      if (owner.toLowerCase() === ownerAddress.toLowerCase()) {
        const state = await publicClient.readContract({
          address: contractAddress,
          abi,
          functionName: "getPositionState",
          args: [BigInt(id)],
        });
        positions.push({ id, ...state });
      }
    } catch (e) {
      // Token may be burned or not exist
    }
  }
  return positions;
}

async function positions() {
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found. Run create_wallet first.");
  const account = await getSmartAccount(signer);
  const addr = account.address;

  console.log(`> 📋 Scanning Positions for ${addr}...`);

  const [marginPositions, lpPositions, lendPositions] = await Promise.all([
    scanUserPositions(LIKWID_MARGIN_POSITION, LIKWID_MARGIN_ABI, addr),
    scanUserPositions(LIKWID_PAIR_POSITION, LIKWID_PAIR_ABI, addr),
    scanUserPositions(LIKWID_LEND_POSITION, LIKWID_LEND_ABI, addr),
  ]);

  console.log(`>`);
  console.log(`> 📈 Margin Positions: ${marginPositions.length}`);
  for (const p of marginPositions) {
    const dir = p.marginForOne ? "Long AGC" : "Long ETH";
    console.log(
      `>   #${p.id} | ${dir} | Margin: ${(Number(p.marginAmount) / 1e18).toFixed(6)} | Total: ${(Number(p.marginTotal) / 1e18).toFixed(6)} | Debt: ${(Number(p.debtAmount) / 1e18).toFixed(6)}`,
    );
  }

  console.log(`>`);
  console.log(`> 💧 LP Positions: ${lpPositions.length}`);
  for (const p of lpPositions) {
    console.log(
      `>   #${p.id} | Liquidity: ${(Number(p.liquidity) / 1e18).toFixed(6)} | Investment: ${(Number(p.totalInvestment) / 1e18).toFixed(6)}`,
    );
  }

  console.log(`>`);
  console.log(`> 🏦 Lend Positions: ${lendPositions.length}`);
  for (const p of lendPositions) {
    console.log(`>   #${p.id} | Lend Amount: ${(Number(p.lendAmount) / 1e18).toFixed(6)}`);
  }

  if (marginPositions.length === 0 && lpPositions.length === 0 && lendPositions.length === 0) {
    console.log(`> No open positions found.`);
  }
}

async function margin_info(tokenIdStr) {
  if (!tokenIdStr) return formatError("Usage: margin_info <position_id>");
  const tokenId = BigInt(tokenIdStr);

  try {
    const state = await publicClient.readContract({
      address: LIKWID_MARGIN_POSITION,
      abi: LIKWID_MARGIN_ABI,
      functionName: "getPositionState",
      args: [tokenId],
    });

    const owner = await publicClient.readContract({
      address: LIKWID_MARGIN_POSITION,
      abi: LIKWID_MARGIN_ABI,
      functionName: "ownerOf",
      args: [tokenId],
    });

    let isLiquidatable = false;
    try {
      isLiquidatable = await publicClient.readContract({
        address: LIKWID_HELPER_ADDRESS,
        abi: LIKWID_HELPER_ABI,
        functionName: "checkMarginPositionLiquidate",
        args: [tokenId],
      });
    } catch (e) {}

    const dir = state.marginForOne ? "Long AGC" : "Long ETH";
    console.log(`> 📈 Margin Position #${tokenIdStr}`);
    console.log(`> Owner: ${owner}`);
    console.log(`> Direction: ${dir}`);
    console.log(`> Margin Amount: ${(Number(state.marginAmount) / 1e18).toFixed(6)}`);
    console.log(`> Margin Total: ${(Number(state.marginTotal) / 1e18).toFixed(6)}`);
    console.log(`> Debt Amount: ${(Number(state.debtAmount) / 1e18).toFixed(6)}`);
    console.log(`> Liquidatable: ${isLiquidatable ? "⚠️ YES" : "✅ No"}`);
  } catch (e) {
    formatError(`Failed to get margin position #${tokenIdStr}: ${e.message}`);
  }
}

async function margin_close(tokenIdStr) {
  if (!tokenIdStr) return formatError("Usage: margin_close <position_id>");
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await getSmartAccount(signer);

  const tokenId = BigInt(tokenIdStr);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  console.log(`> 📉 Closing Margin Position #${tokenIdStr}...`);

  const closeCall = {
    to: LIKWID_MARGIN_POSITION,
    value: 0n,
    data: encodeFunctionData({
      abi: LIKWID_MARGIN_ABI,
      functionName: "close",
      args: [tokenId, 1000000, 0n, deadline], // closeMillionth=1000000 = 100% close
    }),
  };

  const receipt = await runUserOp(account, closeCall, `Close Margin #${tokenIdStr}`);
  if (receipt) {
    // Show updated balance
    const agcBal = await publicClient.readContract({
      address: AGC_TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    });
    const ethBal = await publicClient.getBalance({ address: account.address });
    console.log(`> AGC Balance: ${(Number(agcBal) / 1e18).toFixed(6)} AGC`);
    console.log(`> ETH Balance: ${(Number(ethBal) / 1e18).toFixed(6)} ETH`);
  }
}

async function lp_info(tokenIdStr) {
  if (!tokenIdStr) return formatError("Usage: lp_info <position_id>");
  const tokenId = BigInt(tokenIdStr);

  try {
    const state = await publicClient.readContract({
      address: LIKWID_PAIR_POSITION,
      abi: LIKWID_PAIR_ABI,
      functionName: "getPositionState",
      args: [tokenId],
    });

    const owner = await publicClient.readContract({
      address: LIKWID_PAIR_POSITION,
      abi: LIKWID_PAIR_ABI,
      functionName: "ownerOf",
      args: [tokenId],
    });

    console.log(`> 💧 LP Position #${tokenIdStr}`);
    console.log(`> Owner: ${owner}`);
    console.log(`> Liquidity: ${(Number(state.liquidity) / 1e18).toFixed(6)}`);
    console.log(`> Total Investment: ${(Number(state.totalInvestment) / 1e18).toFixed(6)}`);
  } catch (e) {
    formatError(`Failed to get LP position #${tokenIdStr}: ${e.message}`);
  }
}

async function lp_remove(tokenIdStr) {
  if (!tokenIdStr) return formatError("Usage: lp_remove <position_id>");
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await getSmartAccount(signer);

  const tokenId = BigInt(tokenIdStr);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  // Get position state to know liquidity amount
  let liquidity;
  try {
    const state = await publicClient.readContract({
      address: LIKWID_PAIR_POSITION,
      abi: LIKWID_PAIR_ABI,
      functionName: "getPositionState",
      args: [tokenId],
    });
    liquidity = state.liquidity;
    console.log(`> 💧 Removing LP Position #${tokenIdStr} (liquidity: ${(Number(liquidity) / 1e18).toFixed(6)})...`);
  } catch (e) {
    return formatError(`Failed to read LP position #${tokenIdStr}: ${e.message}`);
  }

  const removeCall = {
    to: LIKWID_PAIR_POSITION,
    value: 0n,
    data: encodeFunctionData({
      abi: LIKWID_PAIR_ABI,
      functionName: "removeLiquidity",
      args: [tokenId, liquidity, 0n, 0n, deadline], // 0 min amounts for full withdrawal
    }),
  };

  const receipt = await runUserOp(account, removeCall, `Remove LP #${tokenIdStr}`);
  if (receipt) {
    const agcBal = await publicClient.readContract({
      address: AGC_TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    });
    const ethBal = await publicClient.getBalance({ address: account.address });
    console.log(`> AGC Balance: ${(Number(agcBal) / 1e18).toFixed(6)} AGC`);
    console.log(`> ETH Balance: ${(Number(ethBal) / 1e18).toFixed(6)} ETH`);
  }
}

async function lend_info(tokenIdStr) {
  if (!tokenIdStr) return formatError("Usage: lend_info <position_id>");
  const tokenId = BigInt(tokenIdStr);

  try {
    const state = await publicClient.readContract({
      address: LIKWID_LEND_POSITION,
      abi: LIKWID_LEND_ABI,
      functionName: "getPositionState",
      args: [tokenId],
    });

    const owner = await publicClient.readContract({
      address: LIKWID_LEND_POSITION,
      abi: LIKWID_LEND_ABI,
      functionName: "ownerOf",
      args: [tokenId],
    });

    console.log(`> 🏦 Lend Position #${tokenIdStr}`);
    console.log(`> Owner: ${owner}`);
    console.log(`> Lend Amount: ${(Number(state.lendAmount) / 1e18).toFixed(6)}`);
  } catch (e) {
    formatError(`Failed to get lend position #${tokenIdStr}: ${e.message}`);
  }
}

async function lend_close(tokenIdStr, amountStr) {
  if (!tokenIdStr) return formatError("Usage: lend_close <position_id> [amount]");
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await getSmartAccount(signer);

  const tokenId = BigInt(tokenIdStr);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  let withdrawAmount;
  if (amountStr) {
    withdrawAmount = parseEther(amountStr);
    console.log(`> 🏦 Withdrawing ${amountStr} from Lend Position #${tokenIdStr}...`);
  } else {
    // Withdraw full amount
    try {
      const state = await publicClient.readContract({
        address: LIKWID_LEND_POSITION,
        abi: LIKWID_LEND_ABI,
        functionName: "getPositionState",
        args: [tokenId],
      });
      withdrawAmount = BigInt(state.lendAmount);
      console.log(
        `> 🏦 Withdrawing full amount (${(Number(withdrawAmount) / 1e18).toFixed(6)}) from Lend Position #${tokenIdStr}...`,
      );
    } catch (e) {
      return formatError(`Failed to read lend position #${tokenIdStr}: ${e.message}`);
    }
  }

  const withdrawCall = {
    to: LIKWID_LEND_POSITION,
    value: 0n,
    data: encodeFunctionData({
      abi: LIKWID_LEND_ABI,
      functionName: "withdraw",
      args: [tokenId, withdrawAmount, deadline],
    }),
  };

  const receipt = await runUserOp(account, withdrawCall, `Withdraw Lend #${tokenIdStr}`);
  if (receipt) {
    const agcBal = await publicClient.readContract({
      address: AGC_TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    });
    const ethBal = await publicClient.getBalance({ address: account.address });
    console.log(`> AGC Balance: ${(Number(agcBal) / 1e18).toFixed(6)} AGC`);
    console.log(`> ETH Balance: ${(Number(ethBal) / 1e18).toFixed(6)} ETH`);
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
  status                    Full account status (balances, cooldown, vesting, positions).
  challenge                 Request a PoA challenge from the verifier.
  verify <ans> <constraints> Submit solution to get a mining signature.
  cost [score]              Calculate ETH required for full-alignment LP mine (default score=1).
  mine <score> <sig> <nonce> [eth]  Submit the mine transaction.

Vesting:
  claimable                 Check claimable vested AGC balance.
  vest                      Claim vested AGC tokens.

Info:
  cooldown                  Check time until next mining opportunity.
  reward [score]            Check estimated reward (default score=1).

DeFi Actions:
  swap <dir> <amt>          Swap between ETH and AGC (eth-agc / agc-eth).
  lp_add <eth>              Add liquidity to ETH/AGC pool.
  margin_open <dir> <amt> [lev]  Open a margin position.
  lend_open <asset> <amt>   Lend ETH or AGC.
  liquidate <id>            Liquidate a margin position.
  scan [window]             Scan for liquidation opportunities.

Position Management:
  positions                 Scan and display all your DeFi positions.
  margin_info <id>          View margin position details.
  margin_close <id>         Close a margin position (full close).
  lp_info <id>              View LP position details.
  lp_remove <id>            Remove all liquidity from LP position.
  lend_info <id>            View lend position details.
  lend_close <id> [amount]  Withdraw from lend position (default: full amount).
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
    cost(args[1]);
    break;
  case "cooldown":
    cooldown();
    break;
  case "reward":
    reward(args[1]);
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
  case "positions":
    positions();
    break;
  case "margin_info":
    margin_info(args[1]);
    break;
  case "margin_close":
    margin_close(args[1]);
    break;
  case "lp_info":
    lp_info(args[1]);
    break;
  case "lp_remove":
    lp_remove(args[1]);
    break;
  case "lend_info":
    lend_info(args[1]);
    break;
  case "lend_close":
    lend_close(args[1], args[2]);
    break;
  default:
    console.log("Unknown command:", command);
}
