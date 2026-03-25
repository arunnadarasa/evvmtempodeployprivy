import type { Hex } from 'viem';

export type PrivyWalletRpcBody = Record<string, unknown>;

export async function relayPrivyWalletRpc(params: {
  relayBaseUrl?: string;
  walletId: string;
  rpcBody: PrivyWalletRpcBody;
  authorizationSignature: string;
  requestExpiry: number;
}): Promise<unknown> {
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

  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg: string;
    if (typeof json === 'object' && json != null) {
      const obj = json as Record<string, unknown>;
      const errorVal = obj['error'];
      const errorObj =
        typeof errorVal === 'object' && errorVal != null ? (errorVal as Record<string, unknown>) : undefined;
      const maybeErrorMessage = errorObj?.['message'];
      const maybeMessage = obj['message'];
      const maybeErrorString = typeof errorVal === 'string' ? errorVal : undefined;
      msg =
        typeof maybeErrorMessage === 'string'
          ? maybeErrorMessage
          : typeof maybeMessage === 'string'
            ? maybeMessage
            : typeof maybeErrorString === 'string'
              ? maybeErrorString
              : JSON.stringify(json);
    } else {
      msg = JSON.stringify(json);
    }
    throw new Error(`Relay failed (${res.status}): ${msg}`);
  }
  return json;
}

export function caip2FromChainId(chainId: number): string {
  return `eip155:${chainId}`;
}

export function extractTxHashFromPrivyRpcResponse(resp: unknown): Hex | undefined {
  if (!resp || typeof resp !== 'object') return undefined;
  const obj = resp as Record<string, unknown>;
  const data = obj['data'] as Record<string, unknown> | undefined;
  const hash = obj['hash'];
  const txHash = data?.['transaction_hash'];
  const innerHash = data?.['hash'];
  const candidate = innerHash ?? hash ?? txHash;
  return typeof candidate === 'string' && candidate.startsWith('0x') ? (candidate as Hex) : undefined;
}

