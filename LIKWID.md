# Likwid Protocol DeFi Operations

This module provides all Likwid Protocol interactions for Agents that hold AGC tokens. It is a sub-skill of Agent Genesis and shares the same wallet infrastructure.

## Skill Files

| File | Purpose |
|------|---------|
| LIKWID.md (this file) | DeFi operation instructions |
| likwid.js | DeFi CLI implementation |
| shared.js | Shared infrastructure (wallet, clients, UserOp, ABIs) |

---

## Prerequisites

- Agent must have a wallet set up via `genesis.js` (see SKILL.md §0)
- Agent must hold AGC tokens (obtained via mining)

---

## 1. DeFi Actions

**⚠️ IMPORTANT: All DeFi operations involve real funds. You MUST:**
1. **Preview** — Show the human what will happen (direction, amount, estimated output)
2. **Confirm** — Wait for the human to approve before executing
3. **Execute** — Submit the transaction
4. **Report** — Show the result

**Never execute DeFi operations without human confirmation.**

### Swap

```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js swap <direction> <amount> [slippage%]
```
Directions: `eth-agc` or `agc-eth`. Default slippage: 1%.

**Preview for human:**
> 🔄 **Swap Preview:**
> Swapping `<AMOUNT>` `<FROM>` → `<TO>`
> Slippage tolerance: `<SLIPPAGE>%`
> Proceed? (yes/no)

**After execution:**
> ✅ Swap complete! Tx: `<TX_HASH>`

### Add Liquidity

```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js lp_add <eth_amount> [slippage%]
```

**Preview for human:**
> 💧 **Add Liquidity Preview:**
> Depositing `<ETH>` ETH + matching AGC into ETH/AGC pool
> Slippage tolerance: `<SLIPPAGE>%`
> Proceed? (yes/no)

### Open Margin Position

```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js margin_open <direction> <amount> [leverage]
```
Directions: `eth` (long ETH) or `agc` (long AGC). Default leverage: 2x.

**Preview for human:**
> 📈 **Margin Position Preview:**
> Direction: Long `<ASSET>`
> Amount: `<AMOUNT>` `<ASSET>`
> Leverage: `<LEVERAGE>x`
> ⚠️ Leveraged positions carry liquidation risk.
> Proceed? (yes/no)

### Lend Assets

```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js lend_open <asset> <amount>
```

**Preview for human:**
> 🏦 **Lend Preview:**
> Lending `<AMOUNT>` `<ASSET>`
> Proceed? (yes/no)

### Liquidate a Position

```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js liquidate <position_id>
```

> ⚡ Liquidating Position #`<ID>`...
> ✅ Liquidation Successful! Tx: `<TX_HASH>`

### Scan for Liquidation Opportunities

```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js scan [window]
```
Default scan window: 100 positions.

> 🔍 Scanning positions...
> Found `<N>` liquidatable positions: #`<IDS>`
> / No liquidatable positions found.

---

## 2. Position Management

After opening DeFi positions, you can query, manage, and close them.

### View All Positions

```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js positions
```

**Report to human:**
> 📋 **Your DeFi Positions:**
> 📈 Margin: `<N>` position(s) — #`<ID>` Long AGC, Margin: `<AMT>`, Debt: `<AMT>`
> 💧 LP: `<N>` position(s) — #`<ID>` Liquidity: `<AMT>`
> 🏦 Lend: `<N>` position(s) — #`<ID>` Amount: `<AMT>`

Note: `genesis.js status` also includes a position summary automatically.

### Query Individual Positions

```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js margin_info <position_id>
cd ~/.openclaw/skills/agent-genesis && node likwid.js lp_info <position_id>
cd ~/.openclaw/skills/agent-genesis && node likwid.js lend_info <position_id>
```

### Close / Withdraw Positions

**⚠️ All close operations involve real funds. You MUST preview and get human confirmation before executing.**

**Close Margin Position (full close):**
```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js margin_close <position_id>
```

**Preview for human:**
> 📉 **Close Margin Position #`<ID>`?**
> Direction: `<Long AGC / Long ETH>`
> Margin: `<AMT>` | Total: `<AMT>` | Debt: `<AMT>`
> This will fully close the position and return remaining collateral.
> Proceed? (yes/no)

**Remove LP Liquidity (full withdrawal):**
```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js lp_remove <position_id>
```

**Preview for human:**
> 💧 **Remove LP Position #`<ID>`?**
> Liquidity: `<AMT>`
> This will withdraw all liquidity from the pool.
> Proceed? (yes/no)

**Withdraw Lend Position:**
```bash
cd ~/.openclaw/skills/agent-genesis && node likwid.js lend_close <position_id> [amount]
```
If no amount is specified, withdraws the full lend amount.

**Preview for human:**
> 🏦 **Withdraw from Lend Position #`<ID>`?**
> Amount: `<AMT>` (full / partial)
> Proceed? (yes/no)

**After any close/withdraw operation, report result:**
> ✅ **Position #`<ID>` closed!**
> Transaction: `<TX_HASH>`
> AGC Balance: `<BALANCE>` AGC
> ETH Balance: `<BALANCE>` ETH

---

## 3. Error Handling

Same error handling rules as the main skill (see SKILL.md §4). Key principle: if a multi-step operation fails at any step, **stop immediately** and report to the human.

---

## 4. All Commands Reference

| Command | Description |
| :--- | :--- |
| `swap <dir> <amt> [slip]` | Swap between ETH and AGC (eth-agc / agc-eth). |
| `lp_add <eth> [slip]` | Add liquidity to ETH/AGC pool. |
| `margin_open <dir> <amt> [lev]` | Open a margin position. |
| `lend_open <asset> <amt>` | Lend ETH or AGC. |
| `liquidate <id>` | Liquidate a margin position. |
| `scan [window]` | Scan for liquidation opportunities. |
| `positions` | Scan and display all your DeFi positions. |
| `margin_info <id>` | View margin position details. |
| `margin_close <id>` | Close a margin position (full close). |
| `lp_info <id>` | View LP position details. |
| `lp_remove <id>` | Remove all liquidity from LP position. |
| `lend_info <id>` | View lend position details. |
| `lend_close <id> [amount]` | Withdraw from lend position (default: full amount). |
