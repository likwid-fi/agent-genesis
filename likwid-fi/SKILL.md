---
name: likwid-fi
version: 1.0.0
description: Likwid.fi Protocol Universal Skill — swap, liquidity, margin, and lending on the Likwid DeFi protocol.
homepage: https://likwid.fi
---

# Likwid.fi Protocol Universal Skill

Interact with the **Likwid Protocol** — a unified DeFi protocol for swaps, liquidity provision, margin trading, and lending. Works with any EOA wallet or ERC-4337 Smart Account.

## Skill Architecture

| File | Purpose |
|------|---------|
| **SKILL.md** (this file) | Skill documentation and agent workflow |
| **likwid-fi.js** | CLI implementation |
| **package.json** | Dependencies (viem, permissionless) |
| **bootstrap.sh** | One-line install script |
| **abi/** | On-chain contract ABIs |
| **pools/** | Per-network pool & contract configuration |

## Supported Networks

| Network | Config File |
|---------|-------------|
| Sepolia (testnet) | `pools/sepolia.json` |
| Ethereum (mainnet) | `pools/ethereum.json` *(coming soon)* |
| Base | `pools/base.json` *(coming soon)* |

---

## 0. First Load — Setup

**When this skill is first loaded**, you MUST run the bootstrap and configure it before any DeFi operation. Do NOT silently proceed.

### Fast Path (preferred)

If the skill is already installed locally, reuse it immediately:

```bash
test -f ~/.openclaw/skills/agent-genesis/likwid-fi/likwid-fi.js && echo "skill present"
```

### Standard Install / Update

Run the bootstrap script to install or update everything in one shot:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/likwid-fi/agent-genesis/refs/heads/main/likwid-fi/bootstrap.sh)
```

After bootstrap, all commands run from `~/.openclaw/skills/agent-genesis/likwid-fi/`.

### Step 1: Interactive Setup

After bootstrap completes, ask the user for three things:

1. **Network** — Which network to operate on?
   > Available: `sepolia`, `ethereum`, `base`

2. **Private Key File** — Where is your wallet's private key stored?
   > Provide the **file path** containing the private key (hex string, with or without `0x` prefix).
   > Also supports JSON wallet files with a `privateKey` field.
   >
   > **NEVER** ask the user to paste their private key directly. Always ask for the **file path**.

3. **Account Type** — How do you want to interact with the protocol?
   > `eoa` — Sign and send transactions directly from your EOA wallet.
   > `smart` — Use an ERC-4337 Smart Account (via Permissionless). Transactions are submitted as UserOperations through a bundler.

Then run:

```bash
node likwid-fi.js setup <network> <keyFilePath> <accountType>
```

**Report to human:**

> **Likwid.fi Skill Configured!**
>
> Network: `<NETWORK>` (Chain ID `<CHAIN_ID>`)
> EOA Address: `<EOA_ADDRESS>`
> Account Type: `<EOA|SMART>`
> Smart Account: `<SMART_ADDRESS>` *(if smart)*
>
> **CRITICAL:** Your private key is read from `<KEY_FILE>`. Never share this file.

### Step 3: Verify Account

```bash
node likwid-fi.js account
```

Show the user their balances and addresses.

---

## 1. Swap

Swap tokens on any Likwid pool.

### Step 1: List Available Pools

```bash
node likwid-fi.js pools
```

**Report to human:**

> **Available Pools on `<NETWORK>`:**
>
> ETH/USDT (fee: 0.30%)
> ETH/LIKWID (fee: 0.30%)
> ETH/LIKWID (fee: 0.50%)
>
> Which pool and direction?

### Step 2: Get Quote

Before executing, always preview the swap:

```bash
node likwid-fi.js quote <pool> <direction> <amount>
```

**Direction:**
- `0to1` — Swap currency0 for currency1 (e.g., ETH → USDT)
- `1to0` — Swap currency1 for currency0 (e.g., USDT → ETH)

**Report to human:**

> **Swap Preview:**
> Swapping `<AMOUNT>` `<FROM>` → ~`<OUTPUT>` `<TO>`
> Fee: `<FEE_RATE>`% (`<FEE_AMOUNT>` `<FROM>`)
> Slippage tolerance: `<SLIPPAGE>`%
>
> Proceed? (yes/no)

**Wait for human confirmation before executing.**

### Step 3: Execute Swap

```bash
node likwid-fi.js swap <pool> <direction> <amount> [slippage%]
```

Default slippage: 1%.

**Report to human:**

> **Swap Successful!**
> `<AMOUNT>` `<FROM>` → `<TO>`
> Transaction: `<TX_HASH>`
> Block: `<BLOCK_NUMBER>`

Or on failure:

> **Swap Failed:** `<ERROR_MESSAGE>`
> No funds were spent.

---

## 2. Add / Increase Liquidity

Provide liquidity to a Likwid pool. If you already have a position in the pool, the command automatically uses `increaseLiquidity` (adds to the existing NFT). Otherwise it creates a new LP position (ERC-721 NFT) via `addLiquidity`.

### Step 1: Select Pool & Check State

```bash
node likwid-fi.js pool_info <pool>
```

**If pool is not initialized:**

> **Pool Not Initialized**
> Pool `<NAME>` (fee: `<FEE>`%) has no liquidity. You need to Create a Pair first.

**If pool exists, report to human:**

> **Pool `<NAME>` (fee: `<FEE>`%)**
> Reserve `<SYMBOL0>`: `<RESERVE0>`
> Reserve `<SYMBOL1>`: `<RESERVE1>`
> Rate: 1 `<SYMBOL0>` = `<RATE>` `<SYMBOL1>`
>
> How much liquidity would you like to add? You can provide an amount for either `<SYMBOL0>` or `<SYMBOL1>` — the other side will be auto-calculated from the pool ratio.

### Step 2: Execute

The user provides an amount for **one side** (currency `0` or `1`). The matching amount is auto-calculated.

```bash
node likwid-fi.js lp_add <pool> <currency> <amount> [slippage%]
```

- `<currency>`: `0` for currency0, `1` for currency1
- The other side is calculated proportionally from the on-chain reserve ratio
- Existing positions are auto-detected via the Likwid API. If found, `increaseLiquidity` is used with the existing `tokenId`.

**Report to human before execution:**

> **Add Liquidity Preview:** (or **Increase Liquidity Preview** if existing position found)
> Pool: `<NAME>` (fee: `<FEE>`%)
> Rate: 1 `<SYMBOL0>` = `<RATE>` `<SYMBOL1>`
> `<SYMBOL0>`: `<AMOUNT0>`
> `<SYMBOL1>`: `<AMOUNT1>`
> Slippage: `<SLIPPAGE>`%
>
> Proceed? (yes/no)

**Wait for human confirmation before executing.**

**After execution:**

> **Liquidity Added!** (or **Liquidity Increased!**)
> Transaction: `<TX_HASH>`
> Block: `<BLOCK_NUMBER>`

Or on failure:

> **Add Liquidity Failed:** `<ERROR_MESSAGE>`
> No funds were spent.

---

## 2b. View Liquidity Positions

View your LP positions in a specific pool.

```bash
node likwid-fi.js lp_positions <pool>
```

**Report to human:**

> **Your Liquidity Positions:**
>
> Pool: `<NAME>`  Swap Fee: `<FEE>`%  Margin Fee: `<MARGIN_FEE>`%
> Your Pool Share: `<SHARE>`%
> `<SYMBOL0>`: `<AMOUNT0>`
> `<SYMBOL1>`: `<AMOUNT1>`
>
> Tip: Use "lp_add" to increase liquidity, or "lp_remove" to remove liquidity.

If no positions found:

> No liquidity positions found for `<NAME>`.

---

## 2c. Remove Liquidity

Remove liquidity from an existing LP position.

### Step 1: Check Position

```bash
node likwid-fi.js lp_positions <pool>
```

Report the user's current position details (pool share, token amounts).

### Step 2: Execute

```bash
node likwid-fi.js lp_remove <pool> [percentage]
```

- `[percentage]`: 1-100 (default: 100 = remove all liquidity)
- The first position in the pool is used automatically

**Report to human before execution:**

> **Remove Liquidity Preview:**
> Pool: `<NAME>` (fee: `<FEE>`%) — tokenId: `<TOKEN_ID>`
> Removing: `<PERCENT>`% of liquidity
> Est. `<SYMBOL0>`: `<AMOUNT0>`
> Est. `<SYMBOL1>`: `<AMOUNT1>`
> Slippage: 1%
>
> Proceed? (yes/no)

**Wait for human confirmation before executing.**

**After execution:**

> **Liquidity Removed!**
> Transaction: `<TX_HASH>`
> Block: `<BLOCK_NUMBER>`

Or on failure:

> **Remove Liquidity Failed:** `<ERROR_MESSAGE>`
> No funds were withdrawn.

---

## 3. Create a Pair

Create a new Likwid pool by initializing it on-chain. Tokens are resolved by name from the network config.

### Step 1: Check Available Tokens

```bash
node likwid-fi.js pools
```

The tokens available for pairing are defined in `pools/<network>.json` under `tokens`. Current Sepolia tokens: ETH, USDT, LIKWID.

### Step 2: Create the Pair

```bash
node likwid-fi.js create_pair <token0> <token1> <fee> <marginFee>
```

- `<token0>`, `<token1>`: Token names (e.g., `ETH`, `USDT`). Addresses are auto-sorted to satisfy `currency0 < currency1`.
- `<fee>`, `<marginFee>`: Fee values in basis points (e.g., `3000` = 0.30%).

**Report to human:**

> **Create Pair Preview:**
> currency0: `<SYMBOL0>` (`<ADDRESS0>`)
> currency1: `<SYMBOL1>` (`<ADDRESS1>`)
> Swap Fee: `<FEE>`%  Margin Fee: `<MARGIN_FEE>`%
> Pool ID: `<POOL_ID>`
>
> Proceed? (yes/no)

**Wait for human confirmation before executing.**

**On success:**

> **Pair Created!**
> Pool added to config: `<NAME>` (fee: `<FEE>`%).
> Use `lp_add <NAME> <currency> <amount>` to add initial liquidity.

**If pool already exists:**

> **Pool Already Exists**
> This pair is already initialized on-chain. Use `pools` to check if it's in your config, or `lp_add` to add liquidity.

---

## 4. Margin Trading

Open leveraged long/short positions on Likwid pools.

### Understanding Direction

For pool `ETH/LIKWID` (currency0=ETH, currency1=LIKWID):

| Direction | Meaning | Collateral | Borrow |
|---|---|---|---|
| `long` | Long LIKWID (Short ETH) | LIKWID | ETH |
| `short` | Short LIKWID (Long ETH) | ETH | LIKWID |

Direction is always relative to **currency1**. `long` = bullish on currency1, `short` = bearish on currency1.

### Step 1: Get Quote

Always preview before opening a position:

```bash
node likwid-fi.js margin_quote <pool> <direction> <leverage> <amount>
```

Example:
```bash
node likwid-fi.js margin_quote ETH/LIKWID short 1 0.1
```

**Report to human:**

> **Margin Preview: Short LIKWID (Long ETH) | ETH/LIKWID | 1x**
>
> Margin: `0.1 ETH`
> Total (Using Margin 1x): `0.0997 ETH`
> Borrow Amount: `980.73 LIKWID`
> Borrow APY: `5.00%`
>
> Initial Margin Level: `2.00`
> Liquidation Margin Level: `1.17`
> Liq.Price: `0.00017404 ETH per LIKWID`
>
> Max Margin (1x): `1.506 ETH`
> Borrow Max Amount: `990.54 LIKWID` (includes 1% slippage)
>
> Proceed? (yes/no)

**Wait for human confirmation before executing.**

### Step 2: Open / Increase Position

```bash
node likwid-fi.js margin_open <pool> <direction> <leverage> <amount>
```

The command automatically:
1. Queries the API for existing margin positions on the same pool
2. If an existing position with the same direction exists → **increases** it (`margin()`)
3. If no position exists → **opens** a new one (`addMargin()`)

**After execution:**

> **Margin Position Opened!**
> Transaction: `<TX_HASH>`
> Block: `<BLOCK_NUMBER>`

Or on failure:

> **Margin Open Failed:** `<ERROR_MESSAGE>`
> No funds were spent.

### Leverage & Max Margin

| Leverage | Max Margin Ratio |
|---|---|
| 1x | 15% of pairReserve (capped by realReserve) |
| 2x | 12% |
| 3x | 9% |
| 4x | 5% |
| 5x | 1.7% |

Higher leverage = smaller max position, higher liquidation risk.

### Step 3: View Positions

```bash
node likwid-fi.js margin_positions <pool>
```

Shows all your margin positions on the given pool with real-time on-chain data.

**Report to human:**

> **Margin Positions: ETH/LIKWID** (Swap Fee: 0.30% Margin Fee: 0.30%)
> Current Price: `0.00010066 ETH per LIKWID`
>
> **Position #20**
> Short LIKWID · Long ETH
> Margin Amount: `0.001 ETH`
> Margin Total: `0.000997 ETH`
> Debt: `9.9654 LIKWID`
> Borrow APY: `5.00%`
> Liq.Price: `0.00018217 ETH`
> Cur.Price: `0.00010066 ETH`
> Margin Level: `1.99`
> Estimated PNL: `-0.00000902 ETH`

Data source: API provides `tokenId` only; all other data (marginAmount, marginTotal, debtAmount, direction) is read on-chain via `getPositionState()`.

**PNL Calculation:**
- If debt currency ≠ price currency: `PNL = marginTotal - (debt × curPrice)`
- If debt currency = price currency: `PNL = marginTotal - (debt × 1/curPrice)`

---

## 5. Error Handling

When errors occur, **always inform the human clearly**. Never silently swallow errors.

| Error Type | What to Tell the Human |
|---|---|
| **Not configured** | "Run setup first: `node likwid-fi.js setup <network> <keyFile> <accountType>`" |
| **Key file not found** | "Private key file not found at `<PATH>`. Please check the path." |
| **Pool not found** | "Pool `<NAME>` not found. Use token pair (e.g. ETH/USDT). Run `pools` to list." |
| **Quote failed** | "Could not get quote — pool may have insufficient liquidity." |
| **Approval failed** | "Token approval failed. Swap was NOT executed." |
| **Swap reverted** | "Swap transaction reverted. No funds were lost. Check slippage or try a smaller amount." |
| **Insufficient balance** | "Insufficient `<TOKEN>` balance. You have `<BALANCE>`, need `<REQUIRED>`." |
| **UserOp failed** | "Smart Account UserOperation failed: `<REASON>`. Try EOA mode or check bundler." |

**Key principle:** If a multi-step operation fails at any step (e.g., approval fails before swap), **stop immediately** and report.

---

## 6. All Commands Reference

| Command | Description |
|:---|:---|
| `setup <net> <key> [type]` | Configure network, wallet, and account type. |
| `account` | Show current account info and balances. |
| `pools` | List available pools on the current network. |
| `pool_info <pool>` | Query on-chain pool state (reserves, rate). |
| `quote <pool> <dir> <amt>` | Get swap output estimate without executing. |
| `swap <pool> <dir> <amt> [slip]` | Execute a swap. |
| `lp_add <pool> <cur> <amt> [slip]` | Add or increase liquidity. `<cur>`: `0` or `1`. |
| `lp_positions <pool>` | Show your liquidity positions in a pool. |
| `lp_remove <pool> [percent]` | Remove liquidity. Default: 100% (all). |
| `create_pair <t0> <t1> <fee> <mfee>` | Create a new pool. Tokens by name. |
| `margin_quote <pool> <dir> <lev> <amt>` | Preview margin position. |
| `margin_open <pool> <dir> <lev> <amt>` | Open or increase margin position. |
| `margin_positions <pool>` | Show your margin positions. |

### Arguments

| Arg | Values | Description |
|:---|:---|:---|
| `<net>` | `sepolia`, `ethereum`, `base` | Target network. |
| `<key>` | File path | Path to file containing private key. |
| `[type]` | `eoa`, `smart` | Account type (default: `eoa`). |
| `<pool>` | `ETH/USDT`, `ETH-LIKWID` | Token pair. Lowest fee tier selected by default. |
| `<dir>` | `0to1`, `1to0` | Swap direction. |
| `<cur>` | `0`, `1` | Which currency to provide (other auto-calculated). |
| `<amt>` | `"0.01"`, `"100"` | Human-readable token amount. |
| `[slip]` | `1`, `0.5`, `3` | Slippage tolerance in % (default: `1`). |
| `<t0>`, `<t1>` | `ETH`, `USDT`, ... | Token names from network config `tokens`. |
| `<fee>`, `<mfee>` | `3000` | Fee in basis points (3000 = 0.30%). |
| `<dir>` (margin) | `long`, `short` | Direction relative to currency1. |
| `<lev>` | `1`-`5` | Leverage multiplier. |

---

## 7. Adding New Networks

To add a new network, create a JSON file in `pools/<network>.json`:

```json
{
  "network": "<name>",
  "chainId": <id>,
  "rpc": "<rpc_url>",
  "bundlerUrl": "<bundler_url>",
  "smartAccountFactory": "<factory_address>",
  "contracts": {
    "LikwidVault": "<address>",
    "LikwidPairPosition": "<address>",
    "LikwidMarginPosition": "<address>",
    "LikwidLendPosition": "<address>",
    "LikwidHelper": "<address>"
  },
  "pools": [
    {
      "name": "TOKEN_A / TOKEN_B",
      "currency0": { "address": "<addr>", "symbol": "A", "decimals": 18 },
      "currency1": { "address": "<addr>", "symbol": "B", "decimals": 18 },
      "fee": 3000,
      "marginFee": 3000
    }
  ]
}
```

Then switch to the new network:
```bash
node likwid-fi.js setup <new_network> <keyFile> [accountType]
```
