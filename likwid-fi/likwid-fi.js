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

function formatToken(amount, decimals, symbol) {
  return `${formatUnits(amount, decimals)} ${symbol}`;
}

// ======================= CLIENT SETUP =======================

function createClients(config, networkConfig) {
  const privateKey = readPrivateKey(config.keyFilePath);
  if (!privateKey) return null;

  const chain = CHAINS[config.network];
  const rpc = process.env.RPC_URL || networkConfig.rpc;
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpc),
  });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpc),
  });

  return { publicClient, walletClient, account, chain };
}

async function getSmartAccount(config, networkConfig, eoaAccount) {
  const { createSmartAccountClient, createBundlerClient, ENTRYPOINT_ADDRESS_V06 } = require("permissionless");
  const { signerToSimpleSmartAccount } = require("permissionless/accounts");

  const chain = CHAINS[config.network];
  const rpc = process.env.RPC_URL || networkConfig.rpc;
  const bundlerUrl = process.env.BUNDLER_URL || networkConfig.bundlerUrl;
  const factoryAddress = networkConfig.smartAccountFactory;

  const publicClient = createPublicClient({ chain, transport: http(rpc) });

  const smartAccount = await signerToSimpleSmartAccount(publicClient, {
    signer: eoaAccount,
    factoryAddress,
    entryPoint: ENTRYPOINT_ADDRESS_V06,
  });

  const bundlerClient = createBundlerClient({
    transport: http(bundlerUrl),
    entryPoint: ENTRYPOINT_ADDRESS_V06,
    chain,
  });

  const smartAccountClient = createSmartAccountClient({
    account: smartAccount,
    entryPoint: ENTRYPOINT_ADDRESS_V06,
    chain,
    bundlerTransport: http(bundlerUrl),
  });

  return { smartAccount, smartAccountClient, bundlerClient, publicClient };
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
  const rpc = process.env.RPC_URL || netConfig.rpc;
  const publicClient = createPublicClient({ chain, transport: http(rpc) });

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

  // --- Execute based on account type ---
  if (config.accountType === "smart") {
    await executeSwapSmart(config, netConfig, eoaAccount, publicClient, {
      pool, poolId, zeroForOne, fromToken, toToken,
      amountIn, amountOutMin, deadline, senderAddress,
      pairPositionABI,
    });
  } else {
    await executeSwapEOA(config, netConfig, eoaAccount, publicClient, {
      pool, poolId, zeroForOne, fromToken, toToken,
      amountIn, amountOutMin, deadline, senderAddress,
      pairPositionABI,
    });
  }
}

// ======================= EOA EXECUTION =======================

async function executeSwapEOA(config, netConfig, eoaAccount, publicClient, params) {
  const { pool, poolId, zeroForOne, fromToken, toToken, amountIn, amountOutMin, deadline, senderAddress, pairPositionABI } = params;

  const chain = CHAINS[config.network];
  const rpc = process.env.RPC_URL || netConfig.rpc;
  const walletClient = createWalletClient({
    account: eoaAccount,
    chain,
    transport: http(rpc),
  });

  const pairPositionAddress = netConfig.contracts.LikwidPairPosition;
  const sendingNative = isNative(fromToken.address);

  // --- Approve if selling ERC20 ---
  if (!sendingNative) {
    const currentAllowance = await publicClient.readContract({
      address: fromToken.address,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [senderAddress, pairPositionAddress],
    });

    if (currentAllowance < amountIn) {
      console.log(`> Approving ${fromToken.symbol} for LikwidPairPosition...`);
      const approveTx = await walletClient.writeContract({
        address: fromToken.address,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [pairPositionAddress, amountIn],
      });
      console.log(`> Approval tx: ${approveTx}`);
      await publicClient.waitForTransactionReceipt({ hash: approveTx });
      console.log(`> Approval confirmed.`);
    }
  }

  // --- Execute swap ---
  console.log(`> Submitting swap transaction...`);

  const swapParams = {
    poolId,
    zeroForOne,
    to: senderAddress,
    amountIn,
    amountOutMin,
    deadline,
  };

  try {
    const txHash = await walletClient.writeContract({
      address: pairPositionAddress,
      abi: pairPositionABI,
      functionName: "exactInput",
      args: [swapParams],
      value: sendingNative ? amountIn : 0n,
    });

    console.log(`> Tx submitted: ${txHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status === "success") {
      console.log(`> SWAP_OK`);
      console.log(`> Transaction: ${txHash}`);
      console.log(`> Block: ${receipt.blockNumber}`);
      console.log(`> Gas used: ${receipt.gasUsed}`);
    } else {
      console.log(`> SWAP_REVERTED`);
      console.log(`> Transaction: ${txHash}`);
    }
  } catch (e) {
    console.log(`> ERROR: Swap failed: ${e.shortMessage || e.message}`);
  }
}

// ======================= SMART ACCOUNT EXECUTION =======================

async function executeSwapSmart(config, netConfig, eoaAccount, publicClient, params) {
  const { pool, poolId, zeroForOne, fromToken, toToken, amountIn, amountOutMin, deadline, senderAddress, pairPositionABI } = params;

  const { smartAccount, smartAccountClient } = await getSmartAccount(config, netConfig, eoaAccount);
  const pairPositionAddress = netConfig.contracts.LikwidPairPosition;
  const sendingNative = isNative(fromToken.address);

  const calls = [];

  // --- Approve if selling ERC20 ---
  if (!sendingNative) {
    const currentAllowance = await publicClient.readContract({
      address: fromToken.address,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [senderAddress, pairPositionAddress],
    });

    if (currentAllowance < amountIn) {
      console.log(`> Approving ${fromToken.symbol} for LikwidPairPosition...`);
      calls.push({
        to: fromToken.address,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [pairPositionAddress, amountIn],
        }),
      });
    }
  }

  // --- Swap call ---
  const swapParams = {
    poolId,
    zeroForOne,
    to: senderAddress,
    amountIn,
    amountOutMin,
    deadline,
  };

  calls.push({
    to: pairPositionAddress,
    value: sendingNative ? amountIn : 0n,
    data: encodeFunctionData({
      abi: pairPositionABI,
      functionName: "exactInput",
      args: [swapParams],
    }),
  });

  console.log(`> Submitting UserOperation (${calls.length} call${calls.length > 1 ? "s" : ""})...`);

  try {
    const txHash = await smartAccountClient.sendTransactions({ transactions: calls });

    console.log(`> UserOp submitted: ${txHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status === "success") {
      console.log(`> SWAP_OK`);
      console.log(`> Transaction: ${txHash}`);
      console.log(`> Block: ${receipt.blockNumber}`);
      console.log(`> Gas used: ${receipt.gasUsed}`);
    } else {
      console.log(`> SWAP_REVERTED`);
      console.log(`> Transaction: ${txHash}`);
    }
  } catch (e) {
    console.log(`> ERROR: UserOp failed: ${e.shortMessage || e.message}`);
  }
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
  quote <pool> <dir> <amount>               Get swap quote without executing.

DeFi Actions:
  swap <pool> <dir> <amount> [slippage%]    Execute swap.

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
        case "swap":
          await cmd_swap(args[1], args[2], args[3], args[4]);
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
