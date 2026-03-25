## EVVM Tempo Deployer Privy

EVVM Tempo Deployer Privy is a React app built around:

- **Privy social login** and embedded wallet creation
- **Tempo Testnet (Moderato)** deployment of the EVVM stack
- **Ethereum Sepolia** registration in the official EVVM registry
- **Signature building** for EVVM EIP-191 flows
- **Local deployment manifests** and dashboard tracking

This repo is the Tempo-focused Privy version of the EVVM deployer, not the older Base Sepolia deployer.

### What This App Does

- Deploys an EVVM stack on **Tempo Testnet (Moderato)**:
  - Staking
  - EVVM Core
  - NameService
  - Estimator
  - Treasury
  - P2PSwap
- Links EVVM Core with its Solidity library (`CoreHashUtils`)
- Registers Tempo-hosted EVVM cores in the official EVVM registry on **Ethereum Sepolia**
- Writes the assigned EVVM ID back to the Tempo core with `setEvvmID(...)`
- Provides a **Signature Builder** for EVVM message flows
- Provides a **Tempo faucet helper** for testnet `pathUSD`

### Current Chain Model

- **Deployment chain**: Tempo Testnet (Moderato), chain ID `42431`
- **Registration chain**: Ethereum Sepolia, chain ID `11155111`
- **Registry contract**: `0x389dC8fb09211bbDA841D59f4a51160dA2377832`

### Current Architecture

#### Tempo deployment

Tempo deployment is handled through the **funded Privy embedded wallet**.

Important:

- Tempo deployment is **not** meant to use ZeroDev sponsorship in this app
- Tempo deploys are treated as **wallet-owned Tempo transactions**
- The intended fee model is Tempo-native and stablecoin-aware, with `pathUSD` as the default fee-token candidate

#### Sepolia registration

Sepolia registration is a **cross-chain** flow:

1. On **Sepolia**, call:
   - `registerEvvm(42431, tempoCoreAddress)`
2. On **Tempo**, call:
   - `setEvvmID(evvmId)`

So:

- the **input address** on the register page is a **Tempo Testnet EVVM core**
- the **registry write** happens on **Sepolia**
- the **EVVM ID writeback** happens on **Tempo**

#### ZeroDev

ZeroDev is kept for the **Sepolia smart-wallet registration direction**, not for Tempo contract deployment.

### Prerequisites

- Node 18+ (or Bun)
- A Privy app configured for:
  - Tempo Testnet
  - Ethereum Sepolia
  - smart wallets / embedded wallets
- A ZeroDev project configured for Sepolia registration flows if you want sponsored Sepolia writes
- Foundry/EVVM build outputs available locally so the bytecodes can be generated

### Install & Run

```bash
git clone https://github.com/arunnadarasa/evvmtempodeployprivy
cd evvmtempodeployprivy
npm install
npm run dev
```

App runs at:

- [http://localhost:8081](http://localhost:8081)

### Workflow

### 1. Generate EVVM bytecodes

Compile EVVM contracts from the upstream EVVM contracts repo so Foundry artifacts exist, then generate:

```bash
node scripts/extract-bytecodes.mjs \
  --artifactsRoot "/path/to/EVVM/out" \
  --outFile "src/lib/contracts/bytecodes.ts"
```

### 2. Deploy on Tempo Testnet

Go to `/deploy`.

The Tempo deploy wizard now runs as an **8-step flow**:

1. Staking
2. EVVM Core
3. NameService
4. Estimator
5. Treasury
6. P2PSwap
7. Setup EVVM
8. Setup Staking

Notes:

- This flow uses the **Privy embedded wallet**
- It is intended for **Tempo Testnet**
- It is no longer framed as a ZeroDev-sponsored Tempo deployment flow

### 3. Fund the Tempo wallet

The deploy page shows the connected Privy wallet and a Tempo faucet helper.

Current helper:

- request testnet `pathUSD`

Important nuance:

- `pathUSD` is central to the Tempo fee-token model
- the deploy path is being aligned to Tempo-native transaction handling, not a normal native-gas-only EVM assumption

### 4. Register on Sepolia

Go to `/register`.

This page expects:

- a **Tempo Testnet EVVM core address**

The registration flow is:

1. Write the Tempo core into the Sepolia registry
2. Resolve the actual assigned EVVM ID after the Sepolia tx mines
3. Write that EVVM ID into the Tempo core with `setEvvmID(...)`

### 5. View manifests and EVVM IDs

Go to `/dashboard`.

The dashboard shows:

- deployment manifests
- deployed contract addresses
- EVVM IDs when known
- P2PSwap address for newer deployments

### 6. Build signatures

Go to `/signatures`.

The signature builder supports EVVM EIP-191 message flows and uses saved deployment context where available.

### Environment Notes

This repo has gone through several architecture changes. The current intent is:

- **Privy**
  - auth
  - embedded wallets
  - approval UX
- **Tempo**
  - deployment chain
  - fee-token aware transaction model
- **Sepolia**
  - EVVM registry write chain
- **ZeroDev**
  - Sepolia smart-wallet / sponsored path support
  - not the main Tempo deploy mechanism

### Key Learnings

A detailed engineering handoff lives here:

- [TEMPO_PRIVY_OWS_ZERODEV_LEARNINGS.md](./TEMPO_PRIVY_OWS_ZERODEV_LEARNINGS.md)

That file captures:

- Tempo Wallet / OWS learnings
- Privy learnings
- ZeroDev failures and successes
- Tempo fee-token conclusions
- EVVM deploy issues and fixes
- Sepolia registration behavior
- final recommended architecture

### Official EVVM and Tempo References

Useful upstream references:

- [EVVM docs](https://www.evvm.info/)
- [EVVM testnet contracts](https://github.com/EVVM-org/testnet-Contracts)
- [EVVM scaffold](https://github.com/EVVM-org/scaffold-evvm)
- [EVVM registry contracts](https://github.com/EVVM-org/evvm-registry-contracts)
- [Tempo docs](https://docs.tempo.xyz/)
- [Tempo main site](https://tempo.xyz/)
- [Open Wallet Standard](https://github.com/open-wallet-standard/core)

### Scripts

- `scripts/extract-bytecodes.mjs`
  - generate `src/lib/contracts/bytecodes.ts` from Foundry artifacts
- `scripts/debug-core-estimate.mjs`
  - local debug helper for large deploy estimation
- `scripts/debug-zerodev-tempo.mjs`
  - local debug helper for ZeroDev / Tempo sponsorship behavior

### License

This frontend is intended for testnet and development use with the EVVM ecosystem.

Refer to upstream EVVM repositories for contract and registry licensing details.
