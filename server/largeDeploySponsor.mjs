/**
 * Platform deploy treasury — one hot wallet pays gas for EVVM Core CREATE for ALL instances
 * deployed through the app (Core initcode exceeds ZeroDev sponsored UserOp callData ~32KB).
 * Not the on-chain EVVM Treasury.sol (that is deployed after Core).
 *
 * Listen on 127.0.0.1 by default (local dev). In production: auth, rate limits, calldata allowlist.
 */
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, tempoModerato } from 'viem/chains';

dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)) });
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const PK = process.env.DEPLOY_SPONSOR_PRIVATE_KEY;
const PORT = Number(process.env.LARGE_DEPLOY_SPONSOR_PORT || 8788);
const HOST = process.env.LARGE_DEPLOY_SPONSOR_HOST || '127.0.0.1';
const SECRET = process.env.SPONSOR_API_SECRET || '';
const CHAIN_ID = Number(process.env.DEPLOY_SPONSOR_CHAIN_ID || tempoModerato.id);
const CHAINS = {
  [baseSepolia.id]: baseSepolia,
  [tempoModerato.id]: tempoModerato,
};
const chain = CHAINS[CHAIN_ID];

if (!chain) {
  console.error(
    `Unsupported DEPLOY_SPONSOR_CHAIN_ID=${CHAIN_ID}. Use ${tempoModerato.id} (Tempo Moderato) or ${baseSepolia.id} (Base Sepolia).`
  );
  process.exit(1);
}

const RPC =
  process.env.DEPLOY_SPONSOR_RPC_URL ||
  (chain.id === tempoModerato.id
    ? process.env.TEMPO_MODERATO_RPC_URL
    : process.env.BASE_SEPOLIA_RPC_URL) ||
  chain.rpcUrls.default.http[0];

if (!PK || !/^0x[0-9a-fA-F]{64}$/.test(PK)) {
  console.error('Set DEPLOY_SPONSOR_PRIVATE_KEY (0x + 64 hex) in server/.env or root .env');
  process.exit(1);
}

const account = privateKeyToAccount(PK);
const walletClient = createWalletClient({
  account,
  chain,
  transport: http(RPC),
});

console.log('[largeDeploySponsor] listening', `${HOST}:${PORT}`);
console.log(
  '[largeDeploySponsor] platform treasury address (VITE_LARGE_DEPLOY_SPONSOR_FROM):',
  account.address
);
console.log('[largeDeploySponsor] chain:', `${chain.name} (${chain.id})`);
if (!SECRET) console.warn('[largeDeploySponsor] SPONSOR_API_SECRET unset — only use on localhost');

const app = express();
app.use(
  cors({
    origin: [/localhost/, /127\.0\.0\.1/],
    credentials: true,
  })
);
app.use(express.json({ limit: '3mb' }));

app.post('/deploy', async (req, res) => {
  try {
    if (SECRET && req.headers['x-sponsor-secret'] !== SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { chainId, data } = req.body || {};
    if (chainId !== chain.id) {
      return res.status(400).json({ error: `Only chain ${chain.id} (${chain.name})` });
    }
    if (typeof data !== 'string' || !data.startsWith('0x') || data.length % 2 !== 0) {
      return res.status(400).json({ error: 'Invalid hex data' });
    }
    if (data.length > 3_000_000) {
      return res.status(400).json({ error: 'Payload too large' });
    }
    const byteLen = (data.length - 2) / 2;
    let gas = 1_200_000 + byteLen * 450;
    gas = Math.min(22_000_000, Math.max(8_000_000, Math.ceil(gas)));
    const hash = await walletClient.sendTransaction({
      data: data.toLowerCase(),
      value: 0n,
      gas: BigInt(gas),
    });
    return res.json({ hash });
  } catch (e) {
    console.error('[largeDeploySponsor]', e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, address: account.address, chainId: chain.id, chainName: chain.name });
});

app.listen(PORT, HOST);
