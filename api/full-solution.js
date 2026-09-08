// api/full-solution.js — step 2 of the paid flow: verify payment, then solve.
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

import Stripe from 'stripe';
import Anthropic from '@anthropic-ai/sdk';

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

  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // ---- 1. Was this actually paid, and is it still unspent? -----------------
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (e) {
    // An id that Stripe does not recognise is a forgery, not a server fault.
    return res.status(402).json({ error: 'Payment not found' });
  }

  if (session.payment_status !== 'paid') {
    return res.status(402).json({ error: 'Payment not completed' });
  }
  if (session.metadata?.redeemed === 'true') {
    return res.status(409).json({ error: 'This solution has already been delivered' });
  }

  const equation = session.metadata?.equation;
  if (!equation) {
    return res.status(400).json({ error: 'No equation attached to this payment' });
  }

  // ---- 2. Spend it BEFORE calling Claude ----------------------------------
  // Marking first means a crash or timeout costs the student their $1 once,
  // rather than leaving a session that can be replayed for unlimited solutions.
  // The refund path below covers the failure case.
  await stripe.checkout.sessions.update(sessionId, {
    metadata: { ...session.metadata, redeemed: 'true' },
  });

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
      messages: [{
        role: 'user',
        content: JSON.stringify({
          equation,
          initialCondition: session.metadata.initialCondition || null,
        }),
      }],
    });

    // Claude can decline and still return 200, so check before reading content.
    if (response.stop_reason === 'refusal') {
      await refund(stripe, session, 'model declined');
      return res.status(502).json({ error: 'Could not produce a solution. You have been refunded.' });
    }

    const solution = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    if (!solution.trim()) {
      await refund(stripe, session, 'empty solution');
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
    await refund(stripe, session, 'api error');
    return res.status(500).json({ error: 'Could not produce a solution. You have been refunded.' });
  }
}

// Nobody should pay for an answer they did not get. A refund that itself fails
// is logged rather than thrown, so the student still receives the error message
// instead of a blank 500.
async function refund(stripe, session, reason) {
  try {
    await stripe.refunds.create({
      payment_intent: session.payment_intent,
      reason: 'requested_by_customer',
      metadata: { auto_refund: reason },
    });
    console.log(`Refunded ${session.id}: ${reason}`);
  } catch (e) {
    console.error(`REFUND FAILED for ${session.id} (${reason}):`, e);
  }
}
