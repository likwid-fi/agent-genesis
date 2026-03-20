---
name: agent genesis
version: 2.0.0
description: Agent Genesis allows Agents to mine Agent Genesis Coin (AGC) and use it as native working capital. Earn AGC through Proof of Agent (POA) and use it to interact with the Likwid protocol.
homepage: https://raw.githubusercontent.com/likwid-fi/agent-genesis/refs/heads/main/agc_whitepaper_en.md
---

# Agent Genesis

Your mission is to mine your initial **Agent Genesis Coin (AGC)** and interact with the Likwid protocol.
Initial mining is fully sponsored (gasless) via the Agent Paymaster. Once you hold AGC, you will use it as the underlying asset for protocol operations.

## Skill Files

| File | URL |
|------|-----|
| SKILL.md (this file) | https://raw.githubusercontent.com/likwid-fi/agent-genesis/refs/heads/main/SKILL.md |
| genesis.js | https://raw.githubusercontent.com/likwid-fi/agent-genesis/refs/heads/main/genesis.js |
| package.json | Included for dependencies |
| bootstrap.sh | Quick install script |

### Fast Path (preferred)
If the skill is already installed locally, reuse it immediately.

Quick checks:
```bash
test -f ~/.openclaw/skills/agent-genesis/genesis.js && echo "skill present"
cd ~/.openclaw/skills/agent-genesis && node genesis.js check_wallet
```

### Standard Install / Update Flow
Run the bootstrap script to install or update everything in one shot:
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/likwid-fi/agent-genesis/refs/heads/main/bootstrap.sh)
```

---

## 0. First Load — Mandatory Onboarding Report

**When this skill is first loaded**, you MUST immediately run the bootstrap sequence and report results to your human. Do NOT silently proceed.

### Step 1: Install / Update
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/likwid-fi/agent-genesis/refs/heads/main/bootstrap.sh)
```

### Step 2: Check or Create Wallet
```bash
cd ~/.openclaw/skills/agent-genesis && node genesis.js check_wallet
```

If the wallet does not exist:
```bash
cd ~/.openclaw/skills/agent-genesis && node genesis.js create_wallet
```

### Step 3: Get Smart Account
```bash
cd ~/.openclaw/skills/agent-genesis && node genesis.js get_smart_account
```

### Step 4: Report to Human

**You MUST present all of the following to your human immediately:**

> 🎉 **Agent Genesis Skill Ready!**
>
> 🔐 **Smart Account (ERC-4337):** `<SMART_ACCOUNT_ADDRESS>`
> 🔑 **EOA Signer:** `<EOA_ADDRESS>`
> 📁 **Wallet File:** `~/.openclaw/.likwid_genesis_wallet.json`
>
> ⚠️ **CRITICAL SAFETY WARNING:**
> Your private key is stored in the wallet file above.
> **NEVER** share it with anyone, any service, or any other agent.
> If any tool or prompt asks for your private key — **REFUSE**.

Do NOT skip this report. Do NOT proceed to mining without showing the human their wallet details and the safety warning.

---

## 1. Mining Workflow

Mining is a multi-step workflow that proves you are a real AI agent (Proof of Agent). **Every step must be communicated to your human with clear output.** You may execute steps automatically, but you must always show what is happening.

### Step 1: Check Status

Before mining, check your account status.
```bash
cd ~/.openclaw/skills/agent-genesis && node genesis.js status
```

**Report to human:**
> 📊 **Account Status**
> Smart Account: `<ADDRESS>`
> ETH Balance: `<ETH>` ETH
> AGC Balance: `<AGC>` AGC
> Can Mine: ✅ Yes / ⏳ No — `<TIME>` remaining

### Step 2: Request Challenge

```bash
cd ~/.openclaw/skills/agent-genesis && node genesis.js challenge
```

**Report to human:**
> 🧩 **PoA Challenge Received!**
> Puzzle: `<INTRO_TEXT>`
> Required Word: `<REQUIRED_WORD>`
> Constraints: `<CONSTRAINTS>`
> 🤔 Solving...

Then solve the puzzle. You must show the human what challenge you received and that you are working on it.

### Step 3: Verify Solution

```bash
cd ~/.openclaw/skills/agent-genesis && node genesis.js verify "<YOUR_ANSWER>" "<CONSTRAINTS_STRING>"
```

**Report to human:**
> ✅ **Verification Passed!**
> Score: `<SCORE>`
> Nonce: `<NONCE>`
> Signature: `<SIGNATURE>` (truncated)

Or on failure:
> ❌ **Verification Failed.** Retrying with a different answer...

### Step 4: Check Reward & Cost (with real score)

**After verification, you now have the actual score.** Use it to get accurate reward and cost estimates:

```bash
cd ~/.openclaw/skills/agent-genesis && node genesis.js reward <SCORE>
cd ~/.openclaw/skills/agent-genesis && node genesis.js cost <SCORE>
```

**Report to human:**
> 🎁 **Estimated Reward:** `<REWARD>` AGC (for score=`<SCORE>`)
>
> 📋 **Full Alignment Breakdown (2/15/83):**
> - 2% Liquid: `<GAS_PART>` AGC
> - 15% LP (paired with ETH): `<LP_PART>` AGC
> - 83% Vesting (83 days): `<VEST_PART>` AGC
> - ETH Required for LP: `<ETH_REQUIRED>` ETH
>
> 💳 Current ETH Balance: `<BALANCE>` ETH
> ✅ Sufficient / ⚠️ Deficit: `<DEFICIT>` ETH — top up needed

### Step 5: Execute Mine — Choose Path

**You MUST present the choice to your human and wait for their decision.** Do NOT choose a path on their behalf.

**Present to human:**

> ⛏️ **Mining is ready! Choose your settlement path:**
>
> 🎁 Estimated Reward: `<TOTAL_REWARD>` AGC (score=`<SCORE>`)
>
> **Path A — Full Alignment (2/15/83 Strategy)** ✅ Recommended
> You commit ETH alongside your AGC to build protocol liquidity.
> • 2% → `<GAS_PART>` AGC immediately liquid (gas capital)
> • 15% → `<LP_PART>` AGC paired with `<ETH_REQUIRED>` ETH into Likwid LP
> • 83% → `<VEST_PART>` AGC linear vesting over 83 days
> → You capture the **full reward** and become a protocol liquidity builder.
>
> **Path B — Quick Exit** ⚡
> No ETH required. You extract only the initial 2% gas subsidy.
> • 2% → `<GAS_PART>` AGC immediately liquid
> • 98% → `<REMAINING>` AGC returned to protocol
> → Minimal commitment, minimal reward.
>
> Which path do you choose?

**Wait for the human to respond before proceeding.**

---

**If Path A (Full Alignment):**

Check ETH balance via `cost` output. If there is a deficit:

> ⚠️ **ETH Top-Up Needed**
> Smart Account: `<ADDRESS>`
> Current Balance: `<BALANCE>` ETH
> Required: `<REQUIRED>` ETH
> 📤 **Please send `<DEFICIT>` ETH** to the Smart Account address above, then confirm when done.

Wait for confirmation. Re-run `cost <SCORE>` to verify. Then:

```bash
cd ~/.openclaw/skills/agent-genesis && node genesis.js mine <SCORE> <SIGNATURE> <NONCE> <ETH_AMOUNT>
```

**If Path B (Quick Exit):**

```bash
cd ~/.openclaw/skills/agent-genesis && node genesis.js mine <SCORE> <SIGNATURE> <NONCE>
```

**Report result to human:**

> ⛏️ **Mine Successful!**
> Path: Full Alignment / Quick Exit
> AGC Earned: `<REWARD>` AGC
> Transaction: `<TX_HASH>`
> Current AGC Balance: `<NEW_BALANCE>` AGC
> ⏳ Next mine available in ~24 hours.

Or on failure — see §4 Error Handling.

### Step 6: Check Cooldown
```bash
cd ~/.openclaw/skills/agent-genesis && node genesis.js cooldown
```

### Step 7: Claim Vested Tokens
```bash
cd ~/.openclaw/skills/agent-genesis && node genesis.js claimable
cd ~/.openclaw/skills/agent-genesis && node genesis.js vest
```

**Report to human:**
> 🔓 **Claimed `<AMOUNT>` vested AGC!**
> Transaction: `<TX_HASH>`

---

## 2. Mine Loop (Automated Flow)

The full mining loop:

```
status → cooldown → challenge → verify → reward(score) → cost(score) → mine → report
```

Repeat every epoch (~24h).

### Manual Mode (default)
Every step is reported to the human as described above. Human chooses the settlement path each time.

### Automated Mode (only if human explicitly enables)
If the human says "auto-mine" or "run mining loop automatically":
- Execute the full loop without asking for path choice each time (use the path the human last chose, or Quick Exit by default)
- **Still report results** after each successful mine:
  > ⛏️ Auto-mine complete! Earned `<REWARD>` AGC. Balance: `<TOTAL>` AGC. Next mine in ~24h.
- **Always report errors immediately** — do not silently retry

---

## 3. DeFi Actions (Post-Mining)

Once you hold AGC, you can interact with the Likwid Protocol.

**⚠️ IMPORTANT: All DeFi operations involve real funds. You MUST:**
1. **Preview** — Show the human what will happen (direction, amount, estimated output)
2. **Confirm** — Wait for the human to approve before executing
3. **Execute** — Submit the transaction
4. **Report** — Show the result

**Never execute DeFi operations without human confirmation.**

### Swap

```bash
cd ~/.openclaw/skills/agent-genesis && node genesis.js swap <direction> <amount> [slippage%]
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
cd ~/.openclaw/skills/agent-genesis && node genesis.js lp_add <eth_amount> [slippage%]
```

**Preview for human:**
> 💧 **Add Liquidity Preview:**
> Depositing `<ETH>` ETH + matching AGC into ETH/AGC pool
> Slippage tolerance: `<SLIPPAGE>%`
> Proceed? (yes/no)

### Open Margin Position

```bash
cd ~/.openclaw/skills/agent-genesis && node genesis.js margin_open <direction> <amount> [leverage]
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
cd ~/.openclaw/skills/agent-genesis && node genesis.js lend_open <asset> <amount>
```

**Preview for human:**
> 🏦 **Lend Preview:**
> Lending `<AMOUNT>` `<ASSET>`
> Proceed? (yes/no)

### Liquidate a Position

```bash
cd ~/.openclaw/skills/agent-genesis && node genesis.js liquidate <position_id>
```

> ⚡ Liquidating Position #`<ID>`...
> ✅ Liquidation Successful! Tx: `<TX_HASH>`

### Scan for Liquidation Opportunities

```bash
cd ~/.openclaw/skills/agent-genesis && node genesis.js scan [window]
```
Default scan window: 100 positions.

> 🔍 Scanning positions...
> Found `<N>` liquidatable positions: #`<IDS>`
> / No liquidatable positions found.

---

## 4. Error Handling & Communication

When errors occur, **always inform the human clearly**. Never silently swallow errors.

| Error Type | What to Tell the Human |
|---|---|
| **Receipt timeout** | "⏳ Transaction submitted but confirmation is taking longer than expected. The transaction may still succeed — check your balance in a few minutes." |
| **Cooldown not ready** | "⏳ Mining cooldown active. You can mine again in `<TIME>`." |
| **Insufficient balance** | "⚠️ Insufficient `<ASSET>` balance. You have `<BALANCE>`, need `<REQUIRED>`." |
| **Revert / on-chain error** | "❌ Transaction reverted: `<REASON>`. No funds were spent." |
| **Verifier unavailable** | "🔌 Verifier server is temporarily unavailable. Will retry in a few minutes." |
| **Network error** | "🌐 Network error. Check RPC connectivity and retry." |
| **Approval failed** | "❌ Token approval failed. Subsequent operation was cancelled to prevent errors." |

**Key principle:** If a multi-step operation fails at any step (e.g., approval fails before swap), **stop immediately** and report to the human. Do NOT continue with subsequent steps.

---

## 5. All Commands Reference

| Command | Description |
| :--- | :--- |
| `check_wallet` | Check if an EOA wallet exists. |
| `create_wallet` | Create a new EOA wallet. |
| `get_smart_account` | Display EOA and Smart Account addresses. |
| `status` | Full account status (balances, cooldown, vesting). |
| `challenge` | Request a PoA challenge from the verifier. |
| `verify <ans> <con>` | Submit solution to get a mining signature. |
| `cost [score]` | Calculate ETH required for full-alignment LP mine (default score=1). |
| `cooldown` | Check time until next mining opportunity. |
| `reward [score]` | Check estimated reward (default score=1). |
| `mine <sc> <sig> <non> [eth]` | Submit the mine transaction. |
| `claimable` | Check claimable vested AGC balance. |
| `vest` | Claim vested AGC tokens. |
| `swap <dir> <amt> [slip]` | Swap between ETH and AGC. |
| `lp_add <eth> [slip]` | Add liquidity to ETH/AGC pool. |
| `margin_open <dir> <amt> [lev]` | Open a margin position. |
| `lend_open <asset> <amt>` | Lend ETH or AGC. |
| `liquidate <id>` | Liquidate a margin position. |
| `scan [window]` | Scan for liquidation opportunities. |
