## EVVM Genesis Deployer

EVVM Genesis Deployer is a small React + RainbowKit + wagmi app that:

- **Deploys a full EVVM stack on Base Sepolia** (Staking, Core, NameService, Estimator, Treasury, P2PSwap)
- **Links Core with its Solidity library** and uses compiled Foundry bytecode
- **Registers the EVVM instance on the Registry EVVM contract on Ethereum Sepolia**
- **Provides a Signature Builder** for EVVM EIP‑191 messages (Pay, DispersePay, Staking)
- **Includes a Social Token faucet** (testnet‑only) for the deployed EVVM instance

### Prerequisites

- Node 18+ (or Bun)  
- An Ethereum wallet with **Base Sepolia** and **Ethereum Sepolia** testnet ETH  
- Foundry build outputs for EVVM contracts available locally (see `scripts/extract-bytecodes.mjs`)

### Install & Run

```bash
git clone https://github.com/arunnadarasa/evvm-genesis-deployer
cd evvm-genesis-deployer
npm install
npm run dev
```

App runs by default at `http://localhost:8081`.

### Workflow

1. **Compile EVVM contracts** (from the EVVM contracts repo) so that `out/` artifacts exist on disk.  
2. **Generate bytecodes**:

```bash
node scripts/extract-bytecodes.mjs \
  --artifactsRoot "/path/to/NHS EVVM/out" \
  --outFile "src/lib/contracts/bytecodes.ts"
```

3. **Deploy contracts**  
   - Go to the **Deploy** tab.  
   - Configure EVVM name and admin addresses.  
   - Run the **7‑step deployment + registry wizard**:
     1. Staking  
     2. EVVM Core (with CoreHashUtils library linking)  
     3. NameService  
     4. Estimator  
     5. Treasury  
     6. P2PSwap  
     7. Registry registration on **Ethereum Sepolia** (returns an EVVM ID)

4. **View deployments**  
   - The **Dashboard** shows each deployment, contract addresses and the **Registry (Sepolia)** tx link.

5. **Build signatures**  
   - From Dashboard, click **Sign** on a deployment.  
   - The **Signature Builder**:
     - Preselects the deployment and its **EVVM ID**.  
     - Lets you build **Pay**, **DispersePay**, and **Staking** signatures.  
     - Provides a token selector (`ETH (0x0)` or your Social Token / principal token at `0x…0001`).

6. **Mint Social Token (testnet faucet)**  
   - In **Signatures → Faucet**:  
     - Choose recipient (defaults to connected wallet).  
     - Choose amount (wei) for the **principal token**.  
     - Click **Mint** to call `Core.addBalance(user, token, quantity)` on Base Sepolia.  
   - Use the minted balance with the Pay/DispersePay flows.

### Gas sponsorship (ZeroDev) and login (Privy)

- **Privy** is used for **social login only** (email, Google) and embedded wallet creation. No Privy wallet RPC is used for deployment, so there are no 500/429 errors from Privy’s API on the deploy path.
- **ZeroDev** sponsors **smaller** deploys (e.g. Staking, NameService, …) via Kernel UserOps. **EVVM Core** initcode is larger than ZeroDev’s sponsored UserOp `callData` limit (~32KB), so Core needs a **separate gas payer**:
  - **Option A — Platform deploy treasury (recommended for production):** Run a **single dedicated sponsor** (hot wallet + `largeDeploySponsor` API) that pays Core `CREATE` gas for **every EVVM instance** users deploy through your platform—not one treasury per EVVM, and not the on-chain **EVVM Treasury** contract (that contract is deployed only *after* Core exists).
  - **Option B — User embedded wallet:** If the platform treasury is not configured, each user funds their Privy embedded wallet on Base Sepolia for the Core step only.

**Platform deploy treasury (all EVVMs on this app)**

1. Fund one **Base Sepolia** hot wallet (your platform ops budget); put its private key in `server/.env` as `DEPLOY_SPONSOR_PRIVATE_KEY`.
2. Run `npm run dev:sponsor` (or host the same `/deploy` endpoint in production). **Every** Core deploy across all users goes through this wallet until you rotate keys or add quotas.
3. App env: `VITE_LARGE_DEPLOY_SPONSOR_URL` + `VITE_LARGE_DEPLOY_SPONSOR_FROM` = that wallet’s address (must match the key). Restart the frontend after changes.
4. Hardening: `SPONSOR_API_SECRET` on the server; in production, **do not** put that secret in `VITE_*`—proxy `/deploy` behind your API with auth/rate limits so the treasury cannot be drained by arbitrary calldata.

**ZeroDev dashboard:** Gas policy for project `92691254-2986-488c-9c5d-b6028a3deb3a` on Base Sepolia at [dashboard.zerodev.app](https://dashboard.zerodev.app).

### Environment / Chains

- **Deployment chain**: Base Sepolia (chain ID `84532`)  
- **Registry chain**: Ethereum Sepolia (chain ID `11155111`)  
- Registry EVVM proxy address (Sepolia): `0x389dC8fb09211bbDA841D59f4a51160dA2377832`

### Important Notes

- The faucet (`addBalance`) and some reduced cooldowns are **testnet‑only** conveniences; they are **not available on mainnet**.
- All contract ABIs and bytecodes used here are sourced from the official EVVM contracts repositories and Foundry artifacts.

### Official EVVM ecosystem (GitHub)

These repos are the maintained sources for contracts, tooling, and examples—useful alongside this deployer:

| Repo | Purpose |
|------|---------|
| [**testnet-Contracts**](https://github.com/EVVM-org/testnet-Contracts) | Compact toolkit for testnet EVVM: Solidity sources, Foundry scripts, and **`evvm` CLI** (`./evvm deploy`, `register`, etc.). NPM: `@evvm/testnet-contracts`. Docs: [evvm.info](https://www.evvm.info/). |
| [**evvm-js**](https://github.com/EVVM-org/evvm-js) | TypeScript SDK (`@evvm/evvm-js`) for Core, NameService, Staking, P2PSwap with **viem/ethers** signers—good for post-deploy app logic. |
| [**scaffold-evvm**](https://github.com/EVVM-org/scaffold-evvm) | Full dev environment (Next.js + Foundry/Hardhat): `npm run wizard` clones Testnet-Contracts, runs Anvil, deploys the six core contracts locally. |
| [**Hackathon-CoffeShop-Example**](https://github.com/EVVM-org/Hackathon-CoffeShop-Example) | End-to-end **EVVM service** pattern: off-chain EIP-191 signatures, fishers execute on-chain; uses `@evvm/viem-signature-library`. |
| [**evvm-registry-contracts**](https://github.com/EVVM-org/evvm-registry-contracts) | **RegistryEvvm** on testnets (governance, registration); aligns with the Sepolia registry step in this app. |

**Bytecode / artifacts:** You can generate `bytecodes.ts` from any Foundry `out/` tree that matches the deployed EVVM stack (e.g. artifacts from [testnet-Contracts](https://github.com/EVVM-org/testnet-Contracts) after `forge build`).

### Scripts

- `scripts/extract-bytecodes.mjs` – reads Foundry JSON artifacts and generates `src/lib/contracts/bytecodes.ts` with:
  - Creation bytecode for all EVVM contracts
  - Link references for Core’s `CoreHashUtils` library
  - A guard to ensure bytecodes exist before deployment

### License

This frontend is intended for testnet and development use with the EVVM ecosystem. Refer to the upstream EVVM contract repositories for their licenses (EVVM‑NONCOMMERCIAL‑1.0 for core registry/contracts).
