import { useState, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { useWallets } from '@privy-io/react-auth';
import { createPublicClient, http } from 'viem';
import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
  constants,
} from '@zerodev/sdk';
import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator';
import { toOwner } from 'permissionless/utils';
import { baseSepolia, sepolia, tempoModerato } from 'viem/chains';
import { getZeroDevRpcUrl } from '@/lib/zerodev';
import type { KernelAccountClient } from '@zerodev/sdk';
import type { SmartAccount } from 'viem/account-abstraction';

const CHAINS_BY_ID: Record<
  number,
  typeof baseSepolia | typeof sepolia | typeof tempoModerato
> = {
  [baseSepolia.id]: baseSepolia,
  [sepolia.id]: sepolia,
  [tempoModerato.id]: tempoModerato,
};

export function useZeroDevKernelClient(): {
  client: KernelAccountClient | null;
  account: SmartAccount | null;
  isLoading: boolean;
  error: Error | null;
} {
  const { chain } = useAccount();
  const { wallets } = useWallets();
  const [client, setClient] = useState<KernelAccountClient | null>(null);
  const [account, setAccount] = useState<SmartAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const builtRef = useRef(false);

  type EmbeddedWalletLike = {
    walletClientType?: string;
    address?: `0x${string}`;
    getEthereumProvider?: () => Promise<unknown>;
  };

  const embeddedWallet = (wallets as EmbeddedWalletLike[] | undefined)?.find(
    (w) => w?.walletClientType === 'privy'
  );

  const chainId = chain?.id;
  const viemChain = chainId != null ? CHAINS_BY_ID[chainId] : null;
  // #region agent log
  fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1c16cb' },
    body: JSON.stringify({
      sessionId: '1c16cb',
      runId: 'zerodev-hook-init',
      hypothesisId: 'H1-zerodev-unavailable',
      location: 'useZeroDevKernelClient.ts:hook-init',
      message: 'ZeroDev hook init flags',
      data: {
        chainId: chainId ?? null,
        viemChainDefined: !!viemChain,
        embeddedWalletPresent: !!embeddedWallet,
        embeddedWalletType: embeddedWallet?.walletClientType ?? null,
        hasGetEthereumProvider: typeof embeddedWallet?.getEthereumProvider === 'function',
        embeddedWalletAddressDefined: !!embeddedWallet?.address,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  useEffect(() => {
    if (!embeddedWallet || !viemChain || !chainId) {
      setClient(null);
      setAccount(null);
      setError(null);
      setIsLoading(false);
      builtRef.current = false;
      return;
    }

    let cancelled = false;
    builtRef.current = true;
    setIsLoading(true);
    setError(null);
    const rpcUrl = getZeroDevRpcUrl(chainId);
    // #region agent log
    fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1c16cb' },
      body: JSON.stringify({
        sessionId: '1c16cb',
        runId: 'zerodev-hook-rpcurl',
        hypothesisId: 'H1-zerodev-unavailable',
        location: 'useZeroDevKernelClient.ts:rpcUrl',
        message: 'ZeroDev rpc url computed',
        data: {
          chainId,
          rpcUrl: rpcUrl.slice(0, 64) + '...',
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    (async () => {
      try {
        const provider = await embeddedWallet.getEthereumProvider?.();
        // #region agent log
        fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1c16cb' },
          body: JSON.stringify({
            sessionId: '1c16cb',
            runId: 'zerodev-provider-check',
            hypothesisId: 'H2-early-return',
            location: 'useZeroDevKernelClient.ts:provider-check',
            message: 'embeddedWallet.getEthereumProvider result',
            data: {
              cancelled: cancelled,
              providerPresent: !!provider,
              embeddedWalletAddressDefined: !!embeddedWallet.address,
              chainId,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        if (cancelled || !provider || !embeddedWallet.address) return;

        const signer = await toOwner({
          // signerToEcdsaValidator only needs an EIP-1193-ish signer; cast is fine here because
          // the embedded wallet provider matches the expected shape at runtime.
          owner: provider as Parameters<typeof toOwner>[0]['owner'],
          address: embeddedWallet.address,
        });
        if (cancelled) return;

        // #region agent log
        fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1c16cb' },
          body: JSON.stringify({
            sessionId: '1c16cb',
            runId: 'zerodev-signer-ready',
            hypothesisId: 'H3-signer-success',
            location: 'useZeroDevKernelClient.ts:signed',
            message: 'ZeroDev toOwner signer created',
            data: {
              chainId,
              embeddedWalletAddressDefined: !!embeddedWallet.address,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion

        const publicClient = createPublicClient({
          chain: viemChain,
          transport: http(viemChain.rpcUrls.default.http[0]),
        });

        const entryPoint = constants.getEntryPoint('0.7');
        const kernelVersion = constants.KERNEL_V3_1;
        const useMetaFactory = chainId !== tempoModerato.id;

        const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
          signer,
          entryPoint,
          kernelVersion,
        });
        if (cancelled) return;

        const kernelAccount = await createKernelAccount(publicClient, {
          plugins: { sudo: ecdsaValidator },
          entryPoint,
          kernelVersion,
          // Tempo has the standard Kernel contracts deployed, but the meta-factory path
          // has been the earliest common failure point in sponsorship simulation here.
          useMetaFactory,
        });
        if (cancelled) return;

        const paymasterClient = createZeroDevPaymasterClient({
          chain: viemChain,
          transport: http(rpcUrl),
        });

        const kernelClient = createKernelAccountClient({
          account: kernelAccount,
          chain: viemChain,
          bundlerTransport: http(rpcUrl),
          client: publicClient,
          paymaster: {
            getPaymasterData: (parameters) =>
              paymasterClient.sponsorUserOperation({ userOperation: parameters }),
          },
        });

        if (!cancelled) {
          setAccount(kernelAccount);
          setClient(kernelClient);
          // #region agent log
          fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1c16cb' },
            body: JSON.stringify({
              sessionId: '1c16cb',
              runId: 'zerodev-hook-ready',
              hypothesisId: 'H1-zerodev-ready',
              location: 'useZeroDevKernelClient.ts:ready',
              message: 'ZeroDev client/account created',
              data: {
                chainId,
                kernelAccountAddress: (kernelAccount as { address?: string }).address ?? null,
              },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
        }
      } catch (err) {
        if (!cancelled) {
          const errMsg = err instanceof Error ? err.message : String(err);
          // #region agent log
          fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1c16cb' },
            body: JSON.stringify({
              sessionId: '1c16cb',
              runId: 'zerodev-hook-init',
              hypothesisId: 'H1-zerodev-unavailable',
              location: 'useZeroDevKernelClient.ts:catch',
              message: 'ZeroDev kernel init failed',
              data: { chainId, errMsg },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
          setError(err instanceof Error ? err : new Error(String(errMsg)));
          setClient(null);
          setAccount(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [embeddedWallet?.address, chainId]);

  return { client, account, isLoading, error };
}
