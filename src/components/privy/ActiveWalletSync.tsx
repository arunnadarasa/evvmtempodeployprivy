import { useEffect } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { useSetActiveWallet } from '@privy-io/wagmi';

export function ActiveWalletSync() {
  const { ready, wallets } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();

  useEffect(() => {
    if (!ready) return;
    type WalletLike = {
      chainType?: string;
      walletClientType?: string;
      address?: unknown;
    };
    // Snapshot wallets to verify which one ends up active.
    fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1c16cb' },
      body: JSON.stringify({
        sessionId: '1c16cb',
        runId: 'wallet-sync',
        hypothesisId: 'H1-wallet-source',
        location: 'ActiveWalletSync.tsx:wallet-snapshot',
        message: 'Privy/wagmi wallets snapshot (type selection)',
        data: {
          walletCount: (wallets as WalletLike[]).length,
          wallets: (wallets as WalletLike[]).map((w) => ({
            chainType: w?.chainType ?? null,
            walletClientType: w?.walletClientType ?? null,
            // Avoid logging full address if present.
            addressPrefix:
              typeof w?.address === 'string' && w.address
                ? `${w.address.slice(0, 8)}…${w.address.slice(-4)}`
                : null,
          })),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});

    const ethereumWallet =
      // Prefer non-Privy wallets (e.g. Tempo Wallet / OWS) if present.
      (wallets as WalletLike[]).find(
        (w) => w?.chainType === 'ethereum' && w?.walletClientType !== 'privy'
      ) ??
      // Fall back to Privy embedded wallet only if it's the only option.
      (wallets as WalletLike[]).find((w) => w?.chainType === 'ethereum' && w?.walletClientType === 'privy') ??
      (wallets as WalletLike[]).find((w) => w?.chainType === 'ethereum') ??
      wallets[0];
    const wallet = ethereumWallet;
    if (!wallet) return;

    // Record which wallet we set as active.
    fetch('http://127.0.0.1:7507/ingest/c08c81b9-0eaa-43a9-821e-80d55eb4208b', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1c16cb' },
      body: JSON.stringify({
        sessionId: '1c16cb',
        runId: 'wallet-sync',
        hypothesisId: 'H2-active-wallet-chosen',
        location: 'ActiveWalletSync.tsx:active-wallet-chosen',
        message: 'Active wallet chosen for wagmi tx signing',
        data: {
          chainType: (wallet as WalletLike)?.chainType ?? null,
          walletClientType: (wallet as WalletLike)?.walletClientType ?? null,
          addressPrefix:
            typeof (wallet as WalletLike)?.address === 'string' && (wallet as WalletLike).address
              ? `${(wallet as WalletLike).address.slice(0, 8)}…${(wallet as WalletLike).address.slice(-4)}`
              : null,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});

    void setActiveWallet(wallet);
  }, [ready, wallets, setActiveWallet]);

  return null;
}

