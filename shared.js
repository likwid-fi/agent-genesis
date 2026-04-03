/**
 * shared.js — Shared infrastructure for Agent Genesis skill modules.
 *
 * Provides: viem clients, wallet management, ERC-4337 smart account helpers,
 * UserOperation execution, approval helpers, chain registry, pool resolution,
 * token resolution, and common constants/ABIs.
 *
 * Multi-chain support: CHAIN_REGISTRY holds per-chain config. Use
 * getChainContext(chainName) to get a full context for any supported chain.
 * Legacy globals (POOL_KEY, POOL_ID, publicClient, etc.) are preserved for
 * backward compatibility with genesis.js.
 */

const { createSmartAccountClient, createBundlerClient, ENTRYPOINT_ADDRESS_V06 } = require("permissionless");
const { signerToSimpleSmartAccount } = require("permissionless/accounts");
const {
  createPublicClient,
  custom,
  http,
  parseEther,
  toHex,
  encodeFunctionData,
  decodeFunctionData,
  parseAbi,
  toFunctionSelector,
  keccak256,
  encodeAbiParameters,
} = require("viem");
const { sepolia, mainnet, base, bsc } = require("viem/chains");
const { privateKeyToAccount, generatePrivateKey } = require("viem/accounts");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ======================= CONFIGURATION =======================
const VERIFIER_URL = "https://verifier.likwid.fi";
const WALLET_FILE = path.join(os.homedir(), ".openclaw", ".likwid_genesis_wallet.json");
const CUSTOM_TOKENS_FILE = path.join(os.homedir(), ".openclaw", ".likwid_tokens.json");
const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ERC-4337 Infrastructure
const ENTRY_POINT_ADDRESS = ENTRYPOINT_ADDRESS_V06; // EntryPoint v0.6
const SMART_ACCOUNT_FACTORY_ADDRESS = "0x9406Cc6185a346906296840746125a0E44976454";

// ======================= CHAIN REGISTRY =======================

const CHAIN_REGISTRY = {
  sepolia: {
    chain: sepolia,
    chainId: sepolia.id,
    rpc: process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com",
    bundler: process.env.SEPOLIA_BUNDLER || "https://bundler.particle.network",
    contracts: {
      LikwidHelper: "0x6407CDAAe652Ac601Df5Fba20b0fDf072Edd2013",
      LikwidPairPosition: "0xA8296e28c62249f89188De0499a81d6AD993a515",
      LikwidMarginPosition: "0x6a2666cA9D5769069762225161D454894fCe617c",
      LikwidLendPosition: "0xd04C34F7F57cAC394eC170C4Fe18A8B0330A2F37",
    },
    agc: {
      token: "0x83738CCFcd130714ceE2c8805122b820F2Ac3a2F",
      paymaster: "0xf624E3E553DF10313Bd3a297423ECB07FB52e6f3",
    },
    tokens: {
      ETH: NATIVE_TOKEN_ADDRESS,
      AGC: "0x83738CCFcd130714ceE2c8805122b820F2Ac3a2F",
    },
    nativeSymbol: "ETH",
  },
  ethereum: {
    chain: mainnet,
    chainId: mainnet.id,
    rpc: process.env.ETHEREUM_RPC || "https://ethereum-rpc.publicnode.com",
    bundler: process.env.ETHEREUM_BUNDLER || "https://bundler.particle.network",
    contracts: {
      LikwidHelper: "0x16a9633f8A777CA733073ea2526705cD8338d510",
      LikwidPairPosition: "0xB397FE16BE79B082f17F1CD96e6489df19E07BCD",
      LikwidMarginPosition: "0x6bec0c1dc4898484b7F094566ddf8bC82ED7Abe8",
      LikwidLendPosition: "0xCE91db5947228bBA595c3CAC49eb24053A06618E",
      LikwidVault: "0x065d449ec9D139740343990B7E1CF05fA830e4Ba",
    },
    agc: null, // No AGC on Ethereum mainnet
    tokens: {
      ETH: NATIVE_TOKEN_ADDRESS,
      USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    },
    nativeSymbol: "ETH",
  },
  base: {
    chain: base,
    chainId: base.id,
    rpc: process.env.BASE_RPC || "https://base-rpc.publicnode.com",
    bundler: process.env.BASE_BUNDLER || "https://bundler.particle.network",
    contracts: {
      LikwidHelper: ZERO_ADDRESS,
      LikwidPairPosition: ZERO_ADDRESS,
      LikwidMarginPosition: ZERO_ADDRESS,
      LikwidLendPosition: ZERO_ADDRESS,
    },
    agc: null, // AGC on Base is planned for future
    tokens: {
      ETH: NATIVE_TOKEN_ADDRESS,
      USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    },
    nativeSymbol: "ETH",
  },
  bnb: {
    chain: bsc,
    chainId: bsc.id,
    rpc: process.env.BNB_RPC || "https://bsc-rpc.publicnode.com",
    bundler: process.env.BNB_BUNDLER || "https://bundler.particle.network",
    contracts: {
      LikwidHelper: ZERO_ADDRESS,
      LikwidPairPosition: ZERO_ADDRESS,
      LikwidMarginPosition: ZERO_ADDRESS,
      LikwidLendPosition: ZERO_ADDRESS,
    },
    agc: null, // No AGC on BNB
    tokens: {
      BNB: NATIVE_TOKEN_ADDRESS,
      USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    },
    nativeSymbol: "BNB",
  },
};

// ======================= LEGACY GLOBALS (for genesis.js compatibility) =======================
// These are preserved so genesis.js continues to work without changes.

const CHAIN = sepolia;
const NETWORK_NAME = CHAIN.name;
const CHAIN_ID = CHAIN.id;
const RPC_URL = process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const BUNDLER_URL = process.env.BUNDLER_URL || "https://bundler.particle.network";

const AGC_TOKEN_ADDRESS = process.env.AGC_TOKEN_ADDRESS || "0x83738CCFcd130714ceE2c8805122b820F2Ac3a2F";
const AGENT_PAYMASTER_ADDRESS = process.env.AGENT_PAYMASTER_ADDRESS || "0xf624E3E553DF10313Bd3a297423ECB07FB52e6f3";

const LIKWID_HELPER_ADDRESS = process.env.LIKWID_HELPER_ADDRESS || "0x6407CDAAe652Ac601Df5Fba20b0fDf072Edd2013";
const LIKWID_PAIR_POSITION = process.env.LIKWID_PAIR_POSITION || "0xA8296e28c62249f89188De0499a81d6AD993a515";
const LIKWID_MARGIN_POSITION = process.env.LIKWID_MARGIN_POSITION || "0x6a2666cA9D5769069762225161D454894fCe617c";
const LIKWID_LEND_POSITION = process.env.LIKWID_LEND_POSITION || "0xd04C34F7F57cAC394eC170C4Fe18A8B0330A2F37";

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
const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
]);

const AGC_MINE_ABI = parseAbi([
  "function mine(uint256 score, bytes calldata signature, uint256 nonce) external payable",
]);

const AGC_MINE_SELECTOR = toFunctionSelector(AGC_MINE_ABI[0]);

const AGENT_PAYMASTER_ABI = parseAbi(["function hasFreeMined(address user) external view returns (bool)"]);

const LIKWID_PAIR_ABI = parseAbi([
  "function exactInput((bytes32 poolId, bool zeroForOne, address to, uint256 amountIn, uint256 amountOutMin, uint256 deadline) params) external payable returns (uint24 swapFee, uint256 feeAmount, uint256 amountOut)",
  "function exactOutput((bytes32 poolId, bool zeroForOne, address to, uint256 amountInMax, uint256 amountOut, uint256 deadline) params) external payable returns (uint24 swapFee, uint256 feeAmount, uint256 amountIn)",
  "function addLiquidity((address currency0, address currency1, uint24 fee, uint24 marginFee) key, address recipient, uint256 amount0, uint256 amount1, uint256 amount0Min, uint256 amount1Min, uint256 deadline) external payable returns (uint256 tokenId, uint128 liquidity)",
  "function increaseLiquidity(uint256 tokenId, uint256 amount0, uint256 amount1, uint256 amount0Min, uint256 amount1Min, uint256 deadline) external payable returns (uint128 liquidity)",
  "function removeLiquidity(uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) external returns (uint256 amount0, uint256 amount1)",
  "function donate(bytes32 poolId, uint256 amount0, uint256 amount1, uint256 deadline) external",
  "function getPositionState(uint256 positionId) external view returns ((uint128 liquidity, uint256 totalInvestment) state)",
  "function vault() external view returns (address)",
  "function nextId() external view returns (uint256)",
  "function poolIds(uint256 tokenId) external view returns (bytes32 poolId)",
  "function poolKeys(bytes32 poolId) external view returns (address currency0, address currency1, uint24 fee, uint24 marginFee)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
]);

const LIKWID_MARGIN_ABI = parseAbi([
  "function addMargin((address currency0, address currency1, uint24 fee, uint24 marginFee) key, (bool marginForOne, uint24 leverage, uint256 marginAmount, uint256 borrowAmount, uint256 borrowAmountMax, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint256 borrowAmount, uint256 swapFeeAmount)",
  "function margin((uint256 tokenId, uint24 leverage, uint256 marginAmount, uint256 borrowAmount, uint256 borrowAmountMax, uint256 deadline) params) external payable returns (uint256 borrowAmount, uint256 swapFeeAmount)",
  "function close(uint256 tokenId, uint24 closeMillionth, uint256 closeAmountMin, uint256 deadline) external",
  "function liquidateBurn(uint256 tokenId, uint256 deadline) external returns (uint256 profit)",
  "function getPositionState(uint256 tokenId) external view returns ((bool marginForOne, uint128 marginAmount, uint128 marginTotal, uint256 depositCumulativeLast, uint128 debtAmount, uint256 borrowCumulativeLast) state)",
  "function nextId() external view returns (uint256)",
  "function poolIds(uint256 tokenId) external view returns (bytes32 poolId)",
  "function poolKeys(bytes32 poolId) external view returns (address currency0, address currency1, uint24 fee, uint24 marginFee)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
]);

const LIKWID_LEND_ABI = parseAbi([
  "function addLending((address currency0, address currency1, uint24 fee, uint24 marginFee) key, bool lendForOne, address recipient, uint256 amount, uint256 deadline) external payable returns (uint256 tokenId)",
  "function deposit(uint256 tokenId, uint256 amount, uint256 deadline) external payable",
  "function withdraw(uint256 tokenId, uint256 amount, uint256 deadline) external",
  "function exactInput((bool zeroForOne, uint256 tokenId, uint256 amountIn, uint256 amountOutMin, uint256 deadline) params) external payable returns (uint24 swapFee, uint256 feeAmount, uint256 amountOut)",
  "function exactOutput((bool zeroForOne, uint256 tokenId, uint256 amountInMax, uint256 amountOut, uint256 deadline) params) external payable returns (uint24 swapFee, uint256 feeAmount, uint256 amountIn)",
  "function getPositionState(uint256 positionId) external view returns ((uint128 lendAmount, uint256 depositCumulativeLast) state)",
  "function nextId() external view returns (uint256)",
  "function poolIds(uint256 tokenId) external view returns (bytes32 poolId)",
  "function poolKeys(bytes32 poolId) external view returns (address currency0, address currency1, uint24 fee, uint24 marginFee)",
  "function lendDirections(uint256 tokenId) external view returns (bool lendForOne)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
]);

const LIKWID_HELPER_ABI = parseAbi([
  "function getAmountOut(bytes32 poolId, bool zeroForOne, uint256 amountIn, bool dynamicFee) external view returns (uint256 amountOut, uint24 fee, uint256 feeAmount)",
  "function getAmountIn(bytes32 poolId, bool zeroForOne, uint256 amountOut, bool dynamicFee) external view returns (uint256 amountIn, uint24 fee, uint256 feeAmount)",
  "function checkMarginPositionLiquidate(uint256 tokenId) external view returns (bool liquidated)",
  "function getPoolStateInfo(bytes32 poolId) external view returns ((uint128 totalSupply, uint32 lastUpdated, uint24 lpFee, uint24 marginFee, uint24 protocolFee, uint128 realReserve0, uint128 realReserve1, uint128 mirrorReserve0, uint128 mirrorReserve1, uint128 pairReserve0, uint128 pairReserve1, uint128 truncatedReserve0, uint128 truncatedReserve1, uint128 lendReserve0, uint128 lendReserve1, uint128 interestReserve0, uint128 interestReserve1, int128 insuranceFund0, int128 insuranceFund1, uint256 borrow0CumulativeLast, uint256 borrow1CumulativeLast, uint256 deposit0CumulativeLast, uint256 deposit1CumulativeLast) stateInfo)",
]);

// ======================= LEGACY CLIENTS (for genesis.js) =======================
const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL),
});

// ======================= BUNDLER (legacy) =======================

let bundlerRequestId = 0;

function serializeRpcValue(value) {
  if (typeof value === "bigint") return toHex(value);
  if (Array.isArray(value)) return value.map(serializeRpcValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, serializeRpcValue(nested)]));
  }
  return value;
}

function createBundlerRequestFn(bundlerUrl, chainId) {
  let reqId = 0;
  return async function bundlerRequest(method, params) {
    const response = await fetch(bundlerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++reqId,
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
      error.extraData = payload.error.extraData;
      throw error;
    }
    return payload.result;
  };
}

// Legacy bundler functions using the Sepolia bundler
async function bundlerRequest(method, params) {
  const response = await fetch(BUNDLER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++bundlerRequestId,
      chainId: CHAIN_ID,
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
    error.extraData = payload.error.extraData;
    throw error;
  }
  return payload.result;
}

function createParticleBundlerTransport() {
  return custom({
    request: ({ method, params }) => bundlerRequest(method, params),
  });
}

const bundlerTransport = createParticleBundlerTransport();

const bundlerClient = createBundlerClient({
  chain: CHAIN,
  entryPoint: ENTRY_POINT_ADDRESS,
  transport: bundlerTransport,
});

async function estimateUserOperationGas(userOperation) {
  return bundlerClient.estimateUserOperationGas({ userOperation });
}

// Particle requires `chainId` in every bundler RPC body and exposes fee fields
// on raw estimate responses that permissionless' normalized estimate omits.
async function estimateParticleUserOperationGasRaw(userOperation) {
  return bundlerRequest("eth_estimateUserOperationGas", [userOperation, ENTRY_POINT_ADDRESS]);
}

async function getSponsoredUserOperationEstimate(userOperation, fallbackGasPrices) {
  const opToEstimate = {
    ...userOperation,
    paymasterAndData: AGENT_PAYMASTER_ADDRESS,
    maxFeePerGas: fallbackGasPrices.maxFeePerGas,
    maxPriorityFeePerGas: fallbackGasPrices.maxPriorityFeePerGas,
  };

  const [estimate, rawEstimate] = await Promise.all([
    estimateUserOperationGas(opToEstimate),
    estimateParticleUserOperationGasRaw(opToEstimate),
  ]);

  return {
    ...estimate,
    maxFeePerGas: rawEstimate.maxFeePerGas ?? fallbackGasPrices.maxFeePerGas,
    maxPriorityFeePerGas: rawEstimate.maxPriorityFeePerGas ?? fallbackGasPrices.maxPriorityFeePerGas,
    paymasterAndData: AGENT_PAYMASTER_ADDRESS,
  };
}

async function waitForUserOperationReceipt(hash, timeout = 120_000) {
  return bundlerClient.waitForUserOperationReceipt({ hash, timeout });
}

async function getBundlerGasPrice() {
  const fees = await publicClient.estimateFeesPerGas();
  return {
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  };
}

async function getDirectEthFallbackGasPrice() {
  const fees = await getBundlerGasPrice();
  const minBundlerGasPrice = 1_000_000_000n; // 1 gwei floor for Particle bundler direct ETH mode
  return {
    maxFeePerGas: fees.maxFeePerGas > minBundlerGasPrice ? fees.maxFeePerGas : minBundlerGasPrice,
    maxPriorityFeePerGas:
      fees.maxPriorityFeePerGas > minBundlerGasPrice ? fees.maxPriorityFeePerGas : minBundlerGasPrice,
  };
}

// ======================= WALLET & ACCOUNT =======================

function getWalletInstance() {
  if (fs.existsSync(WALLET_FILE)) {
    const data = JSON.parse(fs.readFileSync(WALLET_FILE, "utf8"));
    let pk = data.privateKey;
    if (!pk.startsWith("0x")) pk = "0x" + pk;
    return privateKeyToAccount(pk);
  }
  return null;
}

async function getSmartAccount(signer, client) {
  return await signerToSimpleSmartAccount(client || publicClient, {
    entryPoint: ENTRY_POINT_ADDRESS,
    signer: signer,
    factoryAddress: SMART_ACCOUNT_FACTORY_ADDRESS,
  });
}

// ======================= MULTI-CHAIN: getChainContext =======================

/**
 * Returns a full chain context object for the given chain name.
 * chainName is REQUIRED — no default chain.
 *
 * The context contains: config, publicClient, contract addresses, token map,
 * and lazy-created bundler/smart-account infrastructure.
 */
function getChainContext(chainName) {
  if (!chainName) {
    throw new Error("Chain name is required. Supported chains: " + Object.keys(CHAIN_REGISTRY).join(", "));
  }
  const key = chainName.toLowerCase();
  const reg = CHAIN_REGISTRY[key];
  if (!reg) {
    throw new Error(`Unknown chain: "${chainName}". Supported chains: ${Object.keys(CHAIN_REGISTRY).join(", ")}`);
  }

  const pc = createPublicClient({
    chain: reg.chain,
    transport: http(reg.rpc),
  });

  const chainBundlerRequest = createBundlerRequestFn(reg.bundler, reg.chainId);

  const chainBundlerTransport = custom({
    request: ({ method, params }) => chainBundlerRequest(method, params),
  });

  const chainBundlerClient = createBundlerClient({
    chain: reg.chain,
    entryPoint: ENTRY_POINT_ADDRESS,
    transport: chainBundlerTransport,
  });

  // Merge custom tokens from .likwid_tokens.json
  const customTokens = loadCustomTokens(key);
  const allTokens = { ...reg.tokens, ...customTokens };

  return {
    name: key,
    chain: reg.chain,
    chainId: reg.chainId,
    rpc: reg.rpc,
    bundlerUrl: reg.bundler,
    contracts: reg.contracts,
    agc: reg.agc,
    tokens: allTokens,
    nativeSymbol: reg.nativeSymbol,
    publicClient: pc,
    bundlerClient: chainBundlerClient,
    bundlerTransport: chainBundlerTransport,
    bundlerRequest: chainBundlerRequest,
    hasAgc: !!reg.agc,
    getSmartAccount: async (signer) => getSmartAccount(signer, pc),
    getGasPrice: async () => {
      const fees = await pc.estimateFeesPerGas();
      return {
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      };
    },
    getDirectGasPrice: async () => {
      const fees = await pc.estimateFeesPerGas();
      const minGas = 1_000_000_000n;
      return {
        maxFeePerGas: fees.maxFeePerGas > minGas ? fees.maxFeePerGas : minGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas > minGas ? fees.maxPriorityFeePerGas : minGas,
      };
    },
  };
}

// ======================= MULTI-CHAIN: Token Resolution =======================

/**
 * Resolve a token symbol or address to a normalized address.
 * Case-insensitive symbol lookup.
 */
function resolveToken(chainCtx, symbolOrAddress) {
  if (!symbolOrAddress) throw new Error("Token symbol or address is required.");

  // Direct address
  if (symbolOrAddress.startsWith("0x") && symbolOrAddress.length === 42) {
    return symbolOrAddress.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase()
      ? NATIVE_TOKEN_ADDRESS
      : symbolOrAddress;
  }

  // Symbol lookup (case-insensitive)
  const sym = symbolOrAddress.toUpperCase();
  for (const [key, addr] of Object.entries(chainCtx.tokens)) {
    if (key.toUpperCase() === sym) return addr;
  }

  throw new Error(
    `Unknown token "${symbolOrAddress}" on ${chainCtx.name}. Known tokens: ${Object.keys(chainCtx.tokens).join(", ")}`,
  );
}

/**
 * Get the display symbol for a token address on the given chain context.
 */
function getTokenSymbol(chainCtx, address) {
  const addr = address.toLowerCase();
  for (const [sym, tokenAddr] of Object.entries(chainCtx.tokens)) {
    if (tokenAddr.toLowerCase() === addr) return sym;
  }
  // Return abbreviated address if no symbol found
  return address.slice(0, 6) + "..." + address.slice(-4);
}

// ======================= MULTI-CHAIN: Pool Resolution =======================

/**
 * Compute a poolId from a poolKey.
 */
function computePoolId(poolKey) {
  return keccak256(
    encodeAbiParameters(
      [
        { name: "currency0", type: "address" },
        { name: "currency1", type: "address" },
        { name: "fee", type: "uint24" },
        { name: "marginFee", type: "uint24" },
      ],
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.marginFee],
    ),
  );
}

/**
 * Resolve a pair string like "ETH/USDC" or "0xAAA/0xBBB" into a pool object.
 * Pair is REQUIRED — no default pair.
 * Automatically sorts currency0 < currency1 (Uniswap V4 convention).
 *
 * Returns: { poolKey, poolId, token0Symbol, token1Symbol, currency0, currency1 }
 */
function resolvePool(chainCtx, pairStr) {
  if (!pairStr) {
    throw new Error("Pool pair is required (e.g., ETH/USDC).");
  }

  const parts = pairStr.split("/");
  if (parts.length !== 2) {
    throw new Error(`Invalid pair format: "${pairStr}". Expected format: TOKEN0/TOKEN1 (e.g., ETH/USDC)`);
  }

  const addrA = resolveToken(chainCtx, parts[0].trim());
  const addrB = resolveToken(chainCtx, parts[1].trim());

  if (addrA.toLowerCase() === addrB.toLowerCase()) {
    throw new Error("Pool pair tokens must be different.");
  }

  // Sort: currency0 < currency1
  let currency0, currency1, sym0, sym1;
  if (addrA.toLowerCase() < addrB.toLowerCase()) {
    currency0 = addrA;
    currency1 = addrB;
    sym0 = getTokenSymbol(chainCtx, addrA);
    sym1 = getTokenSymbol(chainCtx, addrB);
  } else {
    currency0 = addrB;
    currency1 = addrA;
    sym0 = getTokenSymbol(chainCtx, addrB);
    sym1 = getTokenSymbol(chainCtx, addrA);
  }

  const poolKey = {
    currency0,
    currency1,
    fee: 3000,
    marginFee: 3000,
  };

  const poolId = computePoolId(poolKey);

  return {
    poolKey,
    poolId,
    token0Symbol: sym0,
    token1Symbol: sym1,
    currency0,
    currency1,
  };
}

// ======================= MULTI-CHAIN: Custom Tokens =======================

/**
 * Load custom tokens for a specific chain from .likwid_tokens.json.
 */
function loadCustomTokens(chainName) {
  try {
    if (!fs.existsSync(CUSTOM_TOKENS_FILE)) return {};
    const data = JSON.parse(fs.readFileSync(CUSTOM_TOKENS_FILE, "utf8"));
    const chainData = data[chainName];
    if (chainData && chainData.tokens) {
      return chainData.tokens;
    }
    return {};
  } catch (e) {
    return {};
  }
}

/**
 * Save a custom token for a specific chain to .likwid_tokens.json.
 */
function saveCustomToken(chainName, symbol, address) {
  let data = {};
  try {
    if (fs.existsSync(CUSTOM_TOKENS_FILE)) {
      data = JSON.parse(fs.readFileSync(CUSTOM_TOKENS_FILE, "utf8"));
    }
  } catch (e) {
    data = {};
  }

  if (!data[chainName]) {
    data[chainName] = { tokens: {} };
  }
  if (!data[chainName].tokens) {
    data[chainName].tokens = {};
  }
  data[chainName].tokens[symbol.toUpperCase()] = address;

  const dir = path.dirname(CUSTOM_TOKENS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CUSTOM_TOKENS_FILE, JSON.stringify(data, null, 2));
}

// ======================= MULTI-CHAIN: runUserOp =======================

/**
 * Run a UserOperation on a specific chain context.
 * chainCtx: chain context from getChainContext()
 * account: smart account
 * calls: single call or array of calls
 * description: human-readable description
 *
 * Paymaster strategy:
 *   - Chains with AGC (sepolia, base future): AGC Paymaster -> ETH fallback
 *   - Other chains: direct native gas only
 */
async function runUserOpMultiChain(chainCtx, account, calls, description) {
  let gasPaymentMode = chainCtx.hasAgc ? "agc" : "native";
  const hasAgcPaymaster = chainCtx.hasAgc;
  const paymasterAddress = hasAgcPaymaster ? chainCtx.agc.paymaster : null;
  const agcTokenAddress = hasAgcPaymaster ? chainCtx.agc.token : null;
  let expectsFreeMine = false;
  let canUseFreeMine = false;
  let preferredGasMode = hasAgcPaymaster ? "agc" : "native";
  let ethBalance;
  let agcBalance = 0n;
  let estimatedDirectEthCost = null;
  let paymasterEstimateSucceeded = false;
  let estimatedAgcPrecharge = null;

  if (hasAgcPaymaster) {
    expectsFreeMine = isFreeMineOperationForToken(calls, agcTokenAddress);
    if (expectsFreeMine) {
      try {
        const hasFreeMined = await chainCtx.publicClient.readContract({
          address: paymasterAddress,
          abi: AGENT_PAYMASTER_ABI,
          functionName: "hasFreeMined",
          args: [account.address],
        });
        canUseFreeMine = !hasFreeMined;
      } catch {
        canUseFreeMine = false;
      }
    }
  }

  // Create paymaster-sponsored client (only for AGC chains)
  let smartAccountClient;
  if (hasAgcPaymaster) {
    const getSponsoredEstimate = async (userOperation, fallbackGasPrices) => {
      const opToEstimate = {
        ...userOperation,
        paymasterAndData: paymasterAddress,
        maxFeePerGas: fallbackGasPrices.maxFeePerGas,
        maxPriorityFeePerGas: fallbackGasPrices.maxPriorityFeePerGas,
      };
      const [estimate, rawEstimate] = await Promise.all([
        chainCtx.bundlerClient.estimateUserOperationGas({ userOperation: opToEstimate }),
        chainCtx.bundlerRequest("eth_estimateUserOperationGas", [opToEstimate, ENTRY_POINT_ADDRESS]),
      ]);
      return {
        ...estimate,
        maxFeePerGas: rawEstimate.maxFeePerGas ?? fallbackGasPrices.maxFeePerGas,
        maxPriorityFeePerGas: rawEstimate.maxPriorityFeePerGas ?? fallbackGasPrices.maxPriorityFeePerGas,
        paymasterAndData: paymasterAddress,
      };
    };

    smartAccountClient = createSmartAccountClient({
      account,
      entryPoint: ENTRY_POINT_ADDRESS,
      chain: chainCtx.chain,
      bundlerTransport: chainCtx.bundlerTransport,
      middleware: {
        sponsorUserOperation: async ({ userOperation }) => {
          console.log(`> Estimating gas and attaching custom paymaster (${description})...`);
          const fallbackGasPrices = await chainCtx.getGasPrice();
          try {
            const estimate = await getSponsoredEstimate(userOperation, fallbackGasPrices);
            gasPaymentMode = canUseFreeMine ? "free" : "agc";
            return {
              ...estimate,
              verificationGasLimit:
                BigInt(estimate.verificationGasLimit) > 600000n ? estimate.verificationGasLimit : 600000n,
            };
          } catch (paymasterError) {
            const paymasterErrorMessage = [
              paymasterError?.message,
              paymasterError?.cause?.message,
              typeof paymasterError?.extraData === "string" ? paymasterError.extraData : null,
            ]
              .filter(Boolean)
              .join(" | ");
            console.log(`> Warning: Paymaster estimation/attachment failed: ${paymasterErrorMessage.slice(0, 160)}`);
            throw paymasterError;
          }
        },
      },
    });
  }

  // Unwrap single-element arrays so encodeCallData uses execute() instead of executeBatch().
  // executeBatch() on SimpleAccount v0.6 does NOT support msg.value per call.
  const encodedCalls = Array.isArray(calls) && calls.length === 1 ? calls[0] : calls;

  const ethSmartAccountClient = createSmartAccountClient({
    account,
    entryPoint: ENTRY_POINT_ADDRESS,
    chain: chainCtx.chain,
    bundlerTransport: chainCtx.bundlerTransport,
    middleware: {
      gasPrice: chainCtx.getDirectGasPrice,
    },
  });

  console.log(`> Packaging UserOperation for ${description}...`);
  try {
    const callData = await account.encodeCallData(encodedCalls);
    let userOpHash;
    const operationRequiredEth = getOperationRequiredEth(calls);

    // Estimate direct native gas cost
    try {
      const ethUserOperation = await ethSmartAccountClient.prepareUserOperationRequest({
        userOperation: { callData },
      });
      estimatedDirectEthCost = getRequiredPrefundForUserOperation(ethUserOperation);
    } catch (ethEstimateError) {
      console.log(
        `> Warning: Direct native gas estimation failed: ${getNormalizedErrorMessage(ethEstimateError).slice(0, 160)}`,
      );
    }

    ethBalance = await chainCtx.publicClient.getBalance({ address: account.address });

    if (hasAgcPaymaster) {
      agcBalance = await chainCtx.publicClient.readContract({
        address: agcTokenAddress,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [account.address],
      });

      const operationRequiredAgc = await getOperationRequiredAgcForChain(
        chainCtx, calls, agcTokenAddress,
      );

      const totalRequiredEthForDirect =
        estimatedDirectEthCost === null ? null : estimatedDirectEthCost + operationRequiredEth;
      const hasEnoughEthForDirectGas = totalRequiredEthForDirect !== null && ethBalance >= totalRequiredEthForDirect;
      const hasEnoughAgcForOperation = agcBalance >= operationRequiredAgc;

      if (!hasEnoughAgcForOperation && !hasEnoughEthForDirectGas) {
        const shortfallAgc = operationRequiredAgc - agcBalance;
        throw new Error(
          [
            "CLI_INSUFFICIENT_OPERATION_AGC",
            `required=${formatTokenAmount(operationRequiredAgc)}`,
            `available=${formatTokenAmount(agcBalance)}`,
            `op_shortfall=${formatTokenAmount(shortfallAgc)}`,
          ].join("|"),
        );
      }

      if (hasEnoughEthForDirectGas) {
        preferredGasMode = "eth";
      } else if (canUseFreeMine) {
        preferredGasMode = "agc";
      } else {
        const paymasterEstimate = await getPaymasterEstimateWithPrechargeOrThrowMultiChain(
          chainCtx, callData, ethSmartAccountClient, agcTokenAddress, paymasterAddress,
        );
        estimatedAgcPrecharge = paymasterEstimate.estimatedAgcPrecharge;
        const totalRequiredAgc = operationRequiredAgc + estimatedAgcPrecharge;
        if (agcBalance < totalRequiredAgc) {
          throw new Error(
            [
              "CLI_INSUFFICIENT_TOTAL_AGC",
              `operation=${formatTokenAmount(operationRequiredAgc)}`,
              `precharge=${formatTokenAmount(estimatedAgcPrecharge)}`,
              `required=${formatTokenAmount(totalRequiredAgc)}`,
              `available=${formatTokenAmount(agcBalance)}`,
              `shortfall=${formatTokenAmount(totalRequiredAgc - agcBalance)}`,
            ].join("|"),
          );
        }
        preferredGasMode = "agc";
        paymasterEstimateSucceeded = true;
      }
    } else {
      // No AGC paymaster — native gas only
      const totalRequiredEth =
        estimatedDirectEthCost === null ? null : estimatedDirectEthCost + operationRequiredEth;
      if (totalRequiredEth !== null && ethBalance < totalRequiredEth) {
        throw new Error(
          [
            "CLI_INSUFFICIENT_NATIVE_GAS",
            `required=${formatTokenAmount(totalRequiredEth)}`,
            `available=${formatTokenAmount(ethBalance)}`,
            `shortfall=${formatTokenAmount(totalRequiredEth - ethBalance)}`,
          ].join("|"),
        );
      }
      preferredGasMode = "native";
    }

    const submitWithNative = async () => {
      gasPaymentMode = hasAgcPaymaster ? "eth" : "native";
      const ethUserOperation = await ethSmartAccountClient.prepareUserOperationRequest({
        userOperation: { callData },
      });
      ethUserOperation.signature = await account.signUserOperation(ethUserOperation);
      return chainCtx.bundlerRequest("eth_sendUserOperation", [ethUserOperation, ENTRY_POINT_ADDRESS]);
    };

    const submitWithPaymaster = async () =>
      smartAccountClient.sendUserOperation({
        userOperation: { callData },
      });

    if (preferredGasMode === "native" || preferredGasMode === "eth") {
      console.log(`> Smart account ${chainCtx.nativeSymbol} balance: ${Number(ethBalance) / 1e18} ${chainCtx.nativeSymbol}`);
      if (estimatedDirectEthCost !== null) {
        console.log(`> Estimated direct ${chainCtx.nativeSymbol} gas required: ${Number(estimatedDirectEthCost) / 1e18} ${chainCtx.nativeSymbol}`);
      }
      if (operationRequiredEth > 0n) {
        console.log(`> ${chainCtx.nativeSymbol} required by operation: ${Number(operationRequiredEth) / 1e18} ${chainCtx.nativeSymbol}`);
      }
      console.log(`> Using direct ${chainCtx.nativeSymbol} gas payment...`);
      userOpHash = await submitWithNative();
    } else {
      console.log(`> Smart account ${chainCtx.nativeSymbol} balance: ${Number(ethBalance) / 1e18} ${chainCtx.nativeSymbol}`);
      console.log(`> Smart account AGC balance: ${Number(agcBalance) / 1e18} AGC`);
      if (!canUseFreeMine) {
        if (!paymasterEstimateSucceeded) {
          console.log("> Checking paymaster estimate...");
          const paymasterEstimate = await getPaymasterEstimateWithPrechargeOrThrowMultiChain(
            chainCtx, callData, ethSmartAccountClient, agcTokenAddress, paymasterAddress,
          );
          estimatedAgcPrecharge = paymasterEstimate.estimatedAgcPrecharge;
          paymasterEstimateSucceeded = true;
        }
        console.log(`> Estimated AGC precharge: ${Number(estimatedAgcPrecharge) / 1e18} AGC`);
      }
      console.log("> Using AGC / paymaster gas payment...");
      userOpHash = await submitWithPaymaster();
    }

    console.log(`> UserOperation submitted! Hash: ${userOpHash}`);
    console.log("> Waiting for receipt...");
    const receipt = await chainCtx.bundlerClient.waitForUserOperationReceipt({ hash: userOpHash, timeout: 120_000 });
    if (receipt.success !== true || receipt.receipt?.status !== "success") {
      throw new Error(
        [
          "CLI_USEROP_REVERTED",
          `reason=${sanitizeCliField(receipt.reason || "unknown")}`,
          `tx_hash=${receipt.receipt?.transactionHash || "unknown"}`,
          `gas_used=${receipt.actualGasUsed ? receipt.actualGasUsed.toString() : "unknown"}`,
          `gas_cost_eth=${receipt.actualGasCost ? formatTokenAmount(receipt.actualGasCost) : "unknown"}`,
        ].join("|"),
      );
    }
    const gasNote =
      gasPaymentMode === "free"
        ? " (first mine sponsored by paymaster)"
        : gasPaymentMode === "agc"
          ? " (gas paid in AGC)"
          : ` (gas paid in ${chainCtx.nativeSymbol})`;
    console.log(`\n> Done: ${description} Successful!${gasNote} Tx Hash: ${receipt.receipt.transactionHash}`);
    return receipt;
  } catch (e) {
    return handleUserOpError(e, description);
  }
}

// ======================= LEGACY USER OPERATION (for genesis.js) =======================

async function runUserOp(account, calls, description) {
  let gasPaymentMode = "agc";
  const expectsFreeMine = isFreeMineOperation(calls);
  let canUseFreeMine = false;
  let preferredGasMode = "agc";
  let ethBalance;
  let agcBalance;
  let estimatedDirectEthCost = null;
  let paymasterEstimateSucceeded = false;
  let estimatedAgcPrecharge = null;

  if (expectsFreeMine) {
    try {
      const hasFreeMined = await publicClient.readContract({
        address: AGENT_PAYMASTER_ADDRESS,
        abi: AGENT_PAYMASTER_ABI,
        functionName: "hasFreeMined",
        args: [account.address],
      });
      canUseFreeMine = !hasFreeMined;
    } catch {
      canUseFreeMine = false;
    }
  }

  const smartAccountClient = createSmartAccountClient({
    account,
    entryPoint: ENTRY_POINT_ADDRESS,
    chain: CHAIN,
    bundlerTransport,
    middleware: {
      sponsorUserOperation: async ({ userOperation }) => {
        console.log(`> Estimating gas and attaching custom paymaster (${description})...`);
        const fallbackGasPrices = await getBundlerGasPrice();

        try {
          const estimate = await getSponsoredUserOperationEstimate(userOperation, fallbackGasPrices);
          gasPaymentMode = canUseFreeMine ? "free" : "agc";

          return {
            ...estimate,
            verificationGasLimit:
              BigInt(estimate.verificationGasLimit) > 600000n ? estimate.verificationGasLimit : 600000n,
          };
        } catch (paymasterError) {
          const paymasterErrorMessage = [
            paymasterError?.message,
            paymasterError?.cause?.message,
            typeof paymasterError?.extraData === "string" ? paymasterError.extraData : null,
          ]
            .filter(Boolean)
            .join(" | ");
          console.log(`> Warning: Paymaster estimation/attachment failed: ${paymasterErrorMessage.slice(0, 160)}`);
          throw paymasterError;
        }
      },
    },
  });

  const encodedCalls = Array.isArray(calls) && calls.length === 1 ? calls[0] : calls;

  const ethSmartAccountClient = createSmartAccountClient({
    account,
    entryPoint: ENTRY_POINT_ADDRESS,
    chain: CHAIN,
    bundlerTransport,
    middleware: {
      gasPrice: getDirectEthFallbackGasPrice,
    },
  });

  console.log(`> Packaging UserOperation for ${description}...`);
  try {
    const callData = await account.encodeCallData(encodedCalls);
    let userOpHash;
    const operationRequiredAgc = await getOperationRequiredAgc(calls);
    const operationRequiredEth = getOperationRequiredEth(calls);

    try {
      const ethUserOperation = await ethSmartAccountClient.prepareUserOperationRequest({
        userOperation: { callData },
      });
      estimatedDirectEthCost = getRequiredPrefundForUserOperation(ethUserOperation);
    } catch (ethEstimateError) {
      console.log(
        `> Warning: Direct ETH gas estimation failed: ${getNormalizedErrorMessage(ethEstimateError).slice(0, 160)}`,
      );
    }

    [ethBalance, agcBalance] = await Promise.all([
      publicClient.getBalance({ address: account.address }),
      publicClient.readContract({
        address: AGC_TOKEN_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [account.address],
      }),
    ]);

    const totalRequiredEthForDirect =
      estimatedDirectEthCost === null ? null : estimatedDirectEthCost + operationRequiredEth;
    const hasEnoughEthForDirectGas = totalRequiredEthForDirect !== null && ethBalance >= totalRequiredEthForDirect;
    const hasEnoughAgcForOperation = agcBalance >= operationRequiredAgc;

    if (!hasEnoughAgcForOperation) {
      const shortfallAgc = operationRequiredAgc - agcBalance;
      throw new Error(
        [
          "CLI_INSUFFICIENT_OPERATION_AGC",
          `required=${formatTokenAmount(operationRequiredAgc)}`,
          `available=${formatTokenAmount(agcBalance)}`,
          `op_shortfall=${formatTokenAmount(shortfallAgc)}`,
        ].join("|"),
      );
    }

    if (hasEnoughEthForDirectGas) {
      preferredGasMode = "eth";
    } else if (canUseFreeMine) {
      preferredGasMode = "agc";
    } else {
      const paymasterEstimate = await getPaymasterEstimateWithPrechargeOrThrow(callData, ethSmartAccountClient);
      estimatedAgcPrecharge = paymasterEstimate.estimatedAgcPrecharge;
      const totalRequiredAgc = operationRequiredAgc + estimatedAgcPrecharge;
      if (agcBalance < totalRequiredAgc) {
        throw new Error(
          [
            "CLI_INSUFFICIENT_TOTAL_AGC",
            `operation=${formatTokenAmount(operationRequiredAgc)}`,
            `precharge=${formatTokenAmount(estimatedAgcPrecharge)}`,
            `required=${formatTokenAmount(totalRequiredAgc)}`,
            `available=${formatTokenAmount(agcBalance)}`,
            `shortfall=${formatTokenAmount(totalRequiredAgc - agcBalance)}`,
          ].join("|"),
        );
      }
      preferredGasMode = "agc";
      paymasterEstimateSucceeded = true;
    }

    const submitWithEth = async () => {
      gasPaymentMode = "eth";
      const ethUserOperation = await ethSmartAccountClient.prepareUserOperationRequest({
        userOperation: { callData },
      });
      ethUserOperation.signature = await account.signUserOperation(ethUserOperation);
      return bundlerRequest("eth_sendUserOperation", [ethUserOperation, ENTRY_POINT_ADDRESS]);
    };

    const submitWithPaymaster = async () =>
      smartAccountClient.sendUserOperation({
        userOperation: { callData },
      });

    if (preferredGasMode === "eth") {
      console.log(`> Smart account ETH balance: ${Number(ethBalance) / 1e18} ETH`);
      if (estimatedDirectEthCost !== null) {
        console.log(`> Estimated direct ETH gas required: ${Number(estimatedDirectEthCost) / 1e18} ETH`);
      }
      if (operationRequiredEth > 0n) {
        console.log(`> ETH required by operation: ${Number(operationRequiredEth) / 1e18} ETH`);
      }
      console.log("> Using direct ETH gas payment...");
      userOpHash = await submitWithEth();
    } else {
      console.log(`> Smart account ETH balance: ${Number(ethBalance) / 1e18} ETH`);
      console.log(`> Smart account AGC balance: ${Number(agcBalance) / 1e18} AGC`);
      if (!canUseFreeMine) {
        console.log(`> Required AGC for operation: ${Number(operationRequiredAgc) / 1e18} AGC`);
        if (!paymasterEstimateSucceeded) {
          console.log("> Checking paymaster estimate...");
          const paymasterEstimate = await getPaymasterEstimateWithPrechargeOrThrow(callData, ethSmartAccountClient);
          estimatedAgcPrecharge = paymasterEstimate.estimatedAgcPrecharge;
          paymasterEstimateSucceeded = true;
        }
        console.log(`> Estimated AGC precharge: ${Number(estimatedAgcPrecharge) / 1e18} AGC`);
      }
      console.log("> Using AGC / paymaster gas payment...");
      userOpHash = await submitWithPaymaster();
    }

    console.log(`> UserOperation submitted! Hash: ${userOpHash}`);
    console.log("> Waiting for receipt...");
    const receipt = await waitForUserOperationReceipt(userOpHash, 120_000);
    if (receipt.success !== true || receipt.receipt?.status !== "success") {
      throw new Error(
        [
          "CLI_USEROP_REVERTED",
          `reason=${sanitizeCliField(receipt.reason || "unknown")}`,
          `tx_hash=${receipt.receipt?.transactionHash || "unknown"}`,
          `gas_used=${receipt.actualGasUsed ? receipt.actualGasUsed.toString() : "unknown"}`,
          `gas_cost_eth=${receipt.actualGasCost ? formatTokenAmount(receipt.actualGasCost) : "unknown"}`,
        ].join("|"),
      );
    }
    const gasNote =
      gasPaymentMode === "free"
        ? " (first mine sponsored by paymaster)"
        : gasPaymentMode === "eth"
          ? " (gas paid in ETH)"
          : " (gas paid in AGC)";
    console.log(`\n> Done: ${description} Successful!${gasNote} Tx Hash: ${receipt.receipt.transactionHash}`);
    return receipt;
  } catch (e) {
    return handleUserOpError(e, description);
  }
}

// ======================= SHARED ERROR HANDLER =======================

function handleUserOpError(e, description) {
  const errMsg = e.message || String(e);
  if (errMsg.startsWith("CLI_INSUFFICIENT_OPERATION_AGC|")) {
    const fields = parseCliErrorFields(errMsg);
    console.log(`> Error: ${description} aborted.`);
    console.log(`> AGC for operation is insufficient.`);
    console.log(`> Required:  ${fields.required} AGC`);
    console.log(`> Available: ${fields.available} AGC`);
    console.log(`> Operation shortfall: ${fields.op_shortfall} AGC`);
    return null;
  }
  if (errMsg.startsWith("CLI_PAYMASTER_ESTIMATE_FAILED|")) {
    const fields = parseCliErrorFields(errMsg);
    console.log(`> Error: ${description} aborted.`);
    console.log(`> Paymaster estimate failed.`);
    console.log(`> This transaction cannot proceed with AGC gas sponsorship right now.`);
    console.log(`> Detail: ${fields.reason}`);
    return null;
  }
  if (errMsg.startsWith("CLI_INSUFFICIENT_TOTAL_AGC|")) {
    const fields = parseCliErrorFields(errMsg);
    console.log(`> Error: ${description} aborted.`);
    console.log(`> AGC is insufficient for operation + paymaster precharge.`);
    console.log(`> Operation: ${fields.operation} AGC`);
    console.log(`> Precharge: ${fields.precharge} AGC`);
    console.log(`> Required:  ${fields.required} AGC`);
    console.log(`> Available: ${fields.available} AGC`);
    console.log(`> Shortfall: ${fields.shortfall} AGC`);
    return null;
  }
  if (errMsg.startsWith("CLI_INSUFFICIENT_NATIVE_GAS|")) {
    const fields = parseCliErrorFields(errMsg);
    console.log(`> Error: ${description} aborted.`);
    console.log(`> Insufficient native token for gas.`);
    console.log(`> Required:  ${fields.required}`);
    console.log(`> Available: ${fields.available}`);
    console.log(`> Shortfall: ${fields.shortfall}`);
    return null;
  }
  if (errMsg.startsWith("CLI_USEROP_REVERTED|")) {
    const fields = parseCliErrorFields(errMsg);
    console.log(`> Error: ${description} reverted onchain.`);
    console.log(`> Tx Hash: ${fields.tx_hash}`);
    console.log(`> Reason: ${fields.reason}`);
    console.log(`> Gas Used: ${fields.gas_used}`);
    console.log(`> Gas Cost: ${fields.gas_cost_eth}`);
    return null;
  }
  if (errMsg.includes("EstimateGas") || errMsg.includes("execution reverted") || errMsg.includes("AA")) {
    console.log(`> Error: ${description} failed during gas estimation or execution.`);
    console.log(`>`);
    console.log(`> Possible causes:`);
    console.log(`>   1. Collateral amount too small (try a larger amount)`);
    console.log(`>   2. Insufficient token balance or allowance`);
    console.log(`>   3. Insufficient gas token balance`);
    console.log(`>   4. Contract rejected the operation (invalid params or pool state)`);
    console.log(`>`);
    console.log(`> Technical detail: ${errMsg.slice(0, 200)}`);
  } else {
    console.error(`> ${description} execution failed:`, e.stack || errMsg);
  }
  return null;
}

// ======================= MULTI-CHAIN PAYMASTER HELPERS =======================

async function getPaymasterEstimateWithPrechargeOrThrowMultiChain(
  chainCtx, callData, ethSmartAccountClient, agcTokenAddress, paymasterAddress,
) {
  const gasPrices = await chainCtx.getGasPrice();
  const ethUserOperation = await ethSmartAccountClient.prepareUserOperationRequest({
    userOperation: { callData },
  });

  const opToEstimate = {
    ...ethUserOperation,
    paymasterAndData: paymasterAddress,
    maxFeePerGas: gasPrices.maxFeePerGas,
    maxPriorityFeePerGas: gasPrices.maxPriorityFeePerGas,
  };

  let estimate;
  try {
    const [est, rawEst] = await Promise.all([
      chainCtx.bundlerClient.estimateUserOperationGas({ userOperation: opToEstimate }),
      chainCtx.bundlerRequest("eth_estimateUserOperationGas", [opToEstimate, ENTRY_POINT_ADDRESS]),
    ]);
    estimate = {
      ...est,
      maxFeePerGas: rawEst.maxFeePerGas ?? gasPrices.maxFeePerGas,
      maxPriorityFeePerGas: rawEst.maxPriorityFeePerGas ?? gasPrices.maxPriorityFeePerGas,
      paymasterAndData: paymasterAddress,
    };
  } catch (error) {
    throw new Error(
      `CLI_PAYMASTER_ESTIMATE_FAILED|reason=${sanitizeCliField(getNormalizedErrorMessage(error).slice(0, 200))}`,
    );
  }

  const requiredEthPrefund = getRequiredPrefundForUserOperation(estimate, true);
  const estimatedAgcPrecharge = await estimateAgcPrechargeFromRequiredEthMultiChain(
    chainCtx, (requiredEthPrefund * 31n) / 10n, agcTokenAddress,
  );
  return { estimate, estimatedAgcPrecharge };
}

async function estimateAgcPrechargeFromRequiredEthMultiChain(chainCtx, requiredEthPrefund, agcTokenAddress) {
  if (!requiredEthPrefund || requiredEthPrefund <= 0n) return 0n;

  const helperAddr = chainCtx.contracts.LikwidHelper;
  const pairAddr = chainCtx.contracts.LikwidPairPosition;

  // We need a poolId for the AGC pool on this chain
  // Find a pool that includes AGC and the native token
  const nativeAddr = NATIVE_TOKEN_ADDRESS;
  let currency0, currency1;
  if (nativeAddr.toLowerCase() < agcTokenAddress.toLowerCase()) {
    currency0 = nativeAddr;
    currency1 = agcTokenAddress;
  } else {
    currency0 = agcTokenAddress;
    currency1 = nativeAddr;
  }
  const agcPoolId = keccak256(
    encodeAbiParameters(
      [
        { name: "currency0", type: "address" },
        { name: "currency1", type: "address" },
        { name: "fee", type: "uint24" },
        { name: "marginFee", type: "uint24" },
      ],
      [currency0, currency1, 3000, 3000],
    ),
  );

  // Reserve-based quote
  let reserveQuote = 0n;
  try {
    const state = await chainCtx.publicClient.readContract({
      address: helperAddr,
      abi: LIKWID_HELPER_ABI,
      functionName: "getPoolStateInfo",
      args: [agcPoolId],
    });
    const reserveEth = BigInt(state.pairReserve0);
    const reserveAgc = BigInt(state.pairReserve1);
    if (reserveEth > 0n && reserveAgc > 0n) {
      reserveQuote = (requiredEthPrefund * reserveAgc * 120n) / (reserveEth * 100n);
    }
  } catch {}

  // Spot quote
  let spotQuote = 0n;
  try {
    const oneEth = 10n ** 18n;
    const res = await chainCtx.publicClient.readContract({
      address: helperAddr,
      abi: LIKWID_HELPER_ABI,
      functionName: "getAmountOut",
      args: [agcPoolId, true, oneEth, true],
    });
    const agcPerEth = BigInt(res[0]);
    if (agcPerEth > 0n) {
      spotQuote = (requiredEthPrefund * agcPerEth * 120n) / (oneEth * 100n);
    }
  } catch {}

  // Helper getAmountIn quote
  let helperQuote = 0n;
  try {
    const res = await chainCtx.publicClient.readContract({
      address: helperAddr,
      abi: LIKWID_HELPER_ABI,
      functionName: "getAmountIn",
      args: [agcPoolId, false, requiredEthPrefund, true],
    });
    helperQuote = (BigInt(res[0]) * 110n) / 100n;
  } catch {}

  return maxBigInt(helperQuote, reserveQuote, spotQuote);
}

/**
 * Compute how much AGC is needed for operations on any chain.
 */
async function getOperationRequiredAgcForChain(chainCtx, calls, agcTokenAddress) {
  if (!agcTokenAddress) return 0n;

  const callList = Array.isArray(calls) ? calls : [calls];
  let requiredAgc = 0n;
  const pairPos = chainCtx.contracts.LikwidPairPosition;
  const marginPos = chainCtx.contracts.LikwidMarginPosition;
  const lendPos = chainCtx.contracts.LikwidLendPosition;

  for (const call of callList) {
    if (!call || typeof call !== "object" || typeof call.to !== "string" || typeof call.data !== "string") continue;
    const target = call.to.toLowerCase();

    if (target === pairPos.toLowerCase()) {
      let decoded;
      try { decoded = decodeFunctionData({ abi: LIKWID_PAIR_ABI, data: call.data }); } catch { continue; }
      if (decoded.functionName === "exactInput" && decoded.args?.[0]) {
        const params = decoded.args[0];
        const poolKey = await getPoolKeyFromContract(chainCtx, pairPos, params.poolId);
        requiredAgc += getAgcAmountFromPairSwapInputGeneric(poolKey, params.zeroForOne, params.amountIn, agcTokenAddress);
      } else if (decoded.functionName === "exactOutput" && decoded.args?.[0]) {
        const params = decoded.args[0];
        const poolKey = await getPoolKeyFromContract(chainCtx, pairPos, params.poolId);
        requiredAgc += getAgcAmountFromPairSwapInputGeneric(poolKey, params.zeroForOne, params.amountInMax, agcTokenAddress);
      } else if (decoded.functionName === "addLiquidity" && decoded.args?.[0]) {
        requiredAgc += getAgcAmountFromPairLiquidityGeneric(decoded.args[0], decoded.args[2], decoded.args[3], agcTokenAddress);
      }
      continue;
    }

    if (target === marginPos.toLowerCase()) {
      let decoded;
      try { decoded = decodeFunctionData({ abi: LIKWID_MARGIN_ABI, data: call.data }); } catch { continue; }
      if (decoded.functionName === "addMargin" && decoded.args?.[0] && decoded.args?.[1]) {
        requiredAgc += getAgcAmountFromDirectionalAmountGeneric(
          decoded.args[0], decoded.args[1].marginForOne, decoded.args[1].marginAmount, agcTokenAddress,
        );
      }
      continue;
    }

    if (target === lendPos.toLowerCase()) {
      let decoded;
      try { decoded = decodeFunctionData({ abi: LIKWID_LEND_ABI, data: call.data }); } catch { continue; }
      if (decoded.functionName === "addLending" && decoded.args?.[0]) {
        requiredAgc += getAgcAmountFromDirectionalAmountGeneric(decoded.args[0], decoded.args[1], decoded.args[3], agcTokenAddress);
      }
    }
  }

  return requiredAgc;
}

function isFreeMineOperationForToken(calls, agcTokenAddress) {
  const selector = AGC_MINE_SELECTOR;
  const isCall = (call) =>
    call && call.to && typeof call.to === "string" &&
    call.to.toLowerCase() === agcTokenAddress.toLowerCase() &&
    typeof call.data === "string" && call.data.startsWith(selector);
  if (!Array.isArray(calls)) return isCall(calls);
  return calls.length > 0 && calls.every(isCall);
}

async function getPoolKeyFromContract(chainCtx, contractAddr, poolId) {
  try {
    return await chainCtx.publicClient.readContract({
      address: contractAddr,
      abi: LIKWID_PAIR_ABI,
      functionName: "poolKeys",
      args: [poolId],
    });
  } catch (error) {
    throw new Error(`Failed to read poolKeys(${poolId}) from ${contractAddr}: ${getNormalizedErrorMessage(error)}`);
  }
}

function getAgcAmountFromPairSwapInputGeneric(poolKey, zeroForOne, amountIn, agcTokenAddress) {
  return getAgcAmountFromDirectionalAmountGeneric(poolKey, !zeroForOne, amountIn, agcTokenAddress);
}

function getAgcAmountFromDirectionalAmountGeneric(poolKey, useCurrency1, amount, agcTokenAddress) {
  const currency = useCurrency1
    ? typeof poolKey?.currency1 === "string" ? poolKey.currency1 : poolKey?.[1]
    : typeof poolKey?.currency0 === "string" ? poolKey.currency0 : poolKey?.[0];
  return typeof currency === "string" && currency.toLowerCase() === agcTokenAddress.toLowerCase()
    ? BigInt(amount ?? 0n)
    : 0n;
}

function getAgcAmountFromPairLiquidityGeneric(poolKey, amount0, amount1, agcTokenAddress) {
  const agcAddr = agcTokenAddress.toLowerCase();
  const c0 = typeof poolKey?.currency0 === "string" ? poolKey.currency0.toLowerCase() : typeof poolKey?.[0] === "string" ? poolKey[0].toLowerCase() : null;
  const c1 = typeof poolKey?.currency1 === "string" ? poolKey.currency1.toLowerCase() : typeof poolKey?.[1] === "string" ? poolKey[1].toLowerCase() : null;
  let req = 0n;
  if (c0 === agcAddr) req += BigInt(amount0 ?? 0n);
  if (c1 === agcAddr) req += BigInt(amount1 ?? 0n);
  return req;
}

// ======================= HELPERS =======================

async function getApprovalCall(accountAddress, tokenAddress, spenderAddress, requiredAmount, client) {
  const pc = client || publicClient;
  const allowance = await pc.readContract({
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
        args: [spenderAddress, 115792089237316195423570985008687907853269984665640564039457584007913129639935n],
      }),
    };
  }
  return null;
}

function isFreeMineCall(call) {
  return (
    call &&
    call.to &&
    typeof call.to === "string" &&
    call.to.toLowerCase() === AGC_TOKEN_ADDRESS.toLowerCase() &&
    typeof call.data === "string" &&
    call.data.startsWith(AGC_MINE_SELECTOR)
  );
}

function isFreeMineOperation(calls) {
  if (!Array.isArray(calls)) {
    return isFreeMineCall(calls);
  }
  return calls.length > 0 && calls.every(isFreeMineCall);
}

function getRequiredPrefundForUserOperation(userOperation, hasPaymaster = false) {
  const callGasLimit = BigInt(userOperation.callGasLimit ?? 0n);
  const verificationGasLimit = BigInt(userOperation.verificationGasLimit ?? 0n);
  const preVerificationGas = BigInt(userOperation.preVerificationGas ?? 0n);
  const maxFeePerGas = BigInt(userOperation.maxFeePerGas ?? 0n);
  const verificationMultiplier = hasPaymaster ? 3n : 1n;

  return (callGasLimit + verificationGasLimit * verificationMultiplier + preVerificationGas) * maxFeePerGas;
}

async function getPaymasterUserOperationEstimateOrThrow(callData, ethSmartAccountClient) {
  const gasPrices = await getBundlerGasPrice();
  const ethUserOperation = await ethSmartAccountClient.prepareUserOperationRequest({
    userOperation: { callData },
  });

  try {
    return await getSponsoredUserOperationEstimate(ethUserOperation, gasPrices);
  } catch (error) {
    throw new Error(
      `CLI_PAYMASTER_ESTIMATE_FAILED|reason=${sanitizeCliField(getNormalizedErrorMessage(error).slice(0, 200))}`,
    );
  }
}

async function getPaymasterEstimateWithPrechargeOrThrow(callData, ethSmartAccountClient) {
  const estimate = await getPaymasterUserOperationEstimateOrThrow(callData, ethSmartAccountClient);
  const estimatedAgcPrecharge = await estimateAgcPrechargeFromPaymasterEstimate(estimate);
  return { estimate, estimatedAgcPrecharge };
}

async function estimateAgcPrechargeFromRequiredEth(requiredEthPrefund) {
  if (!requiredEthPrefund || requiredEthPrefund <= 0n) return 0n;

  const reserveQuote = await getAgcQuoteFromReserves(requiredEthPrefund);
  const spotQuote = await getAgcQuoteFromSpot(requiredEthPrefund);
  let helperQuote = 0n;

  try {
    const res = await publicClient.readContract({
      address: LIKWID_HELPER_ADDRESS,
      abi: LIKWID_HELPER_ABI,
      functionName: "getAmountIn",
      args: [POOL_ID, false, requiredEthPrefund, true],
    });
    helperQuote = (BigInt(res[0]) * 110n) / 100n;
  } catch {
    helperQuote = 0n;
  }

  return maxBigInt(helperQuote, reserveQuote, spotQuote);
}

async function estimateAgcPrechargeFromPaymasterEstimate(paymasterEstimate) {
  const requiredEthPrefund = getRequiredPrefundForUserOperation(paymasterEstimate, true);
  return estimateAgcPrechargeFromRequiredEth((requiredEthPrefund * 31n) / 10n);
}

async function getPoolKey(poolId) {
  if (poolId === POOL_ID) {
    return POOL_KEY;
  }
  try {
    return await publicClient.readContract({
      address: LIKWID_PAIR_POSITION,
      abi: LIKWID_PAIR_ABI,
      functionName: "poolKeys",
      args: [poolId],
    });
  } catch (error) {
    throw new Error(
      `Failed to read poolKeys(${poolId.toString()}) from ${LIKWID_PAIR_POSITION}: ${getNormalizedErrorMessage(error)}`,
    );
  }
}

async function getPoolKeyByTokenId(address, abi, tokenId) {
  let poolId;
  try {
    poolId = await publicClient.readContract({
      address,
      abi,
      functionName: "poolIds",
      args: [tokenId],
    });
  } catch (error) {
    throw new Error(`Failed to read poolIds(${tokenId.toString()}) from ${address}: ${getNormalizedErrorMessage(error)}`);
  }
  return getPoolKey(poolId);
}

function getAgcAmountFromPairLiquidity(poolKey, amount0, amount1) {
  const agcAddress = AGC_TOKEN_ADDRESS.toLowerCase();
  const currency0 =
    typeof poolKey?.currency0 === "string"
      ? poolKey.currency0.toLowerCase()
      : typeof poolKey?.[0] === "string"
        ? poolKey[0].toLowerCase()
        : null;
  const currency1 =
    typeof poolKey?.currency1 === "string"
      ? poolKey.currency1.toLowerCase()
      : typeof poolKey?.[1] === "string"
        ? poolKey[1].toLowerCase()
        : null;
  let requiredAgc = 0n;

  if (currency0 === agcAddress) {
    requiredAgc += BigInt(amount0 ?? 0n);
  }
  if (currency1 === agcAddress) {
    requiredAgc += BigInt(amount1 ?? 0n);
  }

  return requiredAgc;
}

function poolKeyIncludesAgc(poolKey) {
  const agcAddress = AGC_TOKEN_ADDRESS.toLowerCase();
  const currency0 =
    typeof poolKey?.currency0 === "string"
      ? poolKey.currency0.toLowerCase()
      : typeof poolKey?.[0] === "string"
        ? poolKey[0].toLowerCase()
        : null;
  const currency1 =
    typeof poolKey?.currency1 === "string"
      ? poolKey.currency1.toLowerCase()
      : typeof poolKey?.[1] === "string"
        ? poolKey[1].toLowerCase()
        : null;
  return (
    currency0 === agcAddress ||
    currency1 === agcAddress
  );
}

function getAgcAmountFromDirectionalAmount(poolKey, useCurrency1, amount) {
  const currency = useCurrency1
    ? typeof poolKey?.currency1 === "string"
      ? poolKey.currency1
      : poolKey?.[1]
    : typeof poolKey?.currency0 === "string"
      ? poolKey.currency0
      : poolKey?.[0];
  return typeof currency === "string" && currency.toLowerCase() === AGC_TOKEN_ADDRESS.toLowerCase()
    ? BigInt(amount ?? 0n)
    : 0n;
}

function getAgcAmountFromPairSwapInput(poolKey, zeroForOne, amountIn) {
  return getAgcAmountFromDirectionalAmount(poolKey, !zeroForOne, amountIn);
}

async function getOperationRequiredAgc(calls) {
  const callList = Array.isArray(calls) ? calls : [calls];
  let requiredAgc = 0n;

  for (const call of callList) {
    if (!call || typeof call !== "object" || typeof call.to !== "string" || typeof call.data !== "string") continue;

    const target = call.to.toLowerCase();

    if (target === LIKWID_PAIR_POSITION.toLowerCase()) {
      let decoded;
      try {
        decoded = decodeFunctionData({ abi: LIKWID_PAIR_ABI, data: call.data });
      } catch {
        continue;
      }

      if (decoded.functionName === "exactInput" && decoded.args?.[0]) {
        const params = decoded.args[0];
        const poolKey = await getPoolKey(params.poolId);
        requiredAgc += getAgcAmountFromPairSwapInput(poolKey, params.zeroForOne, params.amountIn);
      } else if (decoded.functionName === "exactOutput" && decoded.args?.[0]) {
        const params = decoded.args[0];
        const poolKey = await getPoolKey(params.poolId);
        requiredAgc += getAgcAmountFromPairSwapInput(poolKey, params.zeroForOne, params.amountInMax);
      } else if (decoded.functionName === "addLiquidity" && decoded.args?.[0]) {
        requiredAgc += getAgcAmountFromPairLiquidity(decoded.args[0], decoded.args[2], decoded.args[3]);
      } else if (decoded.functionName === "increaseLiquidity" && decoded.args?.[0] !== undefined) {
        const poolKey = await getPoolKeyByTokenId(LIKWID_PAIR_POSITION, LIKWID_PAIR_ABI, decoded.args[0]);
        requiredAgc += getAgcAmountFromPairLiquidity(poolKey, decoded.args[1], decoded.args[2]);
      } else if (decoded.functionName === "donate" && decoded.args?.[0]) {
        const poolKey = await getPoolKey(decoded.args[0]);
        requiredAgc += getAgcAmountFromPairLiquidity(poolKey, decoded.args[1], decoded.args[2]);
      }
      continue;
    }

    if (target === LIKWID_MARGIN_POSITION.toLowerCase()) {
      let decoded;
      try {
        decoded = decodeFunctionData({ abi: LIKWID_MARGIN_ABI, data: call.data });
      } catch {
        continue;
      }

      if (decoded.functionName === "addMargin" && decoded.args?.[0] && decoded.args?.[1]) {
        requiredAgc += getAgcAmountFromDirectionalAmount(
          decoded.args[0],
          decoded.args[1].marginForOne,
          decoded.args[1].marginAmount,
        );
      } else if (decoded.functionName === "margin" && decoded.args?.[0]) {
        const params = decoded.args[0];
        let position;
        try {
          position = await publicClient.readContract({
            address: LIKWID_MARGIN_POSITION,
            abi: LIKWID_MARGIN_ABI,
            functionName: "getPositionState",
            args: [params.tokenId],
          });
        } catch (error) {
          throw new Error(
            `Failed to read margin position state(${params.tokenId.toString()}) from ${LIKWID_MARGIN_POSITION}: ${getNormalizedErrorMessage(error)}`,
          );
        }
        const poolKey = await getPoolKeyByTokenId(LIKWID_MARGIN_POSITION, LIKWID_MARGIN_ABI, params.tokenId);
        if (!poolKeyIncludesAgc(poolKey)) {
          continue;
        }
        requiredAgc += getAgcAmountFromDirectionalAmount(poolKey, position.marginForOne, params.marginAmount);
      }
      continue;
    }

    if (target === LIKWID_LEND_POSITION.toLowerCase()) {
      let decoded;
      try {
        decoded = decodeFunctionData({ abi: LIKWID_LEND_ABI, data: call.data });
      } catch {
        continue;
      }

      if (decoded.functionName === "addLending" && decoded.args?.[0]) {
        requiredAgc += getAgcAmountFromDirectionalAmount(decoded.args[0], decoded.args[1], decoded.args[3]);
      } else if (decoded.functionName === "deposit" && decoded.args?.[0] !== undefined) {
        const tokenId = decoded.args[0];
        let lendForOne;
        try {
          lendForOne = await publicClient.readContract({
            address: LIKWID_LEND_POSITION,
            abi: LIKWID_LEND_ABI,
            functionName: "lendDirections",
            args: [tokenId],
          });
        } catch (error) {
          throw new Error(
            `Failed to read lendDirections(${tokenId.toString()}) from ${LIKWID_LEND_POSITION}: ${getNormalizedErrorMessage(error)}`,
          );
        }
        const poolKey = await getPoolKeyByTokenId(LIKWID_LEND_POSITION, LIKWID_LEND_ABI, tokenId);
        if (!poolKeyIncludesAgc(poolKey)) {
          continue;
        }
        requiredAgc += getAgcAmountFromDirectionalAmount(poolKey, lendForOne, decoded.args[1]);
      } else if ((decoded.functionName === "exactInput" || decoded.functionName === "exactOutput") && decoded.args?.[0]) {
        const params = decoded.args[0];
        const poolKey = await getPoolKeyByTokenId(LIKWID_LEND_POSITION, LIKWID_LEND_ABI, params.tokenId);
        if (!poolKeyIncludesAgc(poolKey)) {
          continue;
        }
        requiredAgc += getAgcAmountFromPairSwapInput(
          poolKey,
          params.zeroForOne,
          decoded.functionName === "exactInput" ? params.amountIn : params.amountInMax,
        );
      }
    }
  }

  return requiredAgc;
}

function getOperationRequiredEth(calls) {
  const callList = Array.isArray(calls) ? calls : [calls];
  return callList.reduce((sum, call) => sum + BigInt(call?.value ?? 0n), 0n);
}

function formatTokenAmount(value) {
  return (Number(value) / 1e18).toFixed(6);
}

function parseCliErrorFields(message) {
  return Object.fromEntries(
    message
      .split("|")
      .slice(1)
      .map((entry) => {
        const [key, value] = entry.split("=");
        return [key, value];
      }),
  );
}

async function getAgcQuoteFromReserves(requiredEthPrefund) {
  const state = await publicClient.readContract({
    address: LIKWID_HELPER_ADDRESS,
    abi: LIKWID_HELPER_ABI,
    functionName: "getPoolStateInfo",
    args: [POOL_ID],
  });

  const reserveEth = BigInt(state.pairReserve0);
  const reserveAgc = BigInt(state.pairReserve1);
  if (reserveEth === 0n || reserveAgc === 0n) return 0n;

  return (requiredEthPrefund * reserveAgc * 120n) / (reserveEth * 100n);
}

async function getAgcQuoteFromSpot(requiredEthPrefund) {
  const oneEth = 10n ** 18n;
  const res = await publicClient.readContract({
    address: LIKWID_HELPER_ADDRESS,
    abi: LIKWID_HELPER_ABI,
    functionName: "getAmountOut",
    args: [POOL_ID, true, oneEth, true],
  });
  const agcPerEth = BigInt(res[0]);
  if (agcPerEth === 0n) return 0n;

  return (requiredEthPrefund * agcPerEth * 120n) / (oneEth * 100n);
}

function maxBigInt(...values) {
  return values.reduce((max, value) => (value > max ? value : max), 0n);
}

function sanitizeCliField(value) {
  return String(value).replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

function getNormalizedErrorMessage(error) {
  return [
    error?.message,
    error?.cause?.message,
    typeof error?.extraData === "string" ? error.extraData : null,
    error?.details,
    typeof error?.shortMessage === "string" ? error.shortMessage : null,
  ]
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();
}

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

// ======================= .env LOADER =======================

function loadEnvConfig() {
  let MODEL_TYPE = process.env.MODEL_TYPE || null;
  let MODEL_KEY = process.env.MODEL_KEY || null;
  try {
    const envPath = path.join(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      const envConfig = Object.fromEntries(
        fs
          .readFileSync(envPath, "utf8")
          .split("\n")
          .map((line) => line.match(/^\s*([^=]+?)\s*=(.*)$/))
          .filter(Boolean)
          .map(([, key, val]) => [key, val.trim().replace(/^"|"$/g, "")]),
      );
      MODEL_TYPE = MODEL_TYPE || envConfig.MODEL_TYPE || null;
      MODEL_KEY = MODEL_KEY || envConfig.MODEL_KEY || null;
    }
  } catch (e) {
    // ignore
  }
  return { MODEL_TYPE, MODEL_KEY };
}

// ======================= EXPORTS =======================
module.exports = {
  // Config
  NETWORK_NAME,
  CHAIN_ID,
  VERIFIER_URL,
  RPC_URL,
  BUNDLER_URL,
  WALLET_FILE,
  NATIVE_TOKEN_ADDRESS,
  AGC_TOKEN_ADDRESS,
  AGENT_PAYMASTER_ADDRESS,
  ENTRY_POINT_ADDRESS,
  SMART_ACCOUNT_FACTORY_ADDRESS,
  LIKWID_HELPER_ADDRESS,
  LIKWID_PAIR_POSITION,
  LIKWID_MARGIN_POSITION,
  LIKWID_LEND_POSITION,
  POOL_KEY,
  POOL_ID,
  // Multi-chain
  CHAIN_REGISTRY,
  getChainContext,
  resolveToken,
  resolvePool,
  getTokenSymbol,
  computePoolId,
  loadCustomTokens,
  saveCustomToken,
  runUserOpMultiChain,
  // ABIs
  ERC20_ABI,
  LIKWID_PAIR_ABI,
  LIKWID_MARGIN_ABI,
  LIKWID_LEND_ABI,
  LIKWID_HELPER_ABI,
  // Clients
  publicClient,
  bundlerClient,
  // Wallet & Account
  getWalletInstance,
  getSmartAccount,
  // UserOp (legacy for genesis.js)
  runUserOp,
  // Helpers
  getApprovalCall,
  formatError,
  formatHumanSeconds,
  loadEnvConfig,
  // Re-export viem utilities used by consumers
  parseEther,
  encodeFunctionData,
  parseAbi,
  keccak256,
  encodeAbiParameters,
  generatePrivateKey,
  privateKeyToAccount,
  fs,
  path,
};
