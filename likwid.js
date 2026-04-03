/**
 * likwid.js — Likwid Protocol Universal DeFi Engine.
 *
 * Multi-chain, multi-pair DeFi operations: swap, liquidity, margin, lending,
 * liquidation, and position management.
 *
 * All operations interact with the Likwid Protocol via ERC-4337 UserOperations.
 * --chain and --pair are REQUIRED for every DeFi command (no defaults).
 */

const {
  // Multi-chain
  CHAIN_REGISTRY,
  getChainContext,
  resolveToken,
  resolvePool,
  getTokenSymbol,
  computePoolId,
  saveCustomToken,
  runUserOpMultiChain,
  NATIVE_TOKEN_ADDRESS,
  WALLET_FILE,
  // ABIs
  ERC20_ABI,
  LIKWID_PAIR_ABI,
  LIKWID_MARGIN_ABI,
  LIKWID_LEND_ABI,
  LIKWID_HELPER_ABI,
  // Wallet & Account
  getWalletInstance,
  getSmartAccount,
  // Helpers
  getApprovalCall,
  formatError,
  // viem utilities
  parseEther,
  encodeFunctionData,
  generatePrivateKey,
  privateKeyToAccount,
  fs,
  path,
} = require("./shared");

// ======================= CLI ARGUMENT PARSING =======================

/**
 * Extract --chain and --pair from args, return { chain, pair, rest }.
 * Both are REQUIRED for DeFi commands (except add_token which only needs --chain).
 */
function parseGlobalArgs(args) {
  let chain = null;
  let pair = null;
  const rest = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--chain" && i + 1 < args.length) {
      chain = args[++i];
    } else if (args[i] === "--pair" && i + 1 < args.length) {
      pair = args[++i];
    } else {
      rest.push(args[i]);
    }
  }

  return { chain, pair, rest };
}

/**
 * Determine if a token address is the native token (ETH/BNB/etc).
 */
function isNativeToken(address) {
  return address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
}

// ======================= DEFI ACTIONS =======================

async function swap_command(chainCtx, pool, direction, amountStr, slippageStr = "1") {
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await chainCtx.getSmartAccount(signer);

  // Parse direction: "0-1", "1-0", or symbol-based (e.g., "eth-usdc")
  let zeroForOne;
  if (direction === "0-1") {
    zeroForOne = true;
  } else if (direction === "1-0") {
    zeroForOne = false;
  } else {
    // Symbol-based direction: detect which token matches which side
    const parts = direction.split("-");
    if (parts.length === 2) {
      const fromSym = parts[0].toUpperCase();
      const toSym = parts[1].toUpperCase();
      if (fromSym === pool.token0Symbol.toUpperCase()) {
        zeroForOne = true;
      } else if (fromSym === pool.token1Symbol.toUpperCase()) {
        zeroForOne = false;
      } else {
        return formatError(
          `Cannot match direction "${direction}" to pool ${pool.token0Symbol}/${pool.token1Symbol}. Use 0-1, 1-0, or <from>-<to> with matching symbols.`,
        );
      }
    } else {
      return formatError(`Invalid direction: "${direction}". Use 0-1, 1-0, or <from>-<to>.`);
    }
  }

  const amountIn = parseEther(amountStr || "0");
  const slippage = BigInt(slippageStr);

  const fromToken = zeroForOne ? pool.token0Symbol : pool.token1Symbol;
  const toToken = zeroForOne ? pool.token1Symbol : pool.token0Symbol;
  const fromAddress = zeroForOne ? pool.currency0 : pool.currency1;
  const fromIsNative = isNativeToken(fromAddress);

  console.log(`> [${chainCtx.name}] Swap: ${amountStr} ${fromToken} -> ${toToken}`);
  let amountOut;
  try {
    const res = await chainCtx.publicClient.readContract({
      address: chainCtx.contracts.LikwidHelper,
      abi: LIKWID_HELPER_ABI,
      functionName: "getAmountOut",
      args: [pool.poolId, zeroForOne, amountIn, true],
    });
    amountOut = res[0];
  } catch (e) {
    return formatError(`Simulation failed: ${e.message || e}`);
  }

  console.log(`> Simulated output: ~${(Number(amountOut) / 1e18).toFixed(6)} ${toToken} (${slippageStr}% slippage)`);

  const amountOutMin = (amountOut * (100n - slippage)) / 100n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  const swapCalls = [];
  let description = "";

  if (!fromIsNative) {
    // Approve the token being spent
    const approval = await getApprovalCall(
      account.address,
      fromAddress,
      chainCtx.contracts.LikwidPairPosition,
      amountIn,
      chainCtx.publicClient,
    );
    if (approval) {
      console.log(`> Approving ${fromToken} for Swap...`);
      description += `Approve ${fromToken} + `;
      swapCalls.push(approval);
    }
  }

  // Paymaster approval (AGC chains only)
  if (chainCtx.hasAgc) {
    const pmApproval = await getApprovalCall(
      account.address,
      chainCtx.agc.token,
      chainCtx.agc.paymaster,
      parseEther("1000000"),
      chainCtx.publicClient,
    );
    if (pmApproval) {
      console.log(`> Approving AGC for Paymaster sponsorship...`);
      description += "Approve AGC Paymaster + ";
      swapCalls.push(pmApproval);
    }
  }

  const swapCall = {
    to: chainCtx.contracts.LikwidPairPosition,
    value: fromIsNative ? amountIn : 0n,
    data: encodeFunctionData({
      abi: LIKWID_PAIR_ABI,
      functionName: "exactInput",
      args: [
        {
          poolId: pool.poolId,
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
  description += `Swap ${fromToken}->${toToken}`;
  await runUserOpMultiChain(chainCtx, account, swapCalls, description);
}

async function lp_add(chainCtx, pool, amount0Str, slippageStr = "1") {
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await chainCtx.getSmartAccount(signer);

  const amount0 = parseEther(amount0Str || "0");
  const slippage = BigInt(slippageStr);
  const token0IsNative = isNativeToken(pool.currency0);
  const token1IsNative = isNativeToken(pool.currency1);

  console.log(`> [${chainCtx.name}] Adding Liquidity: ${amount0Str} ${pool.token0Symbol} + matching ${pool.token1Symbol}`);
  const stateInfo = await chainCtx.publicClient.readContract({
    address: chainCtx.contracts.LikwidHelper,
    abi: LIKWID_HELPER_ABI,
    functionName: "getPoolStateInfo",
    args: [pool.poolId],
  });

  const reserve0 = stateInfo.pairReserve0;
  const reserve1 = stateInfo.pairReserve1;
  let amount1 = 0n;
  if (reserve0 > 0n) {
    amount1 = (amount0 * BigInt(reserve1)) / BigInt(reserve0);
  } else {
    amount1 = amount0;
  }

  console.log(`> Required ${pool.token1Symbol}: ~${(Number(amount1) / 1e18).toFixed(6)}`);

  const amount0Min = (amount0 * (100n - slippage)) / 100n;
  const amount1Min = (amount1 * (100n - slippage)) / 100n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  const lpCalls = [];
  let description = "";

  // Approve token0 if not native
  if (!token0IsNative) {
    const approval = await getApprovalCall(
      account.address,
      pool.currency0,
      chainCtx.contracts.LikwidPairPosition,
      amount0,
      chainCtx.publicClient,
    );
    if (approval) {
      console.log(`> Approving ${pool.token0Symbol} for LP...`);
      lpCalls.push(approval);
      description += `Approve ${pool.token0Symbol} + `;
    }
  }

  // Approve token1 if not native
  if (!token1IsNative) {
    const approval = await getApprovalCall(
      account.address,
      pool.currency1,
      chainCtx.contracts.LikwidPairPosition,
      amount1,
      chainCtx.publicClient,
    );
    if (approval) {
      console.log(`> Approving ${pool.token1Symbol} for LP...`);
      lpCalls.push(approval);
      description += `Approve ${pool.token1Symbol} + `;
    }
  }

  // Paymaster approval (AGC chains only)
  if (chainCtx.hasAgc) {
    const pmApproval = await getApprovalCall(
      account.address,
      chainCtx.agc.token,
      chainCtx.agc.paymaster,
      parseEther("1000000"),
      chainCtx.publicClient,
    );
    if (pmApproval) {
      console.log(`> Approving AGC for Paymaster sponsorship...`);
      lpCalls.push(pmApproval);
      description += "Approve AGC Paymaster + ";
    }
  }

  // Determine ETH value: whichever side is native
  let ethValue = 0n;
  if (token0IsNative) ethValue = amount0;
  else if (token1IsNative) ethValue = amount1;

  const lpCall = {
    to: chainCtx.contracts.LikwidPairPosition,
    value: ethValue,
    data: encodeFunctionData({
      abi: LIKWID_PAIR_ABI,
      functionName: "addLiquidity",
      args: [pool.poolKey, account.address, amount0, amount1, amount0Min, amount1Min, deadline],
    }),
  };
  lpCalls.push(lpCall);
  description += `Add LP ${pool.token0Symbol}/${pool.token1Symbol}`;

  await runUserOpMultiChain(chainCtx, account, lpCalls, description);
}

/**
 * Parse human-friendly margin direction into protocol parameters.
 *
 * Generic directions:
 *   long  / long-<token1>  → marginForOne=true,  collateral=token1
 *   short / short-<token1> → marginForOne=false,  collateral=token0
 *
 * Returns { marginForOne, collateralSymbol, collateralAddress, tradeLabel } or null.
 */
function parseMarginDirection(raw, pool) {
  if (!raw) return null;
  const d = raw.toLowerCase().replace(/[\s_]/g, "-");
  const t0 = pool.token0Symbol.toLowerCase();
  const t1 = pool.token1Symbol.toLowerCase();

  // long = bullish on token1, collateral is token1 (marginForOne=true)
  const longPatterns = ["long", `long-${t1}`, t1];
  // short = bearish on token1, collateral is token0 (marginForOne=false)
  const shortPatterns = ["short", `short-${t1}`, t0, `long-${t0}`];

  if (longPatterns.includes(d)) {
    return {
      marginForOne: true,
      collateralSymbol: pool.token1Symbol,
      collateralAddress: pool.currency1,
      tradeLabel: `Long ${pool.token1Symbol}`,
    };
  }
  if (shortPatterns.includes(d)) {
    return {
      marginForOne: false,
      collateralSymbol: pool.token0Symbol,
      collateralAddress: pool.currency0,
      tradeLabel: `Short ${pool.token1Symbol}`,
    };
  }
  return null;
}

async function margin_open(chainCtx, pool, direction, amountStr, leverageStr = "2") {
  const parsed = parseMarginDirection(direction, pool);
  if (!parsed) {
    console.log(`> Invalid direction: "${direction}"`);
    console.log(`>`);
    console.log(`> Usage: margin_open <direction> <amount> [leverage] --chain <chain> --pair <pair>`);
    console.log(`>`);
    console.log(`> Pool: ${pool.token0Symbol}/${pool.token1Symbol}`);
    console.log(`> Directions:`);
    console.log(`>   long  / long-${pool.token1Symbol.toLowerCase()} / ${pool.token1Symbol.toLowerCase()}  -> Long ${pool.token1Symbol} (collateral: ${pool.token1Symbol})`);
    console.log(`>   short / short-${pool.token1Symbol.toLowerCase()} / ${pool.token0Symbol.toLowerCase()} -> Short ${pool.token1Symbol} (collateral: ${pool.token0Symbol})`);
    return;
  }

  const { marginForOne, collateralSymbol, collateralAddress, tradeLabel } = parsed;
  const collateralIsNative = isNativeToken(collateralAddress);

  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await chainCtx.getSmartAccount(signer);

  if (!amountStr || amountStr === "0") {
    return formatError("Amount must be greater than 0.");
  }
  const marginAmount = parseEther(amountStr);
  const leverage = parseInt(leverageStr || "2");

  // Balance pre-check
  let balance;
  if (collateralIsNative) {
    balance = await chainCtx.publicClient.getBalance({ address: account.address });
  } else {
    balance = await chainCtx.publicClient.readContract({
      address: collateralAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    });
  }

  const balanceFormatted = (Number(balance) / 1e18).toFixed(6);

  if (balance < marginAmount) {
    console.log(`> Insufficient ${collateralSymbol} balance!`);
    console.log(`>`);
    console.log(`> ${tradeLabel}`);
    console.log(`> Required collateral: ${amountStr} ${collateralSymbol}`);
    console.log(`> Available balance:   ${balanceFormatted} ${collateralSymbol}`);
    console.log(`> Shortfall:           ${((Number(marginAmount) - Number(balance)) / 1e18).toFixed(6)} ${collateralSymbol}`);
    console.log(`>`);
    console.log(`> Network: ${chainCtx.chain.name} (Chain ID ${chainCtx.chainId})`);
    console.log(`> Send ${collateralSymbol} to your Smart Account, or try a smaller amount.`);
    return;
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  console.log(`> [${chainCtx.name}] Opening Margin Position`);
  console.log(`>    Direction:  ${tradeLabel}`);
  console.log(`>    Collateral: ${amountStr} ${collateralSymbol}`);
  console.log(`>    Leverage:   ${leverage}x`);
  console.log(`>    Balance:    ${balanceFormatted} ${collateralSymbol}`);

  // Collect approval calls (zero-value)
  const approvalCalls = [];

  if (!collateralIsNative) {
    const approval = await getApprovalCall(
      account.address,
      collateralAddress,
      chainCtx.contracts.LikwidMarginPosition,
      marginAmount,
      chainCtx.publicClient,
    );
    if (approval) {
      console.log(`> Approving ${collateralSymbol} for Margin...`);
      approvalCalls.push(approval);
    }
  }

  // Paymaster approval (AGC chains only)
  if (chainCtx.hasAgc) {
    const pmApproval = await getApprovalCall(
      account.address,
      chainCtx.agc.token,
      chainCtx.agc.paymaster,
      parseEther("1000000"),
      chainCtx.publicClient,
    );
    if (pmApproval) {
      console.log(`> Approving AGC for Paymaster sponsorship...`);
      approvalCalls.push(pmApproval);
    }
  }

  const marginCall = {
    to: chainCtx.contracts.LikwidMarginPosition,
    value: collateralIsNative ? marginAmount : 0n,
    data: encodeFunctionData({
      abi: LIKWID_MARGIN_ABI,
      functionName: "addMargin",
      args: [
        pool.poolKey,
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

  if (!collateralIsNative) {
    // All calls are zero-value, safe to batch
    const allCalls = [...approvalCalls, marginCall];
    await runUserOpMultiChain(chainCtx, account, allCalls, `Open Margin ${tradeLabel} ${leverage}x`);
  } else {
    // Native token collateral: marginCall carries value — must use execute() (single call).
    // SimpleAccount v0.6 executeBatch() does NOT forward msg.value per call.
    if (approvalCalls.length > 0) {
      const approvalResult = await runUserOpMultiChain(chainCtx, account, approvalCalls, `Approve for ${tradeLabel}`);
      if (!approvalResult) {
        console.log(`> Approval step failed. Aborting margin open.`);
        return;
      }
    }
    await runUserOpMultiChain(chainCtx, account, [marginCall], `Open Margin ${tradeLabel} ${leverage}x`);
  }
}

async function lend_open(chainCtx, pool, side, amountStr) {
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await chainCtx.getSmartAccount(signer);

  // side: "0" or token0 symbol -> lendForOne=false (lend token0)
  //        "1" or token1 symbol -> lendForOne=true (lend token1)
  let lendForOne;
  let assetSymbol;
  let assetAddress;
  const s = (side || "").toLowerCase();
  if (s === "0" || s === pool.token0Symbol.toLowerCase()) {
    lendForOne = false;
    assetSymbol = pool.token0Symbol;
    assetAddress = pool.currency0;
  } else if (s === "1" || s === pool.token1Symbol.toLowerCase()) {
    lendForOne = true;
    assetSymbol = pool.token1Symbol;
    assetAddress = pool.currency1;
  } else {
    return formatError(
      `Invalid lend side: "${side}". Use "0"/${pool.token0Symbol} or "1"/${pool.token1Symbol}.`,
    );
  }

  const assetIsNative = isNativeToken(assetAddress);
  const amount = parseEther(amountStr || "0");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  console.log(`> [${chainCtx.name}] Lending: ${amountStr} ${assetSymbol}`);

  const lendCalls = [];
  let description = "";

  if (!assetIsNative) {
    const approval = await getApprovalCall(
      account.address,
      assetAddress,
      chainCtx.contracts.LikwidLendPosition,
      amount,
      chainCtx.publicClient,
    );
    if (approval) {
      console.log(`> Approving ${assetSymbol} for Lend...`);
      lendCalls.push(approval);
      description += `Approve ${assetSymbol} + `;
    }
  }

  if (chainCtx.hasAgc) {
    const pmApproval = await getApprovalCall(
      account.address,
      chainCtx.agc.token,
      chainCtx.agc.paymaster,
      parseEther("1000000"),
      chainCtx.publicClient,
    );
    if (pmApproval) {
      console.log(`> Approving AGC for Paymaster sponsorship...`);
      lendCalls.push(pmApproval);
      description += "Approve AGC Paymaster + ";
    }
  }

  const lendCall = {
    to: chainCtx.contracts.LikwidLendPosition,
    value: assetIsNative ? amount : 0n,
    data: encodeFunctionData({
      abi: LIKWID_LEND_ABI,
      functionName: "addLending",
      args: [pool.poolKey, lendForOne, account.address, amount, deadline],
    }),
  };
  lendCalls.push(lendCall);
  description += `Lend ${assetSymbol}`;

  await runUserOpMultiChain(chainCtx, account, lendCalls, description);
}

async function liquidate_position(chainCtx, tokenIdStr) {
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await chainCtx.getSmartAccount(signer);

  const tokenId = BigInt(tokenIdStr || "0");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  console.log(`> [${chainCtx.name}] Liquidating Position #${tokenIdStr}...`);

  const liquidateCall = {
    to: chainCtx.contracts.LikwidMarginPosition,
    value: 0n,
    data: encodeFunctionData({
      abi: LIKWID_MARGIN_ABI,
      functionName: "liquidateBurn",
      args: [tokenId, deadline],
    }),
  };

  await runUserOpMultiChain(chainCtx, account, [liquidateCall], `Liquidate Position #${tokenIdStr}`);
}

async function scan_liquidations(chainCtx, scanWindowStr = "100") {
  const scanWindow = parseInt(scanWindowStr);
  console.log(`> [${chainCtx.name}] Scanning positions (last ${scanWindow})...`);

  let nextId;
  try {
    nextId = await chainCtx.publicClient.readContract({
      address: chainCtx.contracts.LikwidMarginPosition,
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
      const isLiquidatable = await chainCtx.publicClient.readContract({
        address: chainCtx.contracts.LikwidHelper,
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

async function scanUserPositions(client, contractAddress, abi, ownerAddress, scanWindow = 200) {
  let nextId;
  try {
    nextId = await client.readContract({
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
      const owner = await client.readContract({
        address: contractAddress,
        abi,
        functionName: "ownerOf",
        args: [BigInt(id)],
      });
      if (owner.toLowerCase() === ownerAddress.toLowerCase()) {
        const state = await client.readContract({
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

async function positions(chainCtx) {
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found. Run create_wallet first.");
  const account = await chainCtx.getSmartAccount(signer);
  const addr = account.address;
  const pc = chainCtx.publicClient;

  console.log(`> [${chainCtx.name}] Scanning Positions for ${addr}...`);

  const [marginPositions, lpPositions, lendPositions] = await Promise.all([
    scanUserPositions(pc, chainCtx.contracts.LikwidMarginPosition, LIKWID_MARGIN_ABI, addr),
    scanUserPositions(pc, chainCtx.contracts.LikwidPairPosition, LIKWID_PAIR_ABI, addr),
    scanUserPositions(pc, chainCtx.contracts.LikwidLendPosition, LIKWID_LEND_ABI, addr),
  ]);

  console.log(`>`);
  console.log(`> Margin Positions: ${marginPositions.length}`);
  for (const p of marginPositions) {
    // Resolve pool symbols for this position
    let dirLabel = p.marginForOne ? "Long token1" : "Short token1";
    try {
      const poolId = await pc.readContract({
        address: chainCtx.contracts.LikwidMarginPosition,
        abi: LIKWID_MARGIN_ABI,
        functionName: "poolIds",
        args: [BigInt(p.id)],
      });
      const poolKey = await pc.readContract({
        address: chainCtx.contracts.LikwidMarginPosition,
        abi: LIKWID_MARGIN_ABI,
        functionName: "poolKeys",
        args: [poolId],
      });
      const sym1 = getTokenSymbol(chainCtx, typeof poolKey.currency1 === "string" ? poolKey.currency1 : poolKey[1]);
      dirLabel = p.marginForOne ? `Long ${sym1}` : `Short ${sym1}`;
    } catch {}
    console.log(
      `>   #${p.id} | ${dirLabel} | Margin: ${(Number(p.marginAmount) / 1e18).toFixed(6)} | Total: ${(Number(p.marginTotal) / 1e18).toFixed(6)} | Debt: ${(Number(p.debtAmount) / 1e18).toFixed(6)}`,
    );
  }

  console.log(`>`);
  console.log(`> LP Positions: ${lpPositions.length}`);
  for (const p of lpPositions) {
    console.log(
      `>   #${p.id} | Liquidity: ${(Number(p.liquidity) / 1e18).toFixed(6)} | Investment: ${(Number(p.totalInvestment) / 1e18).toFixed(6)}`,
    );
  }

  console.log(`>`);
  console.log(`> Lend Positions: ${lendPositions.length}`);
  for (const p of lendPositions) {
    console.log(`>   #${p.id} | Lend Amount: ${(Number(p.lendAmount) / 1e18).toFixed(6)}`);
  }

  if (marginPositions.length === 0 && lpPositions.length === 0 && lendPositions.length === 0) {
    console.log(`> No open positions found.`);
  }
}

async function margin_info(chainCtx, tokenIdStr) {
  if (!tokenIdStr) return formatError("Usage: margin_info <position_id> --chain <chain>");
  const tokenId = BigInt(tokenIdStr);
  const pc = chainCtx.publicClient;

  try {
    const state = await pc.readContract({
      address: chainCtx.contracts.LikwidMarginPosition,
      abi: LIKWID_MARGIN_ABI,
      functionName: "getPositionState",
      args: [tokenId],
    });

    const owner = await pc.readContract({
      address: chainCtx.contracts.LikwidMarginPosition,
      abi: LIKWID_MARGIN_ABI,
      functionName: "ownerOf",
      args: [tokenId],
    });

    let isLiquidatable = false;
    try {
      isLiquidatable = await pc.readContract({
        address: chainCtx.contracts.LikwidHelper,
        abi: LIKWID_HELPER_ABI,
        functionName: "checkMarginPositionLiquidate",
        args: [tokenId],
      });
    } catch (e) {}

    // Resolve pool for direction label
    let dirLabel = state.marginForOne ? "Long token1" : "Short token1";
    try {
      const poolId = await pc.readContract({
        address: chainCtx.contracts.LikwidMarginPosition,
        abi: LIKWID_MARGIN_ABI,
        functionName: "poolIds",
        args: [tokenId],
      });
      const poolKey = await pc.readContract({
        address: chainCtx.contracts.LikwidMarginPosition,
        abi: LIKWID_MARGIN_ABI,
        functionName: "poolKeys",
        args: [poolId],
      });
      const sym1 = getTokenSymbol(chainCtx, typeof poolKey.currency1 === "string" ? poolKey.currency1 : poolKey[1]);
      dirLabel = state.marginForOne ? `Long ${sym1}` : `Short ${sym1}`;
    } catch {}

    console.log(`> [${chainCtx.name}] Margin Position #${tokenIdStr}`);
    console.log(`> Owner: ${owner}`);
    console.log(`> Direction: ${dirLabel}`);
    console.log(`> Margin Amount: ${(Number(state.marginAmount) / 1e18).toFixed(6)}`);
    console.log(`> Margin Total: ${(Number(state.marginTotal) / 1e18).toFixed(6)}`);
    console.log(`> Debt Amount: ${(Number(state.debtAmount) / 1e18).toFixed(6)}`);
    console.log(`> Liquidatable: ${isLiquidatable ? "YES" : "No"}`);
  } catch (e) {
    formatError(`Failed to get margin position #${tokenIdStr}: ${e.message}`);
  }
}

async function margin_close(chainCtx, tokenIdStr) {
  if (!tokenIdStr) return formatError("Usage: margin_close <position_id> --chain <chain>");
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await chainCtx.getSmartAccount(signer);
  const pc = chainCtx.publicClient;

  const tokenId = BigInt(tokenIdStr);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  console.log(`> [${chainCtx.name}] Closing Margin Position #${tokenIdStr}...`);

  const closeCall = {
    to: chainCtx.contracts.LikwidMarginPosition,
    value: 0n,
    data: encodeFunctionData({
      abi: LIKWID_MARGIN_ABI,
      functionName: "close",
      args: [tokenId, 1000000, 0n, deadline],
    }),
  };

  const receipt = await runUserOpMultiChain(chainCtx, account, [closeCall], `Close Margin #${tokenIdStr}`);
  if (receipt) {
    const nativeBal = await pc.getBalance({ address: account.address });
    console.log(`> ${chainCtx.nativeSymbol} Balance: ${(Number(nativeBal) / 1e18).toFixed(6)} ${chainCtx.nativeSymbol}`);
  }
}

async function lp_info(chainCtx, tokenIdStr) {
  if (!tokenIdStr) return formatError("Usage: lp_info <position_id> --chain <chain>");
  const tokenId = BigInt(tokenIdStr);
  const pc = chainCtx.publicClient;

  try {
    const state = await pc.readContract({
      address: chainCtx.contracts.LikwidPairPosition,
      abi: LIKWID_PAIR_ABI,
      functionName: "getPositionState",
      args: [tokenId],
    });

    const owner = await pc.readContract({
      address: chainCtx.contracts.LikwidPairPosition,
      abi: LIKWID_PAIR_ABI,
      functionName: "ownerOf",
      args: [tokenId],
    });

    console.log(`> [${chainCtx.name}] LP Position #${tokenIdStr}`);
    console.log(`> Owner: ${owner}`);
    console.log(`> Liquidity: ${(Number(state.liquidity) / 1e18).toFixed(6)}`);
    console.log(`> Total Investment: ${(Number(state.totalInvestment) / 1e18).toFixed(6)}`);
  } catch (e) {
    formatError(`Failed to get LP position #${tokenIdStr}: ${e.message}`);
  }
}

async function lp_remove(chainCtx, tokenIdStr) {
  if (!tokenIdStr) return formatError("Usage: lp_remove <position_id> --chain <chain>");
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await chainCtx.getSmartAccount(signer);
  const pc = chainCtx.publicClient;

  const tokenId = BigInt(tokenIdStr);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  let liquidity;
  try {
    const state = await pc.readContract({
      address: chainCtx.contracts.LikwidPairPosition,
      abi: LIKWID_PAIR_ABI,
      functionName: "getPositionState",
      args: [tokenId],
    });
    liquidity = state.liquidity;
    console.log(`> [${chainCtx.name}] Removing LP Position #${tokenIdStr} (liquidity: ${(Number(liquidity) / 1e18).toFixed(6)})...`);
  } catch (e) {
    return formatError(`Failed to read LP position #${tokenIdStr}: ${e.message}`);
  }

  const removeCall = {
    to: chainCtx.contracts.LikwidPairPosition,
    value: 0n,
    data: encodeFunctionData({
      abi: LIKWID_PAIR_ABI,
      functionName: "removeLiquidity",
      args: [tokenId, liquidity, 0n, 0n, deadline],
    }),
  };

  const receipt = await runUserOpMultiChain(chainCtx, account, [removeCall], `Remove LP #${tokenIdStr}`);
  if (receipt) {
    const nativeBal = await pc.getBalance({ address: account.address });
    console.log(`> ${chainCtx.nativeSymbol} Balance: ${(Number(nativeBal) / 1e18).toFixed(6)} ${chainCtx.nativeSymbol}`);
  }
}

async function lend_info(chainCtx, tokenIdStr) {
  if (!tokenIdStr) return formatError("Usage: lend_info <position_id> --chain <chain>");
  const tokenId = BigInt(tokenIdStr);
  const pc = chainCtx.publicClient;

  try {
    const state = await pc.readContract({
      address: chainCtx.contracts.LikwidLendPosition,
      abi: LIKWID_LEND_ABI,
      functionName: "getPositionState",
      args: [tokenId],
    });

    const owner = await pc.readContract({
      address: chainCtx.contracts.LikwidLendPosition,
      abi: LIKWID_LEND_ABI,
      functionName: "ownerOf",
      args: [tokenId],
    });

    console.log(`> [${chainCtx.name}] Lend Position #${tokenIdStr}`);
    console.log(`> Owner: ${owner}`);
    console.log(`> Lend Amount: ${(Number(state.lendAmount) / 1e18).toFixed(6)}`);
  } catch (e) {
    formatError(`Failed to get lend position #${tokenIdStr}: ${e.message}`);
  }
}

async function lend_close(chainCtx, tokenIdStr, amountStr) {
  if (!tokenIdStr) return formatError("Usage: lend_close <position_id> [amount] --chain <chain>");
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found.");
  const account = await chainCtx.getSmartAccount(signer);
  const pc = chainCtx.publicClient;

  const tokenId = BigInt(tokenIdStr);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  let withdrawAmount;
  if (amountStr) {
    withdrawAmount = parseEther(amountStr);
    console.log(`> [${chainCtx.name}] Withdrawing ${amountStr} from Lend Position #${tokenIdStr}...`);
  } else {
    try {
      const state = await pc.readContract({
        address: chainCtx.contracts.LikwidLendPosition,
        abi: LIKWID_LEND_ABI,
        functionName: "getPositionState",
        args: [tokenId],
      });
      withdrawAmount = BigInt(state.lendAmount);
      console.log(
        `> [${chainCtx.name}] Withdrawing full amount (${(Number(withdrawAmount) / 1e18).toFixed(6)}) from Lend Position #${tokenIdStr}...`,
      );
    } catch (e) {
      return formatError(`Failed to read lend position #${tokenIdStr}: ${e.message}`);
    }
  }

  const withdrawCall = {
    to: chainCtx.contracts.LikwidLendPosition,
    value: 0n,
    data: encodeFunctionData({
      abi: LIKWID_LEND_ABI,
      functionName: "withdraw",
      args: [tokenId, withdrawAmount, deadline],
    }),
  };

  const receipt = await runUserOpMultiChain(chainCtx, account, [withdrawCall], `Withdraw Lend #${tokenIdStr}`);
  if (receipt) {
    const nativeBal = await pc.getBalance({ address: account.address });
    console.log(`> ${chainCtx.nativeSymbol} Balance: ${(Number(nativeBal) / 1e18).toFixed(6)} ${chainCtx.nativeSymbol}`);
  }
}

// ======================= NEW COMMANDS =======================

async function pools_command(chainCtx) {
  console.log(`> [${chainCtx.name}] Known tokens:`);
  for (const [sym, addr] of Object.entries(chainCtx.tokens)) {
    const native = isNativeToken(addr) ? " (native)" : "";
    console.log(`>   ${sym}: ${addr}${native}`);
  }
  console.log(`>`);
  console.log(`> To interact with a pool, use --pair TOKEN0/TOKEN1`);
  console.log(`> Example: --pair ETH/USDC`);
}

async function pool_info(chainCtx, pool) {
  console.log(`> [${chainCtx.name}] Pool: ${pool.token0Symbol}/${pool.token1Symbol}`);
  console.log(`> Pool ID: ${pool.poolId}`);
  console.log(`> Currency0: ${pool.currency0} (${pool.token0Symbol})`);
  console.log(`> Currency1: ${pool.currency1} (${pool.token1Symbol})`);

  try {
    const stateInfo = await chainCtx.publicClient.readContract({
      address: chainCtx.contracts.LikwidHelper,
      abi: LIKWID_HELPER_ABI,
      functionName: "getPoolStateInfo",
      args: [pool.poolId],
    });

    const r0 = (Number(stateInfo.pairReserve0) / 1e18).toFixed(6);
    const r1 = (Number(stateInfo.pairReserve1) / 1e18).toFixed(6);
    const mr0 = (Number(stateInfo.mirrorReserve0) / 1e18).toFixed(6);
    const mr1 = (Number(stateInfo.mirrorReserve1) / 1e18).toFixed(6);
    const lr0 = (Number(stateInfo.lendReserve0) / 1e18).toFixed(6);
    const lr1 = (Number(stateInfo.lendReserve1) / 1e18).toFixed(6);

    console.log(`>`);
    console.log(`> Pair Reserves:   ${r0} ${pool.token0Symbol} / ${r1} ${pool.token1Symbol}`);
    console.log(`> Mirror Reserves: ${mr0} ${pool.token0Symbol} / ${mr1} ${pool.token1Symbol}`);
    console.log(`> Lend Reserves:   ${lr0} ${pool.token0Symbol} / ${lr1} ${pool.token1Symbol}`);
    console.log(`> LP Fee: ${stateInfo.lpFee} | Margin Fee: ${stateInfo.marginFee}`);
    console.log(`> Total Supply: ${(Number(stateInfo.totalSupply) / 1e18).toFixed(6)}`);

    // Price (token1 per token0)
    if (Number(stateInfo.pairReserve0) > 0) {
      const price = Number(stateInfo.pairReserve1) / Number(stateInfo.pairReserve0);
      console.log(`> Price: 1 ${pool.token0Symbol} = ${price.toFixed(6)} ${pool.token1Symbol}`);
    }

    // Utilization
    const totalReserve0 = Number(stateInfo.realReserve0) + Number(stateInfo.mirrorReserve0);
    if (totalReserve0 > 0) {
      const util0 = (Number(stateInfo.mirrorReserve0) / totalReserve0 * 100).toFixed(2);
      console.log(`> Utilization (${pool.token0Symbol}): ${util0}%`);
    }
    const totalReserve1 = Number(stateInfo.realReserve1) + Number(stateInfo.mirrorReserve1);
    if (totalReserve1 > 0) {
      const util1 = (Number(stateInfo.mirrorReserve1) / totalReserve1 * 100).toFixed(2);
      console.log(`> Utilization (${pool.token1Symbol}): ${util1}%`);
    }
  } catch (e) {
    console.log(`> Could not fetch pool state: ${e.message}`);
  }
}

async function price_command(chainCtx, pool) {
  try {
    const stateInfo = await chainCtx.publicClient.readContract({
      address: chainCtx.contracts.LikwidHelper,
      abi: LIKWID_HELPER_ABI,
      functionName: "getPoolStateInfo",
      args: [pool.poolId],
    });

    if (Number(stateInfo.pairReserve0) > 0) {
      const price = Number(stateInfo.pairReserve1) / Number(stateInfo.pairReserve0);
      const invPrice = Number(stateInfo.pairReserve0) / Number(stateInfo.pairReserve1);
      console.log(`> [${chainCtx.name}] ${pool.token0Symbol}/${pool.token1Symbol}`);
      console.log(`> 1 ${pool.token0Symbol} = ${price.toFixed(6)} ${pool.token1Symbol}`);
      console.log(`> 1 ${pool.token1Symbol} = ${invPrice.toFixed(6)} ${pool.token0Symbol}`);
    } else {
      console.log(`> Pool has no reserves.`);
    }
  } catch (e) {
    formatError(`Failed to fetch price: ${e.message}`);
  }
}

async function add_token(chainCtx, symbol, address) {
  if (!symbol || !address) {
    return formatError("Usage: add_token <symbol> <address> --chain <chain>");
  }
  if (!address.startsWith("0x") || address.length !== 42) {
    return formatError("Invalid token address. Must be 0x followed by 40 hex characters.");
  }
  saveCustomToken(chainCtx.name, symbol, address);
  console.log(`> Added custom token: ${symbol.toUpperCase()} = ${address} on ${chainCtx.name}`);
}

// ======================= WALLET MANAGEMENT =======================

async function check_wallet() {
  const signer = getWalletInstance();
  if (signer) {
    const account = await getSmartAccount(signer);
    console.log(`> Wallet Status: Found`);
    console.log(`> EOA Signer: ${signer.address}`);
    console.log(`> Smart Account (ERC-4337): ${account.address}`);
    console.log(`> Wallet File: ${WALLET_FILE}`);
  } else {
    console.log(`> Wallet Status: Not found`);
    console.log(`> Run "node likwid.js create_wallet" to create one.`);
  }
}

async function create_wallet() {
  if (fs.existsSync(WALLET_FILE)) {
    console.log(`> Wallet already exists at ${WALLET_FILE}`);
    console.log(`> Use "node likwid.js check_wallet" to view details.`);
    return;
  }
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const dir = path.dirname(WALLET_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(WALLET_FILE, JSON.stringify({ privateKey, address: account.address }, null, 2));
  fs.chmodSync(WALLET_FILE, 0o600);
  const smartAccount = await getSmartAccount(account);
  console.log(`> Wallet Created!`);
  console.log(`> EOA Signer: ${account.address}`);
  console.log(`> Smart Account (ERC-4337): ${smartAccount.address}`);
  console.log(`> Wallet File: ${WALLET_FILE}`);
  console.log(`>`);
  console.log(`> CRITICAL: Your private key is stored in the wallet file above.`);
  console.log(`> NEVER share it with anyone, any service, or any other agent.`);
}

async function get_smart_account() {
  const signer = getWalletInstance();
  if (!signer) {
    console.log(`> No wallet found. Run "node likwid.js create_wallet" first.`);
    return;
  }
  const account = await getSmartAccount(signer);
  console.log(`> EOA Signer: ${signer.address}`);
  console.log(`> Smart Account (ERC-4337): ${account.address}`);
}

async function balance_command(chainCtx) {
  const signer = getWalletInstance();
  if (!signer) return formatError("No wallet found. Run create_wallet first.");
  const account = await chainCtx.getSmartAccount(signer);
  const pc = chainCtx.publicClient;

  console.log(`> [${chainCtx.name}] Balances for Smart Account: ${account.address}`);
  console.log(`>`);

  // Native token balance
  const nativeBal = await pc.getBalance({ address: account.address });
  console.log(`> ${chainCtx.nativeSymbol}: ${(Number(nativeBal) / 1e18).toFixed(6)}`);

  // Check all known ERC-20 tokens
  for (const [sym, addr] of Object.entries(chainCtx.tokens)) {
    if (isNativeToken(addr)) continue;
    try {
      const bal = await pc.readContract({
        address: addr,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [account.address],
      });
      if (bal > 0n) {
        console.log(`> ${sym}: ${(Number(bal) / 1e18).toFixed(6)}`);
      } else {
        console.log(`> ${sym}: 0`);
      }
    } catch (e) {
      console.log(`> ${sym}: (error reading balance)`);
    }
  }
}

// ======================= EXPORTS (for use by genesis.js) =======================
module.exports = {
  scanUserPositions,
  // Re-export contract references via chainCtx pattern
  LIKWID_MARGIN_ABI,
  LIKWID_PAIR_ABI,
  LIKWID_LEND_ABI,
};

// ======================= CLI ROUTER =======================
if (require.main === module) {
  const args = process.argv.slice(2);
  const { chain, pair, rest } = parseGlobalArgs(args);
  const command = rest[0];

  // Wallet commands (no --chain needed)
  const walletCommands = ["check_wallet", "create_wallet", "get_smart_account"];
  if (walletCommands.includes(command)) {
    (async () => {
      switch (command) {
        case "check_wallet": await check_wallet(); break;
        case "create_wallet": await create_wallet(); break;
        case "get_smart_account": await get_smart_account(); break;
      }
      process.exit(0);
    })();
    return;
  }

  if (!command) {
    console.log(`Likwid Protocol — Universal DeFi Engine for Agents

Usage: node likwid.js <command> [args] --chain <chain> --pair <pair>

Chains: ${Object.keys(CHAIN_REGISTRY).join(", ")}

Wallet & Account:
  check_wallet                  Check if wallet exists and show addresses.
  create_wallet                 Create a new EOA wallet (ERC-4337).
  get_smart_account             Display EOA and Smart Account addresses.
  balance                       Show balances on a chain. Requires --chain.

DeFi Actions (require --chain and --pair):
  swap <dir> <amt> [slip]       Swap tokens. dir: 0-1, 1-0, or <from>-<to>.
  lp_add <amt0> [slip]          Add liquidity (amt0 of token0 + matching token1).
  margin_open <dir> <amt> [lev] Open margin. dir: long/short/<symbol>.
  lend_open <side> <amt>        Lend token0 or token1. side: 0/1/<symbol>.
  liquidate <id>                Liquidate a margin position.
  scan [window]                 Scan for liquidation opportunities.

Position Management (require --chain):
  positions                     Scan and display all your DeFi positions.
  margin_info <id>              View margin position details.
  margin_close <id>             Close a margin position (full close).
  lp_info <id>                  View LP position details.
  lp_remove <id>                Remove all liquidity from LP position.
  lend_info <id>                View lend position details.
  lend_close <id> [amount]      Withdraw from lend position (default: full amount).

Discovery (require --chain):
  pools                         List known tokens on a chain.
  pool_info                     Show pool state (reserves, fees, utilization).
  price                         Current price for a pool.
  add_token <sym> <addr>        Add a custom token (saved to likwid_tokens.json).

Protocol: https://likwid.fi | Docs: https://likwidfi.gitbook.io/likwid-protocol-docs
`);
    process.exit(0);
  }

  // Commands that only need --chain (no --pair)
  const chainOnlyCommands = ["pools", "add_token", "positions", "margin_info", "margin_close",
    "lp_info", "lp_remove", "lend_info", "lend_close", "liquidate", "scan", "balance"];
  const needsPair = !chainOnlyCommands.includes(command);

  if (!chain) {
    console.log(`Error: --chain is required. Supported chains: ${Object.keys(CHAIN_REGISTRY).join(", ")}`);
    process.exit(1);
  }

  let chainCtx;
  try {
    chainCtx = getChainContext(chain);
  } catch (e) {
    console.log(`Error: ${e.message}`);
    process.exit(1);
  }

  let pool = null;
  if (needsPair) {
    if (!pair) {
      console.log(`Error: --pair is required for "${command}". Example: --pair ETH/USDC`);
      process.exit(1);
    }
    try {
      pool = resolvePool(chainCtx, pair);
    } catch (e) {
      console.log(`Error: ${e.message}`);
      process.exit(1);
    }
  } else if (pair) {
    // Optional pair for commands that can use it
    try {
      pool = resolvePool(chainCtx, pair);
    } catch (e) {
      console.log(`Warning: ${e.message}`);
    }
  }

  (async () => {
    switch (command) {
      // DeFi Actions (need --pair)
      case "swap":
        await swap_command(chainCtx, pool, rest[1], rest[2], rest[3]);
        break;
      case "lp_add":
        await lp_add(chainCtx, pool, rest[1], rest[2]);
        break;
      case "margin_open":
        await margin_open(chainCtx, pool, rest[1], rest[2], rest[3]);
        break;
      case "lend_open":
        await lend_open(chainCtx, pool, rest[1], rest[2]);
        break;
      case "pool_info":
        await pool_info(chainCtx, pool);
        break;
      case "price":
        await price_command(chainCtx, pool);
        break;

      // Chain-only commands
      case "balance":
        await balance_command(chainCtx);
        break;
      case "pools":
        await pools_command(chainCtx);
        break;
      case "add_token":
        await add_token(chainCtx, rest[1], rest[2]);
        break;
      case "positions":
        await positions(chainCtx);
        break;
      case "margin_info":
        await margin_info(chainCtx, rest[1]);
        break;
      case "margin_close":
        await margin_close(chainCtx, rest[1]);
        break;
      case "lp_info":
        await lp_info(chainCtx, rest[1]);
        break;
      case "lp_remove":
        await lp_remove(chainCtx, rest[1]);
        break;
      case "lend_info":
        await lend_info(chainCtx, rest[1]);
        break;
      case "lend_close":
        await lend_close(chainCtx, rest[1], rest[2]);
        break;
      case "liquidate":
        await liquidate_position(chainCtx, rest[1]);
        break;
      case "scan":
        await scan_liquidations(chainCtx, rest[1]);
        break;
      default:
        console.log("Unknown command:", command);
    }
    process.exit(0);
  })();
}
