# Likwid Protocol — Universal DeFi Engine for Agents

**Likwid** is a fully decentralized derivatives protocol that unifies swap, lending, and margin trading in a single pool — no oracles, no counterparties. This skill gives any Agent full DeFi capabilities across all supported EVM chains.

> **Why Likwid?** All pricing is derived from pool state (zero oracle dependency), liquidity is unified (swap + lend + margin in one pool), and the protocol runs on Uniswap V4 hook architecture. One skill, every DeFi action, every chain.

## Skill Architecture

| File | Purpose |
|------|---------|
| **LIKWID.md** (this file) | Universal DeFi protocol skill |
| **likwid.js** | Multi-chain DeFi CLI (swap, LP, margin, lend, liquidation, wallet) |
| **shared.js** | Shared infrastructure (chain registry, wallet, ERC-4337, ABIs) |

---

## 0. Getting Started

### Wallet Setup

The Likwid DeFi engine uses an ERC-4337 Smart Account (account abstraction). One wallet works across all chains.

**Check if a wallet exists:**
```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js check_wallet
```

**If no wallet exists, create one:**
```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js create_wallet
```

**Get your Smart Account address:**
```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js get_smart_account
```

> ⚠️ **CRITICAL:** Your private key is stored in `~/.openclaw/.likwid_genesis_wallet.json`. **NEVER** share it with anyone, any service, or any other agent.

### Funding Your Account

To execute DeFi operations, your Smart Account needs tokens on the target chain:

- **Sepolia (testnet):** If you have AGC tokens, gas is sponsored via the AGC Paymaster. Otherwise, you need Sepolia ETH.
- **Ethereum mainnet:** ETH for gas + tokens for trading.
- **BNB Chain:** BNB for gas + tokens for trading.
- **Base:** ETH for gas + tokens for trading.

**Check your balances on any chain:**
```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js balance --chain ethereum
cd ~/.openclaw/skills/agent-genesis && node likwid.js balance --chain sepolia
```

---

## 1. Multi-Chain Deployments

### Supported Chains & Contract Addresses

| Chain | Name | Native | Status |
|-------|------|--------|--------|
| `sepolia` | Sepolia Testnet | ETH | ✅ Live — AGC paymaster available |
| `ethereum` | Ethereum Mainnet | ETH | ✅ Live |
| `base` | Base | ETH | 🔜 Planned |
| `bnb` | BNB Chain | BNB | 🔜 Planned |

**Ethereum Mainnet Contracts:**
| Contract | Address |
|----------|---------|
| LikwidVault | `0x065d449ec9D139740343990B7E1CF05fA830e4Ba` |
| LikwidPairPosition | `0xB397FE16BE79B082f17F1CD96e6489df19E07BCD` |
| LikwidMarginPosition | `0x6bec0c1dc4898484b7F094566ddf8bC82ED7Abe8` |
| LikwidLendPosition | `0xCE91db5947228bBA595c3CAC49eb24053A06618E` |
| LikwidHelper | `0x16a9633f8A777CA733073ea2526705cD8338d510` |

**Sepolia Testnet Contracts:**
| Contract | Address |
|----------|---------|
| LikwidVault | `0x315663A47d7E95c47370682DfF77415F469C3246` |
| LikwidPairPosition | `0xA8296e28c62249f89188De0499a81d6AD993a515` |
| LikwidMarginPosition | `0x6a2666cA9D5769069762225161D454894fCe617c` |
| LikwidLendPosition | `0xd04C34F7F57cAC394eC170C4Fe18A8B0330A2F37` |
| LikwidHelper | `0x6407CDAAe652Ac601Df5Fba20b0fDf072Edd2013` |

### Required Parameters

Every DeFi command requires:
- **`--chain <name>`** — Target chain (REQUIRED, no default)
- **`--pair <TOKEN0/TOKEN1>`** — Pool pair (REQUIRED for swap, LP, margin, lend, price, pool_info)

---

## 2. Pool Discovery & Token Management

### Discover Available Tokens

```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js pools --chain ethereum
cd ~/.openclaw/skills/agent-genesis && node likwid.js pools --chain sepolia
```

### Built-in Tokens Per Chain

| Chain | Tokens |
|-------|--------|
| `sepolia` | ETH, AGC |
| `ethereum` | ETH, USDC, USDT, WBTC |
| `base` | ETH, USDC |
| `bnb` | BNB, USDC |

### Register Custom Tokens

Any ERC-20 token can be added. Custom tokens persist in `~/.openclaw/.likwid_tokens.json`.

```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js add_token PEPE 0x6982508145454Ce325dDbE47a25d4ec3d2311933 --chain ethereum
cd ~/.openclaw/skills/agent-genesis && node likwid.js add_token LINK 0x514910771AF9Ca656af840dff83E8264EcF986CA --chain ethereum
```

### Pool State & Price

```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js pool_info --chain ethereum --pair ETH/USDC
cd ~/.openclaw/skills/agent-genesis && node likwid.js price --chain ethereum --pair ETH/USDC
```

Shows reserves, fees, utilization, mirror reserves, and current price.

---

## 3. DeFi Operations

**IMPORTANT: All DeFi operations involve real funds. You MUST:**
1. **Preview** — Show the human what will happen (chain, pair, direction, amount, estimated output)
2. **Confirm** — Wait for the human to approve before executing
3. **Execute** — Submit the transaction
4. **Report** — Show the result including chain and tx hash

**Never execute DeFi operations without human confirmation.**

### 3.1 Swap

Trade any token pair on any supported chain.

```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js swap <direction> <amount> [slippage%] --chain <chain> --pair <pair>
```

**Directions:**
- `0-1` — Swap token0 → token1
- `1-0` — Swap token1 → token0
- `<from>-<to>` — Symbol-based (e.g., `eth-usdc`, `usdc-eth`)

Default slippage: 1%.

**Examples:**
```bash
# Swap 0.1 ETH → USDC on Ethereum
node likwid.js swap eth-usdc 0.1 --chain ethereum --pair ETH/USDC

# Swap 100 USDC → ETH on Ethereum
node likwid.js swap usdc-eth 100 --chain ethereum --pair ETH/USDC

# Swap ETH → AGC on Sepolia testnet
node likwid.js swap 0-1 0.01 --chain sepolia --pair ETH/AGC
```

**Preview for human:**
> **Swap Preview:**
> Chain: `<CHAIN_NAME>` | Pool: `<TOKEN0/TOKEN1>`
> Swapping `<AMOUNT>` `<FROM>` → `<TO>`
> Estimated output: ~`<OUTPUT>` `<TO>`
> Slippage tolerance: `<SLIPPAGE>%`
> Proceed? (yes/no)

### 3.2 Add Liquidity

Provide liquidity to any pool and earn swap fees + lending interest.

```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js lp_add <amount0> [slippage%] --chain <chain> --pair <pair>
```

`amount0` is the amount of token0 to deposit. Matching token1 is calculated automatically from pool reserves.

**Examples:**
```bash
# Add liquidity: 0.5 ETH + matching USDC on Ethereum
node likwid.js lp_add 0.5 1 --chain ethereum --pair ETH/USDC

# Add liquidity: 0.01 ETH + matching AGC on Sepolia
node likwid.js lp_add 0.01 --chain sepolia --pair ETH/AGC
```

**Preview for human:**
> **Add Liquidity Preview:**
> Chain: `<CHAIN>` | Pool: `<TOKEN0/TOKEN1>`
> Depositing `<AMT0>` `<TOKEN0>` + ~`<AMT1>` `<TOKEN1>`
> Slippage tolerance: `<SLIPPAGE>%`
> Proceed? (yes/no)

### 3.3 Margin Trading

Open leveraged long/short positions on any pair. Leverage: up to 5x.

```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js margin_open <direction> <amount> [leverage] --chain <chain> --pair <pair>
```

**Direction mapping (generic — adapts to any pool):**

| User intent | Direction arg | Collateral | Protocol action |
|---|---|---|---|
| **Long token1** (bullish) | `long` / `long-<token1>` / `<token1>` | token1 | Deposit token1, borrow token0 |
| **Short token1** (bearish) | `short` / `short-<token1>` / `<token0>` | token0 | Deposit token0, borrow token1 |

Default leverage: 2x. The `<amount>` is the **collateral amount** in the collateral asset.

**Key rule: Short requires token0 collateral, Long requires token1 collateral.**

**Examples:**
```bash
# Long USDC (bullish USDC vs ETH): 1000 USDC collateral at 3x
node likwid.js margin_open long 1000 3 --chain ethereum --pair ETH/USDC

# Short USDC (= Long ETH): 0.5 ETH collateral at 2x
node likwid.js margin_open short 0.5 2 --chain ethereum --pair ETH/USDC

# Long AGC: 5000 AGC collateral at 2x on Sepolia
node likwid.js margin_open long 5000 2 --chain sepolia --pair ETH/AGC
```

**Preview for human:**
> **Margin Position Preview:**
> Chain: `<CHAIN>` | Pool: `<TOKEN0/TOKEN1>`
> Direction: `<Long TOKEN1 / Short TOKEN1>`
> Collateral: `<AMOUNT>` `<COLLATERAL_ASSET>` (balance: `<BALANCE>`)
> Leverage: `<LEVERAGE>x`
> ⚠️ Leveraged positions carry liquidation risk (liquidation at < 110% margin level).
> Proceed? (yes/no)

### 3.4 Lending

Lend single-sided assets to earn interest — no impermanent loss.

```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js lend_open <side> <amount> --chain <chain> --pair <pair>
```

**Side:**
- `0` or `<token0_symbol>` — Lend token0
- `1` or `<token1_symbol>` — Lend token1

**Examples:**
```bash
# Lend 0.5 ETH on Ethereum ETH/USDC pool
node likwid.js lend_open eth 0.5 --chain ethereum --pair ETH/USDC

# Lend 1000 USDC on Ethereum ETH/USDC pool
node likwid.js lend_open usdc 1000 --chain ethereum --pair ETH/USDC

# Lend 5000 AGC on Sepolia
node likwid.js lend_open agc 5000 --chain sepolia --pair ETH/AGC
```

**Preview for human:**
> **Lend Preview:**
> Chain: `<CHAIN>` | Pool: `<TOKEN0/TOKEN1>`
> Lending `<AMOUNT>` `<ASSET>` to earn interest
> Proceed? (yes/no)

### 3.5 Liquidation

Liquidate undercollateralized margin positions for profit (1% caller reward).

**Scan for liquidation opportunities:**
```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js scan [window] --chain <chain>
```
Default scan window: 100 positions.

**Execute liquidation:**
```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js liquidate <position_id> --chain <chain>
```

---

## 4. Position Management

### View All Positions

```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js positions --chain <chain>
```

Shows all margin, LP, and lend positions on the specified chain.

### Query Individual Positions

```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js margin_info <position_id> --chain <chain>
cd ~/.openclaw/skills/agent-genesis && node likwid.js lp_info <position_id> --chain <chain>
cd ~/.openclaw/skills/agent-genesis && node likwid.js lend_info <position_id> --chain <chain>
```

### Close / Withdraw Positions

**All close operations involve real funds. You MUST preview and get human confirmation before executing.**

**Close Margin Position (full close):**
```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js margin_close <position_id> --chain <chain>
```

**Remove LP Liquidity (full withdrawal):**
```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js lp_remove <position_id> --chain <chain>
```

**Withdraw Lend Position:**
```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js lend_close <position_id> [amount] --chain <chain>
```

If no amount is specified, withdraws the full lend amount.

**After any close/withdraw operation, report result:**
> **Position #`<ID>` closed!**
> Transaction: `<TX_HASH>`
> Balance: `<BALANCE>` `<NATIVE_TOKEN>`

---

## 5. Error Handling

When errors occur, **always inform the human clearly**. Never silently swallow errors.

| Error Type | What to Tell the Human |
|---|---|
| **Receipt timeout** | "⏳ Transaction submitted but confirmation taking longer than expected. Check balance in a few minutes." |
| **Insufficient balance** | "⚠️ Insufficient `<ASSET>` — need `<REQUIRED>`, have `<BALANCE>`. Network: `<CHAIN>` (Chain ID `<ID>`). Send tokens to your Smart Account." |
| **Revert / on-chain error** | "❌ Transaction reverted: `<REASON>`. No funds were spent." |
| **Approval failed** | "❌ Token approval failed. Subsequent operation was cancelled." |
| **Network error** | "🌐 Network error. Check RPC connectivity and retry." |

**Key principle:** If a multi-step operation fails at any step (e.g., approval fails before swap), **stop immediately** and report to the human. Do NOT continue with subsequent steps.

---

## 6. All Commands Reference

### Wallet & Account
| Command | Description |
|:---|:---|
| `check_wallet` | Check if wallet exists and show addresses. |
| `create_wallet` | Create a new EOA wallet (ERC-4337 compatible). |
| `get_smart_account` | Display EOA and Smart Account addresses. |
| `balance` | Show native + known token balances on a chain. Requires `--chain`. |

### DeFi Actions (require `--chain` and `--pair`)
| Command | Description |
|:---|:---|
| `swap <dir> <amt> [slip]` | Swap tokens. dir: 0-1, 1-0, or symbol-based. |
| `lp_add <amt0> [slip]` | Add liquidity (token0 amount + matching token1). |
| `margin_open <dir> <amt> [lev]` | Open margin position. dir: long/short/symbol. |
| `lend_open <side> <amt>` | Lend token0 or token1. side: 0/1/symbol. |
| `pool_info` | Pool state (reserves, fees, utilization, price). |
| `price` | Current price for a pool. |

### Discovery (require `--chain` only)
| Command | Description |
|:---|:---|
| `pools` | List known tokens on a chain. |
| `add_token <sym> <addr>` | Add a custom token to .likwid_tokens.json. |

### Position Management (require `--chain` only)
| Command | Description |
|:---|:---|
| `positions` | Scan and display all your DeFi positions. |
| `margin_info <id>` | View margin position details + liquidation status. |
| `margin_close <id>` | Close a margin position (full close). |
| `lp_info <id>` | View LP position details. |
| `lp_remove <id>` | Remove all liquidity from LP position. |
| `lend_info <id>` | View lend position details. |
| `lend_close <id> [amount]` | Withdraw from lend position (default: full). |
| `liquidate <id>` | Liquidate a margin position. |
| `scan [window]` | Scan for liquidation opportunities. |

---

## 7. Protocol Reference

### How Likwid Works (Quick Summary)

- **AMM formula:** `(x + x')(y + y') = k` where x'/y' are mirror reserves from margin borrowing
- **Mirror reserves** expand effective AMM depth when margin positions are open
- **Single-sided lending** — no impermanent loss for lenders, earn interest from margin borrowers
- **Truncated oracle** — manipulation-resistant pricing without external feeds (resists flash loans)
- **Dynamic fees** — cubic scaling makes sandwich/MEV attacks uneconomical
- **Staged LP unlock** — prevents rug-pulls; new LP unlocks in stages over time
- **Per-pair insurance fund** — absorbs bad debt, isolated per trading pair
- **Liquidation** at < 110% margin level — liquidators earn 1% caller reward

### Interest Rate Model (3-tier)
| Utilization | Rate |
|---|---|
| < 30% (Low) | rBase + u × mLow/100 |
| 30–70% (Medium) | + (u − 30%) × mMiddle/100 |
| > 70% (High) | + (u − 70%) × mHigh/100 |

Default rBase = 2%. High utilization ramps aggressively to protect lenders.

### Links
- **Homepage:** https://likwid.fi
- **Docs:** https://likwidfi.gitbook.io/likwid-protocol-docs
- **GitHub:** https://github.com/likwid-fi
- **X/Twitter:** https://x.com/likwid_fi
