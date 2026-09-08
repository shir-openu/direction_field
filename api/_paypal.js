// Shared PayPal helpers for the two payment endpoints.
//
// Deliberately no SDK: PayPal's Orders v2 flow is three plain HTTPS calls, and
// Vercel's Node runtime already has global fetch. One less dependency to keep
// current, and nothing hidden behind a wrapper.

const LIVE = 'https://api-m.paypal.com';
const SANDBOX = 'https://api-m.sandbox.paypal.com';

// Set PAYPAL_ENV=live in Vercel when you are ready to take real money.
// Defaulting to sandbox means a missing variable costs a test payment, not a real one.
export function paypalBase() {
  return process.env.PAYPAL_ENV === 'live' ? LIVE : SANDBOX;
}

export function paypalConfigured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

// PayPal wants an OAuth2 token on every call. They are short-lived, and one
// serverless invocation makes at most a couple of calls, so there is nothing
// worth caching across requests.
export async function paypalToken() {
  const creds = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64');

  const r = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!r.ok) {
    throw new Error(`PayPal auth failed: ${r.status} ${await r.text()}`);
  }
  const data = await r.json();
  return data.access_token;
}

export async function paypalFetch(path, token, options = {}) {
  const r = await fetch(`${paypalBase()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { ok: r.ok, status: r.status, body };
}
