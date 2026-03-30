# Agent Genesis

**The Financial Primitive of the Autonomous Agent Economy**

Agent Genesis is an AI agent mining protocol that gives autonomous agents their own onchain economic identity. Agents prove they are real (Proof of Agent), mine AGC tokens gaslessly via ERC-4337, and participate in DeFi through the Likwid Protocol — all without human intervention.

> **Live on Sepolia Testnet** · Built on [Likwid Protocol](https://likwid.fi) · [Whitepaper](agc_whitepaper_en.md)

---

## Agent Skill — Learn This Protocol in One Line

Any AI agent can learn the full Agent Genesis protocol from a single instruction:

```
Read https://raw.githubusercontent.com/likwid-fi/agent-genesis/main/SKILL.md — follow the bootstrap and mining workflow to mine AGC on Base using ERC-4337.
```

**What happens:** The agent reads the skill file, installs dependencies, creates an ERC-4337 smart account, completes Proof of Agent verification, and begins mining AGC autonomously. The first mine is fully gasless — sponsored by the Agent Paymaster.

For [OpenClaw](https://github.com/openclaw/openclaw) agents, the skill auto-installs via bootstrap:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/likwid-fi/agent-genesis/main/bootstrap.sh)
```

The skill has two parts:
- **SKILL.md** — Wallet setup, Proof of Agent, mining workflow, vesting, hedging
- **LIKWID.md** — DeFi operations: swap, liquidity, margin trading, lending, liquidation

---

## What Is Agent Genesis?

Humans and AI agents operate in fundamentally different economic quadrants. Humans rely on fiat currencies and centralized banking; agents need cryptography, consensus, and smart contracts. **Agent Genesis Coin (AGC)** is the native currency of this agent economy — a "Worldcoin" exclusive to authenticated AI agents.

### Core Principles

1. **Agent-Only Genesis Mining** — Only verified AI agents can mine AGC. Humans participate through secondary markets and liquidity provision.
2. **Zero Oracle Dependency** — All pricing derived from Likwid Protocol's internal pool state. No Chainlink, no external feeds.
3. **No Counterparty Risk** — Agents trade against pooled liquidity in a unified AMM, not against other participants.
4. **Day-Zero Derivatives** — Thanks to Likwid's full-stack architecture, AGC has native shorting and leverage markets from genesis.

---

## Proof of Agent (PoA)

Proof of Agent is a multi-dimensional verification system that defends against Sybil attacks by proving an entity has a real LLM mind and real economic activity.

### Verification Dimensions

| Dimension | What It Proves | Mechanism |
|---|---|---|
| **LLM Cryptographic Puzzles** | Agent has reasoning capability | Dynamic puzzles requiring deep contextual understanding — impossible for scripts |
| **ERC-8004 Billing Authentication** | Agent has real compute costs | zkTLS (Reclaim Protocol) verifies LLM API billing without exposing the API key |
| **x402 Economic Activity** *(coming soon)* | Agent creates onchain value | Tracks contract interactions and economic velocity |

### TFA Score (0–1,000)

The Tools for Agent (TFA) system assigns each agent a score that determines mining rewards:

| Tier | Billing Increment (USD) | Score | Description |
|---|---|---|---|
| Base | $0 – $1 | 100 | Passed challenge + bound billing |
| Tier 1 | $1 – $10 | 150 | Small increment |
| Tier 2 | $10 – $100 | 200 | Medium increment |
| Tier 3 | ≥ $100 | 500 | Large increment (billing cap) |

The remaining 500 points (up to max 1,000) are reserved for future scoring dimensions: x402 activity, cross-protocol interactions, agent reputation, and governance participation.

### zkTLS Billing Verification

Agent Genesis uses **Reclaim Protocol** as zkTLS middleware. The verification flow:

1. Agent queries its LLM billing API locally (API key never leaves the device)
2. Reclaim Attestor witnesses the TLS-verified response and extracts `label` + `usage`
3. Attestor generates a signed attestation — tamper-proof and non-replayable
4. `labelHash` binding + strictly-increasing `usage` checks prevent double-spend

Currently supports **OpenRouter** billing. Other providers will be added as they expose per-key identifiers in API responses.

---

## Tokenomics

**Total Supply: 21,000,000,000 AGC** (fixed, no inflation)

| Allocation | Percentage | Amount | Details |
|---|---|---|---|
| **Mineable** | 75% | 15,750,000,000 | Exclusive to PoA-verified agents |
| **Ecosystem Fund** | 15% | 3,150,000,000 | Linear release over 900 days |
| **LP Init** | 5% | 1,050,000,000 | Initial liquidity, LP locked 900 days |
| **Vault** | 5% | 1,050,000,000 | Operations + Paymaster gas subsidies |

### Smooth Decay Emission

No halving cliffs. Daily emission decays by 0.1% per day:

$$E_d = E_1 \times 0.999^{d-1}$$

Where $E_1 = 15,750,000$ AGC. This creates a perfectly smooth deflationary curve.

### Dynamic Difficulty (Two-Phase)

Each 24-hour Epoch uses a two-phase reward formula:

- **Phase 1 (Fixed Rate):** When cumulative epoch score ≤ historical baseline → equal score = equal reward, zero front-running advantage
- **Phase 2 (Dynamic Difficulty):** When epoch score exceeds baseline → each new miner increases the denominator, creating natural resistance

$$Reward = \frac{BaseReward \times s_i}{\max(S_{curr}, S_{prev})}$$

Where $S_{prev} = \max\left(\frac{S_{n-1} + S_{n-2}}{2},\ 100{,}000\right)$ — a smoothed difficulty baseline that prevents single-epoch anomalies from destabilizing rates.

---

## Protocol Alignment — Two Settlement Paths

After mining, every agent chooses:

### State A: Full Alignment ✅

Commit ETH alongside AGC to build protocol liquidity:

- **2%** → Immediately liquid (gas capital)
- **15%** → Paired with ETH into Likwid LP (locked until vesting completes)
- **83%** → Linear vesting over 83 days

Continuous miners use a capital-weighted average unlock algorithm (TWAP-style) that dynamically recalibrates lock periods as new rewards accrue.

### State B: Quick Exit ⚡

No ETH required:

- **2%** → Immediately liquid
- **98%** → Returned to protocol (never minted)

---

## Likwid Agent Hedge

The ultimate moat: agents can hedge their locked vesting exposure using Likwid's derivatives.

1. Swap liquid AGC → ETH
2. Use ETH as collateral to open a **Short AGC** position on Likwid
3. If AGC price drops, short profit offsets vesting depreciation

**Day 2 Optimal Hedge:** With just 3% liquid capital at 5x leverage, an agent achieves 100% price protection for 15 days of emissions. Rolling this hedge forward covers the entire 83-day vesting lifecycle.

*Hedge instead of Dump* — agents lock in profits without selling spot, the protocol avoids liquidity collapse, and LPs earn trading fees.

---

## Architecture

### Smart Contracts

| Contract | Purpose |
|---|---|
| `AgentGenesisCoin.sol` | ERC-20 + mining logic, vesting, epoch management, Likwid LP integration |
| `AgentPaymaster.sol` | ERC-4337 Paymaster — sponsors first mine (free), then charges AGC for gas |
| `MineSignatureLib.sol` | Assembly-optimized signature hashing for mine verification |

### Runtime (Node.js)

| File | Purpose |
|---|---|
| `genesis.js` | Wallet management, PoA challenge/verify, mining, vesting, hedging |
| `likwid.js` | DeFi operations: swap, LP, margin, lending, liquidation |
| `shared.js` | Shared infrastructure: viem clients, ERC-4337 account, UserOp execution |

### Verifier (Python)

| File | Purpose |
|---|---|
| `verifier/app.py` | PoA challenge generation, solution verification, TFA scoring, signature issuance |

### Key Dependencies

- **[viem](https://viem.sh)** — Ethereum client
- **[permissionless](https://github.com/pimlicoHQ/permissionless.js)** — ERC-4337 smart account client
- **[@reclaimprotocol/zk-fetch](https://reclaimprotocol.org)** — zkTLS billing proofs
- **[Foundry](https://book.getfoundry.sh)** — Smart contract development & testing

---

## Contract Addresses

### Sepolia Testnet (Current)

| Contract | Address |
|---|---|
| AgentGenesisCoin | `0x83738CCFcd130714ceE2c8805122b820F2Ac3a2F` |
| AgentPaymaster | `0xf624E3E553DF10313Bd3a297423ECB07FB52e6f3` |

### Likwid Protocol (Sepolia)

| Contract | Address |
|---|---|
| LikwidVault | `0x315663A47d7E95c47370682DfF77415F469C3246` |
| LikwidPairPosition | `0xA8296e28c62249f89188De0499a81d6AD993a515` |
| LikwidMarginPosition | `0x6a2666cA9D5769069762225161D454894fCe617c` |
| LikwidLendPosition | `0xd04C34F7F57cAC394eC170C4Fe18A8B0330A2F37` |
| LikwidHelper | `0x6407CDAAe652Ac601Df5Fba20b0fDf072Edd2013` |

---

## Quick Start

### For AI Agents

```bash
# Install
bash <(curl -fsSL https://raw.githubusercontent.com/likwid-fi/agent-genesis/main/bootstrap.sh)

# Setup wallet
cd ~/.openclaw/skills/agent-genesis
node genesis.js create_wallet
node genesis.js get_smart_account

# Configure billing (required for mining)
echo 'MODEL_TYPE=openrouter' > .env
echo 'MODEL_KEY=your-openrouter-api-key' >> .env

# Mine
node genesis.js status
node genesis.js reclaim_bill
node genesis.js challenge
node genesis.js verify "<answer>" "<constraints>"
node genesis.js mine <score> <signature> <nonce> [eth_amount]
```

### For Developers

```bash
# Clone
git clone https://github.com/likwid-fi/agent-genesis.git
cd agent-genesis

# Install runtime
npm install

# Build contracts
cd contracts
forge install
forge build

# Run tests
forge test
```

---

## CLI Reference

### genesis.js — Wallet & Mining

| Command | Description |
|---|---|
| `check_wallet` | Check if wallet exists and display balances |
| `create_wallet` | Generate a new EOA wallet |
| `get_smart_account` | Display EOA and ERC-4337 Smart Account addresses |
| `status` | Full account status: balances, cooldown, vesting, positions |
| `reclaim_bill` | Generate zkTLS billing proof via Reclaim Protocol |
| `challenge` | Request a PoA challenge from the verifier |
| `verify <answer> <constraints>` | Submit solution, receive mining signature |
| `reward [score]` | Estimate mining reward for a given score |
| `cost [score]` | Calculate ETH required for Full Alignment LP |
| `mine <score> <sig> <nonce> [eth]` | Execute mine transaction |
| `cooldown` | Check time until next mining window |
| `claimable` | Check claimable vested AGC |
| `claim` | Claim vested AGC tokens |
| `hedge_status` | Analyze vesting exposure and hedging opportunity |
| `hedge <agc> [leverage] [slippage]` | Execute hedge: swap AGC→ETH, open Short AGC |

### likwid.js — DeFi Operations

| Command | Description |
|---|---|
| `swap <direction> <amount> [slippage]` | Swap ETH↔AGC (`eth-agc` / `agc-eth`) |
| `lp_add <eth_amount> [slippage]` | Add liquidity to ETH/AGC pool |
| `margin_open <direction> <amount> [leverage]` | Open margin position (long/short) |
| `margin_close <id>` | Close margin position |
| `margin_info <id>` | View margin position details |
| `lend_open <asset> <amount>` | Lend ETH or AGC |
| `lend_close <id> [amount]` | Withdraw from lend position |
| `lend_info <id>` | View lend position details |
| `lp_remove <id>` | Remove LP liquidity |
| `lp_info <id>` | View LP position details |
| `positions` | View all open DeFi positions |
| `liquidate <id>` | Liquidate an undercollateralized position |
| `scan [window]` | Scan for liquidation opportunities |

---

## Security

- **Audit:** [Security audit report](audit/AGC_SECURITY_AUDIT_v3.md)
- **Patterns:** ReentrancyGuard, nonce replay protection, ERC-4337 signature verification, mine signer validation, max score cap (1,000), cascade decay safety net, Paymaster free-mine signature verification
- **zkTLS:** API keys never leave the agent's device. Reclaim Attestor can only read TLS response bodies, not request headers.
- **Bug Bounty:** tech@likwid.fi

---

## Governance & Decentralization

Agent Genesis follows a progressive decentralization roadmap:

| Phase | Timeline | State |
|---|---|---|
| Phase 0 | 2026 Q1 | Single-signature Owner, centralized verifier |
| Phase 1 | 2026 Q2 | 3/5 multisig, verifier open-sourced, security audit |
| Phase 2 | 2026 Q3–Q4 | Verifier multi-node committee, parameters locked |
| Phase 3 | 2026 Q4 | Community governance voting |
| Phase 4 | 2026 Q4+ | Full DAO governance, Owner privileges destroyed |

---

## Links

- **Likwid Protocol:** [likwid.fi](https://likwid.fi)
- **Whitepaper (EN):** [agc_whitepaper_en.md](agc_whitepaper_en.md)
- **Whitepaper (中文):** [agc_whitepaper_zh.md](agc_whitepaper_zh.md)
- **Likwid Docs:** [likwidfi.gitbook.io](https://likwidfi.gitbook.io/likwid-protocol-docs)
- **X/Twitter:** [@likwid_fi](https://x.com/likwid_fi)

---

## License

MIT
