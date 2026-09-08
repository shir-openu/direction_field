// api/full-solution.js — the Direction Field app's first API.
//
// The phone app sends the equation; this returns the full worked solution.
// The Anthropic key lives here as a Vercel environment variable and is never
// shipped inside the APK.
//
// NEW PROJECT — nothing to revert to. The Direction Field app had no API
// before this repo; the app itself is unchanged and still runs offline for
// everything except this endpoint.
//   App source: D:\Dropbox\1PIPELINES1\FLUTTER_DIRECTION_FIELD_PHONE_APP\FLUTTER_1\DIRECTION_FIELD_MOB
//
// Separate from the Digital Friend endpoints (ODE-20218-2nd-DF*-en), which
// tutor without giving the answer and run on Gemini. This one is paid and
// gives the complete answer, on Claude.

import Anthropic from '@anthropic-ai/sdk';

// The phone app is not a browser, so CORS does not apply to it. This header is
// here for the web twin on GitHub Pages, which is a browser origin.
const ALLOWED_ORIGIN = 'https://shir-openu.github.io';

// Shir is writing the mathematical instructions herself.
// TODO(shir): replace with the full-solution instructions.
const INSTRUCTIONS = `<<< FULL-SOLUTION INSTRUCTIONS GO HERE >>>`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { equation, initialCondition, paymentToken } = req.body || {};
  if (!equation) return res.status(400).json({ error: 'equation is required' });

  // Prepaid credit packs: $10 buys 15 solutions. Unimplemented until the
  // credit store exists, and it refuses rather than serving paid work free.
  if (!(await hasCredit(paymentToken))) {
    return res.status(402).json({ error: 'Payment required' });
  }

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
        content: JSON.stringify({ equation, initialCondition: initialCondition ?? null }),
      }],
    });

    // Claude can decline and still return 200, so check before reading content.
    if (response.stop_reason === 'refusal') {
      return res.status(502).json({ error: 'Model declined the request' });
    }

    const solution = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    return res.status(200).json({
      solution,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens,
      },
    });
  } catch (error) {
    console.error('Anthropic API Error:', error);
    return res.status(500).json({ error: 'Error processing request' });
  }
}

// Placeholder until the credit store is set up.
async function hasCredit(_paymentToken) {
  return false;
}
