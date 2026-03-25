import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';

// Load env from both locations:
// - server/.env (recommended)
// - repo root .env (fallback)
dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)) });
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));

const PRIVY_APP_ID = process.env.PRIVY_APP_ID;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;
const PORT = Number(process.env.PORT || 8787);

if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
  // eslint-disable-next-line no-console
  console.error('Missing PRIVY_APP_ID or PRIVY_APP_SECRET in environment.');
  process.exit(1);
}

function basicAuthHeader(appId, appSecret) {
  return `Basic ${Buffer.from(`${appId}:${appSecret}`).toString('base64')}`;
}

/**
 * POST /api/privy/wallets/:walletId/rpc
 * Body:
 * {
 *   "rpcBody": { ... },                     // Body for Privy POST /v1/wallets/:walletId/rpc
 *   "authorizationSignature": "<base64>",   // From useAuthorizationSignature()
 *   "requestExpiry": 1773679531000          // ms unix timestamp used in signature payload (optional but recommended)
 * }
 */
app.post('/api/privy/wallets/:walletId/rpc', async (req, res) => {
  try {
    const { walletId } = req.params;
    const { rpcBody, authorizationSignature, requestExpiry } = req.body || {};

    if (!walletId) return res.status(400).json({ error: 'Missing walletId' });
    if (!rpcBody) return res.status(400).json({ error: 'Missing rpcBody' });
    if (!authorizationSignature) return res.status(400).json({ error: 'Missing authorizationSignature' });

    const url = `https://api.privy.io/v1/wallets/${walletId}/rpc`;

    const headers = {
      'Content-Type': 'application/json',
      Authorization: basicAuthHeader(PRIVY_APP_ID, PRIVY_APP_SECRET),
      'privy-app-id': PRIVY_APP_ID,
      'privy-authorization-signature': authorizationSignature,
    };

    // Privy rejects expired requests; include an expiry header if provided.
    if (typeof requestExpiry === 'number') {
      headers['privy-request-expiry'] = String(requestExpiry);
    }

    const r = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(rpcBody),
    });

    const text = await r.text();
    const json = (() => {
      try {
        return JSON.parse(text);
      } catch {
        return { raw: text };
      }
    })();

    return res.status(r.status).json(json);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Relay error', e);
    return res.status(500).json({ error: e?.message || 'Relay error' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Privy relay listening on http://localhost:${PORT}`);
});

