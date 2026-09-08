// api/create-checkout.js — step 1 of the paid flow.
//
// Gumroad needs no server call to start a purchase: the product has a fixed URL.
// This endpoint exists so the page has one place to ask where to send the buyer,
// and so the product URL is configuration rather than something baked into the
// published HTML.
//
// The equation does not travel with them. Checkout opens in a second tab and the
// page stays put holding it, because Gumroad's current editor has no
// "redirect after purchase" - there is no return trip to carry anything back.
// What comes back is the licence key, pasted by the buyer.
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

  // Still required, so the page cannot open a paid checkout for an empty box.
  const { equation } = req.body || {};
  if (!equation || typeof equation !== 'string') {
    return res.status(400).json({ error: 'equation is required' });
  }
  if (equation.length > 200) {
    return res.status(400).json({ error: 'equation is too long' });
  }

  // wanted=true opens Gumroad straight on the checkout rather than the
  // product's description page.
  const url = `${process.env.GUMROAD_PRODUCT_URL}?wanted=true`;

  return res.status(200).json({ url });
}
