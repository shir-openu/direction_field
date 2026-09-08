// api/full-solution.js — step 2 of the paid flow: capture the payment, then solve.
//
// NEW ENDPOINT — nothing was overwritten to add it. The Direction Field had no
// API before this repo; the app itself is unchanged and still runs offline for
// everything except this call.
//   Pre-API state: commit 499213fbf0a5a5d62cfb4abe07f0ca3d0199866e (2026-08-17)
//   https://github.com/shir-openu/direction_field/tree/499213fbf0a5a5d62cfb4abe07f0ca3d0199866e
//   App source: D:\Dropbox\1PIPELINES1\FLUTTER_DIRECTION_FIELD_PHONE_APP\FLUTTER_1\DIRECTION_FIELD_MOB
//
// Separate from the Digital Friend endpoints (ODE-20218-2nd-DF*-en), which tutor
// without giving the answer and run on Gemini. This one is paid, gives the
// complete answer, and runs on Claude.
//
// The Anthropic key lives in Vercel's environment and never ships in the APK -
// the phone app calls this endpoint exactly like the web page does.

import Anthropic from '@anthropic-ai/sdk';
import { paypalToken, paypalFetch, paypalConfigured } from './_paypal.js';

const ALLOWED_ORIGIN = 'https://shir-openu.github.io';

// Shir writes the mathematical instructions herself, the same way she wrote the
// ai-hint.js tutor prompt. This file only assembles them.
// TODO(shir): replace with the full-solution instructions.
const INSTRUCTIONS = `<<< FULL-SOLUTION INSTRUCTIONS GO HERE >>>`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!paypalConfigured()) {
    console.error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set in the Vercel environment');
    return res.status(503).json({ error: 'Payment is not configured yet' });
  }

  const { orderId } = req.body || {};
  if (!orderId) return res.status(400).json({ error: 'orderId is required' });

  let token;
  try {
    token = await paypalToken();
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: 'Payment provider unavailable' });
  }

  // ---- 1. Take the money ---------------------------------------------------
  // Capture is the check. PayPal refuses to capture an order twice, so a replayed
  // orderId fails here instead of needing an "already redeemed" flag of our own -
  // which is the part a prepaid-pack design would have needed a database for.
  const cap = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, token, {
    method: 'POST',
    body: '{}',
  });

  if (!cap.ok || cap.body?.status !== 'COMPLETED') {
    const issue = cap.body?.details?.[0]?.issue;
    if (issue === 'ORDER_ALREADY_CAPTURED') {
      return res.status(409).json({ error: 'This solution has already been delivered' });
    }
    console.error('PayPal capture failed:', cap.status, cap.body);
    return res.status(402).json({ error: 'Payment not completed' });
  }

  const unit = cap.body.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  const captureId = capture?.id;

  // custom_id holds the equation base64url-encoded, because PayPal only permits
  // letters, digits and -_., in that field. See create-checkout.js.
  //
  // On the CAPTURE response PayPal echoes custom_id inside the capture object,
  // not on the purchase unit where it was sent - reading only the purchase unit
  // returned "no equation attached" on a payment that had in fact gone through.
  // Check both, capture first.
  const rawCustomId = capture?.custom_id || unit?.custom_id || null;
  let equation = null;
  if (rawCustomId) {
    try {
      equation = Buffer.from(rawCustomId, 'base64url').toString('utf8');
    } catch {
      equation = null;
    }
  }

  if (!equation) {
    await refund(token, captureId, 'no equation on the order');
    return res.status(400).json({ error: 'No equation attached to this payment' });
  }

  // ---- 2. Solve ------------------------------------------------------------
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
      await refund(token, captureId, 'model declined');
      return res.status(502).json({ error: 'Could not produce a solution. You have been refunded.' });
    }

    const solution = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    if (!solution.trim()) {
      await refund(token, captureId, 'empty solution');
      return res.status(502).json({ error: 'Could not produce a solution. You have been refunded.' });
    }

    return res.status(200).json({
      solution,
      equation,
      // Real token counts, so the true cost per solution can replace the estimate.
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens,
      },
    });
  } catch (error) {
    console.error('Anthropic API Error:', error);
    await refund(token, captureId, 'api error');
    return res.status(500).json({ error: 'Could not produce a solution. You have been refunded.' });
  }
}

// Nobody should pay for an answer they did not get. A refund that itself fails
// is logged rather than thrown, so the student still receives the error message
// instead of a blank 500 - but it needs a human to finish, hence the loud log.
async function refund(token, captureId, reason) {
  if (!captureId) {
    console.error(`REFUND IMPOSSIBLE (no capture id): ${reason}`);
    return;
  }
  try {
    const r = await paypalFetch(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, token, {
      method: 'POST',
      body: JSON.stringify({ note_to_payer: 'Automatic refund: the solution could not be produced.' }),
    });
    if (r.ok) console.log(`Refunded capture ${captureId}: ${reason}`);
    else console.error(`REFUND FAILED for capture ${captureId} (${reason}):`, r.status, r.body);
  } catch (e) {
    console.error(`REFUND FAILED for capture ${captureId} (${reason}):`, e);
  }
}
