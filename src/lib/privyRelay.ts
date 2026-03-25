import type { Hex } from 'viem';

export type PrivyWalletRpcBody = Record<string, any>;

export async function relayPrivyWalletRpc(params: {
  relayBaseUrl?: string;
  walletId: string;
  rpcBody: PrivyWalletRpcBody;
  authorizationSignature: string;
  requestExpiry: number;
}): Promise<any> {
  const relayBaseUrl = params.relayBaseUrl ?? 'http://localhost:8787';

  const res = await fetch(`${relayBaseUrl}/api/privy/wallets/${params.walletId}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rpcBody: params.rpcBody,
      authorizationSignature: params.authorizationSignature,
      requestExpiry: params.requestExpiry,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || json?.error || json?.message || JSON.stringify(json);
    throw new Error(`Relay failed (${res.status}): ${msg}`);
  }
  return json;
}

export function caip2FromChainId(chainId: number): string {
  return `eip155:${chainId}`;
}

export function extractTxHashFromPrivyRpcResponse(resp: any): Hex | undefined {
  return resp?.data?.hash ?? resp?.hash ?? resp?.data?.transaction_hash;
}

