import { useState, useCallback } from 'react';
import { encodeDeployData, type Hash, type PublicClient } from 'viem';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { useWallets } from '@privy-io/react-auth';
import {
  deployEVVMContracts,
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
  const { data: walletClient } = useWalletClient();
  const { wallets, ready: walletsReady } = useWallets();
  const publicClient = usePublicClient();

  const embeddedWallet =
    wallets.find((w: any) => w?.chainType === 'ethereum' && w?.walletClientType === 'privy') ??
    wallets.find((w: any) => w?.chainType === 'ethereum') ??
    wallets[0];
  const embeddedWalletAddress = embeddedWallet?.address;

  const canDeploy = !!address && walletsReady && !!embeddedWalletAddress && !!publicClient && hasBytecodes();

  const deploy = useCallback(
    async (config: DeploymentConfig): Promise<DeploymentRecord | null> => {
      if (!publicClient || !chain || !walletsReady || !embeddedWalletAddress) {
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
        // Deploy via the embedded wallet; Tempo gas sponsorship is enabled via `feePayer: true`.
        const sendSponsoredTransaction = async (input: {
          chainId: number;
          to?: `0x${string}`;
          data: `0x${string}`;
          value?: bigint;
          deployParams?: { abi: any; bytecode: `0x${string}`; args: any[] };
          walletContractDeploy?: boolean;
        }) => {
          const isContractDeploy = input.to === undefined || input.to === null;
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
            const deployViaWallet = true;

            /*
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
                return hash as `0x${string}`;
              }
            */

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
                input.chainId === 84532
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
                throw new Error(
                  'Configure platform treasury (VITE_LARGE_DEPLOY_SPONSOR_*) or fund the embedded wallet with native gas for Core creation.'
                );
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
              if (!deployData.startsWith('0x60806040')) {
                throw new Error('Internal error: EVVM Core creation payload is not valid Solidity initcode.');
              }
              let hash: `0x${string}`;
              const usedEthSendTransaction = false; // retained for telemetry/debug, but Tempo sponsorship is used.
              try {
                hash = (await walletClient.sendTransaction({
                  data: deployData,
                  value: 0n,
                  gas: gasLimit,
                  // Tempo gas sponsorship (requires `withFeePayer` transport in wagmi config)
                  feePayer: true,
                })) as `0x${string}`;
              } catch (e: unknown) {
                throw new Error(
                  `Tempo fee sponsorship failed for Core contract creation. ` +
                    `Ensure the client is configured with Tempo's \`withFeePayer\` transport and that the fee payer service is reachable. ` +
                    `Original error: ${e instanceof Error ? e.message : String(e)}`
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
          /*
            const hash = await zerodevClient.sendTransaction({
              account: zerodevAccount,
              chain: zerodevClient.chain ?? undefined,
              to: input.to,
              data: bundlerSafeHex(input.data),
              value: input.value ?? 0n,
            });
            return hash as `0x${string}`;
          */
          if (!walletClient) {
            throw new Error('Wallet not ready to send transaction');
          }
          let hash: `0x${string}`;
          try {
            hash = (await walletClient.sendTransaction({
              to: input.to,
              data: input.data,
              value: input.value ?? 0n,
              // Tempo gas sponsorship (requires `withFeePayer` transport in wagmi config)
              feePayer: true,
            })) as `0x${string}`;
          } catch (e: unknown) {
            throw new Error(
              `Tempo fee sponsorship failed for contract call. ` +
                `Original error: ${e instanceof Error ? e.message : String(e)}`
            );
          }
          return hash;
        };

        const contractDeployerAddress = embeddedWalletAddress as `0x${string}`;
        const sponsorUrl = import.meta.env.VITE_LARGE_DEPLOY_SPONSOR_URL;
        const sponsorFrom = import.meta.env.VITE_LARGE_DEPLOY_SPONSOR_FROM as
          | `0x${string}`
          | undefined;
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
            eoaAddressForLargeDeploy: embeddedWalletAddress as `0x${string}` | undefined,
            treasuryDeployerAddress:
              sponsorUrl && sponsorFrom ? sponsorFrom : undefined,
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
      } catch (err: any) {
        record.deploymentStatus = 'failed';
        saveDeployment(record);
        setError(err?.message || 'Deployment failed');
        setProgress({
          stage: 'failed',
          message: err?.message || 'Deployment failed',
          step: record.currentStep,
          totalSteps: 7,
        });
        return null;
      } finally {
        setDeploying(false);
      }
    },
    [publicClient, chain, walletsReady, embeddedWalletAddress, walletClient]
  );

  return { deploying, progress, error, canDeploy, deploy };
}
