/**
 * genesis.js — Agent Genesis: Wallet management & AGC mining workflow.
 *
 * Provides: wallet setup, PoA challenge/verify, mining, vesting, status.
 * DeFi operations (swap, LP, margin, lend, liquidation) are in likwid.js.
 */

const {
  // Config
  VERIFIER_URL,
  AGC_TOKEN_ADDRESS,
  AGENT_PAYMASTER_ADDRESS,
  LIKWID_HELPER_ADDRESS,
  POOL_ID,
  WALLET_FILE,
  // ABIs
  ERC20_ABI,
  LIKWID_HELPER_ABI,
  // Clients
  publicClient,
  // Wallet & Account
  getWalletInstance,
  getSmartAccount,
  // UserOp
  runUserOp,
  // Helpers
  formatError,
  formatHumanSeconds,
  loadEnvConfig,
  // viem utilities
  parseEther,
  encodeFunctionData,
  parseAbi,
  generatePrivateKey,
  privateKeyToAccount,
  fs,
  path,
} = require("./shared");

const axios = require("axios");
const { ReclaimClient } = require("@reclaimprotocol/zk-fetch");

// Load .env config for billing proof
const { MODEL_TYPE, MODEL_KEY } = loadEnvConfig();

// Import position scanning from likwid.js (used by status command)
const {
  scanUserPositions,
  LIKWID_MARGIN_POSITION,
  LIKWID_MARGIN_ABI,
  LIKWID_PAIR_POSITION,
  LIKWID_PAIR_ABI,
  LIKWID_LEND_POSITION,
  LIKWID_LEND_ABI,
} = require("./likwid");

// ======================= WALLET MANAGEMENT =======================

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

  // Scan positions summary (from likwid.js)
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

async function reclaim_bill(op) {
  let reclaimProofStr = null;
  let modelTypeStr = null;
  const print_proof = op === "pp";
  if (MODEL_TYPE && MODEL_KEY) {
    console.log(`> 🔍 Detected API Key for ${MODEL_TYPE}, generating Reclaim proof...`);
    try {
      const sigRes = await axios.get(`${VERIFIER_URL}/session-signature`);
      const { appId, signature } = sigRes.data;
      console.log(`> Received session signature from verifier, generating Reclaim proof...`);

      const client = new ReclaimClient(appId, signature);

      if (MODEL_TYPE.toLowerCase() === "openrouter") {
        const proof = await client.zkFetch(
          "https://openrouter.ai/api/v1/key",
          {
            method: "GET",
          },
          {
            headers: {
              Authorization: `Bearer ${MODEL_KEY}`,
            },
            responseMatches: [
              {
                type: "regex",
                value: '"label":\\s*"(?<label>[^"]+)"',
              },
              {
                type: "regex",
                value: '"usage":(?<usage>[0-9.]+)',
              },
            ],
          },
        );

        reclaimProofStr = JSON.stringify(proof);
        modelTypeStr = "openrouter";
        if (print_proof) {
          console.log(`> 🔐 Reclaim proof:`);
          console.log(JSON.stringify(proof, null, 2));
        } else {
          console.log(`> 🔐 Reclaim proof generated successfully.`);
        }
      } else {
        console.log(`> ⚠️ Unsupported MODEL_TYPE: ${MODEL_TYPE}`);
      }
    } catch (e) {
      console.log(`> ⚠️ Reclaim proof generation failed: ${e.message}`);
    }
  } else {
    console.log(`> 🔍 No MODEL_TYPE and MODEL_KEY configured, skipping Reclaim proof generation.`);
  }
  return { reclaimProofStr, modelTypeStr };
}

async function verify(answer, constraints) {
  if (!answer || !constraints) return formatError("Usage: verify <answer> <constraints>");
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await getSmartAccount(signer);

  const { reclaimProofStr, modelTypeStr } = await reclaim_bill();

  try {
    const payload = {
      wallet_address: account.address,
      answer_text: answer,
      constraints: constraints,
    };
    if (reclaimProofStr) {
      payload.reclaim_proof = reclaimProofStr;
      payload.model_type = modelTypeStr;
    }

    const res = await axios.post(`${VERIFIER_URL}/verify`, payload);
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
    formatError(`Verification failed: ${e.response?.data?.detail || e.response?.data?.message || e.message}`);
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
    if (r1 > 0n) ethCost = (liquidPart * r0 * 110n) / (r1 * 100n); // Add 10% slippage

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

// ======================= CLI ROUTER =======================
const args = process.argv.slice(2);
const command = args[0];

if (!command) {
  console.log(`Agent Genesis CLI — Wallet & Mining

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
  claim                     Claim vested AGC tokens.

Info:
  cooldown                  Check time until next mining opportunity.
  reward [score]            Check estimated reward (default score=1).
  reclaim_bill [pp]         Generate Reclaim billing proof (pp = print proof).

DeFi Operations → use likwid.js:
  node likwid.js <command>  See likwid.js --help for swap, LP, margin, lend, liquidation.
`);
  process.exit(0);
}

(async () => {
  switch (command) {
    case "check_wallet":
      await check_wallet();
      break;
    case "create_wallet":
      await create_wallet();
      break;
    case "get_smart_account":
      await get_smart_account();
      break;
    case "status":
      await status();
      break;
    case "challenge":
      await challenge();
      break;
    case "verify":
      await verify(args[1], args[2]);
      break;
    case "cost":
      await cost(args[1]);
      break;
    case "cooldown":
      await cooldown();
      break;
    case "reward":
      await reward(args[1]);
      break;
    case "mine":
      await mine(args[1], args[2], args[3], args[4]);
      break;
    case "claim":
      await claimVested();
      break;
    case "claimable":
      await claimable();
      break;
    case "reclaim_bill":
      await reclaim_bill(args[1]);
      break;
    default:
      console.log("Unknown command:", command);
      console.log("For DeFi operations, use: node likwid.js <command>");
  }
  process.exit(0);
})();
