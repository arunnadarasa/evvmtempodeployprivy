import { useState, useCallback } from 'react';
import { encodeDeployData, toHex } from 'viem';
import { useAccount, usePublicClient } from 'wagmi';
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
import { tempoModerato } from 'viem/chains';

/** EOA/Privy CREATE for EVVM Core (~38k init); wallet default ~1.2M leaves empty contract + status=1. */
function walletLargeCreateGasLimit(deployParams: {
  abi: unknown;
  bytecode: `0x${string}`;
  args: readonly unknown[];
}): bigint {
  const init = encodeDeployData(deployParams as Parameters<typeof encodeDeployData>[0]);
  const byteLen = BigInt((init.length - 2) / 2);
  const estimated = 2_000_000n + byteLen * 650n;
  const minGas = 10_000_000n;
  const maxGas = 24_000_000n;
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

  const embeddedWallet =
    wallets.find((w: any) => w?.chainType === 'ethereum' && w?.walletClientType === 'privy') ??
    wallets.find((w: any) => w?.chainType === 'ethereum') ??
    wallets[0];
  const embeddedWalletAddress = embeddedWallet?.address;
  const hasEmbeddedProvider = typeof embeddedWallet?.getEthereumProvider === 'function';
  const useDirectTempoWalletFlow = chain?.id === tempoModerato.id;

  const canDeploy =
    !!address &&
    walletsReady &&
    !!embeddedWalletAddress &&
    !!publicClient &&
    hasBytecodes() &&
    (useDirectTempoWalletFlow ? hasEmbeddedProvider : !!zerodevClient && !!zerodevAccount);

  const deploy = useCallback(
    async (config: DeploymentConfig): Promise<DeploymentRecord | null> => {
      if (!publicClient || !chain || !walletsReady || !embeddedWalletAddress) {
        setError('Wallet not connected');
        return null;
      }

      if (useDirectTempoWalletFlow && !hasEmbeddedProvider) {
        setError('Privy embedded wallet provider is not ready yet.');
        return null;
      }

      if (!useDirectTempoWalletFlow) {
        setError('Switch the Privy wallet to Tempo Testnet (Moderato) to deploy contracts.');
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
        const sendSponsoredTransaction = async (input: {
          chainId: number;
          to?: `0x${string}`;
          data: `0x${string}`;
          value?: bigint;
          deployParams?: { abi: unknown; bytecode: `0x${string}`; args: unknown[] };
          walletContractDeploy?: boolean;
        }) => {
          const isContractDeploy = input.to === undefined || input.to === null;
          const isTempoChain = input.chainId === tempoModerato.id;
          const useDirectWalletOnTempo = isTempoChain;
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
        if (useDirectWalletOnTempo) {
          const provider = await embeddedWallet?.getEthereumProvider?.();
          if (!provider || typeof (provider as any).request !== 'function') {
            throw new Error('Privy embedded wallet provider is not ready yet.');
          }

          const latestBlock = await publicClient.getBlock();
          const estimatedFees = await publicClient
            .estimateFeesPerGas({ type: 'eip1559' })
            .catch(() => null);
          const baseFeePerGas =
            latestBlock.baseFeePerGas && latestBlock.baseFeePerGas > 0n
              ? latestBlock.baseFeePerGas
              : 20_000_000_000n;
          const maxPriorityFeePerGas =
            estimatedFees?.maxPriorityFeePerGas &&
            estimatedFees.maxPriorityFeePerGas > 0n
              ? estimatedFees.maxPriorityFeePerGas
              : 1_000_000_000n;
          const maxFeePerGas =
            estimatedFees?.maxFeePerGas && estimatedFees.maxFeePerGas > baseFeePerGas
              ? estimatedFees.maxFeePerGas
              : baseFeePerGas * 2n + maxPriorityFeePerGas;

          const sendViaEmbeddedProvider = async (request: {
            to?: `0x${string}`;
            data: `0x${string}`;
            gas: bigint;
            value?: bigint;
          }) => {
            const nonce = await publicClient.getTransactionCount({
              address: embeddedWalletAddress,
              blockTag: 'pending',
            });
            const tx = {
              chainId: toHex(chain.id),
              type: '0x2',
              from: embeddedWalletAddress,
              ...(request.to ? { to: request.to } : {}),
              data: request.data,
              gas: toHex(request.gas),
              maxFeePerGas: toHex(maxFeePerGas),
              maxPriorityFeePerGas: toHex(maxPriorityFeePerGas),
              nonce: toHex(nonce),
              value: toHex(request.value ?? 0n),
            };

            const signedTx = (await (provider as any).request({
              method: 'eth_signTransaction',
              params: [tx],
            })) as `0x${string}`;

            return (await publicClient.request({
              method: 'eth_sendRawTransaction',
              params: [signedTx],
            })) as `0x${string}`;
          };

          if (isContractDeploy && input.deployParams) {
            const deployData = encodeDeployData({
              abi: input.deployParams.abi as any,
              bytecode: input.deployParams.bytecode,
              args: input.deployParams.args as any,
            }) as `0x${string}`;

            let gas = walletLargeCreateGasLimit(input.deployParams);
            try {
              const estimatedGas = await publicClient.estimateGas({
                account: embeddedWalletAddress,
                data: deployData,
              });
              const paddedGas = (estimatedGas * 130n) / 100n;
              if (paddedGas > gas) {
                gas = paddedGas;
              }
            } catch {
              // Tempo RPC estimation can intermittently fail; keep the conservative fallback heuristic.
            }

            const hash = await sendViaEmbeddedProvider({
              data: deployData,
              gas,
            });
            return hash as `0x${string}`;
          }

          if (!input.to) {
            throw new Error('Direct wallet transaction is missing a recipient.');
          }

          let gas = 500_000n;
          try {
            const estimatedGas = await publicClient.estimateGas({
              account: embeddedWalletAddress,
              to: input.to,
              data: input.data,
              value: input.value ?? 0n,
            });
            gas = (estimatedGas * 120n) / 100n;
          } catch {
            // Keep a reasonable fallback for small setup calls.
          }

          const hash = await sendViaEmbeddedProvider({
            to: input.to,
            data: input.data,
            value: input.value ?? 0n,
            gas,
          });
          return hash as `0x${string}`;
        }

        throw new Error('Tempo deployment only supports direct funded-wallet transactions on Tempo Testnet (Moderato).');
        };

        const contractDeployerAddress = useDirectTempoWalletFlow
          ? (embeddedWalletAddress as `0x${string}`)
          : (embeddedWalletAddress as `0x${string}`);
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
            aaDeployerAddress: undefined,
            contractDeployerAddress,
          }
        );

        record.stakingAddress = addresses.staking;
        record.evvmCoreAddress = addresses.evvmCore;
        record.nameServiceAddress = addresses.nameService;
        record.estimatorAddress = addresses.estimator;
        record.treasuryAddress = addresses.treasury;
        record.p2pSwapAddress = addresses.p2pSwap;
        record.deploymentStatus = 'completed';
        record.currentStep = 8;
        saveDeployment(record);

        setProgress({
          stage: 'complete',
          message: 'Deployment complete!',
          step: 8,
          totalSteps: 8,
        });

        return record;
      } catch (err: any) {
        const rawMsg = err?.message || 'Deployment failed';
        const msg =
          typeof rawMsg === 'string' && rawMsg.includes('insufficient funds for gas * price + value')
            ? 'The Privy wallet does not have enough native Tempo gas to pay for this transaction. PathUSD is not used for deployment gas. Fund the wallet with native Tempo testnet gas, then retry.'
            : rawMsg;
        record.deploymentStatus = 'failed';
        saveDeployment(record);
        setError(msg);
        setProgress({
          stage: 'failed',
          message: msg,
          step: record.currentStep,
          totalSteps: 8,
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
      embeddedWalletAddress,
      embeddedWallet,
      hasEmbeddedProvider,
      useDirectTempoWalletFlow,
    ]
  );

  return { deploying, progress, error, canDeploy, deploy };
}
