import { useEffect } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { useSetActiveWallet } from '@privy-io/wagmi';

export function ActiveWalletSync() {
  const { ready, wallets } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();

  useEffect(() => {
    if (!ready) return;
    const ethereumWallet =
      wallets.find((w: any) => w?.chainType === 'ethereum' && w?.walletClientType === 'privy') ??
      wallets.find((w: any) => w?.chainType === 'ethereum') ??
      wallets[0];
    if (!ethereumWallet) return;
    void setActiveWallet(ethereumWallet);
  }, [ready, wallets, setActiveWallet]);

  return null;
}
