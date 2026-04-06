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
  http,
  parseUnits,
  formatUnits,
  encodeFunctionData,
  keccak256,
  encodeAbiParameters,
  parseAbi,
  getAddress,
} = require("viem");
const { signAuthorization } = require("viem/actions");
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

async function fetchLiquidityPositions(chainId, owner, poolId) {
  const url = `https://api.likwid.fi/v1/margin/pool/liquidity/list?chainId=${chainId}&page=1&pageSize=5&owner=${owner}&poolId=${poolId}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return json.data?.items || json.items || [];
  } catch (e) {
    console.log(`> Warning: Could not query positions API: ${e.message}`);
    return [];
  }
}

async function fetchMarginPositions(chainId, owner, poolId) {
  const url = `https://api.likwid.fi/v1/margin/position/list?borrow=false&burned=false&chainId=${chainId}&page=1&pageSize=100&owner=${owner}&poolId=${poolId}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return json.data?.items || json.items || [];
  } catch (e) {
    console.log(`> Warning: Could not query margin positions API: ${e.message}`);
    return [];
  }
}

function resolveRpc(config, networkConfig) {
  if (process.env.RPC_URL) return http(process.env.RPC_URL);
  if (networkConfig.rpc) return http(networkConfig.rpc);
  return http();
}

// ======================= BUNDLER HELPERS =======================

function resolveBundlerTransport(networkConfig) {
  const url = process.env.BUNDLER_URL || networkConfig.bundlerUrl;
  return http(url);
}

function buildPaymasterMiddleware(networkConfig) {
  if (process.env.LIKWID_NO_PAYMASTER === "1") return undefined;
  const addr = networkConfig.paymaster;
  if (!addr) return undefined;
  const stub = {
    paymaster: addr,
    paymasterData: "0x",
    verificationGasLimit: 600000n,
    paymasterVerificationGasLimit: 600000n,
    paymasterPostOpGasLimit: 600000n,
  };
  return {
    getPaymasterStubData: async () => stub,
    getPaymasterData: async () => stub,
  };
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

async function resolveContext() {
  const config = loadConfig();
  if (!config) { console.log(`> ERROR: Not configured. Run setup first.`); return null; }

  const netConfig = loadNetworkConfig(config.network);
  if (!netConfig) return null;

  const privateKey = readPrivateKey(config.keyFilePath);
  if (!privateKey) return null;

  const eoaAccount = privateKeyToAccount(privateKey);
  const chain = CHAINS[config.network];
  const publicClient = createPublicClient({ chain, transport: resolveRpc(config, netConfig) });

  // With EIP-7702, EOA and Smart Account share the same address
  const senderAddress = eoaAccount.address;

  return { config, netConfig, eoaAccount, publicClient, senderAddress };
}

async function getSmartAccount(config, networkConfig, eoaAccount) {
  const { toSimple7702SmartAccount, createBundlerClient } = require("viem/account-abstraction");

  const chain = CHAINS[config.network];
  const transport = resolveRpc(config, networkConfig);
  const publicClient = createPublicClient({ chain, transport });

  const smartAccount = await toSimple7702SmartAccount({
    client: publicClient,
    owner: eoaAccount,
    entryPoint: "0.9",
  });

  const bundlerTransport = resolveBundlerTransport(networkConfig);

  const bundlerClient = createBundlerClient({
    account: smartAccount,
    client: publicClient,
    transport: bundlerTransport,
    userOperation: {
      estimateFeesPerGas: async () => {
        const fees = await publicClient.estimateFeesPerGas();
        const floor = 1_000_000_000n;
        return {
          maxFeePerGas: fees.maxFeePerGas > floor ? fees.maxFeePerGas : floor,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas > floor ? fees.maxPriorityFeePerGas : floor,
        };
      },
    },
  });

  bundlerClient._paymaster = buildPaymasterMiddleware(networkConfig);

  return { smartAccount, bundlerClient, publicClient };
}

// ======================= SHARED EXECUTION =======================

async function buildApprovalCalls(publicClient, owner, tokenAddress, tokenSymbol, spender, amount) {
  const currentAllowance = await publicClient.readContract({
    address: tokenAddress, abi: ERC20_ABI, functionName: "allowance",
    args: [owner, spender],
  });
  if (currentAllowance >= amount) return [];
  console.log(`> Approving ${tokenSymbol}...`);
  const calls = [];
  // Non-standard ERC-20 tokens (e.g. USDT) revert on approve(newAmount) when
  // current allowance > 0. Reset to 0 first to handle this safely.
  if (currentAllowance > 0n) {
    calls.push({
      to: tokenAddress, value: 0n, _isApproval: true,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [spender, 0n] }),
    });
  }
  calls.push({
    to: tokenAddress, value: 0n, _isApproval: true,
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [spender, amount] }),
  });
  return calls;
}

async function submitUserOp(bundlerClient, calls, options = {}) {
  const sendArgs = { calls, ...options };
  const usePaymaster = bundlerClient._paymaster && !options._skipPaymaster;
  if (usePaymaster) sendArgs.paymaster = bundlerClient._paymaster;
  try {
    const hash = await bundlerClient.sendUserOperation(sendArgs);
    console.log(`> UserOp submitted: ${hash}`);
    console.log(`> Waiting for receipt...`);
    const receipt = await bundlerClient.waitForUserOperationReceipt({ hash, timeout: 120_000 });
    if (receipt.success) {
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
  } catch (e) {
    if (usePaymaster) {
      console.log(`> Paymaster failed (${e.shortMessage || e.message}), retrying with direct gas...`);
      return submitUserOp(bundlerClient, calls, { ...options, _skipPaymaster: true });
    }
    console.log(`> ERROR: UserOp failed: ${e.shortMessage || e.message}`);
    return false;
  }
}

async function getEip7702Authorization(publicClient, walletClient, implementationAddress) {
  const code = await publicClient.getCode({ address: walletClient.account.address });
  if (code && code !== "0x" && code.startsWith("0xef0100")) {
    // Check if current delegation matches the expected implementation
    const currentImpl = "0x" + code.slice(8);
    if (currentImpl.toLowerCase() === implementationAddress.toLowerCase()) return null;
    console.log(`> Re-delegating EIP-7702 (${currentImpl.slice(0, 10)}... -> ${implementationAddress.slice(0, 10)}...)...`);
  } else {
    console.log(`> Signing EIP-7702 authorization (first-time delegation)...`);
  }
  return signAuthorization(walletClient, {
    contractAddress: implementationAddress,
  });
}

async function executeCalls(config, netConfig, eoaAccount, publicClient, calls) {
  if (config.accountType === "smart") {
    const { smartAccount, bundlerClient } = await getSmartAccount(config, netConfig, eoaAccount);

    // Sign EIP-7702 authorization if EOA hasn't been delegated yet
    const chain = CHAINS[config.network];
    const walletClient = createWalletClient({
      account: eoaAccount, chain,
      transport: resolveRpc(config, netConfig),
    });
    const authorization = await getEip7702Authorization(publicClient, walletClient, smartAccount.authorization.address);
    const userOpOptions = authorization ? { authorization } : {};

    // Non-standard ERC-20 tokens (e.g. USDT) can fail when approve + swap are
    // batched in a single executeBatch. Split approvals into a separate UserOp.
    const approvalCalls = calls.filter(c => c._isApproval);
    const actionCalls = calls.filter(c => !c._isApproval);

    try {
      if (approvalCalls.length > 0 && actionCalls.length > 0) {
        console.log(`> Submitting approvals (${approvalCalls.length} call${approvalCalls.length > 1 ? "s" : ""})...`);
        const ok = await submitUserOp(bundlerClient, approvalCalls, userOpOptions);
        if (!ok) return false;
        console.log(`> Submitting action (${actionCalls.length} call${actionCalls.length > 1 ? "s" : ""})...`);
        const ok2 = await submitUserOp(bundlerClient, actionCalls);
        if (!ok2) return false;
      } else {
        console.log(`> Submitting UserOperation (${calls.length} call${calls.length > 1 ? "s" : ""})...`);
        const ok = await submitUserOp(bundlerClient, calls, userOpOptions);
        if (!ok) return false;
      }
      return true;
    } catch (e) {
      console.log(`> ERROR: UserOp failed: ${e.shortMessage || e.message}`);
      return false;
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
          return false;
        }
      } catch (e) {
        console.log(`> ERROR: Transaction failed: ${e.shortMessage || e.message}`);
        return false;
      }
    }
    console.log(`> TX_OK`);
    return true;
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
    console.log(`> Smart Account: ${account.address} (EIP-7702, same as EOA)`);
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
    console.log(`> Mode: EIP-7702 (EOA = Smart Account)`);
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

  Object.entries(netConfig.pools).forEach(([name, tiers]) => {
    tiers.forEach((pool) => {
      const poolId = computePoolId(pool);
      console.log(`> ${name} (fee: ${(pool.fee / 10000).toFixed(2)}%)`);
      console.log(`>     ${pool.currency0.symbol} (${pool.currency0.address})`);
      console.log(`>     ${pool.currency1.symbol} (${pool.currency1.address})`);
      console.log(`>     Margin Fee: ${(pool.marginFee / 10000).toFixed(2)}%`);
      console.log(`>     Pool ID: ${poolId}`);
      console.log(`>`);
    });
  });
}

async function cmd_quote(poolStr, direction, amountStr) {
  if (!poolStr || !direction || !amountStr) {
    console.log(`> Usage: quote <pool> <direction> <amount>`);
    console.log(`> Pool: token pair (e.g. ETH/USDT) — lowest fee tier selected by default`);
    console.log(`> Direction: 0to1 (currency0 -> currency1) or 1to0 (currency1 -> currency0)`);
    return;
  }

  const config = loadConfig();
  if (!config) return console.log(`> ERROR: Not configured. Run setup first.`);

  const netConfig = loadNetworkConfig(config.network);
  if (!netConfig) return;

  const pool = resolvePool(netConfig, poolStr);
  if (!pool) return console.log(`> ERROR: Pool "${poolStr}" not found. Use token pair (e.g. ETH/USDT). Run "pools" to list.`);

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
    console.log(`> Pool: ${pool.currency0.symbol}/${pool.currency1.symbol} (fee: ${(pool.fee / 10000).toFixed(2)}%)`);
    console.log(`> Input: ${amountStr} ${fromToken.symbol}`);
    console.log(`> Output: ~${formatUnits(amountOut, toToken.decimals)} ${toToken.symbol}`);
    console.log(`> Fee: ${(fee / 10000).toFixed(2)}% (${formatUnits(feeAmount, fromToken.decimals)} ${fromToken.symbol})`);
  } catch (e) {
    console.log(`> ERROR: Quote failed: ${e.shortMessage || e.message}`);
  }
}

async function cmd_swap(poolStr, direction, amountStr, slippageStr = "1") {
  if (!poolStr || !direction || !amountStr) {
    console.log(`> Usage: swap <pool> <direction> <amount> [slippage%]`);
    console.log(`> Pool: token pair (e.g. ETH/USDT) — lowest fee tier selected by default`);
    console.log(`> Direction: 0to1 (currency0 -> currency1) or 1to0 (currency1 -> currency0)`);
    console.log(`> Default slippage: 1%`);
    return;
  }

  const ctx = await resolveContext();
  if (!ctx) return;
  const { config, netConfig, eoaAccount, publicClient, senderAddress } = ctx;

  const pool = resolvePool(netConfig, poolStr);
  if (!pool) return console.log(`> ERROR: Pool "${poolStr}" not found. Use token pair (e.g. ETH/USDT). Run "pools" to list.`);

  const zeroForOne = direction === "0to1";
  const fromToken = zeroForOne ? pool.currency0 : pool.currency1;
  const toToken = zeroForOne ? pool.currency1 : pool.currency0;
  const amountIn = parseUnits(amountStr, fromToken.decimals);
  const slippage = BigInt(slippageStr);
  const poolId = computePoolId(pool);

  const pairPositionABI = loadABI("LikwidPairPosition");
  const helperABI = loadABI("LikwidHelper");

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
    calls.push(...await buildApprovalCalls(publicClient, senderAddress, fromToken.address, fromToken.symbol, pairPositionAddress, amountIn));
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

async function cmd_pool_info(poolStr) {
  if (poolStr === undefined) {
    console.log(`> Usage: pool_info <pool>`);
    console.log(`> Pool: token pair (e.g. ETH/USDT) — lowest fee tier selected by default`);
    return;
  }

  const config = loadConfig();
  if (!config) return console.log(`> ERROR: Not configured. Run setup first.`);

  const netConfig = loadNetworkConfig(config.network);
  if (!netConfig) return;

  const pool = resolvePool(netConfig, poolStr);
  if (!pool) return console.log(`> ERROR: Pool "${poolStr}" not found. Use token pair (e.g. ETH/USDT). Run "pools" to list.`);

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

    const poolName = `${pool.currency0.symbol}/${pool.currency1.symbol}`;

    if (r0 === 0n && r1 === 0n) {
      console.log(`> POOL_NOT_INITIALIZED`);
      console.log(`> Pool: ${poolName} (fee: ${(pool.fee / 10000).toFixed(2)}%)`);
      console.log(`> This pool has no liquidity. You need to Create a Pair first.`);
      return;
    }

    const rate0to1 = Number(formatUnits(r1, pool.currency1.decimals)) / Number(formatUnits(r0, pool.currency0.decimals));
    const rate1to0 = Number(formatUnits(r0, pool.currency0.decimals)) / Number(formatUnits(r1, pool.currency1.decimals));

    console.log(`> POOL_INFO`);
    console.log(`> Pool: ${poolName} (fee: ${(pool.fee / 10000).toFixed(2)}%)`);
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

async function cmd_lp_add(poolStr, currencyStr, amountStr, slippageStr = "1") {
  if (!poolStr || !currencyStr || !amountStr) {
    console.log(`> Usage: lp_add <pool> <currency> <amount> [slippage%]`);
    console.log(`> Pool: token pair (e.g. ETH/USDT) — lowest fee tier selected by default`);
    console.log(`> Currency: 0 (currency0) or 1 (currency1)`);
    console.log(`> Provide the amount for one side; the other is auto-calculated from pool ratio.`);
    return;
  }

  const ctx = await resolveContext();
  if (!ctx) return;
  const { config, netConfig, eoaAccount, publicClient, senderAddress } = ctx;

  const pool = resolvePool(netConfig, poolStr);
  if (!pool) return console.log(`> ERROR: Pool "${poolStr}" not found. Use token pair (e.g. ETH/USDT). Run "pools" to list.`);

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

  const poolName = `${pool.currency0.symbol}/${pool.currency1.symbol}`;

  if (r0 === 0n && r1 === 0n) {
    console.log(`> POOL_NOT_INITIALIZED`);
    console.log(`> Pool: ${poolName} (fee: ${(pool.fee / 10000).toFixed(2)}%)`);
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

  // --- Check for existing position ---
  const positions = await fetchLiquidityPositions(netConfig.chainId, senderAddress, poolId);
  const existingTokenId = positions.length > 0 ? BigInt(positions[0].tokenId) : null;

  if (existingTokenId) {
    console.log(`> LP_INCREASE: ${poolName} (fee: ${(pool.fee / 10000).toFixed(2)}%) — tokenId: ${existingTokenId}`);
  } else {
    console.log(`> LP_ADD: ${poolName} (fee: ${(pool.fee / 10000).toFixed(2)}%)`);
  }
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
    calls.push(...await buildApprovalCalls(publicClient, senderAddress, pool.currency0.address, pool.currency0.symbol, pairPositionAddress, amount0));
  }
  if (!native1 && amount1 > 0n) {
    calls.push(...await buildApprovalCalls(publicClient, senderAddress, pool.currency1.address, pool.currency1.symbol, pairPositionAddress, amount1));
  }

  const nativeValue = (native0 ? amount0 : 0n) + (native1 ? amount1 : 0n);

  if (existingTokenId) {
    calls.push({
      to: pairPositionAddress,
      value: nativeValue,
      data: encodeFunctionData({
        abi: pairPositionABI,
        functionName: "increaseLiquidity",
        args: [existingTokenId, amount0, amount1, amount0Min, amount1Min, deadline],
      }),
    });
  } else {
    const poolKey = {
      currency0: pool.currency0.address,
      currency1: pool.currency1.address,
      fee: pool.fee,
      marginFee: pool.marginFee,
    };
    calls.push({
      to: pairPositionAddress,
      value: nativeValue,
      data: encodeFunctionData({
        abi: pairPositionABI,
        functionName: "addLiquidity",
        args: [poolKey, senderAddress, amount0, amount1, amount0Min, amount1Min, deadline],
      }),
    });
  }

  await executeCalls(config, netConfig, eoaAccount, publicClient, calls);
}

// ======================= LP POSITIONS =======================

async function cmd_lp_positions(poolStr) {
  if (!poolStr) {
    console.log(`> Usage: lp_positions <pool>`);
    console.log(`> Pool: token pair (e.g. ETH/USDT)`);
    return;
  }

  const ctx = await resolveContext();
  if (!ctx) return;
  const { config, netConfig, publicClient, senderAddress } = ctx;

  const pool = resolvePool(netConfig, poolStr);
  if (!pool) return console.log(`> ERROR: Pool "${poolStr}" not found. Use token pair (e.g. ETH/USDT). Run "pools" to list.`);

  const poolId = computePoolId(pool);
  const poolName = `${pool.currency0.symbol}/${pool.currency1.symbol}`;

  const positions = await fetchLiquidityPositions(netConfig.chainId, senderAddress, poolId);
  if (positions.length === 0) {
    console.log(`> No liquidity positions found for ${poolName}.`);
    return;
  }

  const helperABI = loadABI("LikwidHelper");
  const pairPositionABI = loadABI("LikwidPairPosition");

  // Query pool state once (shared across all positions)
  let stateInfo;
  try {
    stateInfo = await publicClient.readContract({
      address: netConfig.contracts.LikwidHelper,
      abi: helperABI,
      functionName: "getPoolStateInfo",
      args: [poolId],
    });
  } catch (e) {
    return console.log(`> ERROR: Could not query pool state: ${e.shortMessage || e.message}`);
  }

  const totalSupply = stateInfo.totalSupply;
  const r0 = stateInfo.pairReserve0;
  const r1 = stateInfo.pairReserve1;

  console.log(`> Your Liquidity Positions:`);
  console.log(`>`);

  for (const item of positions) {
    const tokenId = BigInt(item.tokenId);

    let posState;
    try {
      posState = await publicClient.readContract({
        address: netConfig.contracts.LikwidPairPosition,
        abi: pairPositionABI,
        functionName: "getPositionState",
        args: [tokenId],
      });
    } catch (e) {
      console.log(`> ERROR: Could not query position #${tokenId}: ${e.shortMessage || e.message}`);
      continue;
    }

    const liquidity = posState.liquidity;
    const poolShare = totalSupply > 0n ? Number(liquidity) / Number(totalSupply) : 0;
    const amount0 = totalSupply > 0n ? (r0 * liquidity) / totalSupply : 0n;
    const amount1 = totalSupply > 0n ? (r1 * liquidity) / totalSupply : 0n;

    console.log(`>   Pool: ${poolName}  Swap Fee: ${(pool.fee / 10000).toFixed(2)}%  Margin Fee: ${(pool.marginFee / 10000).toFixed(2)}%`);
    console.log(`>   Your Pool Share: ${(poolShare * 100).toFixed(2)}%`);
    console.log(`>   ${pool.currency0.symbol}: ${formatUnits(amount0, pool.currency0.decimals)}`);
    console.log(`>   ${pool.currency1.symbol}: ${formatUnits(amount1, pool.currency1.decimals)}`);
    console.log(`>`);
  }

  console.log(`>   Tip: Use "lp_add" to increase liquidity, or "lp_remove" to remove liquidity.`);
}

// ======================= REMOVE LIQUIDITY =======================

async function cmd_lp_remove(poolStr, percentStr = "100") {
  if (!poolStr) {
    console.log(`> Usage: lp_remove <pool> [percentage]`);
    console.log(`> Pool: token pair (e.g. ETH/USDT)`);
    console.log(`> Percentage: 1-100 (default: 100 = remove all)`);
    return;
  }

  const ctx = await resolveContext();
  if (!ctx) return;
  const { config, netConfig, eoaAccount, publicClient, senderAddress } = ctx;

  const pool = resolvePool(netConfig, poolStr);
  if (!pool) return console.log(`> ERROR: Pool "${poolStr}" not found. Use token pair (e.g. ETH/USDT). Run "pools" to list.`);

  const poolId = computePoolId(pool);
  const poolName = `${pool.currency0.symbol}/${pool.currency1.symbol}`;

  const positions = await fetchLiquidityPositions(netConfig.chainId, senderAddress, poolId);
  if (positions.length === 0) {
    console.log(`> ERROR: No liquidity position found for ${poolName}. Nothing to remove.`);
    return;
  }

  const tokenId = BigInt(positions[0].tokenId);
  const pairPositionABI = loadABI("LikwidPairPosition");
  const helperABI = loadABI("LikwidHelper");

  // Query position state on-chain
  let posState;
  try {
    posState = await publicClient.readContract({
      address: netConfig.contracts.LikwidPairPosition,
      abi: pairPositionABI,
      functionName: "getPositionState",
      args: [tokenId],
    });
  } catch (e) {
    return console.log(`> ERROR: Could not query position state: ${e.shortMessage || e.message}`);
  }

  const totalLiquidity = posState.liquidity;
  if (totalLiquidity === 0n) {
    console.log(`> ERROR: Position #${tokenId} has zero liquidity.`);
    return;
  }

  const percent = BigInt(percentStr);
  if (percent < 1n || percent > 100n) {
    return console.log(`> ERROR: Percentage must be between 1 and 100.`);
  }

  const liquidityToRemove = (totalLiquidity * percent) / 100n;

  // Query pool reserves to estimate output
  let stateInfo;
  try {
    stateInfo = await publicClient.readContract({
      address: netConfig.contracts.LikwidHelper,
      abi: helperABI,
      functionName: "getPoolStateInfo",
      args: [poolId],
    });
  } catch (e) {
    return console.log(`> ERROR: Could not query pool state: ${e.shortMessage || e.message}`);
  }

  const totalSupply = stateInfo.totalSupply;
  const r0 = stateInfo.pairReserve0;
  const r1 = stateInfo.pairReserve1;

  const estAmount0 = totalSupply > 0n ? (r0 * liquidityToRemove) / totalSupply : 0n;
  const estAmount1 = totalSupply > 0n ? (r1 * liquidityToRemove) / totalSupply : 0n;

  const slippage = 1n; // 1% default
  const amount0Min = (estAmount0 * (100n - slippage)) / 100n;
  const amount1Min = (estAmount1 * (100n - slippage)) / 100n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  console.log(`> LP_REMOVE: ${poolName} (fee: ${(pool.fee / 10000).toFixed(2)}%) — tokenId: ${tokenId}`);
  console.log(`> Removing: ${percentStr}% of liquidity`);
  console.log(`> Est. ${pool.currency0.symbol}: ${formatUnits(estAmount0, pool.currency0.decimals)}`);
  console.log(`> Est. ${pool.currency1.symbol}: ${formatUnits(estAmount1, pool.currency1.decimals)}`);
  console.log(`> Slippage: 1%`);
  console.log(`> Sender: ${senderAddress}`);

  const pairPositionAddress = netConfig.contracts.LikwidPairPosition;
  const calls = [{
    to: pairPositionAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: pairPositionABI,
      functionName: "removeLiquidity",
      args: [tokenId, liquidityToRemove, amount0Min, amount1Min, deadline],
    }),
  }];

  await executeCalls(config, netConfig, eoaAccount, publicClient, calls);
}

// ======================= CREATE PAIR =======================

function saveNetworkConfig(network, netConfig) {
  const file = path.join(POOLS_DIR, `${network}.json`);
  fs.writeFileSync(file, JSON.stringify(netConfig, null, 2) + "\n");
}

function resolvePool(netConfig, poolStr) {
  // Normalize: uppercase, replace - with /
  const key = poolStr.toUpperCase().replace("-", "/");
  // Direct key match
  let tiers = netConfig.pools[key];
  if (!tiers) {
    // Try reversed order: "USDT/ETH" -> "ETH/USDT"
    const parts = key.split("/");
    if (parts.length === 2) tiers = netConfig.pools[`${parts[1]}/${parts[0]}`];
  }
  if (!tiers || tiers.length === 0) return null;
  return tiers[0]; // lowest fee (array pre-sorted)
}

function resolveToken(netConfig, name) {
  const upper = name.toUpperCase();
  const token = netConfig.tokens[upper];
  if (!token) return null;
  return { symbol: upper, address: token.address, decimals: token.decimals };
}

function isAddress(s) {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}

async function resolveTokenOrAddress(netConfig, nameOrAddress, publicClient) {
  // Try name lookup first
  const byName = resolveToken(netConfig, nameOrAddress);
  if (byName) return byName;

  // If it looks like an address, query on-chain
  if (!isAddress(nameOrAddress)) return null;

  const address = getAddress(nameOrAddress);
  const tokenAbi = parseAbi([
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
  ]);

  try {
    const [symbol, decimals] = await Promise.all([
      publicClient.readContract({ address, abi: tokenAbi, functionName: "symbol" }),
      publicClient.readContract({ address, abi: tokenAbi, functionName: "decimals" }),
    ]);
    return { symbol, address: address.toLowerCase(), decimals };
  } catch (e) {
    console.log(`> WARN: Could not read token metadata at ${address}: ${e.shortMessage || e.message}`);
    return null;
  }
}

async function cmd_create_pair(token0Name, token1Name, feeStr, marginFeeStr) {
  if (!token0Name || !token1Name || !feeStr || !marginFeeStr) {
    console.log(`> Usage: create_pair <token0> <token1> <fee> <marginFee>`);
    console.log(`> Tokens can be resolved by name or contract address.`);
    console.log(`> Fee values in basis points (e.g., 3000 = 0.30%).`);
    return;
  }

  const ctx = await resolveContext();
  if (!ctx) return;
  const { config, netConfig, eoaAccount, publicClient } = ctx;

  // --- Resolve tokens (by name or address) ---
  const tokenA = await resolveTokenOrAddress(netConfig, token0Name, publicClient);
  const tokenB = await resolveTokenOrAddress(netConfig, token1Name, publicClient);

  if (!tokenA) {
    const available = Object.keys(netConfig.tokens).join(", ");
    return console.log(`> ERROR: Unknown token "${token0Name}". Available: ${available} (or pass a contract address)`);
  }
  if (!tokenB) {
    const available = Object.keys(netConfig.tokens).join(", ");
    return console.log(`> ERROR: Unknown token "${token1Name}". Available: ${available} (or pass a contract address)`);
  }
  if (tokenA.address.toLowerCase() === tokenB.address.toLowerCase()) {
    return console.log(`> ERROR: currency0 and currency1 cannot be the same token.`);
  }

  // --- Sort: protocol requires currency0 < currency1 ---
  let currency0, currency1;
  if (tokenA.address.toLowerCase() < tokenB.address.toLowerCase()) {
    currency0 = tokenA;
    currency1 = tokenB;
  } else {
    currency0 = tokenB;
    currency1 = tokenA;
  }

  const fee = parseInt(feeStr);
  const marginFee = parseInt(marginFeeStr);

  const poolKey = {
    currency0: currency0.address,
    currency1: currency1.address,
    fee,
    marginFee,
  };

  // Compute poolId for display
  const poolObj = {
    currency0, currency1, fee, marginFee,
  };
  const poolId = computePoolId(poolObj);

  console.log(`> CREATE_PAIR`);
  console.log(`> currency0: ${currency0.symbol} (${currency0.address})`);
  console.log(`> currency1: ${currency1.symbol} (${currency1.address})`);
  console.log(`> Swap Fee: ${(fee / 10000).toFixed(2)}%  Margin Fee: ${(marginFee / 10000).toFixed(2)}%`);
  console.log(`> Pool ID: ${poolId}`);

  const vaultABI = loadABI("LikwidVault");
  const vaultAddress = netConfig.contracts.LikwidVault;

  const calls = [{
    to: vaultAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: vaultABI,
      functionName: "initialize",
      args: [poolKey],
    }),
  }];

  console.log(`> Initializing pool on LikwidVault...`);
  const ok = await executeCalls(config, netConfig, eoaAccount, publicClient, calls);
  if (!ok) return;

  // --- Auto-add new tokens to config ---
  let configChanged = false;
  for (const token of [currency0, currency1]) {
    const alreadyKnown = Object.values(netConfig.tokens).some(
      t => t.address.toLowerCase() === token.address.toLowerCase()
    );
    if (!alreadyKnown) {
      netConfig.tokens[token.symbol] = { address: token.address.toLowerCase(), decimals: token.decimals };
      console.log(`> Token added to config: ${token.symbol} (${token.address})`);
      configChanged = true;
    }
  }

  // --- Auto-append pool to config ---
  const pairKey = `${currency0.symbol}/${currency1.symbol}`;
  const newPool = {
    currency0: { address: currency0.address, symbol: currency0.symbol, decimals: currency0.decimals },
    currency1: { address: currency1.address, symbol: currency1.symbol, decimals: currency1.decimals },
    fee,
    marginFee,
  };

  if (!netConfig.pools[pairKey]) netConfig.pools[pairKey] = [];
  const exists = netConfig.pools[pairKey].some(p => p.fee === fee && p.marginFee === marginFee);

  if (!exists) {
    netConfig.pools[pairKey].push(newPool);
    netConfig.pools[pairKey].sort((a, b) => a.fee - b.fee);
    configChanged = true;
    console.log(`> Pool added to config: ${pairKey} (fee: ${(fee / 10000).toFixed(2)}%).`);
  } else {
    console.log(`> Pool already in config.`);
  }

  if (configChanged) {
    saveNetworkConfig(config.network, netConfig);
  }

  console.log(`> Use "lp_add ${pairKey}" to add initial liquidity to this pool.`);
}

// ======================= MARGIN =======================

const LEVERAGE_MAX_RATIOS = [0.15, 0.12, 0.09, 0.05, 0.017]; // 1x..5x
const MARGIN_MINIMUM_RATIO = 10_000_000n; // matches LikwidMarginPosition constant

async function computeMarginPreview(publicClient, netConfig, pool, poolId, marginForOne, leverageInt, marginAmount) {
  const helperABI = loadABI("LikwidHelper");
  const helperAddr = netConfig.contracts.LikwidHelper;

  const marginToken = marginForOne ? pool.currency1 : pool.currency0;
  const borrowToken = marginForOne ? pool.currency0 : pool.currency1;

  // 1. Pool state
  const stateInfo = await publicClient.readContract({
    address: helperAddr, abi: helperABI,
    functionName: "getPoolStateInfo", args: [poolId],
  });

  // 2. Max margin
  const pairReserve = marginForOne ? stateInfo.pairReserve1 : stateInfo.pairReserve0;
  const realReserve = marginForOne ? stateInfo.realReserve1 : stateInfo.realReserve0;
  const ratio = LEVERAGE_MAX_RATIOS[leverageInt - 1];
  const fromPair = pairReserve * BigInt(Math.round(ratio * 10000)) / 10000n;
  const maxMargin = fromPair < realReserve ? fromPair : realReserve;
  const minMargin = pairReserve / MARGIN_MINIMUM_RATIO;

  // 3. Borrow quote: convert marginAmount * leverage to borrow currency
  const zeroForOne = !marginForOne;
  const quoteInput = marginAmount * BigInt(leverageInt);
  const quoteResult = await publicClient.readContract({
    address: helperAddr, abi: helperABI,
    functionName: "getAmountOut", args: [poolId, zeroForOne, quoteInput, true],
  });
  const borrowAmount = quoteResult[0];
  const swapFee = quoteResult[1];
  const swapFeeAmount = quoteResult[2];
  const borrowAmountMax = borrowAmount * 101n / 100n; // +1% slippage

  // 4. Total (Using Margin Lx) = marginAmount * leverage - swapFeeAmount (in margin currency)
  // Fee is charged on the input side of the swap
  const total = quoteInput - swapFeeAmount;

  // 5. Borrow APR
  const borrowForOne = !marginForOne;
  const aprRaw = await publicClient.readContract({
    address: helperAddr, abi: helperABI,
    functionName: "getBorrowAPR", args: [poolId, borrowForOne],
  });

  // 6. Margin levels
  const liquidationLevel = 1.1; // Protocol constant: liquidation trigger
  // minMarginLevels (e.g. 1.17) is the minimum IMR allowed when opening — validated separately

  // 7. Initial Margin Level = (marginAmount + marginTotal) / debtValue
  // debtValue in margin currency: use getAmountIn to price borrowAmount
  const debtQuote = await publicClient.readContract({
    address: helperAddr, abi: helperABI,
    functionName: "getAmountIn", args: [poolId, zeroForOne, borrowAmount, true],
  });
  const debtValueInMarginCurrency = debtQuote[0];
  const initialMarginLevel = Number(marginAmount + total) / Number(debtValueInMarginCurrency);

  // 8. Liquidation price = (marginAmount + marginTotal) / (borrowAmount * 1.1)
  //    Result is always in currency0 per currency1 (e.g. ETH per LIKWID)
  const marginAmtF = Number(formatUnits(marginAmount, marginToken.decimals));
  const marginTotalF = Number(formatUnits(total, marginToken.decimals));
  const borrowAmtF = Number(formatUnits(borrowAmount, borrowToken.decimals));
  let liquidationPrice;
  if (!marginForOne) {
    // Short: margin=currency0, borrow=currency1 → price in currency0/currency1
    liquidationPrice = (marginAmtF + marginTotalF) / (borrowAmtF * liquidationLevel);
  } else {
    // Long: margin=currency1, borrow=currency0 → invert to get currency0/currency1
    liquidationPrice = (borrowAmtF * liquidationLevel) / (marginAmtF + marginTotalF);
  }

  return {
    marginToken, borrowToken, stateInfo,
    maxMargin, minMargin, borrowAmount, borrowAmountMax, swapFee, swapFeeAmount,
    total, aprRaw, liquidationLevel, initialMarginLevel, liquidationPrice,
  };
}

function printMarginPreview(pool, marginForOne, leverageInt, marginAmount, preview) {
  const { marginToken, borrowToken, maxMargin, borrowAmount, borrowAmountMax,
    total, aprRaw, liquidationLevel, initialMarginLevel, liquidationPrice } = preview;

  const dirLabel = marginForOne
    ? `Long ${pool.currency1.symbol} (Short ${pool.currency0.symbol})`
    : `Short ${pool.currency1.symbol} (Long ${pool.currency0.symbol})`;
  const poolName = `${pool.currency0.symbol}/${pool.currency1.symbol}`;
  const aprPercent = (Number(aprRaw) / 10000).toFixed(2);

  // Price unit: always currency0 per currency1
  const priceUnit = `${pool.currency0.symbol} per ${pool.currency1.symbol}`;

  console.log(`> MARGIN_QUOTE: ${dirLabel} | ${poolName} | ${leverageInt}x`);
  console.log(`> ─────────────────────────────────`);
  console.log(`> Margin:                  ${formatUnits(marginAmount, marginToken.decimals)} ${marginToken.symbol}`);
  console.log(`> Total (Using Margin ${leverageInt}x): ${formatUnits(total, marginToken.decimals)} ${marginToken.symbol}`);
  console.log(`> Borrow Amount:           ${formatUnits(borrowAmount, borrowToken.decimals)} ${borrowToken.symbol}`);
  console.log(`> Borrow APY:              ${aprPercent}%`);
  console.log(`> ─────────────────────────────────`);
  console.log(`> Initial Margin Level:     ${initialMarginLevel.toFixed(2)}`);
  console.log(`> Liquidation Margin Level: ${liquidationLevel.toFixed(2)}`);
  console.log(`> Liq.Price:                ${liquidationPrice.toFixed(8)} ${priceUnit}`);
  console.log(`> ─────────────────────────────────`);
  console.log(`> Max Margin (${leverageInt}x):         ${formatUnits(maxMargin, marginToken.decimals)} ${marginToken.symbol}`);
  console.log(`> Max Slippage:             Auto 1%`);
  console.log(`> Borrow Max Amount:        ${formatUnits(borrowAmountMax, borrowToken.decimals)} ${borrowToken.symbol}`);
}

function parseMarginArgs(poolStr, directionStr, leverageStr, amountStr) {
  if (!poolStr || !directionStr || !leverageStr || !amountStr) return null;
  const leverageInt = parseInt(leverageStr);
  if (isNaN(leverageInt) || leverageInt < 1 || leverageInt > 5) {
    console.log(`> ERROR: Leverage must be 1-5 (got "${leverageStr}").`);
    return null;
  }
  const marginForOne = (directionStr === "long");
  if (directionStr !== "long" && directionStr !== "short") {
    console.log(`> ERROR: Direction must be "long" or "short" (got "${directionStr}").`);
    return null;
  }
  return { marginForOne, leverageInt };
}

async function cmd_margin_quote(poolStr, directionStr, leverageStr, amountStr) {
  if (!poolStr || !directionStr || !leverageStr || !amountStr) {
    console.log(`> Usage: margin_quote <pool> <direction> <leverage> <amount>`);
    console.log(`> Pool: token pair (e.g. ETH/LIKWID)`);
    console.log(`> Direction: long (Long currency1) or short (Short currency1)`);
    console.log(`> Leverage: 1-5`);
    console.log(`> Amount: margin amount in collateral currency`);
    return;
  }

  const parsed = parseMarginArgs(poolStr, directionStr, leverageStr, amountStr);
  if (!parsed) return;
  const { marginForOne, leverageInt } = parsed;

  const config = loadConfig();
  if (!config) return console.log(`> ERROR: Not configured. Run setup first.`);
  const netConfig = loadNetworkConfig(config.network);
  if (!netConfig) return;

  const pool = resolvePool(netConfig, poolStr);
  if (!pool) return console.log(`> ERROR: Pool "${poolStr}" not found. Run "pools" to list.`);

  const poolId = computePoolId(pool);
  const marginToken = marginForOne ? pool.currency1 : pool.currency0;
  const marginAmount = parseUnits(amountStr, marginToken.decimals);

  const clients = createClients(config, netConfig);
  if (!clients) return;

  try {
    const preview = await computeMarginPreview(
      clients.publicClient, netConfig, pool, poolId, marginForOne, leverageInt, marginAmount,
    );

    if (marginAmount < preview.minMargin) {
      console.log(`> ERROR: Below minimum margin ${formatUnits(preview.minMargin, marginToken.decimals)} ${marginToken.symbol} (MarginBelowMinimum).`);
      return;
    }
    if (marginAmount > preview.maxMargin) {
      console.log(`> ERROR: Exceeds max margin ${formatUnits(preview.maxMargin, marginToken.decimals)} ${marginToken.symbol} at ${leverageInt}x.`);
      return;
    }

    printMarginPreview(pool, marginForOne, leverageInt, marginAmount, preview);
  } catch (e) {
    console.log(`> ERROR: Margin quote failed: ${e.shortMessage || e.message}`);
  }
}

async function cmd_margin_open(poolStr, directionStr, leverageStr, amountStr) {
  if (!poolStr || !directionStr || !leverageStr || !amountStr) {
    console.log(`> Usage: margin_open <pool> <direction> <leverage> <amount>`);
    console.log(`> Pool: token pair (e.g. ETH/LIKWID)`);
    console.log(`> Direction: long (Long currency1) or short (Short currency1)`);
    console.log(`> Leverage: 1-5`);
    console.log(`> Amount: margin amount in collateral currency`);
    return;
  }

  const parsed = parseMarginArgs(poolStr, directionStr, leverageStr, amountStr);
  if (!parsed) return;
  const { marginForOne, leverageInt } = parsed;

  const ctx = await resolveContext();
  if (!ctx) return;
  const { config, netConfig, eoaAccount, publicClient, senderAddress } = ctx;

  const pool = resolvePool(netConfig, poolStr);
  if (!pool) return console.log(`> ERROR: Pool "${poolStr}" not found. Run "pools" to list.`);

  const poolId = computePoolId(pool);
  const marginToken = marginForOne ? pool.currency1 : pool.currency0;
  const marginAmount = parseUnits(amountStr, marginToken.decimals);

  // --- Preview ---
  let preview;
  try {
    preview = await computeMarginPreview(
      publicClient, netConfig, pool, poolId, marginForOne, leverageInt, marginAmount,
    );
  } catch (e) {
    return console.log(`> ERROR: Margin quote failed: ${e.shortMessage || e.message}`);
  }

  if (marginAmount < preview.minMargin) {
    return console.log(`> ERROR: Below minimum margin ${formatUnits(preview.minMargin, marginToken.decimals)} ${marginToken.symbol} (MarginBelowMinimum).`);
  }
  if (marginAmount > preview.maxMargin) {
    return console.log(`> ERROR: Exceeds max margin ${formatUnits(preview.maxMargin, marginToken.decimals)} ${marginToken.symbol} at ${leverageInt}x.`);
  }

  printMarginPreview(pool, marginForOne, leverageInt, marginAmount, preview);

  // --- Check existing positions via API ---
  console.log(`> Checking existing margin positions...`);
  const positions = await fetchMarginPositions(netConfig.chainId, senderAddress, poolId);

  // Filter: same direction (marginForOne match)
  // We only use tokenId from API; verify direction on-chain if needed
  let existingTokenId = null;
  if (positions.length > 0) {
    const marginPositionABI = loadABI("LikwidMarginPosition");
    // Check first position's direction on-chain
    const tid = BigInt(positions[0].tokenId);
    try {
      const posState = await publicClient.readContract({
        address: netConfig.contracts.LikwidMarginPosition, abi: marginPositionABI,
        functionName: "getPositionState", args: [tid],
      });
      if (posState.marginForOne === marginForOne) {
        existingTokenId = tid;
      }
    } catch (_) {}
  }

  // --- Build calls ---
  const marginPositionAddress = netConfig.contracts.LikwidMarginPosition;
  const marginPositionABI = loadABI("LikwidMarginPosition");
  const calls = [];
  const sendingNative = isNative(marginToken.address);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  // Approve if ERC-20 margin
  if (!sendingNative) {
    calls.push(...await buildApprovalCalls(
      publicClient, senderAddress, marginToken.address, marginToken.symbol,
      marginPositionAddress, marginAmount,
    ));
  }

  if (existingTokenId) {
    // --- Increase existing position: margin() ---
    console.log(`> Found existing position #${existingTokenId}, increasing margin...`);
    calls.push({
      to: marginPositionAddress,
      value: sendingNative ? marginAmount : 0n,
      data: encodeFunctionData({
        abi: marginPositionABI,
        functionName: "margin",
        args: [{
          tokenId: existingTokenId,
          leverage: leverageInt,
          marginAmount,
          borrowAmount: preview.borrowAmount,
          borrowAmountMax: preview.borrowAmountMax,
          deadline,
        }],
      }),
    });
  } else {
    // --- Open new position: addMargin() ---
    console.log(`> No existing position, opening new margin...`);
    const poolKey = {
      currency0: pool.currency0.address,
      currency1: pool.currency1.address,
      fee: pool.fee,
      marginFee: pool.marginFee,
    };
    calls.push({
      to: marginPositionAddress,
      value: sendingNative ? marginAmount : 0n,
      data: encodeFunctionData({
        abi: marginPositionABI,
        functionName: "addMargin",
        args: [poolKey, {
          marginForOne,
          leverage: leverageInt,
          marginAmount,
          borrowAmount: preview.borrowAmount,
          borrowAmountMax: preview.borrowAmountMax,
          recipient: senderAddress,
          deadline,
        }],
      }),
    });
  }

  await executeCalls(config, netConfig, eoaAccount, publicClient, calls);
}

// ======================= MARGIN POSITIONS =======================

async function cmd_margin_positions(poolStr) {
  if (!poolStr) {
    console.log(`> Usage: margin_positions <pool>`);
    console.log(`> Pool: token pair (e.g. ETH/LIKWID)`);
    return;
  }

  const config = loadConfig();
  if (!config) return console.log(`> ERROR: Not configured. Run setup first.`);
  const netConfig = loadNetworkConfig(config.network);
  if (!netConfig) return;

  const pool = resolvePool(netConfig, poolStr);
  if (!pool) return console.log(`> ERROR: Pool "${poolStr}" not found. Run "pools" to list.`);

  const poolId = computePoolId(pool);
  const clients = createClients(config, netConfig);
  if (!clients) return;
  const { publicClient, account } = clients;
  const owner = account.address;

  // 1. Query API — only use tokenId
  const items = await fetchMarginPositions(netConfig.chainId, owner, poolId);
  if (items.length === 0) {
    console.log(`> No margin positions found for ${pool.currency0.symbol}/${pool.currency1.symbol}.`);
    return;
  }

  const marginPositionABI = loadABI("LikwidMarginPosition");
  const helperABI = loadABI("LikwidHelper");
  const helperAddr = netConfig.contracts.LikwidHelper;
  const marginAddr = netConfig.contracts.LikwidMarginPosition;

  // 2. Pool state for current price
  const stateInfo = await publicClient.readContract({
    address: helperAddr, abi: helperABI,
    functionName: "getPoolStateInfo", args: [poolId],
  });
  const r0 = Number(formatUnits(stateInfo.pairReserve0, pool.currency0.decimals));
  const r1 = Number(formatUnits(stateInfo.pairReserve1, pool.currency1.decimals));
  // Current price: currency0 per currency1 (e.g. ETH per LIKWID)
  const curPrice = r0 / r1;

  // 3. Borrow APR for both directions
  const [apr0, apr1] = await Promise.all([
    publicClient.readContract({ address: helperAddr, abi: helperABI, functionName: "getBorrowAPR", args: [poolId, false] }),
    publicClient.readContract({ address: helperAddr, abi: helperABI, functionName: "getBorrowAPR", args: [poolId, true] }),
  ]);

  const poolName = `${pool.currency0.symbol}/${pool.currency1.symbol}`;
  const swapFeeStr = (pool.fee / 10000).toFixed(2);
  const marginFeeStr = (pool.marginFee / 10000).toFixed(2);

  console.log(`> MARGIN_POSITIONS: ${poolName} (Swap Fee: ${swapFeeStr}% Margin Fee: ${marginFeeStr}%)`);
  console.log(`> Current Price: ${curPrice.toFixed(8)} ${pool.currency0.symbol} per ${pool.currency1.symbol}`);
  console.log(`>`);

  // 4. For each position, get on-chain state
  for (let i = 0; i < items.length; i++) {
    const tokenId = BigInt(items[i].tokenId);

    let posState;
    try {
      posState = await publicClient.readContract({
        address: marginAddr, abi: marginPositionABI,
        functionName: "getPositionState", args: [tokenId],
      });
    } catch (e) {
      console.log(`> Position #${tokenId}: ERROR reading state: ${e.shortMessage || e.message}`);
      continue;
    }

    const marginForOne = posState.marginForOne;
    const marginToken = marginForOne ? pool.currency1 : pool.currency0;
    const borrowToken = marginForOne ? pool.currency0 : pool.currency1;

    const marginAmountF = Number(formatUnits(posState.marginAmount, marginToken.decimals));
    const marginTotalF = Number(formatUnits(posState.marginTotal, marginToken.decimals));
    const debtAmountF = Number(formatUnits(posState.debtAmount, borrowToken.decimals));

    const dirLabel = marginForOne
      ? `Long ${pool.currency1.symbol} · Short ${pool.currency0.symbol}`
      : `Short ${pool.currency1.symbol} · Long ${pool.currency0.symbol}`;

    // Borrow APR: borrowForOne = !marginForOne
    const apr = marginForOne ? apr0 : apr1;
    const aprPercent = (Number(apr) / 10000).toFixed(2);

    // Liquidation price = (marginAmount + marginTotal) / (debtAmount * 1.1)
    // Always in currency0 per currency1
    const liquidationLevel = 1.1;
    let liqPrice;
    if (!marginForOne) {
      liqPrice = (marginAmountF + marginTotalF) / (debtAmountF * liquidationLevel);
    } else {
      liqPrice = (debtAmountF * liquidationLevel) / (marginAmountF + marginTotalF);
    }

    // Margin Level = (marginAmount + marginTotal) / debtValue_in_margin_currency
    // For short (margin=c0, debt=c1): debtValue = debtAmount * curPrice
    // For long  (margin=c1, debt=c0): debtValue = debtAmount / curPrice (= debtAmount * (1/curPrice))
    let debtValueInMargin;
    if (!marginForOne) {
      // debt is currency1, margin is currency0. debt unit ≠ price unit → debt * curPrice
      debtValueInMargin = debtAmountF * curPrice;
    } else {
      // debt is currency0, margin is currency1. debt unit = price unit → debt * (1/curPrice)
      debtValueInMargin = debtAmountF / curPrice;
    }
    const marginLevel = (marginAmountF + marginTotalF) / debtValueInMargin;

    // Estimated PNL
    // debt unit ≠ price unit: PNL = marginTotal - (debt * curPrice)
    // debt unit = price unit:  PNL = marginTotal - (debt * 1/curPrice)
    let pnl;
    if (!marginForOne) {
      // Short: margin=c0(ETH), debt=c1(LIKWID). Price=c0/c1. debt unit(c1) ≠ price unit(c0)
      pnl = marginTotalF - (debtAmountF * curPrice);
    } else {
      // Long: margin=c1(LIKWID), debt=c0(ETH). Price=c0/c1. debt unit(c0) = price unit(c0)
      pnl = marginTotalF - (debtAmountF / curPrice);
    }

    console.log(`> Position #${tokenId}`);
    console.log(`> ${dirLabel}`);
    console.log(`> Margin Amount:   ${marginAmountF} ${marginToken.symbol}`);
    console.log(`> Margin Total:    ${marginTotalF} ${marginToken.symbol}`);
    console.log(`> Debt:            ${debtAmountF} ${borrowToken.symbol}`);
    console.log(`> Borrow APY:      ${aprPercent}%`);
    console.log(`> Liq.Price:       ${liqPrice.toFixed(8)} ${pool.currency0.symbol} per ${pool.currency1.symbol}`);
    console.log(`> Cur.Price:       ${curPrice.toFixed(8)} ${pool.currency0.symbol} per ${pool.currency1.symbol}`);
    console.log(`> Margin Level:    ${marginLevel.toFixed(2)}`);
    console.log(`> Estimated PNL:   ${pnl >= 0 ? "+" : ""}${pnl.toFixed(8)} ${marginToken.symbol}`);
    if (i < items.length - 1) console.log(`>`);
  }
}

// ======================= CLI ROUTER =======================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log(`Likwid.fi Protocol Universal Skill — Powered by https://likwid.fi

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
  lp_add <pool> <currency> <amt> [slip%]    Add or increase liquidity. currency: 0 or 1.
  lp_positions <pool>                       Show your liquidity positions.
  lp_remove <pool> [percent]                Remove liquidity. Default: 100% (all).
  create_pair <t0> <t1> <fee> <marginFee>   Create a new pool. Tokens by name or address.

Margin Trading:
  margin_quote <pool> <dir> <lev> <amt>     Preview margin position without executing.
  margin_open  <pool> <dir> <lev> <amt>     Open or increase a margin position.
  margin_positions <pool>                   Show your margin positions.

Arguments:
  <pool>      Token pair (e.g. ETH/USDT). Lowest fee tier selected by default.
  <dir>       Swap direction: 0to1 or 1to0
  <amount>    Human-readable amount (e.g., "0.01", "100")
  [slippage]  Slippage tolerance in % (default: 1)
`);
    process.exit(0);
  }

  (async () => {
    console.log(`> Powered by https://likwid.fi`);
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
        case "lp_positions":
          await cmd_lp_positions(args[1]);
          break;
        case "lp_remove":
          await cmd_lp_remove(args[1], args[2]);
          break;
        case "create_pair":
          await cmd_create_pair(args[1], args[2], args[3], args[4]);
          break;
        case "margin_quote":
          await cmd_margin_quote(args[1], args[2], args[3], args[4]);
          break;
        case "margin_open":
          await cmd_margin_open(args[1], args[2], args[3], args[4]);
          break;
        case "margin_positions":
          await cmd_margin_positions(args[1]);
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
