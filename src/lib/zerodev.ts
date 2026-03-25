/**
 * ZeroDev project and RPC helpers for gas sponsorship.
 *
 * Privy is used for social login only; sponsorship is via ZeroDev SDK (`useZeroDevKernelClient`).
 *
 * Note: If you deploy on Tempo testnet (Moderato, chain id `42431`), make sure the ZeroDev
 * project has an active sponsor policy for that chain as well (if supported by your ZeroDev setup).
 */
export const ZERODEV_PROJECT_ID = '92691254-2986-488c-9c5d-b6028a3deb3a';

const ZERODEV_RPC_BASE = 'https://rpc.zerodev.app/api/v3';

export function getZeroDevRpcUrl(chainId: number): string {
  return `${ZERODEV_RPC_BASE}/${ZERODEV_PROJECT_ID}/chain/${chainId}`;
}

