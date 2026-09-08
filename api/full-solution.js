// api/full-solution.js — step 2 of the paid flow: verify the purchase, then solve.
//
// The Direction Field had no API before this repo; the app itself is unchanged
// and still runs offline for everything except this call.
//   Pre-API state: commit 499213fbf0a5a5d62cfb4abe07f0ca3d0199866e (2026-08-17)
//   https://github.com/shir-openu/direction_field/tree/499213fbf0a5a5d62cfb4abe07f0ca3d0199866e
//
// Separate from the Digital Friend endpoints (ODE-20218-2nd-DF*-en), which tutor
// without giving the answer and run on Gemini. This one is paid, gives the
// complete answer, and runs on Claude.
//
// The Anthropic key lives in Vercel's environment and never ships in the APK -
// the phone app calls this endpoint exactly like the web page does.
//
// Payment is Gumroad, not PayPal: PayPal live requires an Israeli business
// registration. See api/_gumroad.js for why and how.

import Anthropic from '@anthropic-ai/sdk';
import { gumroadConfigured, gumroadSale, gumroadVerifyLicence } from './_gumroad.js';
import { INSTRUCTIONS } from './_instructions.js';

const ALLOWED_ORIGIN = 'https://shir-openu.github.io';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!gumroadConfigured()) {
    console.error('GUMROAD_ACCESS_TOKEN / GUMROAD_PRODUCT_ID are not set');
    return res.status(503).json({ error: 'Payment is not configured yet' });
  }

  const { saleId, equation } = req.body || {};
  if (!saleId) return res.status(400).json({ error: 'saleId is required' });
  if (!equation || typeof equation !== 'string') {
    return res.status(400).json({ error: 'equation is required' });
  }

  // ---- 1. Was this actually bought? ---------------------------------------
  const sale = await gumroadSale(saleId);
  if (!sale.ok || !sale.sale) {
    console.error('Gumroad sale lookup failed:', sale.status, sale.body);
    return res.status(402).json({ error: 'Payment not found' });
  }
  if (sale.sale.refunded || sale.sale.chargebacked) {
    return res.status(402).json({ error: 'This payment was refunded' });
  }

  const licenceKey = sale.sale.license_key;
  if (!licenceKey) {
    // Licence keys are what make a sale single-use here, so a product without
    // them would hand out unlimited solutions for one payment.
    console.error('Sale has no licence key - is "generate license key" enabled on the product?');
    return res.status(500).json({ error: 'Payment could not be verified' });
  }

  // ---- 2. Spend it ---------------------------------------------------------
  // Gumroad increments the uses counter on every verify, so the first call
  // returns 1 and a replay returns 2 or more. That is the whole single-use
  // mechanism - no store of our own, nothing to keep in sync.
  const licence = await gumroadVerifyLicence(licenceKey);
  if (!licence.ok) {
    console.error('Licence verify failed:', licence.status, licence.body);
    return res.status(402).json({ error: 'Payment could not be verified' });
  }
  if (licence.refunded) {
    return res.status(402).json({ error: 'This payment was refunded' });
  }
  if (licence.uses !== null && licence.uses > 1) {
    return res.status(409).json({ error: 'This solution has already been delivered' });
  }

  // ---- 3. Solve ------------------------------------------------------------
  try {
    const client = new Anthropic(); // ANTHROPIC_API_KEY from Vercel env

    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      // Identical on every call, so caching makes the input side nearly free.
      system: [{ type: 'text', text: INSTRUCTIONS, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: JSON.stringify({ equation }) }],
    });

    // Claude can decline and still return 200, so check before reading content.
    if (response.stop_reason === 'refusal') {
      return res.status(502).json({ error: 'Could not produce a solution. Contact Shir for a refund.' });
    }

    const solution = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    if (!solution.trim()) {
      return res.status(502).json({ error: 'Could not produce a solution. Contact Shir for a refund.' });
    }

    return res.status(200).json({
      solution,
      equation,
      // Real token counts, so the true cost per solution stays visible.
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens,
      },
    });
  } catch (error) {
    // Gumroad refunds are issued from its dashboard rather than by API here, so
    // this says who to ask instead of promising an automatic refund it cannot make.
    console.error('Anthropic API Error:', error);
    return res.status(500).json({ error: 'Could not produce a solution. Contact Shir for a refund.' });
  }
}
