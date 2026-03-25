import { createConfig } from '@privy-io/wagmi';
import { http } from 'viem';
import { withFeePayer } from 'viem/tempo';
import { sepolia, tempoModerato } from 'viem/chains';

// Tempo fee token: "PathSUD" (different from default "PathUSD"/0).
// viem's Tempo fee tokens are TIP-20 addresses; for PathSUD the address ends with `...0001`.
const TEMPO_FEE_TOKEN_PATHSUD = '0x20c0000000000000000000000000000000000001';

// Extend the chain definition with the correct fee token so `feePayer: true`
// requests encode the right Tempo transaction type/fields.
const tempoModeratoWithPathSUD = {
  ...tempoModerato,
  feeToken: TEMPO_FEE_TOKEN_PATHSUD,
} as typeof tempoModerato & { feeToken: string };

export const config = createConfig({
  chains: [tempoModeratoWithPathSUD, sepolia],
  transports: {
    [tempoModeratoWithPathSUD.id]: withFeePayer(
      http(tempoModeratoWithPathSUD.rpcUrls.default.http[0]),
      http('https://sponsor.moderato.tempo.xyz')
    ),
    [sepolia.id]: http(sepolia.rpcUrls.default.http[0]),
  },
});

export const SUPPORTED_CHAINS = {
  TEMPO_MODERATO: tempoModeratoWithPathSUD,
  SEPOLIA: sepolia,
} as const;

export const getExplorerUrl = (chainId: number, hash: string, type: 'tx' | 'address' = 'tx'): string => {
  const explorers: Record<number, string> = {
    42431: `https://explore.testnet.tempo.xyz/${type}/${hash}`,
    84532: `https://sepolia.basescan.org/${type}/${hash}`, // legacy (not used by Tempo deploy)
    11155111: `https://sepolia.etherscan.io/${type}/${hash}`,
  };
  return explorers[chainId] || '#';
};

export const getChainName = (chainId: number): string => {
  const names: Record<number, string> = {
    42431: 'Tempo Testnet (Moderato)',
    84532: 'Base Sepolia', // legacy (not used by Tempo deploy)
    11155111: 'Sepolia',
  };
  return names[chainId] || 'Unknown';
};
