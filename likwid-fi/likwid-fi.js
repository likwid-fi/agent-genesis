/**
 * likwid-fi.js — Likwid.fi Protocol Universal Skill
 *
 * Standalone DeFi interaction toolkit for the Likwid Protocol.
 * Supports EOA and ERC-4337 Smart Account execution.
 * No dependency on agent-genesis — fully independent.
 *
 * Commands:
 *   setup <network> <keyFilePath> <accountType>
 *   account
 *   pools
 *   quote <poolIndex> <direction> <amount>
 *   swap <poolIndex> <direction> <amount> [slippage]
 */

const {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  toHex,
  parseUnits,
  formatUnits,
  encodeFunctionData,
  keccak256,
  encodeAbiParameters,
  parseAbi,
  getAddress,
} = require("viem");
const { sepolia, mainnet, base } = require("viem/chains");
const { privateKeyToAccount } = require("viem/accounts");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ======================= PATHS =======================

const CONFIG_FILE = path.join(__dirname, "config.json");
const POOLS_DIR = path.join(__dirname, "pools");
const ABI_DIR = path.join(__dirname, "abi");

// ======================= CHAIN MAP =======================

const CHAINS = {
  sepolia: sepolia,
  ethereum: mainnet,
  base: base,
};

// ======================= NATIVE TOKEN =======================

const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";

// ======================= ABI FRAGMENTS =======================

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
]);

// ======================= HELPERS =======================

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function loadNetworkConfig(network) {
  const file = path.join(POOLS_DIR, `${network}.json`);
  if (!fs.existsSync(file)) {
    console.log(`> ERROR: Network config not found: ${file}`);
    console.log(`> Available networks: ${fs.readdirSync(POOLS_DIR).map(f => f.replace(".json", "")).join(", ")}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadABI(name) {
  const file = path.join(ABI_DIR, `${name}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function expandHome(p) {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function collapseHome(p) {
  const home = os.homedir();
  if (p.startsWith(home + "/")) return "~" + p.slice(home.length);
  return p;
}

function readPrivateKey(keyFilePath) {
  const resolved = path.resolve(expandHome(keyFilePath));
  if (!fs.existsSync(resolved)) {
    console.log(`> ERROR: Private key file not found: ${resolved}`);
    return null;
  }
  let raw = fs.readFileSync(resolved, "utf8").trim();
  // Support JSON wallet files (e.g., agent-genesis format)
  try {
    const json = JSON.parse(raw);
    if (json.privateKey) raw = json.privateKey;
  } catch (_) {}
  if (!raw.startsWith("0x")) raw = "0x" + raw;
  return raw;
}

function computePoolId(poolKey) {
  return keccak256(
    encodeAbiParameters(
      [
        { name: "currency0", type: "address" },
        { name: "currency1", type: "address" },
        { name: "fee", type: "uint24" },
        { name: "marginFee", type: "uint24" },
      ],
      [poolKey.currency0.address, poolKey.currency1.address, poolKey.fee, poolKey.marginFee],
    ),
  );
}

function isNative(address) {
  return address.toLowerCase() === NATIVE_ADDRESS.toLowerCase();
}

function resolveRpc(config, networkConfig) {
  if (process.env.RPC_URL) return http(process.env.RPC_URL);
  if (networkConfig.rpc) return http(networkConfig.rpc);
  return http();
}

// ======================= BUNDLER HELPERS =======================

function serializeRpcValue(value) {
  if (typeof value === "bigint") return toHex(value);
  if (Array.isArray(value)) return value.map(serializeRpcValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, serializeRpcValue(nested)]));
  }
  return value;
}

let bundlerRequestId = 0;

function createParticleBundlerTransport(bundlerUrl, chainId) {
  return custom({
    request: async ({ method, params }) => {
      const response = await fetch(bundlerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++bundlerRequestId,
          chainId,
          method,
          params: serializeRpcValue(params),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message || response.statusText);
      }
      if (payload.error) {
        const error = new Error(payload.error.message || "Bundler request failed");
        error.code = payload.error.code;
        throw error;
      }
      return payload.result;
    },
  });
}

// ======================= CLIENT SETUP =======================

function createClients(config, networkConfig) {
  const privateKey = readPrivateKey(config.keyFilePath);
  if (!privateKey) return null;

  const chain = CHAINS[config.network];
  const transport = resolveRpc(config, networkConfig);
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  return { publicClient, walletClient, account, chain };
}

async function getSmartAccount(config, networkConfig, eoaAccount) {
  const { toSimpleSmartAccount } = require("permissionless/accounts");
  const { entryPoint06Address } = require("viem/account-abstraction");
  const { createBundlerClient } = require("viem/account-abstraction");

  const chain = CHAINS[config.network];
  const transport = resolveRpc(config, networkConfig);
  const bundlerUrl = process.env.BUNDLER_URL || networkConfig.bundlerUrl;
  const factoryAddress = networkConfig.smartAccountFactory;

  const publicClient = createPublicClient({ chain, transport });

  const smartAccount = await toSimpleSmartAccount({
    client: publicClient,
    owner: eoaAccount,
    factoryAddress,
    entryPoint: { address: entryPoint06Address, version: "0.6" },
  });

  const bundlerTransport = bundlerUrl.includes("bundler.particle.network")
    ? createParticleBundlerTransport(bundlerUrl, chain.id)
    : http(bundlerUrl);

  const bundlerClient = createBundlerClient({
    account: smartAccount,
    client: publicClient,
    transport: bundlerTransport,
    userOperation: {
      estimateFeesPerGas: async () => {
        const fees = await publicClient.estimateFeesPerGas();
        const floor = 1_000_000_000n; // 1 gwei floor for Particle bundler
        return {
          maxFeePerGas: fees.maxFeePerGas > floor ? fees.maxFeePerGas : floor,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas > floor ? fees.maxPriorityFeePerGas : floor,
        };
      },
    },
  });

  return { smartAccount, bundlerClient, publicClient };
}

// ======================= SHARED EXECUTION =======================

async function buildApprovalCall(publicClient, owner, tokenAddress, tokenSymbol, spender, amount) {
  const currentAllowance = await publicClient.readContract({
    address: tokenAddress, abi: ERC20_ABI, functionName: "allowance",
    args: [owner, spender],
  });
  if (currentAllowance >= amount) return null;
  console.log(`> Approving ${tokenSymbol}...`);
  return {
    to: tokenAddress, value: 0n,
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [spender, amount] }),
  };
}

async function submitUserOp(bundlerClient, calls) {
  const hash = await bundlerClient.sendUserOperation({ calls });
  console.log(`> UserOp submitted: ${hash}`);
  console.log(`> Waiting for receipt...`);
  const receipt = await bundlerClient.waitForUserOperationReceipt({ hash, timeout: 120_000 });
  if (receipt.success && receipt.receipt?.status === "success") {
    console.log(`> TX_OK`);
    console.log(`> Transaction: ${receipt.receipt.transactionHash}`);
    console.log(`> Block: ${receipt.receipt.blockNumber}`);
    console.log(`> Gas used: ${receipt.actualGasUsed}`);
    return true;
  } else {
    console.log(`> TX_REVERTED`);
    console.log(`> Transaction: ${receipt.receipt?.transactionHash || "unknown"}`);
    console.log(`> Reason: ${receipt.reason || "unknown"}`);
    return false;
  }
}

async function executeCalls(config, netConfig, eoaAccount, publicClient, calls) {
  if (config.accountType === "smart") {
    const { bundlerClient } = await getSmartAccount(config, netConfig, eoaAccount);

    // Split calls: if batch contains ETH-value calls mixed with zero-value calls,
    // run zero-value calls (approvals) first, then the value call separately.
    // SimpleAccount v0.6 executeBatch() does NOT forward msg.value per call.
    const hasValueCall = calls.some(c => c.value > 0n);
    const needsSplit = calls.length > 1 && hasValueCall;

    try {
      if (needsSplit) {
        const zeroCalls = calls.filter(c => !c.value || c.value === 0n);
        const valueCalls = calls.filter(c => c.value > 0n);
        if (zeroCalls.length > 0) {
          console.log(`> Submitting approvals (${zeroCalls.length} call${zeroCalls.length > 1 ? "s" : ""})...`);
          const ok = await submitUserOp(bundlerClient, zeroCalls);
          if (!ok) return;
        }
        for (const vc of valueCalls) {
          console.log(`> Submitting value-carrying call...`);
          const ok = await submitUserOp(bundlerClient, [vc]);
          if (!ok) return;
        }
      } else {
        console.log(`> Submitting UserOperation (${calls.length} call${calls.length > 1 ? "s" : ""})...`);
        await submitUserOp(bundlerClient, calls);
      }
    } catch (e) {
      console.log(`> ERROR: UserOp failed: ${e.shortMessage || e.message}`);
    }
  } else {
    // --- EOA: execute calls sequentially ---
    const chain = CHAINS[config.network];
    const walletClient = createWalletClient({
      account: eoaAccount, chain,
      transport: resolveRpc(config, netConfig),
    });
    console.log(`> Submitting ${calls.length} transaction${calls.length > 1 ? "s" : ""}...`);
    for (const call of calls) {
      try {
        const txHash = await walletClient.sendTransaction({
          to: call.to, value: call.value, data: call.data,
        });
        console.log(`> Tx submitted: ${txHash}`);
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status !== "success") {
          console.log(`> TX_REVERTED: ${txHash}`);
          return;
        }
      } catch (e) {
        console.log(`> ERROR: Transaction failed: ${e.shortMessage || e.message}`);
        return;
      }
    }
    console.log(`> TX_OK`);
  }
}

// ======================= COMMANDS =======================

async function cmd_setup(network, keyFilePath, accountType = "eoa") {
  if (!network || !keyFilePath) {
    console.log(`> Usage: setup <network> <keyFilePath> [accountType]`);
    console.log(`> Networks: sepolia, ethereum, base`);
    console.log(`> Account types: eoa (default), smart`);
    return;
  }

  if (!CHAINS[network]) {
    console.log(`> ERROR: Unknown network "${network}". Supported: sepolia, ethereum, base`);
    return;
  }

  const netConfig = loadNetworkConfig(network);
  if (!netConfig) return;

  const privateKey = readPrivateKey(keyFilePath);
  if (!privateKey) return;

  const account = privateKeyToAccount(privateKey);

  const cfg = { network, keyFilePath: collapseHome(path.resolve(expandHome(keyFilePath))), accountType: accountType.toLowerCase() };
  saveConfig(cfg);

  console.log(`> SETUP_OK`);
  console.log(`> Network: ${netConfig.network} (Chain ID ${netConfig.chainId})`);
  console.log(`> EOA Address: ${account.address}`);
  console.log(`> Account Type: ${cfg.accountType.toUpperCase()}`);
  console.log(`> Key File: ${cfg.keyFilePath}`);

  if (cfg.accountType === "smart") {
    try {
      const { smartAccount } = await getSmartAccount(cfg, netConfig, account);
      console.log(`> Smart Account: ${smartAccount.address}`);
    } catch (e) {
      console.log(`> WARN: Could not derive Smart Account: ${e.message}`);
      console.log(`> Smart Account will be resolved at transaction time.`);
    }
  }
}

async function cmd_account() {
  const config = loadConfig();
  if (!config) {
    console.log(`> ERROR: Not configured. Run setup first.`);
    return;
  }

  const netConfig = loadNetworkConfig(config.network);
  if (!netConfig) return;

  const clients = createClients(config, netConfig);
  if (!clients) return;

  const { publicClient, account } = clients;

  console.log(`> ACCOUNT_INFO`);
  console.log(`> Network: ${netConfig.network} (Chain ID ${netConfig.chainId})`);
  console.log(`> Account Type: ${config.accountType.toUpperCase()}`);
  console.log(`> EOA Address: ${account.address}`);

  const ethBalance = await publicClient.getBalance({ address: account.address });
  console.log(`> EOA ETH Balance: ${formatUnits(ethBalance, 18)} ETH`);

  if (config.accountType === "smart") {
    try {
      const { smartAccount } = await getSmartAccount(config, netConfig, account);
      const smartBalance = await publicClient.getBalance({ address: smartAccount.address });
      console.log(`> Smart Account: ${smartAccount.address}`);
      console.log(`> Smart Account ETH Balance: ${formatUnits(smartBalance, 18)} ETH`);
    } catch (e) {
      console.log(`> WARN: Could not derive Smart Account: ${e.message}`);
    }
  }
}

async function cmd_pools() {
  const config = loadConfig();
  if (!config) {
    console.log(`> ERROR: Not configured. Run setup first.`);
    return;
  }

  const netConfig = loadNetworkConfig(config.network);
  if (!netConfig) return;

  console.log(`> POOLS on ${netConfig.network} (Chain ID ${netConfig.chainId})`);
  console.log(`>`);

  netConfig.pools.forEach((pool, i) => {
    const poolId = computePoolId(pool);
    console.log(`> [${i}] ${pool.name}`);
    console.log(`>     ${pool.currency0.symbol} (${pool.currency0.address})`);
    console.log(`>     ${pool.currency1.symbol} (${pool.currency1.address})`);
    console.log(`>     Swap Fee: ${(pool.fee / 10000).toFixed(2)}%  Margin Fee: ${(pool.marginFee / 10000).toFixed(2)}%`);
    console.log(`>     Pool ID: ${poolId}`);
    console.log(`>`);
  });
}

async function cmd_quote(poolIndexStr, direction, amountStr) {
  if (!poolIndexStr || !direction || !amountStr) {
    console.log(`> Usage: quote <poolIndex> <direction> <amount>`);
    console.log(`> Direction: 0to1 (currency0 -> currency1) or 1to0 (currency1 -> currency0)`);
    return;
  }

  const config = loadConfig();
  if (!config) return console.log(`> ERROR: Not configured. Run setup first.`);

  const netConfig = loadNetworkConfig(config.network);
  if (!netConfig) return;

  const poolIndex = parseInt(poolIndexStr);
  const pool = netConfig.pools[poolIndex];
  if (!pool) return console.log(`> ERROR: Pool index ${poolIndex} not found. Run "pools" to see available pools.`);

  const zeroForOne = direction === "0to1";
  const fromToken = zeroForOne ? pool.currency0 : pool.currency1;
  const toToken = zeroForOne ? pool.currency1 : pool.currency0;
  const amountIn = parseUnits(amountStr, fromToken.decimals);
  const poolId = computePoolId(pool);

  const clients = createClients(config, netConfig);
  if (!clients) return;

  const helperABI = loadABI("LikwidHelper");

  try {
    const result = await clients.publicClient.readContract({
      address: netConfig.contracts.LikwidHelper,
      abi: helperABI,
      functionName: "getAmountOut",
      args: [poolId, zeroForOne, amountIn, true],
    });

    const amountOut = result[0] !== undefined ? result[0] : result;
    const fee = result[1] !== undefined ? result[1] : 0;
    const feeAmount = result[2] !== undefined ? result[2] : 0n;

    console.log(`> QUOTE`);
    console.log(`> Pool: [${poolIndex}] ${pool.name}`);
    console.log(`> Input: ${amountStr} ${fromToken.symbol}`);
    console.log(`> Output: ~${formatUnits(amountOut, toToken.decimals)} ${toToken.symbol}`);
    console.log(`> Fee: ${(fee / 10000).toFixed(2)}% (${formatUnits(feeAmount, fromToken.decimals)} ${fromToken.symbol})`);
  } catch (e) {
    console.log(`> ERROR: Quote failed: ${e.shortMessage || e.message}`);
  }
}

async function cmd_swap(poolIndexStr, direction, amountStr, slippageStr = "1") {
  if (!poolIndexStr || !direction || !amountStr) {
    console.log(`> Usage: swap <poolIndex> <direction> <amount> [slippage%]`);
    console.log(`> Direction: 0to1 (currency0 -> currency1) or 1to0 (currency1 -> currency0)`);
    console.log(`> Default slippage: 1%`);
    return;
  }

  const config = loadConfig();
  if (!config) return console.log(`> ERROR: Not configured. Run setup first.`);

  const netConfig = loadNetworkConfig(config.network);
  if (!netConfig) return;

  const poolIndex = parseInt(poolIndexStr);
  const pool = netConfig.pools[poolIndex];
  if (!pool) return console.log(`> ERROR: Pool index ${poolIndex} not found. Run "pools" to see available pools.`);

  const zeroForOne = direction === "0to1";
  const fromToken = zeroForOne ? pool.currency0 : pool.currency1;
  const toToken = zeroForOne ? pool.currency1 : pool.currency0;
  const amountIn = parseUnits(amountStr, fromToken.decimals);
  const slippage = BigInt(slippageStr);
  const poolId = computePoolId(pool);

  const pairPositionABI = loadABI("LikwidPairPosition");
  const helperABI = loadABI("LikwidHelper");

  // --- Resolve execution context ---
  const privateKey = readPrivateKey(config.keyFilePath);
  if (!privateKey) return;
  const eoaAccount = privateKeyToAccount(privateKey);

  const chain = CHAINS[config.network];
  const publicClient = createPublicClient({ chain, transport: resolveRpc(config, netConfig) });

  let senderAddress;
  if (config.accountType === "smart") {
    try {
      const { smartAccount } = await getSmartAccount(config, netConfig, eoaAccount);
      senderAddress = smartAccount.address;
    } catch (e) {
      return console.log(`> ERROR: Could not resolve Smart Account: ${e.message}`);
    }
  } else {
    senderAddress = eoaAccount.address;
  }

  // --- Quote ---
  console.log(`> SWAP: ${amountStr} ${fromToken.symbol} -> ${toToken.symbol}`);

  let amountOut;
  try {
    const result = await publicClient.readContract({
      address: netConfig.contracts.LikwidHelper,
      abi: helperABI,
      functionName: "getAmountOut",
      args: [poolId, zeroForOne, amountIn, true],
    });
    amountOut = result[0] !== undefined ? result[0] : result;
  } catch (e) {
    return console.log(`> ERROR: Quote failed: ${e.shortMessage || e.message}`);
  }

  const amountOutMin = (amountOut * (100n - slippage)) / 100n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  console.log(`> Estimated output: ~${formatUnits(amountOut, toToken.decimals)} ${toToken.symbol}`);
  console.log(`> Min output (${slippageStr}% slippage): ${formatUnits(amountOutMin, toToken.decimals)} ${toToken.symbol}`);
  console.log(`> Sender: ${senderAddress}`);
  console.log(`> Account Type: ${config.accountType.toUpperCase()}`);

  // --- Build calls ---
  const pairPositionAddress = netConfig.contracts.LikwidPairPosition;
  const sendingNative = isNative(fromToken.address);
  const calls = [];

  // Approve if selling ERC20
  if (!sendingNative) {
    const approvalCall = await buildApprovalCall(publicClient, senderAddress, fromToken.address, fromToken.symbol, pairPositionAddress, amountIn);
    if (approvalCall) calls.push(approvalCall);
  }

  // Swap call
  calls.push({
    to: pairPositionAddress,
    value: sendingNative ? amountIn : 0n,
    data: encodeFunctionData({
      abi: pairPositionABI,
      functionName: "exactInput",
      args: [{
        poolId, zeroForOne, to: senderAddress,
        amountIn, amountOutMin, deadline,
      }],
    }),
  });

  await executeCalls(config, netConfig, eoaAccount, publicClient, calls);
}

// ======================= POOL INFO =======================

async function cmd_pool_info(poolIndexStr) {
  if (poolIndexStr === undefined) {
    console.log(`> Usage: pool_info <poolIndex>`);
    return;
  }

  const config = loadConfig();
  if (!config) return console.log(`> ERROR: Not configured. Run setup first.`);

  const netConfig = loadNetworkConfig(config.network);
  if (!netConfig) return;

  const poolIndex = parseInt(poolIndexStr);
  const pool = netConfig.pools[poolIndex];
  if (!pool) return console.log(`> ERROR: Pool index ${poolIndex} not found. Run "pools" to see available pools.`);

  const poolId = computePoolId(pool);
  const helperABI = loadABI("LikwidHelper");
  const clients = createClients(config, netConfig);
  if (!clients) return;

  try {
    const stateInfo = await clients.publicClient.readContract({
      address: netConfig.contracts.LikwidHelper,
      abi: helperABI,
      functionName: "getPoolStateInfo",
      args: [poolId],
    });

    const r0 = stateInfo.pairReserve0;
    const r1 = stateInfo.pairReserve1;

    if (r0 === 0n && r1 === 0n) {
      console.log(`> POOL_NOT_INITIALIZED`);
      console.log(`> Pool: [${poolIndex}] ${pool.name}`);
      console.log(`> This pool has no liquidity. You need to Create a Pair first.`);
      return;
    }

    const rate0to1 = Number(formatUnits(r1, pool.currency1.decimals)) / Number(formatUnits(r0, pool.currency0.decimals));
    const rate1to0 = Number(formatUnits(r0, pool.currency0.decimals)) / Number(formatUnits(r1, pool.currency1.decimals));

    console.log(`> POOL_INFO`);
    console.log(`> Pool: [${poolIndex}] ${pool.name}`);
    console.log(`> Pool ID: ${poolId}`);
    console.log(`> Pair Reserve ${pool.currency0.symbol}: ${formatUnits(r0, pool.currency0.decimals)}`);
    console.log(`> Pair Reserve ${pool.currency1.symbol}: ${formatUnits(r1, pool.currency1.decimals)}`);
    console.log(`> Rate: 1 ${pool.currency0.symbol} = ${rate0to1.toFixed(6)} ${pool.currency1.symbol}`);
    console.log(`> Rate: 1 ${pool.currency1.symbol} = ${rate1to0.toFixed(6)} ${pool.currency0.symbol}`);
    console.log(`> Total Supply: ${formatUnits(stateInfo.totalSupply, 18)}`);
  } catch (e) {
    console.log(`> ERROR: Could not query pool state: ${e.shortMessage || e.message}`);
  }
}

// ======================= ADD LIQUIDITY =======================

async function cmd_lp_add(poolIndexStr, currencyStr, amountStr, slippageStr = "1") {
  if (!poolIndexStr || !currencyStr || !amountStr) {
    console.log(`> Usage: lp_add <poolIndex> <currency> <amount> [slippage%]`);
    console.log(`> Currency: 0 (currency0) or 1 (currency1)`);
    console.log(`> Provide the amount for one side; the other is auto-calculated from pool ratio.`);
    return;
  }

  const config = loadConfig();
  if (!config) return console.log(`> ERROR: Not configured. Run setup first.`);

  const netConfig = loadNetworkConfig(config.network);
  if (!netConfig) return;

  const poolIndex = parseInt(poolIndexStr);
  const pool = netConfig.pools[poolIndex];
  if (!pool) return console.log(`> ERROR: Pool index ${poolIndex} not found. Run "pools" to see available pools.`);

  const inputSide = parseInt(currencyStr);
  if (inputSide !== 0 && inputSide !== 1) {
    return console.log(`> ERROR: Currency must be 0 or 1.`);
  }

  const inputToken = inputSide === 0 ? pool.currency0 : pool.currency1;
  const inputAmount = parseUnits(amountStr, inputToken.decimals);
  const slippage = BigInt(slippageStr);
  const poolId = computePoolId(pool);

  const helperABI = loadABI("LikwidHelper");
  const pairPositionABI = loadABI("LikwidPairPosition");

  // --- Resolve sender ---
  const privateKey = readPrivateKey(config.keyFilePath);
  if (!privateKey) return;
  const eoaAccount = privateKeyToAccount(privateKey);
  const chain = CHAINS[config.network];
  const publicClient = createPublicClient({ chain, transport: resolveRpc(config, netConfig) });

  let senderAddress;
  if (config.accountType === "smart") {
    try {
      const { smartAccount } = await getSmartAccount(config, netConfig, eoaAccount);
      senderAddress = smartAccount.address;
    } catch (e) {
      return console.log(`> ERROR: Could not resolve Smart Account: ${e.message}`);
    }
  } else {
    senderAddress = eoaAccount.address;
  }

  // --- Query pool state ---
  let r0, r1;
  try {
    const stateInfo = await publicClient.readContract({
      address: netConfig.contracts.LikwidHelper,
      abi: helperABI,
      functionName: "getPoolStateInfo",
      args: [poolId],
    });
    r0 = stateInfo.pairReserve0;
    r1 = stateInfo.pairReserve1;
  } catch (e) {
    return console.log(`> ERROR: Could not query pool state: ${e.shortMessage || e.message}`);
  }

  if (r0 === 0n && r1 === 0n) {
    console.log(`> POOL_NOT_INITIALIZED`);
    console.log(`> Pool: [${poolIndex}] ${pool.name}`);
    console.log(`> This pool has no liquidity. You need to Create a Pair first.`);
    return;
  }

  // --- Calculate matching amount ---
  let amount0, amount1;
  if (inputSide === 0) {
    amount0 = inputAmount;
    amount1 = r0 > 0n ? (inputAmount * r1) / r0 : 0n;
  } else {
    amount1 = inputAmount;
    amount0 = r1 > 0n ? (inputAmount * r0) / r1 : 0n;
  }

  const amount0Min = (amount0 * (100n - slippage)) / 100n;
  const amount1Min = (amount1 * (100n - slippage)) / 100n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  const rate = Number(formatUnits(r1, pool.currency1.decimals)) / Number(formatUnits(r0, pool.currency0.decimals));

  console.log(`> LP_ADD: [${poolIndex}] ${pool.name}`);
  console.log(`> Rate: 1 ${pool.currency0.symbol} = ${rate.toFixed(6)} ${pool.currency1.symbol}`);
  console.log(`> ${pool.currency0.symbol}: ${formatUnits(amount0, pool.currency0.decimals)}`);
  console.log(`> ${pool.currency1.symbol}: ${formatUnits(amount1, pool.currency1.decimals)}`);
  console.log(`> Slippage: ${slippageStr}%`);
  console.log(`> Sender: ${senderAddress}`);

  // --- Build calls ---
  const pairPositionAddress = netConfig.contracts.LikwidPairPosition;
  const native0 = isNative(pool.currency0.address);
  const native1 = isNative(pool.currency1.address);
  const calls = [];

  // Approve ERC20 tokens
  if (!native0 && amount0 > 0n) {
    const call = await buildApprovalCall(publicClient, senderAddress, pool.currency0.address, pool.currency0.symbol, pairPositionAddress, amount0);
    if (call) calls.push(call);
  }
  if (!native1 && amount1 > 0n) {
    const call = await buildApprovalCall(publicClient, senderAddress, pool.currency1.address, pool.currency1.symbol, pairPositionAddress, amount1);
    if (call) calls.push(call);
  }

  // Build PoolKey struct
  const poolKey = {
    currency0: pool.currency0.address,
    currency1: pool.currency1.address,
    fee: pool.fee,
    marginFee: pool.marginFee,
  };

  const nativeValue = (native0 ? amount0 : 0n) + (native1 ? amount1 : 0n);

  calls.push({
    to: pairPositionAddress,
    value: nativeValue,
    data: encodeFunctionData({
      abi: pairPositionABI,
      functionName: "addLiquidity",
      args: [poolKey, senderAddress, amount0, amount1, amount0Min, amount1Min, deadline],
    }),
  });

  await executeCalls(config, netConfig, eoaAccount, publicClient, calls);
}

// ======================= CLI ROUTER =======================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log(`Likwid.fi Protocol Universal Skill

Usage: node likwid-fi.js <command> [args]

Setup:
  setup <network> <keyFile> [accountType]   Configure wallet and network.
                                            Networks: sepolia, ethereum, base
                                            Account types: eoa (default), smart
  account                                   Show current account info and balances.

Pool Info:
  pools                                     List available pools on current network.
  pool_info <pool>                          Query on-chain pool state (reserves, rate).
  quote <pool> <dir> <amount>               Get swap quote without executing.

DeFi Actions:
  swap <pool> <dir> <amount> [slippage%]    Execute swap.
  lp_add <pool> <currency> <amt> [slip%]    Add liquidity. currency: 0 or 1.

Arguments:
  <pool>      Pool index from "pools" command (e.g., 0, 1)
  <dir>       Swap direction: 0to1 or 1to0
  <amount>    Human-readable amount (e.g., "0.01", "100")
  [slippage]  Slippage tolerance in % (default: 1)
`);
    process.exit(0);
  }

  (async () => {
    try {
      switch (command) {
        case "setup":
          await cmd_setup(args[1], args[2], args[3]);
          break;
        case "account":
          await cmd_account();
          break;
        case "pools":
          await cmd_pools();
          break;
        case "quote":
          await cmd_quote(args[1], args[2], args[3]);
          break;
        case "pool_info":
          await cmd_pool_info(args[1]);
          break;
        case "swap":
          await cmd_swap(args[1], args[2], args[3], args[4]);
          break;
        case "lp_add":
          await cmd_lp_add(args[1], args[2], args[3], args[4]);
          break;
        default:
          console.log(`> Unknown command: ${command}`);
          console.log(`> Run without arguments to see usage.`);
      }
    } catch (e) {
      console.log(`> FATAL: ${e.message}`);
    }
    process.exit(0);
  })();
}

module.exports = { computePoolId, loadConfig, loadNetworkConfig };
