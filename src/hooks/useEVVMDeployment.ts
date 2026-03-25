import { useState, useCallback } from 'react';
import { encodeDeployData, type Hash, type PublicClient } from 'viem';
import { sendUserOperation, waitForUserOperationReceipt } from 'viem/account-abstraction';
import { getAction } from 'viem/utils';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { useWallets } from '@privy-io/react-auth';
import { useZeroDevKernelClient } from '@/hooks/useZeroDevKernelClient';
import {
  deployEVVMContracts,
  ZERODEV_SPONSOR_CALLDATA_CHAR_LIMIT,
  type DeploymentConfig,
  type DeploymentProgress,
  type ContractAddresses,
} from '@/lib/contracts/deployment';
import { hasBytecodes } from '@/lib/contracts/bytecodes';
import {
  saveDeployment,
  generateId,
  type DeploymentRecord,
} from '@/lib/storage';
import { getChainName } from '@/lib/wagmi';

/** ZeroDev paymaster validates callData as lowercase hex only; mixed case → "Not valid hex data". */
function bundlerSafeHex(data: `0x${string}`): `0x${string}` {
  return data.toLowerCase() as `0x${string}`;
}

/** After signing, confirm RPC sees the same initcode — Privy+wagmi CREATE can submit 0x00000600… instead of Solidity bytecode (Success + empty getCode). */
async function verifyMempoolMatchesCreateData(
  publicClient: PublicClient,
  hash: Hash,
  expectedData: `0x${string}`
): Promise<void> {
  const exp = expectedData.toLowerCase();
  for (let i = 0; i < 80; i++) {
    const tx = await publicClient.getTransaction({ hash });
    if (tx?.input && tx.input.length > 64) {
      const got = tx.input.toLowerCase();
      if (got !== exp) {
        // #region agent log
        fetch('http://127.0.0.1:7320/ingest/71c8c4fb-0b3d-4f6d-866d-53840d69f636', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '7a9c6a' },
          body: JSON.stringify({
            sessionId: '7a9c6a',
            runId: 'create-verify',
            hypothesisId: 'H-calldata-mismatch',
            location: 'useEVVMDeployment.ts:verifyMempoolMatchesCreateData',
            message: 'on-chain tx.input !== requested Core initcode',
            data: {
              hash,
              gotPrefix: got.slice(0, 48),
              expPrefix: exp.slice(0, 48),
              gotLen: got.length,
              expLen: exp.length,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        throw new Error(
          'Your wallet did not submit the EVVM Core initcode (on-chain transaction data was replaced). ' +
            'Fix: set VITE_LARGE_DEPLOY_SPONSOR_URL + VITE_LARGE_DEPLOY_SPONSOR_FROM and run `npm run dev:sponsor` so Core deploys from the platform treasury, or use an injected wallet (e.g. MetaMask) that supports raw contract creation.'
        );
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** EOA/Privy CREATE for EVVM Core (~38k init); wallet default ~1.2M leaves empty contract + status=1. */
function sponsoredDeployCallGasLimit(deployParams: {
  abi: unknown;
  bytecode: `0x${string}`;
  args: readonly unknown[];
}): bigint {
  const init = encodeDeployData(deployParams as Parameters<typeof encodeDeployData>[0]);
  const byteLen = BigInt((init.length - 2) / 2);
  const estimated = 1_200_000n + byteLen * 400n;
  const minGas = 8_000_000n;
  const maxGas = 14_000_000n;
  if (estimated < minGas) return minGas;
  if (estimated > maxGas) return maxGas;
  return estimated;
}

/** EOA/Privy CREATE for EVVM Core (~38k init); wallet default ~1.2M leaves empty contract + status=1. */
function walletLargeCreateGasLimit(deployParams: {
  abi: unknown;
  bytecode: `0x${string}`;
  args: readonly unknown[];
}): bigint {
  const init = encodeDeployData(deployParams as Parameters<typeof encodeDeployData>[0]);
  const byteLen = BigInt((init.length - 2) / 2);
  const estimated = 1_200_000n + byteLen * 450n;
  const minGas = 8_000_000n;
  const maxGas = 22_000_000n;
  if (estimated < minGas) return minGas;
  if (estimated > maxGas) return maxGas;
  return estimated;
}

export function useEVVMDeployment() {
  const [deploying, setDeploying] = useState(false);
  const [progress, setProgress] = useState<DeploymentProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { address, chain } = useAccount();
  const { wallets, ready: walletsReady } = useWallets();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { client: zerodevClient, account: zerodevAccount, isLoading: zerodevIsLoading } =
    useZeroDevKernelClient();

  // Use the connected wagmi account as the deploy sender, so the tx approval modal
  // comes from the connected Tempo Wallet / OWS flow (not Privy's embedded wallet).
  const deployerAddress = address as `0x${string}` | undefined;

  const canDeploy = !!deployerAddress && walletsReady && !!publicClient && hasBytecodes() && !!walletClient;

  const deploy = useCallback(
    async (config: DeploymentConfig): Promise<DeploymentRecord | null> => {
      if (!publicClient || !chain || !walletsReady || !deployerAddress) {
        setError('Wallet not connected');
        return null;
      }

      setDeploying(true);
      setError(null);

      const deploymentId = generateId();
      const record: DeploymentRecord = {
        id: deploymentId,
        createdAt: new Date().toISOString(),
        evvmName: config.evvmName,
        principalTokenName: config.principalTokenName,
        principalTokenSymbol: config.principalTokenSymbol,
        hostChainId: chain.id,
        hostChainName: getChainName(chain.id),
        adminAddress: config.adminAddress,
        goldenFisherAddress: config.goldenFisherAddress,
        activatorAddress: config.activatorAddress,
        deploymentStatus: 'deploying',
        currentStep: 0,
        txHashes: {},
        totalSupply: config.totalSupply.toString(),
        eraTokens: config.eraTokens.toString(),
        rewardPerOperation: config.rewardPerOperation.toString(),
      };

      saveDeployment(record);

      try {
        // Deploy via the embedded wallet.
        const sendSponsoredTransaction = async (input: {
          chainId: number;
          to?: `0x${string}`;
          data: `0x${string}`;
          value?: bigint;
          deployParams?: { abi: unknown; bytecode: `0x${string}`; args: unknown[] };
          walletContractDeploy?: boolean;
        }) => {
          const isContractDeploy = input.to === undefined || input.to === null;
          const useZeroDevForCall =
            !isContractDeploy &&
            !!zerodevClient &&
            !!zerodevAccount &&
            input.chainId === chain?.id;

          const canZeroDevDeploy =
            isContractDeploy &&
            !!input.deployParams &&
            !!zerodevClient &&
            !!zerodevAccount &&
            input.chainId === chain?.id;
          const forceTempoWalletOnly = (import.meta.env.VITE_TEMPO_WALLET_ONLY ?? 'true') === 'true';
          // #region agent log
          fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1c16cb' },
            body: JSON.stringify({
              sessionId: '1c16cb',
              runId: 'debug-branch-flags',
              hypothesisId: 'H1-zerodev-vs-privy',
              location: 'useEVVMDeployment.ts:sendSponsoredTransaction:branch-flags',
              message: 'Branch flags (ZeroDev vs wallet)',
              data: {
                isContractDeploy,
                useZeroDevForCall,
                canZeroDevDeploy,
                inputChainId: input.chainId,
                currentChainId: chain?.id ?? null,
                walletContractDeploy: input.walletContractDeploy ?? null,
              },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
          // #region agent log
          fetch('http://127.0.0.1:7320/ingest/71c8c4fb-0b3d-4f6d-866d-53840d69f636', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '7a9c6a' },
            body: JSON.stringify({
              sessionId: '7a9c6a',
              runId: 'deploy',
              hypothesisId: 'H1',
              location: 'useEVVMDeployment.ts:sendSponsoredTransaction',
              message: 'sendSponsoredTransaction branch',
              data: {
                isContractDeploy,
                walletContractDeploy: input.walletContractDeploy,
                hasDeployParams: !!input.deployParams,
                chainId: input.chainId,
              },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
          if (isContractDeploy && input.deployParams) {
            let deployViaWallet =
              input.walletContractDeploy === true || !canZeroDevDeploy;

            if (canZeroDevDeploy && !deployViaWallet && !forceTempoWalletOnly) {
              // #region agent log
              fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1c16cb' },
                body: JSON.stringify({
                  sessionId: '1c16cb',
                  runId: 'debug-deploy-decision',
                  hypothesisId: 'H1-zerodev-vs-privy',
                  location: 'useEVVMDeployment.ts:coreDeploy:decision',
                  message: 'Core deploy decision -> ZeroDev userOp',
                  data: {
                    deployViaWallet,
                    canZeroDevDeploy,
                    inputChainId: input.chainId,
                    currentChainId: chain?.id ?? null,
                  },
                  timestamp: Date.now(),
                }),
              }).catch(() => {});
              // #endregion
              const callDataRaw = await zerodevAccount.encodeDeployCallData(input.deployParams);
              const callData = bundlerSafeHex(callDataRaw);
              if (callData.length > ZERODEV_SPONSOR_CALLDATA_CHAR_LIMIT) {
                // #region agent log
                fetch('http://127.0.0.1:7320/ingest/71c8c4fb-0b3d-4f6d-866d-53840d69f636', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '7a9c6a' },
                  body: JSON.stringify({
                    sessionId: '7a9c6a',
                    runId: 'deploy',
                    hypothesisId: 'H-32k-limit',
                    location: 'useEVVMDeployment.ts:deploy',
                    message: 'UserOp callData over sponsor limit, wallet deploy',
                    data: { callDataLen: callData.length, limit: ZERODEV_SPONSOR_CALLDATA_CHAR_LIMIT },
                    timestamp: Date.now(),
                  }),
                }).catch(() => {});
                // #endregion
                deployViaWallet = true;
              } else {
                const callGasLimit = sponsoredDeployCallGasLimit(input.deployParams);
                // #region agent log
                fetch('http://127.0.0.1:7320/ingest/71c8c4fb-0b3d-4f6d-866d-53840d69f636', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '7a9c6a' },
                  body: JSON.stringify({
                    sessionId: '7a9c6a',
                    runId: 'calldata-hex',
                    hypothesisId: 'H-calldata-lowercase',
                    location: 'useEVVMDeployment.ts:ZeroDev deploy',
                    message: 'callData casing for bundler',
                    data: {
                      hadUppercaseHex: callDataRaw !== callData,
                      callDataLen: callData.length,
                      prefix: callData.slice(0, 24),
                    },
                    timestamp: Date.now(),
                  }),
                }).catch(() => {});
                // #endregion
                try {
                  const sendUserOp = getAction(
                    zerodevClient,
                    sendUserOperation,
                    'sendUserOperation'
                  );
                  const waitUoReceipt = getAction(
                    zerodevClient,
                    waitForUserOperationReceipt,
                    'waitForUserOperationReceipt'
                  );
                  const userOpHash = await sendUserOp({
                    account: zerodevAccount,
                    callData,
                    callGasLimit,
                  });
                  const uoReceipt = await waitUoReceipt({ hash: userOpHash });
                  if (!uoReceipt.success) {
                    const reason =
                      uoReceipt.reason?.trim() ||
                      'UserOp reverted (often out-of-gas for large contract deploys).';
                    throw new Error(`Sponsored deploy failed: ${reason}`);
                  }
                  const hash = uoReceipt.receipt.transactionHash;
                  // #region agent log
                  fetch('http://127.0.0.1:7320/ingest/71c8c4fb-0b3d-4f6d-866d-53840d69f636', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '7a9c6a' },
                    body: JSON.stringify({
                      sessionId: '7a9c6a',
                      runId: 'deploy',
                      hypothesisId: 'H2',
                      location: 'useEVVMDeployment.ts:ZeroDev deploy success',
                      message: 'ZeroDev sponsored deploy tx hash',
                      data: { hash, userOpHash, callGasLimit: callGasLimit.toString() },
                      timestamp: Date.now(),
                    }),
                  }).catch(() => {});
                  // #endregion
                  // #region agent log
                  fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1c16cb' },
                    body: JSON.stringify({
                      sessionId: '1c16cb',
                      runId: 'debug-deploy-success',
                      hypothesisId: 'H1-zerodev-vs-privy',
                      location: 'useEVVMDeployment.ts:coreDeploy:zeroDev-success',
                      message: 'ZeroDev deploy completed (tx hash from userOp)',
                      data: { hash, userOpHash, callGasLimit: callGasLimit.toString() },
                      timestamp: Date.now(),
                    }),
                  }).catch(() => {});
                  // #endregion
                  return hash as `0x${string}`;
                } catch (e: unknown) {
                  const errMsg = e instanceof Error ? e.message : String(e);
                  // #region agent log
                  fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1c16cb' },
                    body: JSON.stringify({
                      sessionId: '1c16cb',
                      runId: 'zerodev-core-delegatecall-fallback',
                      hypothesisId: 'H0-zerodev-delegatecall-failed',
                      location: 'useEVVMDeployment.ts:coreDeploy:zerodev-fallback',
                      message: 'ZeroDev core delegatecall simulation failed; falling back to Privy wallet sendTransaction(sponsor=true)',
                      data: { errMsg },
                      timestamp: Date.now(),
                    }),
                  }).catch(() => {});
                  // #endregion
                  deployViaWallet = true;
                }
              }
            }

            if (deployViaWallet) {
              const sponsorBase = import.meta.env.VITE_LARGE_DEPLOY_SPONSOR_URL?.replace(
                /\/$/,
                ''
              );
              const sponsorFromEnv = import.meta.env.VITE_LARGE_DEPLOY_SPONSOR_FROM as
                | `0x${string}`
                | undefined;
              const sponsorSecret = import.meta.env.VITE_SPONSOR_API_SECRET as string | undefined;
              if (
                sponsorBase &&
                sponsorFromEnv &&
                input.walletContractDeploy === true &&
                input.chainId === 42431 &&
                !forceTempoWalletOnly
              ) {
                const r = await fetch(`${sponsorBase}/deploy`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(sponsorSecret ? { 'X-Sponsor-Secret': sponsorSecret } : {}),
                  },
                  body: JSON.stringify({
                    chainId: input.chainId,
                    data: bundlerSafeHex(input.data),
                  }),
                });
                const text = await r.text();
                if (!r.ok) {
                  throw new Error(
                    `Platform treasury deploy failed (${r.status}): ${text.slice(0, 500)}. Fund DEPLOY_SPONSOR_PRIVATE_KEY with native gas on the deployment chain or run npm run dev:sponsor.`
                  );
                }
                const { hash } = JSON.parse(text) as { hash: `0x${string}` };
                // #region agent log
                fetch('http://127.0.0.1:7320/ingest/71c8c4fb-0b3d-4f6d-866d-53840d69f636', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '7a9c6a' },
                  body: JSON.stringify({
                    sessionId: '7a9c6a',
                    runId: 'deploy',
                    hypothesisId: 'H-treasury-sponsor',
                    location: 'useEVVMDeployment.ts:treasurySponsor',
                    message: 'EVVM Core via platform deploy treasury',
                    data: { hash, sponsorBase: sponsorBase.slice(0, 48) },
                    timestamp: Date.now(),
                  }),
                }).catch(() => {});
                // #endregion
                return hash;
              }
              if (!walletClient) {
                throw new Error('Tempo walletClient is not ready to submit the deployment transaction.');
              }
              // #region agent log
              fetch('http://127.0.0.1:7320/ingest/71c8c4fb-0b3d-4f6d-866d-53840d69f636', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '7a9c6a' },
                body: JSON.stringify({
                  sessionId: '7a9c6a',
                  runId: 'deploy',
                  hypothesisId: 'H-wallet-deploy',
                  location: 'useEVVMDeployment.ts:walletContractDeploy',
                  message: 'EOA contract deploy (paid gas)',
                  data: {
                    forcedWallet: input.walletContractDeploy === true,
                    walletContractDeploy: input.walletContractDeploy,
                  },
                  timestamp: Date.now(),
                }),
              }).catch(() => {});
              // #endregion
              /** Wallet default gas ~1.2M is far below large Core CREATE; low gas → receipt success but getCode 0x. */
              const gasLimit =
                input.deployParams != null
                  ? walletLargeCreateGasLimit(input.deployParams)
                  : 12_000_000n;
              // #region agent log
              fetch('http://127.0.0.1:7320/ingest/71c8c4fb-0b3d-4f6d-866d-53840d69f636', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '7a9c6a' },
                body: JSON.stringify({
                  sessionId: '7a9c6a',
                  runId: 'post-fix-gas',
                  hypothesisId: 'H-gas-limit',
                  location: 'useEVVMDeployment.ts:walletCoreDeploy',
                  message: 'EOA Core deploy with explicit gas',
                  data: { gasLimit: gasLimit.toString(), walletContractDeploy: true },
                  timestamp: Date.now(),
                }),
              }).catch(() => {});
              // #endregion
              const deployData = bundlerSafeHex(input.data);
              // #region agent log
              fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Debug-Session-Id': '1c16cb',
                },
                body: JSON.stringify({
                  sessionId: '1c16cb',
                  runId: 'pre-initcode-check',
                  hypothesisId: 'H1-initcode-prefix',
                  location: 'useEVVMDeployment.ts:core-initcode-check',
                  message: 'Core CREATE initcode prefix pre-check',
                  data: {
                    chainId: input.chainId,
                    rawDataPrefix: input.data.slice(0, 12),
                    safeDataPrefix: deployData.slice(0, 12),
                    safeStartsExpected: deployData.startsWith('0x60806040'),
                    rawDataStartsExpected: input.data.startsWith('0x60806040'),
                    deployDataByteLen: (deployData.length - 2) / 2,
                    bytecodePrefix: input.deployParams.bytecode.slice(0, 12),
                    bytecodeByteLen: (input.deployParams.bytecode.length - 2) / 2,
                    argsCount: input.deployParams.args.length,
                  },
                  timestamp: Date.now(),
                }),
              }).catch(() => {});
              // #endregion
              // #region agent log
              fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Debug-Session-Id': '1c16cb',
                },
                body: JSON.stringify({
                  sessionId: '1c16cb',
                  runId: 'pre-initcode-check',
                  hypothesisId: 'H2-data-is-not-initcode',
                  location: 'useEVVMDeployment.ts:core-initcode-check',
                  message: 'Validate initcode-like shape',
                  data: {
                    rawDataStartsWith0x: input.data.startsWith('0x'),
                    safeDataStartsWith0x: deployData.startsWith('0x'),
                    safeDataByteLen: (deployData.length - 2) / 2,
                    expectedBytecodeByteLen: (input.deployParams.bytecode.length - 2) / 2,
                    inputDataLen: input.data.length,
                    bytecodeStartsWith0x60: input.deployParams.bytecode.startsWith('0x60'),
                  },
                  timestamp: Date.now(),
                }),
              }).catch(() => {});
              // #endregion
              // #region agent log
              fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Debug-Session-Id': '1c16cb',
                },
                body: JSON.stringify({
                  sessionId: '1c16cb',
                  runId: 'pre-initcode-check',
                  hypothesisId: 'H3-safehex-is-altering-data',
                  location: 'useEVVMDeployment.ts:core-initcode-check',
                  message: 'Check whether safehex changes prefix',
                  data: {
                    rawDataPrefix: input.data.slice(0, 12),
                    safeDataPrefix: deployData.slice(0, 12),
                    prefixEqual: input.data.slice(0, 12).toLowerCase() === deployData.slice(0, 12),
                  },
                  timestamp: Date.now(),
                }),
              }).catch(() => {});
              // #endregion
              // The initcode prefix is determined by the compiled creation bytecode.
              // Hardcoding a single prefix breaks across bytecode versions.
              const expectedCoreBytecodePrefix = input.deployParams.bytecode
                .slice(0, 12)
                .toLowerCase();
              const actualInitcodePrefix = deployData.slice(0, 12).toLowerCase();
              if (actualInitcodePrefix !== expectedCoreBytecodePrefix) {
                throw new Error(
                  'Internal error: EVVM Core creation payload is not valid Solidity initcode. ' +
                    `Expected initcode prefix ${expectedCoreBytecodePrefix}, got ${actualInitcodePrefix}.`
                );
              }
              // #region agent log
              fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1c16cb' },
                body: JSON.stringify({
                  sessionId: '1c16cb',
                  runId: 'post-fix-guard-pass',
                  hypothesisId: 'H1-initcode-prefix',
                  location: 'useEVVMDeployment.ts:core-initcode-check:guard-pass',
                  message: 'Core CREATE initcode prefix guard passed',
                  data: {
                    expectedCoreBytecodePrefix,
                    actualInitcodePrefix,
                  },
                  timestamp: Date.now(),
                }),
              }).catch(() => {});
              // #endregion
              let hash: `0x${string}`;
              const usedEthSendTransaction = true; // walletClient submits eth_sendTransaction
              try {
                // #region agent log
                fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1c16cb' },
                  body: JSON.stringify({
                    sessionId: '1c16cb',
                    runId: 'no-fee-payer-tx-before-send',
                    hypothesisId: 'H4-fee-payer-transaction-type',
                    location: 'useEVVMDeployment.ts:walletCoreDeploy:before-sendTransaction',
                    message: 'About to call walletClient.sendTransaction',
                    data: {
                      deployDataPrefix: deployData.slice(0, 18),
                      gasLimit: gasLimit.toString(),
                      feePayer: undefined,
                    },
                    timestamp: Date.now(),
                  }),
                }).catch(() => {});
                // #endregion
                // #region agent log
                fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1c16cb' },
                  body: JSON.stringify({
                    sessionId: '1c16cb',
                    runId: 'debug-core-wallet-send',
                    hypothesisId: 'H2-sponsor-ignored',
                    location: 'useEVVMDeployment.ts:coreDeploy:wallet-before-sendTransaction',
                    message: 'Core deploy via walletClient.sendTransaction',
                    data: {
                      usedEthSendTransaction,
                      feePayer: undefined,
                      chainId: chain?.id ?? null,
                      walletClientAccount:
                        typeof walletClient?.account === 'string' ? walletClient.account : null,
                    },
                    timestamp: Date.now(),
                  }),
                }).catch(() => {});
                // #endregion
                hash = (
                  await walletClient.sendTransaction({
                    chainId: input.chainId,
                    data: deployData,
                    value: 0n,
                    gas: gasLimit,
                  } as Parameters<typeof walletClient.sendTransaction>[0])
                ).hash;
              } catch (e: unknown) {
                const errMsg = e instanceof Error ? e.message : String(e);
                // #region agent log
                fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Debug-Session-Id': '1c16cb',
                  },
                  body: JSON.stringify({
                    sessionId: '1c16cb',
                    runId: 'no-fee-payer-tx-failure',
                    hypothesisId: 'H4-fee-payer-transaction-type',
                    location: 'useEVVMDeployment.ts:walletCoreDeploy:feePayer-core',
                    message: 'walletClient.sendTransaction failed',
                    data: {
                      errMsg,
                      deployDataPrefix: deployData.slice(0, 18),
                      gasLimit: gasLimit.toString(),
                    },
                    timestamp: Date.now(),
                  }),
                }).catch(() => {});
                // #endregion

                throw new Error(
                  `Core contract creation failed for Core contract creation. ` +
                    `Original error: ${errMsg}`
                );
              }
              if (publicClient) {
                await verifyMempoolMatchesCreateData(publicClient, hash, deployData);
              }
              // #region agent log
              fetch('http://127.0.0.1:7320/ingest/71c8c4fb-0b3d-4f6d-866d-53840d69f636', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '7a9c6a' },
                body: JSON.stringify({
                  sessionId: '7a9c6a',
                  runId: 'create-verify',
                  hypothesisId: 'H-privy-eth-send',
                  location: 'useEVVMDeployment.ts:walletCoreDeploy:afterVerify',
                  message: 'Core CREATE calldata matched mempool',
                  data: { hash, usedEthSendTransaction },
                  timestamp: Date.now(),
                }),
              }).catch(() => {});
              // #endregion
              return hash;
            }
          }
          if (useZeroDevForCall && !forceTempoWalletOnly) {
            // #region agent log
            fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1c16cb' },
              body: JSON.stringify({
                sessionId: '1c16cb',
                runId: 'debug-call-decision',
                hypothesisId: 'H1-zerodev-vs-privy',
                location: 'useEVVMDeployment.ts:contractCall:zeroDev-branch',
                message: 'Contract call -> ZeroDev userOp (no Privy sponsor flag)',
                data: {
                  to: input.to ?? null,
                  inputChainId: input.chainId,
                  currentChainId: chain?.id ?? null,
                },
                timestamp: Date.now(),
              }),
            }).catch(() => {});
            // #endregion
            try {
              const hash = await zerodevClient.sendTransaction({
                account: zerodevAccount,
                chain: zerodevClient.chain ?? undefined,
                to: input.to,
                data: bundlerSafeHex(input.data),
                value: input.value ?? 0n,
              });
              return hash as `0x${string}`;
            } catch (e: unknown) {
              const errMsg = e instanceof Error ? e.message : String(e);
              // #region agent log
              fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1c16cb' },
                body: JSON.stringify({
                  sessionId: '1c16cb',
                  runId: 'zerodev-call-fallback',
                  hypothesisId: 'H0-zerodev-delegatecall-failed',
                  location: 'useEVVMDeployment.ts:contractCall:zerodev-fallback',
                  message: 'ZeroDev contract call failed; falling back to Privy wallet sendTransaction(sponsor=true)',
                  data: { errMsg, to: input.to ?? null },
                  timestamp: Date.now(),
                }),
              }).catch(() => {});
              // #endregion
            }
          }
          if (!walletClient) {
            throw new Error('Tempo walletClient is not ready to submit the contract call transaction.');
          }
          let hash: `0x${string}`;
          try {
            // #region agent log
            fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1c16cb' },
              body: JSON.stringify({
                sessionId: '1c16cb',
                runId: 'debug-call-wallet-sponsor',
                hypothesisId: 'H2-sponsor-flag',
                location: 'useEVVMDeployment.ts:contractCall:privy-before-sendTransaction-call',
                message: 'About to call walletClient.sendTransaction for contract call',
                data: {
                  to: input.to,
                  inputChainId: input.chainId,
                  currentChainId: chain?.id ?? null,
                },
                timestamp: Date.now(),
              }),
            }).catch(() => {});
            // #endregion
            hash = (
              await walletClient.sendTransaction({
                chainId: input.chainId,
                to: input.to,
                data: input.data,
                value: input.value ?? 0n,
              } as Parameters<typeof walletClient.sendTransaction>[0])
            ).hash;
          } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            // #region agent log
            fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Debug-Session-Id': '1c16cb',
              },
              body: JSON.stringify({
                sessionId: '1c16cb',
                runId: 'no-fee-payer-tx-failure-call',
                hypothesisId: 'H4-fee-payer-transaction-type',
                location: 'useEVVMDeployment.ts:sendSponsoredTransaction:feePayer-call',
                message: 'walletClient.sendTransaction failed for call',
                data: {
                  errMsg,
                  to: input.to ?? null,
                  dataPrefix: input.data.slice(0, 18),
                },
                timestamp: Date.now(),
              }),
            }).catch(() => {});
            // #endregion

            throw new Error(
              `Contract call failed. ` + `Original error: ${errMsg}`
            );
          }
          return hash;
        };

        const contractDeployerAddress = deployerAddress as `0x${string}`;
        const addresses: ContractAddresses = await deployEVVMContracts(
          config,
          publicClient,
          chain.id,
          sendSponsoredTransaction,
          (p) => {
            setProgress(p);
            record.currentStep = p.step;
            if (p.txHash) {
              record.txHashes[p.stage] = p.txHash;
            }
            saveDeployment(record);
          },
          {
            contractDeployerAddress,
            eoaAddressForLargeDeploy: deployerAddress as `0x${string}` | undefined,
            // Force using the connected Tempo wallet/embedded EOA for the actual deploy sender.
            // This keeps Core + metadata prediction consistent with the transaction sender.
            treasuryDeployerAddress: undefined,
          }
        );

        record.stakingAddress = addresses.staking;
        record.evvmCoreAddress = addresses.evvmCore;
        record.nameServiceAddress = addresses.nameService;
        record.estimatorAddress = addresses.estimator;
        record.treasuryAddress = addresses.treasury;
        record.deploymentStatus = 'completed';
        record.currentStep = 7;
        saveDeployment(record);

        setProgress({
          stage: 'complete',
          message: 'Deployment complete!',
          step: 7,
          totalSteps: 7,
        });

        return record;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
            // #region agent log
            fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1c16cb' },
              body: JSON.stringify({
                sessionId: '1c16cb',
                runId: 'deploy-top-level-error',
                hypothesisId: 'H-top-level',
                location: 'useEVVMDeployment.ts:deploy:catch',
                message: 'Top-level deploy error',
                data: { msg },
                timestamp: Date.now(),
              }),
            }).catch(() => {});
            // #endregion
        record.deploymentStatus = 'failed';
        saveDeployment(record);
        setError(msg || 'Deployment failed');
        setProgress({
          stage: 'failed',
          message: msg || 'Deployment failed',
          step: record.currentStep,
          totalSteps: 7,
        });
        return null;
      } finally {
        setDeploying(false);
      }
    },
    [
      publicClient,
      chain,
      walletsReady,
      deployerAddress,
      zerodevClient,
      zerodevAccount,
      zerodevIsLoading,
      walletClient,
    ]
  );

  return { deploying, progress, error, canDeploy, deploy };
}
