// api/create-checkout.js — step 1 of the paid flow.
//
// Gumroad needs no server call to start a purchase: the product has a fixed URL.
// This endpoint exists so the page has one place to ask where to send the buyer,
// and so the equation can be carried through the purchase and back again.
//
// Gumroad appends any ?parameter on the product URL to its post-purchase
// redirect, so the equation makes the round trip without a database. It is
// base64url-encoded because it travels in a URL and equations are full of
// characters that do not.
//
// Replaced the PayPal version: PayPal live requires an Israeli business
// registration Shir does not have. Gumroad is a merchant of record and pays
// individuals - see api/_gumroad.js.

import { gumroadConfigured } from './_gumroad.js';

const ALLOWED_ORIGIN = 'https://shir-openu.github.io';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!gumroadConfigured() || !process.env.GUMROAD_PRODUCT_URL) {
    console.error('GUMROAD_ACCESS_TOKEN / GUMROAD_PRODUCT_ID / GUMROAD_PRODUCT_URL are not set');
    return res.status(503).json({ error: 'Payment is not configured yet' });
  }

  const { equation } = req.body || {};
  if (!equation || typeof equation !== 'string') {
    return res.status(400).json({ error: 'equation is required' });
  }
  if (equation.length > 200) {
    return res.status(400).json({ error: 'equation is too long' });
  }

  const encoded = Buffer.from(equation, 'utf8').toString('base64url');
  const url = `${process.env.GUMROAD_PRODUCT_URL}?wanted=true&eq=${encoded}`;

  return res.status(200).json({ url });
}
