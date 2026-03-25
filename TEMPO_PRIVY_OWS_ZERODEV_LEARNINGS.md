# Tempo, OWS, ZeroDev, Privy: Learnings, Failures, and Successes

Date: 2026-03-25
Repo: `/Users/openclaw/Documents/EVVM Tempo Deployer Privy`

This document captures the practical lessons from debugging EVVM deployment and registration across Tempo Testnet, Privy embedded wallets, ZeroDev smart wallets, and the attempted Tempo Wallet / OWS paths.

## Executive Summary

The biggest architecture lesson is:

- **Tempo deployment** should be treated as a **Tempo-native wallet transaction problem**, not a ZeroDev sponsorship problem.
- **Sepolia registration** should be treated as a **cross-chain registry flow**:
  - write to the EVVM registry on **Ethereum Sepolia**
  - then write the assigned EVVM ID back to the EVVM core on the **host chain**

The practical split that emerged:

- **Tempo Testnet deployment**
  - use the funded Privy embedded wallet
  - use Tempo-native transaction behavior where possible
  - do not depend on ZeroDev for the large EVVM deploy path
- **Sepolia registration**
  - use Sepolia for `registerEvvm(...)`
  - then call `setEvvmID(...)` on the Tempo-hosted EVVM core

## Final Architecture Direction

### Tempo Testnet deployment

Recommended model:

- Privy for auth and embedded wallet ownership
- Tempo transaction model for fees
- `pathUSD` as the default fee token candidate
- no ZeroDev sponsorship on Tempo deploys

Why:

- ZeroDev repeatedly failed on Tempo CREATE-heavy EVVM deploys
- direct funded-wallet deploys were more productive than sponsored AA deploys
- Tempo docs indicate fees can be paid in supported stablecoins rather than a native gas token model

### Sepolia EVVM registration

Recommended model:

- register on **Ethereum Sepolia**
- registry contract:
  - `0x389dC8fb09211bbDA841D59f4a51160dA2377832`
- use:
  - `registerEvvm(42431, tempoCoreAddress)` for Tempo-hosted cores
- after the Sepolia registry assigns the EVVM ID:
  - call `setEvvmID(evvmId)` on the Tempo EVVM core

Why:

- this matches the EVVM CLI/docs behavior
- the registration is a cross-chain registry write, not a same-chain Sepolia-core action

## What We Learned By System

## Tempo Wallet / OWS

### What we learned

- Standard EVM wallet signing flows are not enough for all Tempo-native behaviors.
- Tempo sponsorship and Tempo-native transaction handling rely on transaction behavior that is not equivalent to ordinary EIP-1559 wallet sends.
- The original thought that a generic injected wallet path would solve Tempo sponsorship was incorrect for this app’s deployment flow.

### Failure mode

- When routed through Privy approval or generic wallet-style sending, we saw transaction preparation and transaction-type incompatibilities.
- Earlier in the debugging path, sponsored/send attempts exposed incompatibilities around Tempo-specific transaction behavior.

### Practical conclusion

- Do not treat OWS/injected-wallet support as the primary answer for EVVM deployment on Tempo.
- If using external wallet support in the future, treat it as a separate compatibility layer, not the default deployment path.

## Privy

### What worked

- Privy social login worked well as the user entry point.
- Privy embedded wallet creation worked well as the application-owned wallet model.
- Privy approval UX was usable for both Tempo and Sepolia interactions once the underlying transaction shapes were right.

### What failed or misled us

- When the wrong transaction shape was sent, Privy surfaced vague errors such as:
  - transaction creation failed
  - execution reverted for an unknown reason
  - missing or invalid parameters
- Some failures initially looked like wallet/connectivity problems but were really transaction-shape or chain-flow problems.

### Practical conclusion

- Keep Privy as:
  - authentication
  - wallet ownership
  - approval UX
- Do not confuse Privy’s role with sponsorship or protocol-specific transaction behavior.

## ZeroDev

### What worked

- ZeroDev was workable for small sponsored smart-wallet actions in controlled contexts.
- ZeroDev remained useful for the Sepolia smart-wallet / sponsored registration direction.

### What failed

ZeroDev repeatedly failed for the Tempo deployment path.

Observed failure patterns included:

- `zd_sponsorUserOperation`
- `pm_getPaymasterStubData`
- `Delegatecall failed`
- request-shape validation failures
- simulation failures for deploy user operations
- CREATE-heavy deployment rejection

We also reproduced the same behavior outside the browser:

- normal sponsored calls could work
- tiny sponsored deploys could work
- real EVVM deployment payloads failed in the sponsored AA path on Tempo

### Root lesson

- The problem was not just the frontend.
- The ZeroDev + Kernel sponsored deployment path was not reliable for the actual EVVM Tempo deployment path we were running.

### Practical conclusion

- Remove ZeroDev from Tempo deployment.
- Keep ZeroDev where it actually helps:
  - Sepolia registration sponsorship
  - smaller smart-wallet operations

## Tempo Fee Model

### What we learned

- Tempo docs indicate the protocol does not behave like a normal “native gas token only” chain.
- Supported fee tokens can be used for fees.
- `pathUSD` is a valid and important fee token in the Tempo testnet environment.

### Failure that taught us this

- The app initially used native-EVM assumptions:
  - type-2 transactions
  - native gas wording
  - native gas insufficiency handling
- This led to misleading `insufficient funds for gas * price + value` style errors.

### Practical conclusion

- On Tempo, avoid framing fees as native gas only.
- Prefer Tempo-native fee-token transaction handling.
- Surface fee-token balance issues as fee-token issues, not native gas issues.

## EVVM Deployment Flow

## What ultimately worked better

The Tempo deployment wizard progressed once we treated it as a direct wallet deployment flow and fixed contract/deployment issues one by one.

Successful areas included:

- Staking deployment
- EVVM Core deployment
- NameService deployment
- Estimator deployment
- Treasury deployment
- Setup transactions
- P2PSwap reintegration into manifests and dashboard

## Important deployment fixes made

### 1. Core library linking

The EVVM Core bytecode needed correct `CoreHashUtils` library linking.

Without this:

- Core deployment simulation failed
- generic sponsor failures masked the real issue

### 2. Constructor ABI mismatches

Treasury deployment originally used the wrong constructor argument shape.

Fix:

- use the actual current Treasury constructor shape

### 3. Stale EVVM core setup function

The deployer used an older setup selector at one point.

Fix:

- switch to the current EVVM core setup function used by the source/contracts

### 4. P2PSwap was missing from this Privy repo

The dashboard and storage model originally omitted it.

Fix:

- add `p2pSwapAddress` back into:
  - deploy flow
  - storage
  - manifest card
  - dashboard rendering

## EVVM Registration Learnings

## Correct mental model

Registration is not “register this Sepolia core”.

It is:

- register a **Tempo-hosted EVVM core**
- in the **Sepolia EVVM registry**
- then write the assigned EVVM ID back into the Tempo core

## Registry contract

- Sepolia registry:
  - `0x389dC8fb09211bbDA841D59f4a51160dA2377832`

## Correct transaction sequence

1. On **Sepolia**
   - `registerEvvm(42431, tempoCoreAddress)`
2. On **Tempo**
   - `setEvvmID(evvmId)`

## Important UX lesson

Users can easily get confused because:

- the registry write is on Sepolia
- the EVVM ID sync write is on Tempo
- only the registry tx appears on the Sepolia Etherscan page for the registry contract

This means:

- a successful registration flow may involve two tx hashes on two different chains
- if the core is already registered, there may be no new Sepolia tx at all
- only a Tempo `setEvvmID(...)` sync tx may happen

## Prediction vs actual assigned EVVM ID

One of the biggest registration bugs was trusting the simulated return value from `registerEvvm(...)`.

That was wrong because:

- EVVM IDs are sequential
- another registration can land before ours
- the simulated “next ID” can become stale by the time the tx mines

Practical lesson:

- never trust the predicted EVVM ID as final
- always resolve the actual assigned ID after the Sepolia tx mines
- then use that real ID for Tempo `setEvvmID(...)`

## Concrete Failures We Saw

## Wallet / transaction layer

- black screen from render crash due to stale references after removing ZeroDev paths
- Privy modals showing generic “transaction failed”
- Tempo/native send path exposing native-gas wording even when Tempo docs point toward fee tokens

## ZeroDev / smart account layer

- `zd_sponsorUserOperation` failures
- `pm_getPaymasterStubData` failures
- `Delegatecall failed`
- request payload validation errors
- Tempo CREATE path sponsorship rejection

## Contract deployment layer

- unlinked EVVM Core bytecode
- wrong Treasury constructor encoding
- stale core setup selector
- under-gassed deploy attempts

## Registration layer

- using Sepolia-core wording instead of Tempo-core wording
- trusting simulated EVVM IDs
- treating “already registered” as unknown because of wrapped revert handling
- local dashboard EVVM IDs becoming stale or mismatched with on-chain registry assignments

## UI / product framing failures

- promising sponsorship where funded-wallet flow was the real viable path
- mixing deployment concerns with registration concerns
- not making chain boundaries obvious in the registration flow

## Successes

## Product / UX direction

- Privy social login first is a strong UX anchor
- Tempo deployment and Sepolia registration are easier to reason about as separate flows
- the register page is more understandable once framed as cross-chain

## Tempo deployment

- funded-wallet deployment path is more honest and tractable than ZeroDev sponsorship for Tempo
- multi-step deploy flow now supports:
  - Staking
  - EVVM Core
  - NameService
  - Estimator
  - Treasury
  - P2PSwap
  - EVVM setup
  - Staking setup

## Registration flow

- registration can complete with:
  - Sepolia registry tx
  - Tempo `setEvvmID` tx
- local manifests can carry EVVM IDs
- dashboard can show EVVM IDs for saved deployments

## Dashboard / manifest model

- P2PSwap is now part of stored deployments again
- EVVM IDs are visible in dashboard cards
- JSON export includes the extended deployment record

## Current Best-Practice Recommendations

## 1. Tempo deployment

Use:

- Privy login
- Privy embedded wallet
- funded wallet model
- Tempo-native transaction semantics

Avoid:

- ZeroDev as the main deploy path on Tempo

## 2. Sepolia registration

Use:

- Sepolia registry write first
- Tempo core sync second

Always remember:

- the input address is the **Tempo EVVM core**
- the registry lives on **Sepolia**

## 3. EVVM ID handling

Use:

- actual post-mine EVVM ID

Avoid:

- treating simulated “next ID” as final

## 4. Explorer expectations

Use:

- Sepolia Etherscan for `registerEvvm(...)`
- Tempo explorer for `setEvvmID(...)`

Avoid:

- expecting both txs to appear on the Sepolia registry contract page

## Remaining Risks / Open Questions

## Tempo fee-token send compatibility

The code was switched toward Tempo-native fee-token transaction handling, but runtime compatibility still depends on how the Privy embedded provider behaves with Tempo-specific transaction shapes.

This is the next area to validate carefully in real browser sessions.

## Registration UX clarity

The UI would still benefit from making the two-chain registration flow more explicit, for example:

- chain badges on tx hashes
- labels like:
  - `Sepolia registry tx`
  - `Tempo setEvvmID tx`

## Backfilling older dashboard entries

Older saved deployments may still lack newer fields, especially:

- `p2pSwapAddress`
- updated or reconciled EVVM IDs
- richer registration tx metadata

## Recommended Next Enhancements

- Add chain badges to registration success cards
- Store and render both registration tx hashes more explicitly in dashboard cards
- Add a migration/backfill utility for older local manifests
- Validate the Tempo fee-token transaction path end-to-end with the current Privy embedded provider behavior
- Add a “registered on Sepolia / synced on Tempo” status row to dashboard manifests

## Short Version

If someone needs the single most important takeaway:

- **Tempo deployment:** use the funded Privy wallet, not ZeroDev sponsorship
- **Sepolia registration:** register the Tempo core on Sepolia, then write the assigned EVVM ID back to the Tempo core
- **Do not trust predicted EVVM IDs**
- **Do not expect Sepolia registry txs and Tempo sync txs to appear in the same explorer list**
