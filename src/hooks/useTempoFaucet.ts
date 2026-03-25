import { useCallback, useEffect, useState } from 'react';
import { erc20Abi, formatUnits } from 'viem';
import { PATH_USD_ADDRESS, PATH_USD_DECIMALS, TEMPO_FAUCET_RPC_METHOD, tempoPublicClient } from '@/lib/tempo';

type FaucetState = {
  pathUsdBalance: bigint | null;
  pathUsdBalanceFormatted: string;
  isFunding: boolean;
  isRefreshing: boolean;
  error: string | null;
  requestPathUsd: (address?: `0x${string}`) => Promise<void>;
  refreshBalance: (address?: `0x${string}`) => Promise<void>;
};

export function useTempoFaucet(address?: `0x${string}`): FaucetState {
  const [pathUsdBalance, setPathUsdBalance] = useState<bigint | null>(null);
  const [isFunding, setIsFunding] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshBalance = useCallback(async (targetAddress?: `0x${string}`) => {
    if (!targetAddress) {
      setPathUsdBalance(null);
      return;
    }

    setIsRefreshing(true);
    try {
      const balance = await tempoPublicClient.readContract({
        address: PATH_USD_ADDRESS,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [targetAddress],
      });
      setPathUsdBalance(balance);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const requestPathUsd = useCallback(
    async (targetAddress?: `0x${string}`) => {
      if (!targetAddress) {
        setError('Connect a Privy wallet first.');
        return;
      }

      setIsFunding(true);
      try {
        await tempoPublicClient.request({
          method: TEMPO_FAUCET_RPC_METHOD,
          params: [targetAddress] as unknown[],
        });
        setError(null);
        await refreshBalance(targetAddress);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      } finally {
        setIsFunding(false);
      }
    },
    [refreshBalance]
  );

  useEffect(() => {
    void refreshBalance(address);
  }, [address, refreshBalance]);

  return {
    pathUsdBalance,
    pathUsdBalanceFormatted:
      pathUsdBalance == null ? '0' : formatUnits(pathUsdBalance, PATH_USD_DECIMALS),
    isFunding,
    isRefreshing,
    error,
    requestPathUsd,
    refreshBalance,
  };
}
