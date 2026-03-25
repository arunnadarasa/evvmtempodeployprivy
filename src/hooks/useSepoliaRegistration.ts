import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  isAddress,
  toHex,
  type Address,
} from 'viem';
import { useAccount, usePublicClient, useSwitchChain } from 'wagmi';
import { useWallets } from '@privy-io/react-auth';
import { sepolia, tempoModerato } from 'viem/chains';
import { useZeroDevKernelClient } from '@/hooks/useZeroDevKernelClient';
import {
  evvmCoreRegistrationAbi,
  EVVM_REGISTRY_SEPOLIA_ADDRESS,
  EVVM_TEMPO_HOST_CHAIN_ID,
  evvmRegistryAbi,
} from '@/lib/evvmRegistry';
import {
  getDeployments,
  saveDeployments,
  type DeploymentRecord,
} from '@/lib/storage';

type RegistrationStage =
  | 'idle'
  | 'checking'
  | 'registering'
  | 'verifying'
  | 'syncing-core'
  | 'complete'
  | 'failed';

export interface RegistrationProgress {
  stage: RegistrationStage;
  message: string;
}

export interface RegistrationResult {
  evvmId: bigint;
  registerTxHash?: `0x${string}`;
  setIdTxHash?: `0x${string}`;
  matchedDeploymentIds?: string[];
}

export interface RegistrationLookup {
  state: 'idle' | 'checking' | 'available' | 'registered' | 'unknown';
  message: string;
  evvmId?: bigint;
  needsCoreSync?: boolean;
  matchedDeploymentIds?: string[];
}

const ALREADY_REGISTERED_ERROR_SELECTOR = '0x3a81d6fc';

function errorContainsSelector(error: unknown, selector: string): boolean {
  const seen = new Set<unknown>();

  const visit = (value: unknown): boolean => {
    if (value == null) return false;
    if (typeof value === 'string') return value.toLowerCase().includes(selector.toLowerCase());
    if (typeof value !== 'object') return false;
    if (seen.has(value)) return false;
    seen.add(value);

    if (Array.isArray(value)) {
      return value.some((entry) => visit(entry));
    }

    for (const nested of Object.values(value as Record<string, unknown>)) {
      if (visit(nested)) return true;
    }

    return false;
  };

  return visit(error);
}

async function resolveRegisteredEvvmIdNearHint(params: {
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>;
  coreAddress: Address;
  hintEvvmId?: bigint;
}): Promise<bigint | null> {
  const { publicClient, coreAddress, hintEvvmId } = params;
  const localIds = getDeployments()
    .map((deployment) => deployment.evvmId)
    .filter((evvmId): evvmId is number => typeof evvmId === 'number' && evvmId > 0);
  const localMaxId =
    localIds.length > 0 ? BigInt(Math.max(...localIds)) : undefined;
  const baseline = hintEvvmId ?? localMaxId;
  const start = baseline && baseline > 32n ? baseline - 32n : 1n;
  const end = baseline ? baseline + 128n : localMaxId ? localMaxId + 128n : 0n;

  if (end === 0n) return null;

  for (let evvmId = start; evvmId <= end; evvmId += 1n) {
    try {
      const metadata = await publicClient.readContract({
        address: EVVM_REGISTRY_SEPOLIA_ADDRESS,
        abi: evvmRegistryAbi,
        functionName: 'getEvvmIdMetadata',
        args: [evvmId],
      });

      if (
        metadata.chainId === BigInt(EVVM_TEMPO_HOST_CHAIN_ID) &&
        metadata.evvmAddress.toLowerCase() === coreAddress.toLowerCase()
      ) {
        return evvmId;
      }
    } catch {
      // Ignore sparse / invalid ids and keep scanning around the local hint.
    }
  }

  return null;
}

async function probeRegisterEvvm(params: {
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>;
  coreAddress: Address;
  account?: Address;
}): Promise<
  | { status: 'available'; predictedId: bigint }
  | { status: 'registered' }
  | { status: 'error'; message: string }
> {
  const { publicClient, coreAddress, account } = params;

  const data = encodeFunctionData({
    abi: evvmRegistryAbi,
    functionName: 'registerEvvm',
    args: [BigInt(EVVM_TEMPO_HOST_CHAIN_ID), coreAddress],
  });

  try {
    const result = await publicClient.request({
      method: 'eth_call',
      params: [
        {
          ...(account ? { from: account } : {}),
          to: EVVM_REGISTRY_SEPOLIA_ADDRESS,
          data,
        },
        'latest',
      ],
    });

    const predictedId = decodeFunctionResult({
      abi: evvmRegistryAbi,
      functionName: 'registerEvvm',
      data: result,
    });

    return { status: 'available', predictedId };
  } catch (err) {
    if (errorContainsSelector(err, ALREADY_REGISTERED_ERROR_SELECTOR)) {
      return { status: 'registered' };
    }

    const message = err instanceof Error ? err.message : String(err);
    return { status: 'error', message };
  }
}

function updateMatchingDeployments(
  coreAddress: Address,
  evvmId: bigint,
  txHashes?: {
    registerEvvm?: `0x${string}`;
    setEvvmID?: `0x${string}`;
  }
): string[] {
  const deployments = getDeployments();
  const matchedIds: string[] = [];

  const updated = deployments.map((deployment) => {
    if (deployment.evvmCoreAddress?.toLowerCase() !== coreAddress.toLowerCase()) {
      return deployment;
    }

    matchedIds.push(deployment.id);
    return {
      ...deployment,
      evvmId: Number(evvmId),
      deploymentStatus: 'completed',
      currentStep: Math.max(deployment.currentStep, 7),
      txHashes: {
        ...deployment.txHashes,
        ...(txHashes?.registerEvvm ? { registerEvvm: txHashes.registerEvvm } : {}),
        ...(txHashes?.setEvvmID ? { setEvvmID: txHashes.setEvvmID } : {}),
      },
    } satisfies DeploymentRecord;
  });

  if (matchedIds.length > 0) {
    saveDeployments(updated);
  }

  return matchedIds;
}

export function useSepoliaRegistration() {
  const { address, chain } = useAccount();
  const sepoliaPublicClient = usePublicClient({ chainId: sepolia.id });
  const tempoPublicClient = usePublicClient({ chainId: tempoModerato.id });
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();
  const { wallets } = useWallets();
  const {
    client: zerodevClient,
    account: zerodevAccount,
    isLoading: isKernelLoading,
    error: kernelError,
  } = useZeroDevKernelClient();

  const [isRegistering, setIsRegistering] = useState(false);
  const [progress, setProgress] = useState<RegistrationProgress>({
    stage: 'idle',
    message: 'Ready to register a Tempo Testnet EVVM core on the Sepolia registry.',
  });
  const [error, setError] = useState<string | null>(null);
  const [chainRegistered, setChainRegistered] = useState<boolean | null>(null);
  const [lookup, setLookup] = useState<RegistrationLookup>({
    state: 'idle',
    message: 'Enter a Tempo Testnet EVVM core address to check whether it is already registered on Sepolia.',
  });

  const embeddedWallet =
    wallets.find((w: any) => w?.chainType === 'ethereum' && w?.walletClientType === 'privy') ??
    wallets.find((w: any) => w?.chainType === 'ethereum') ??
    wallets[0];

  const embeddedWalletAddress = embeddedWallet?.address;
  const hasEmbeddedProvider = typeof embeddedWallet?.getEthereumProvider === 'function';

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!sepoliaPublicClient) return;

      try {
        const registered = await sepoliaPublicClient.readContract({
          address: EVVM_REGISTRY_SEPOLIA_ADDRESS,
          abi: evvmRegistryAbi,
          functionName: 'isChainIdRegistered',
          args: [BigInt(EVVM_TEMPO_HOST_CHAIN_ID)],
        });
        if (!cancelled) setChainRegistered(registered);
      } catch {
        if (!cancelled) setChainRegistered(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sepoliaPublicClient]);

  const onSepolia = chain?.id === sepolia.id;

  const isReady = useMemo(
    () =>
      !!address &&
      !!sepoliaPublicClient &&
      onSepolia &&
      !!zerodevClient &&
      !!zerodevAccount &&
      !!embeddedWalletAddress &&
      hasEmbeddedProvider &&
      !isKernelLoading,
    [
      address,
      sepoliaPublicClient,
      onSepolia,
      zerodevClient,
      zerodevAccount,
      embeddedWalletAddress,
      hasEmbeddedProvider,
      isKernelLoading,
    ]
  );

  const switchToSepolia = useCallback(async () => {
    setError(null);
    await switchChainAsync({ chainId: sepolia.id });
  }, [switchChainAsync]);

  const syncEvvmIdToTempoCore = useCallback(
    async (params: { coreAddress: Address; evvmId: bigint }) => {
      if (!tempoPublicClient) {
        throw new Error('Tempo RPC is not ready yet.');
      }

      if (!embeddedWalletAddress || !hasEmbeddedProvider) {
        throw new Error('Privy embedded wallet provider is not ready for Tempo writeback.');
      }

      const provider = await embeddedWallet?.getEthereumProvider?.();
      if (!provider || typeof (provider as any).request !== 'function') {
        throw new Error('Privy embedded wallet provider is not ready for Tempo writeback.');
      }

      if (chain?.id !== tempoModerato.id) {
        await switchChainAsync({ chainId: tempoModerato.id });
      }

      const data = encodeFunctionData({
        abi: evvmCoreRegistrationAbi,
        functionName: 'setEvvmID',
        args: [params.evvmId],
      });

      const latestBlock = await tempoPublicClient.getBlock();
      const estimatedFees = await tempoPublicClient
        .estimateFeesPerGas({ type: 'eip1559' })
        .catch(() => null);
      const baseFeePerGas =
        latestBlock.baseFeePerGas && latestBlock.baseFeePerGas > 0n
          ? latestBlock.baseFeePerGas
          : 20_000_000_000n;
      const maxPriorityFeePerGas =
        estimatedFees?.maxPriorityFeePerGas && estimatedFees.maxPriorityFeePerGas > 0n
          ? estimatedFees.maxPriorityFeePerGas
          : 1_000_000_000n;
      const maxFeePerGas =
        estimatedFees?.maxFeePerGas && estimatedFees.maxFeePerGas > baseFeePerGas
          ? estimatedFees.maxFeePerGas
          : baseFeePerGas * 2n + maxPriorityFeePerGas;

      const nonce = await tempoPublicClient.getTransactionCount({
        address: embeddedWalletAddress,
        blockTag: 'pending',
      });
      const estimatedGas = await tempoPublicClient.estimateGas({
        account: embeddedWalletAddress,
        to: params.coreAddress,
        data,
      });
      const gas = (estimatedGas * 120n) / 100n;

      const tx = {
        chainId: toHex(tempoModerato.id),
        type: '0x2',
        from: embeddedWalletAddress,
        to: params.coreAddress,
        data,
        gas: toHex(gas),
        maxFeePerGas: toHex(maxFeePerGas),
        maxPriorityFeePerGas: toHex(maxPriorityFeePerGas),
        nonce: toHex(nonce),
        value: toHex(0n),
      };

      const signedTx = (await (provider as any).request({
        method: 'eth_signTransaction',
        params: [tx],
      })) as `0x${string}`;

      const setIdTxHash = (await tempoPublicClient.request({
        method: 'eth_sendRawTransaction',
        params: [signedTx],
      })) as `0x${string}`;

      const setIdReceipt = await tempoPublicClient.waitForTransactionReceipt({
        hash: setIdTxHash,
      });

      if (setIdReceipt.status === 'reverted') {
        throw new Error('Tempo core setEvvmID transaction reverted.');
      }

      const coreEvvmId = await tempoPublicClient.readContract({
        address: params.coreAddress,
        abi: evvmCoreRegistrationAbi,
        functionName: 'getEvvmID',
      });

      if (coreEvvmId !== params.evvmId) {
        throw new Error(
          `Tempo core writeback completed, but getEvvmID() returned ${coreEvvmId.toString()} instead of ${params.evvmId.toString()}.`
        );
      }

      return setIdTxHash;
    },
    [
      tempoPublicClient,
      embeddedWalletAddress,
      hasEmbeddedProvider,
      embeddedWallet,
      chain?.id,
      switchChainAsync,
    ]
  );

  const checkRegistrationStatus = useCallback(
    async (coreAddressInput: string): Promise<RegistrationLookup> => {
      if (!sepoliaPublicClient) {
        const result = {
          state: 'unknown',
          message: 'Sepolia RPC is not ready yet.',
        } satisfies RegistrationLookup;
        setLookup(result);
        return result;
      }

      if (!isAddress(coreAddressInput)) {
        const result = {
          state: 'idle',
          message: 'Enter a valid Tempo Testnet EVVM core address to check its registration status.',
        } satisfies RegistrationLookup;
        setLookup(result);
        return result;
      }

      const coreAddress = getAddress(coreAddressInput);
      const matchingLocalDeployments = getDeployments().filter(
        (deployment) => deployment.evvmCoreAddress?.toLowerCase() === coreAddress.toLowerCase()
      );
      const localRegisteredDeployment = matchingLocalDeployments.find(
        (deployment) => deployment.evvmId != null
      );

      try {
        const primaryProbe = await probeRegisterEvvm({
          publicClient: sepoliaPublicClient,
          coreAddress,
          account: address,
        });

        const fallbackProbe =
          primaryProbe.status === 'error'
            ? await probeRegisterEvvm({
                publicClient: sepoliaPublicClient,
                coreAddress,
              })
            : null;

        const probe = fallbackProbe ?? primaryProbe;

        if (probe.status === 'available') {
          const result = {
            state: 'available',
            message: `This Tempo core is not registered on Sepolia yet. Registering now would return EVVM ID ${probe.predictedId.toString()}.`,
            evvmId: probe.predictedId,
            matchedDeploymentIds: matchingLocalDeployments.map((deployment) => deployment.id),
          } satisfies RegistrationLookup;
          setLookup(result);
          return result;
        }

        if (probe.status === 'registered') {
          const resolvedEvvmId = await resolveRegisteredEvvmIdNearHint({
            publicClient: sepoliaPublicClient,
            coreAddress,
            hintEvvmId:
              localRegisteredDeployment?.evvmId != null
                ? BigInt(localRegisteredDeployment.evvmId)
                : undefined,
          });

          let needsCoreSync = false;
          if (resolvedEvvmId != null && tempoPublicClient) {
            try {
              const coreEvvmId = await tempoPublicClient.readContract({
                address: coreAddress,
                abi: evvmCoreRegistrationAbi,
                functionName: 'getEvvmID',
              });
              needsCoreSync = coreEvvmId !== resolvedEvvmId;
            } catch {
              needsCoreSync = true;
            }
          }

          if (resolvedEvvmId != null) {
            updateMatchingDeployments(
              coreAddress,
              resolvedEvvmId,
              {
                registerEvvm: localRegisteredDeployment?.txHashes.registerEvvm as
                  | `0x${string}`
                  | undefined,
                setEvvmID: localRegisteredDeployment?.txHashes.setEvvmID as
                  | `0x${string}`
                  | undefined,
              }
            );
          }

          const result = {
            state: 'registered',
            message:
              resolvedEvvmId != null
                ? needsCoreSync
                  ? `This Tempo core is already registered on Sepolia as EVVM ID ${resolvedEvvmId.toString()}, but the Tempo core still needs setEvvmID(...) writeback.`
                  : `This Tempo core is already registered on Sepolia as EVVM ID ${resolvedEvvmId.toString()}.`
                : localRegisteredDeployment?.evvmId != null
                  ? `This Tempo core is already registered on Sepolia as EVVM ID ${localRegisteredDeployment.evvmId}.`
                : 'This Tempo core is already registered on Sepolia.',
            evvmId:
              resolvedEvvmId != null
                ? resolvedEvvmId
                : localRegisteredDeployment?.evvmId != null
                ? BigInt(localRegisteredDeployment.evvmId)
                : undefined,
            needsCoreSync,
            matchedDeploymentIds: matchingLocalDeployments.map((deployment) => deployment.id),
          } satisfies RegistrationLookup;
          setLookup(result);
          return result;
        }

        const result = {
          state: 'unknown',
          message: `Could not determine registration status yet: ${probe.message}`,
          matchedDeploymentIds: matchingLocalDeployments.map((deployment) => deployment.id),
        } satisfies RegistrationLookup;
        setLookup(result);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const result = {
          state: 'unknown',
          message: `Could not determine registration status yet: ${message}`,
          matchedDeploymentIds: matchingLocalDeployments.map((deployment) => deployment.id),
        } satisfies RegistrationLookup;
        setLookup(result);
        return result;
      }
    },
    [address, sepoliaPublicClient, tempoPublicClient]
  );

  const register = useCallback(
    async (coreAddressInput: string): Promise<RegistrationResult | null> => {
      if (!address) {
        setError('Log in with Privy first.');
        return null;
      }

      if (!isAddress(coreAddressInput)) {
        setError('Enter a valid Tempo Testnet EVVM core address.');
        return null;
      }

      if (!onSepolia) {
        setError('Switch the Privy wallet to Sepolia before registering.');
        return null;
      }

      if (!sepoliaPublicClient || !zerodevClient || !zerodevAccount) {
        setError('ZeroDev smart wallet is still preparing on Sepolia.');
        return null;
      }

      if (chainRegistered === false) {
        setError('The EVVM registry does not currently allow Tempo host registrations.');
        return null;
      }

      const coreAddress = getAddress(coreAddressInput);
      const status = await checkRegistrationStatus(coreAddress);

      if (status.state === 'registered' && status.evvmId != null && status.needsCoreSync) {
        setIsRegistering(true);
        setError(null);
        try {
          setProgress({
            stage: 'syncing-core',
            message: `Writing EVVM ID ${status.evvmId.toString()} back into the Tempo core.`,
          });

          const setIdTxHash = await syncEvvmIdToTempoCore({
            coreAddress,
            evvmId: status.evvmId,
          });

          const matchedDeploymentIds = updateMatchingDeployments(coreAddress, status.evvmId, {
            setEvvmID: setIdTxHash,
          });

          setLookup({
            state: 'registered',
            message: `This Tempo core is already registered on Sepolia as EVVM ID ${status.evvmId.toString()}, and the Tempo core is now synced.`,
            evvmId: status.evvmId,
            needsCoreSync: false,
            matchedDeploymentIds,
          });

          setProgress({
            stage: 'complete',
            message: `Tempo core synced with EVVM ID ${status.evvmId.toString()}.`,
          });

          try {
            await switchChainAsync({ chainId: sepolia.id });
          } catch {
            // Best effort only; registration is complete even if the wallet stays on Tempo.
          }

          return {
            evvmId: status.evvmId,
            registerTxHash: getDeployments().find((deployment) =>
              matchedDeploymentIds.includes(deployment.id)
            )?.txHashes.registerEvvm as `0x${string}` | undefined,
            setIdTxHash,
            matchedDeploymentIds,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          setProgress({
            stage: 'failed',
            message,
          });
          return null;
        } finally {
          setIsRegistering(false);
        }
      }

      if (status.state === 'registered' && !status.needsCoreSync) {
        setError('This Tempo core is already registered on Sepolia.');
        return null;
      }

      setIsRegistering(true);
      setError(null);
      setProgress({
        stage: 'checking',
        message: 'Checking whether this Tempo core is already registered on Sepolia.',
      });

      try {
        const registerCalldata = encodeFunctionData({
          abi: evvmRegistryAbi,
          functionName: 'registerEvvm',
          args: [BigInt(EVVM_TEMPO_HOST_CHAIN_ID), coreAddress],
        });

        const predictedRegisterResult = await sepoliaPublicClient.call({
          account: address,
          to: EVVM_REGISTRY_SEPOLIA_ADDRESS,
          data: registerCalldata,
        });

        const predictedEvvmId = decodeFunctionResult({
          abi: evvmRegistryAbi,
          functionName: 'registerEvvm',
          data: predictedRegisterResult.data,
        });

        setProgress({
          stage: 'registering',
          message: 'Submitting the Sepolia registry transaction for this Tempo core through ZeroDev sponsorship.',
        });

        const registerTxHash = (await zerodevClient.sendTransaction({
          account: zerodevAccount,
          to: EVVM_REGISTRY_SEPOLIA_ADDRESS,
          data: registerCalldata,
        })) as `0x${string}`;

        await sepoliaPublicClient.waitForTransactionReceipt({ hash: registerTxHash });

        setProgress({
          stage: 'verifying',
          message: `Registry accepted the Tempo core. Resolving the actual EVVM ID near ${predictedEvvmId.toString()} on Sepolia.`,
        });

        const evvmId =
          (await resolveRegisteredEvvmIdNearHint({
            publicClient: sepoliaPublicClient,
            coreAddress,
            hintEvvmId: predictedEvvmId,
          })) ?? null;

        if (evvmId == null) {
          throw new Error(
            `Registry write completed, but the actual EVVM ID could not be resolved near predicted ID ${predictedEvvmId.toString()}.`
          );
        }

        const metadata = await sepoliaPublicClient.readContract({
          address: EVVM_REGISTRY_SEPOLIA_ADDRESS,
          abi: evvmRegistryAbi,
          functionName: 'getEvvmIdMetadata',
          args: [evvmId],
        });

        if (
          metadata.chainId !== BigInt(EVVM_TEMPO_HOST_CHAIN_ID) ||
          metadata.evvmAddress.toLowerCase() !== coreAddress.toLowerCase()
        ) {
          throw new Error(
            `Registry write completed, but EVVM ID ${evvmId.toString()} does not map back to the submitted Tempo core address.`
          );
        }

        setProgress({
          stage: 'syncing-core',
          message: `Registry confirmed EVVM ID ${evvmId.toString()}. Writing it into the Tempo core with setEvvmID(...).`,
        });

        const setIdTxHash = await syncEvvmIdToTempoCore({
          coreAddress,
          evvmId,
        });

        const matchedDeploymentIds = updateMatchingDeployments(
          coreAddress,
          evvmId,
          {
            registerEvvm: registerTxHash,
            setEvvmID: setIdTxHash,
          }
        );

        setLookup({
          state: 'registered',
          message: `This Tempo core is now registered on Sepolia as EVVM ID ${evvmId.toString()}, and the Tempo core is synced.`,
          evvmId,
          needsCoreSync: false,
          matchedDeploymentIds,
        });

        setProgress({
          stage: 'complete',
          message: `Sepolia registration complete. Tempo core mapped and synced to EVVM ID ${evvmId.toString()}.`,
        });

        try {
          await switchChainAsync({ chainId: sepolia.id });
        } catch {
          // Best effort only; the registration flow is still complete if the wallet remains on Tempo.
        }

        return {
          evvmId,
          registerTxHash,
          setIdTxHash,
          matchedDeploymentIds,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setProgress({
          stage: 'failed',
          message,
        });
        return null;
      } finally {
        setIsRegistering(false);
      }
    },
    [
      address,
      onSepolia,
      sepoliaPublicClient,
      zerodevClient,
      zerodevAccount,
      chainRegistered,
      checkRegistrationStatus,
      syncEvvmIdToTempoCore,
      switchChainAsync,
    ]
  );

  return {
    chainRegistered,
    checkRegistrationStatus,
    error: error ?? kernelError?.message ?? null,
    isKernelLoading,
    isReady,
    isRegistering,
    isSwitchingChain,
    lookup,
    onSepolia,
    progress,
    register,
    switchToSepolia,
  };
}
