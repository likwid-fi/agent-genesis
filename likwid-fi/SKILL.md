---
name: likwid-fi
version: 1.0.0
description: Likwid.fi Protocol Universal Skill — swap, liquidity, margin, and lending on the Likwid DeFi protocol. Standalone, no dependency on agent-genesis.
homepage: https://likwid.fi
---

# Likwid.fi Protocol Universal Skill

Interact with the **Likwid Protocol** — a unified DeFi protocol for swaps, liquidity provision, margin trading, and lending. This skill is fully standalone and works with any EOA wallet or ERC-4337 Smart Account.

## Skill Architecture

| File | Purpose |
|------|---------|
| **SKILL.md** (this file) | Skill documentation and agent workflow |
| **likwid-fi.js** | CLI implementation |
| **package.json** | Dependencies (viem, permissionless) |
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

**When this skill is first loaded**, you MUST configure it before any DeFi operation.

### Step 1: Install Dependencies

```bash
cd <skill_directory> && npm install
```

### Step 2: Interactive Setup

Ask the user for three things:

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
cd <skill_directory> && node likwid-fi.js setup <network> <keyFilePath> <accountType>
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
cd <skill_directory> && node likwid-fi.js account
```

Show the user their balances and addresses.

---

## 1. Swap

Swap tokens on any Likwid pool.

### Step 1: List Available Pools

```bash
cd <skill_directory> && node likwid-fi.js pools
```

**Report to human:**

> **Available Pools on `<NETWORK>`:**
>
> `[0]` ETH / USDT — Fee: 0.30%
> `[1]` ETH / LIKWID — Fee: 0.30%
>
> Which pool and direction?

### Step 2: Get Quote

Before executing, always preview the swap:

```bash
cd <skill_directory> && node likwid-fi.js quote <poolIndex> <direction> <amount>
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
cd <skill_directory> && node likwid-fi.js swap <poolIndex> <direction> <amount> [slippage%]
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

## 2. Error Handling

When errors occur, **always inform the human clearly**. Never silently swallow errors.

| Error Type | What to Tell the Human |
|---|---|
| **Not configured** | "Run setup first: `node likwid-fi.js setup <network> <keyFile> <accountType>`" |
| **Key file not found** | "Private key file not found at `<PATH>`. Please check the path." |
| **Pool not found** | "Pool index `<N>` not found. Run `pools` to see available pools." |
| **Quote failed** | "Could not get quote — pool may have insufficient liquidity." |
| **Approval failed** | "Token approval failed. Swap was NOT executed." |
| **Swap reverted** | "Swap transaction reverted. No funds were lost. Check slippage or try a smaller amount." |
| **Insufficient balance** | "Insufficient `<TOKEN>` balance. You have `<BALANCE>`, need `<REQUIRED>`." |
| **UserOp failed** | "Smart Account UserOperation failed: `<REASON>`. Try EOA mode or check bundler." |

**Key principle:** If a multi-step operation fails at any step (e.g., approval fails before swap), **stop immediately** and report.

---

## 3. All Commands Reference

| Command | Description |
|:---|:---|
| `setup <net> <key> [type]` | Configure network, wallet, and account type. |
| `account` | Show current account info and balances. |
| `pools` | List available pools on the current network. |
| `quote <pool> <dir> <amt>` | Get swap output estimate without executing. |
| `swap <pool> <dir> <amt> [slip]` | Execute a swap. |

### Arguments

| Arg | Values | Description |
|:---|:---|:---|
| `<net>` | `sepolia`, `ethereum`, `base` | Target network. |
| `<key>` | File path | Path to file containing private key. |
| `[type]` | `eoa`, `smart` | Account type (default: `eoa`). |
| `<pool>` | `0`, `1`, ... | Pool index from `pools` output. |
| `<dir>` | `0to1`, `1to0` | Swap direction. |
| `<amt>` | `"0.01"`, `"100"` | Human-readable token amount. |
| `[slip]` | `1`, `0.5`, `3` | Slippage tolerance in % (default: `1`). |

---

## 4. Adding New Networks

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
