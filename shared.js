/**
 * shared.js — Shared infrastructure for Agent Genesis skill modules.
 *
 * Provides: viem clients, wallet management, ERC-4337 smart account helpers,
 * UserOperation execution, approval helpers, and common constants/ABIs.
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
const { sepolia } = require("viem/chains");
const { privateKeyToAccount, generatePrivateKey } = require("viem/accounts");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ======================= CONFIGURATION =======================
// Network identity — derived from chain config. Update these when switching networks.
const CHAIN = sepolia;
const NETWORK_NAME = CHAIN.name; // e.g. "Sepolia", "Base", "Base Sepolia"
const CHAIN_ID = CHAIN.id; // e.g. 11155111, 8453, 84532

const VERIFIER_URL = "https://verifier.likwid.fi";
const RPC_URL = process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const BUNDLER_URL = process.env.BUNDLER_URL || "https://bundler.particle.network";

const WALLET_FILE = path.join(os.homedir(), ".openclaw", ".likwid_genesis_wallet.json");
const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";

const AGC_TOKEN_ADDRESS = process.env.AGC_TOKEN_ADDRESS || "0x83738CCFcd130714ceE2c8805122b820F2Ac3a2F";
const AGENT_PAYMASTER_ADDRESS = process.env.AGENT_PAYMASTER_ADDRESS || "0xf624E3E553DF10313Bd3a297423ECB07FB52e6f3";

// ERC-4337 Infrastructure
const ENTRY_POINT_ADDRESS = ENTRYPOINT_ADDRESS_V06; // EntryPoint v0.6
const SMART_ACCOUNT_FACTORY_ADDRESS = "0x9406Cc6185a346906296840746125a0E44976454";

// Likwid DeFi Constants
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

// ======================= CLIENTS =======================
const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL),
});

// ======================= BUNDLER =======================

let bundlerRequestId = 0;

function serializeRpcValue(value) {
  if (typeof value === "bigint") return toHex(value);
  if (Array.isArray(value)) return value.map(serializeRpcValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, serializeRpcValue(nested)]));
  }
  return value;
}

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

async function getSmartAccount(signer) {
  return await signerToSimpleSmartAccount(publicClient, {
    entryPoint: ENTRY_POINT_ADDRESS,
    signer: signer,
    factoryAddress: SMART_ACCOUNT_FACTORY_ADDRESS,
  });
}

// ======================= USER OPERATION =======================

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
      // If this read fails, stay conservative and avoid labeling the op as free.
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

        // Try with AGC paymaster first (handles both AGC gas payment and free mine)
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
          console.log(`> ⚠️  Paymaster estimation/attachment failed: ${paymasterErrorMessage.slice(0, 160)}`);
          throw paymasterError;
        }
      },
    },
  });

  // Unwrap single-element arrays so encodeCallData uses execute() instead of executeBatch().
  // executeBatch() on SimpleAccount v0.6 does NOT support msg.value per call,
  // so any call with a non-zero value (e.g. Short AGC sending ETH) must go through execute().
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
        `> ⚠️  Direct ETH gas estimation failed: ${getNormalizedErrorMessage(ethEstimateError).slice(0, 160)}`,
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
    console.log(`\n> ✅ ${description} Successful!${gasNote} Tx Hash: ${receipt.receipt.transactionHash}`);
    return receipt;
  } catch (e) {
    const errMsg = e.message || String(e);
    if (errMsg.startsWith("CLI_INSUFFICIENT_OPERATION_AGC|")) {
      const fields = parseCliErrorFields(errMsg);
      console.log(`> ❌ ${description} aborted.`);
      console.log(`> AGC for operation is insufficient.`);
      console.log(`> Required:  ${fields.required} AGC`);
      console.log(`> Available: ${fields.available} AGC`);
      console.log(`> Operation shortfall: ${fields.op_shortfall} AGC`);
      return null;
    }
    if (errMsg.startsWith("CLI_PAYMASTER_ESTIMATE_FAILED|")) {
      const fields = parseCliErrorFields(errMsg);
      console.log(`> ❌ ${description} aborted.`);
      console.log(`> Paymaster estimate failed.`);
      console.log(`> This transaction cannot proceed with AGC gas sponsorship right now.`);
      console.log(`> Detail: ${fields.reason}`);
      return null;
    }
    if (errMsg.startsWith("CLI_INSUFFICIENT_TOTAL_AGC|")) {
      const fields = parseCliErrorFields(errMsg);
      console.log(`> ❌ ${description} aborted.`);
      console.log(`> AGC is insufficient for operation + paymaster precharge.`);
      console.log(`> Operation: ${fields.operation} AGC`);
      console.log(`> Precharge: ${fields.precharge} AGC`);
      console.log(`> Required:  ${fields.required} AGC`);
      console.log(`> Available: ${fields.available} AGC`);
      console.log(`> Shortfall: ${fields.shortfall} AGC`);
      return null;
    }
    if (errMsg.startsWith("CLI_USEROP_REVERTED|")) {
      const fields = parseCliErrorFields(errMsg);
      console.log(`> ❌ ${description} reverted onchain.`);
      console.log(`> Tx Hash: ${fields.tx_hash}`);
      console.log(`> Reason: ${fields.reason}`);
      console.log(`> Gas Used: ${fields.gas_used}`);
      console.log(`> Gas Cost: ${fields.gas_cost_eth} ETH`);
      return null;
    }
    // Detect gas estimation / contract revert errors and provide user-friendly output
    if (errMsg.includes("EstimateGas") || errMsg.includes("execution reverted") || errMsg.includes("AA")) {
      console.log(`> ❌ ${description} failed during gas estimation or execution.`);
      console.log(`>`);
      console.log(`> Possible causes:`);
      console.log(`>   1. Collateral amount too small (try a larger amount)`);
      console.log(`>   2. Insufficient token balance or allowance`);
      console.log(`>   3. Insufficient AGC for paymaster AND insufficient ETH for direct gas payment`);
      console.log(`>   4. Contract rejected the operation (invalid params or pool state)`);
      console.log(`>`);
      console.log(`> Technical detail: ${errMsg.slice(0, 200)}`);
    } else {
      console.error(`> ${description} execution failed:`, e.stack || errMsg);
    }
    return null;
  }
}

// ======================= HELPERS =======================

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
  // UserOp
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
  generatePrivateKey,
  privateKeyToAccount,
  fs,
  path,
};
