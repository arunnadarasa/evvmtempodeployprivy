import { PrivyProvider, type PrivyClientConfig } from '@privy-io/react-auth';
import { WagmiProvider } from '@privy-io/wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from '@/lib/wagmi';
import { ActiveWalletSync } from '@/components/privy/ActiveWalletSync';
import { sepolia, tempoModerato } from 'viem/chains';

const queryClient = new QueryClient();

const privyConfig: PrivyClientConfig = {
  loginMethods: ['email', 'google'],
  supportedChains: [tempoModerato, sepolia],
  embeddedWallets: {
    ethereum: {
      createOnLogin: 'users-without-wallets',
      // Bypass the embedded-wallet approval UX: Tempo Wallet/OWS flows are expected
      // to be non-interactive in this setup.
      showWalletUIs: false,
    },
  },
  appearance: {
    theme: 'dark',
    accentColor: '#0057ff',
    walletList: [],
  },
};

export function Web3Provider({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider appId="cmmv0z6dv06bs0djs07c7vrl3" config={privyConfig}>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={config}>
          <ActiveWalletSync />
          {children}
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
