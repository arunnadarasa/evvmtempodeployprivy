import { createPublicClient, http } from 'viem';
import { tempoModerato } from 'viem/chains';

export const TEMPO_FAUCET_RPC_METHOD = 'tempo_fundAddress';
export const PATH_USD_ADDRESS = '0x20c0000000000000000000000000000000000000' as const;
export const PATH_USD_DECIMALS = 6;

export const tempoPublicClient = createPublicClient({
  chain: tempoModerato,
  transport: http(tempoModerato.rpcUrls.default.http[0]),
});
