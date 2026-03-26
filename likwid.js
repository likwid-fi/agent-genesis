/**
 * likwid.js — Likwid Protocol DeFi operations for Agent Genesis.
 *
 * Provides: swap, liquidity, margin, lending, liquidation, and position management.
 * All operations interact with the Likwid Protocol on Sepolia via ERC-4337 UserOperations.
 */

const {
  // Config
  AGC_TOKEN_ADDRESS,
  AGENT_PAYMASTER_ADDRESS,
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
  // Wallet & Account
  getWalletInstance,
  getSmartAccount,
  // UserOp
  runUserOp,
  // Helpers
  getApprovalCall,
  formatError,
  // viem utilities
  parseEther,
  encodeFunctionData,
} = require("./shared");

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
    const pmApproval = await getApprovalCall(
      account.address,
      AGC_TOKEN_ADDRESS,
      AGENT_PAYMASTER_ADDRESS,
      parseEther("1000000"),
    );
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

  const pmApproval = await getApprovalCall(
    account.address,
    AGC_TOKEN_ADDRESS,
    AGENT_PAYMASTER_ADDRESS,
    parseEther("1000000"),
  );
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

  const pmApproval = await getApprovalCall(
    account.address,
    AGC_TOKEN_ADDRESS,
    AGENT_PAYMASTER_ADDRESS,
    parseEther("1000000"),
  );
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

  const pmApproval = await getApprovalCall(
    account.address,
    AGC_TOKEN_ADDRESS,
    AGENT_PAYMASTER_ADDRESS,
    parseEther("1000000"),
  );
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
      args: [tokenId, 1000000, 0n, deadline],
    }),
  };

  const receipt = await runUserOp(account, closeCall, `Close Margin #${tokenIdStr}`);
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
      args: [tokenId, liquidity, 0n, 0n, deadline],
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

// ======================= EXPORTS (for use by genesis.js status) =======================
module.exports = {
  scanUserPositions,
  LIKWID_MARGIN_POSITION,
  LIKWID_MARGIN_ABI,
  LIKWID_PAIR_POSITION,
  LIKWID_PAIR_ABI,
  LIKWID_LEND_POSITION,
  LIKWID_LEND_ABI,
};

// ======================= CLI ROUTER =======================
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log(`Likwid Protocol DeFi CLI

Usage: node likwid.js <command> [args]

DeFi Actions:
  swap <dir> <amt> [slip]       Swap between ETH and AGC (eth-agc / agc-eth).
  lp_add <eth> [slip]           Add liquidity to ETH/AGC pool.
  margin_open <dir> <amt> [lev] Open a margin position.
  lend_open <asset> <amt>       Lend ETH or AGC.
  liquidate <id>                Liquidate a margin position.
  scan [window]                 Scan for liquidation opportunities.

Position Management:
  positions                     Scan and display all your DeFi positions.
  margin_info <id>              View margin position details.
  margin_close <id>             Close a margin position (full close).
  lp_info <id>                  View LP position details.
  lp_remove <id>                Remove all liquidity from LP position.
  lend_info <id>                View lend position details.
  lend_close <id> [amount]      Withdraw from lend position (default: full amount).
`);
    process.exit(0);
  }

  (async () => {
    switch (command) {
      case "swap":
        await swap_command(args[1], args[2], args[3]);
        break;
      case "lp_add":
        await lp_add(args[1], args[2]);
        break;
      case "margin_open":
        await margin_open(args[1], args[2], args[3]);
        break;
      case "lend_open":
        await lend_open(args[1], args[2]);
        break;
      case "liquidate":
        await liquidate_position(args[1]);
        break;
      case "scan":
        await scan_liquidations(args[1]);
        break;
      case "positions":
        await positions();
        break;
      case "margin_info":
        await margin_info(args[1]);
        break;
      case "margin_close":
        await margin_close(args[1]);
        break;
      case "lp_info":
        await lp_info(args[1]);
        break;
      case "lp_remove":
        await lp_remove(args[1]);
        break;
      case "lend_info":
        await lend_info(args[1]);
        break;
      case "lend_close":
        await lend_close(args[1], args[2]);
        break;
      default:
        console.log("Unknown command:", command);
    }
    process.exit(0);
  })();
}
