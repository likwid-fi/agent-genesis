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
bash <(curl -fsSL https://raw.githubusercontent.com/likwid-fi/agent-genesis/refs/heads/v2.0-dev/likwid-fi/bootstrap.sh)
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

## 2. Add Liquidity

Provide liquidity to a Likwid pool and receive an LP position (ERC-721 NFT).

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

**Report to human before execution:**

> **Add Liquidity Preview:**
> Pool: `<NAME>` (fee: `<FEE>`%)
> Rate: 1 `<SYMBOL0>` = `<RATE>` `<SYMBOL1>`
> `<SYMBOL0>`: `<AMOUNT0>`
> `<SYMBOL1>`: `<AMOUNT1>`
> Slippage: `<SLIPPAGE>`%
>
> Proceed? (yes/no)

**Wait for human confirmation before executing.**

**After execution:**

> **Liquidity Added!**
> Transaction: `<TX_HASH>`
> Block: `<BLOCK_NUMBER>`

Or on failure:

> **Add Liquidity Failed:** `<ERROR_MESSAGE>`
> No funds were spent.

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

## 4. Error Handling

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

## 5. All Commands Reference

| Command | Description |
|:---|:---|
| `setup <net> <key> [type]` | Configure network, wallet, and account type. |
| `account` | Show current account info and balances. |
| `pools` | List available pools on the current network. |
| `pool_info <pool>` | Query on-chain pool state (reserves, rate). |
| `quote <pool> <dir> <amt>` | Get swap output estimate without executing. |
| `swap <pool> <dir> <amt> [slip]` | Execute a swap. |
| `lp_add <pool> <cur> <amt> [slip]` | Add liquidity. `<cur>`: `0` or `1`. |
| `create_pair <t0> <t1> <fee> <mfee>` | Create a new pool. Tokens by name. |

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

---

## 6. Adding New Networks

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
