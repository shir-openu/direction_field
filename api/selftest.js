// api/selftest.js — TEMPORARY. Delete once the solution output has been checked.
//
// PayPal started blocking the repeated automated sandbox logins, so the paid
// path can no longer be driven end to end on demand. The payment half is already
// proven; this exercises the other half - that the instructions in
// full-solution.js actually produce a correct worked solution.
//
// The equation is HARDCODED. This deliberately cannot be used to obtain a free
// solution for an arbitrary equation, so leaving it up briefly costs one fixed
// call rather than opening a hole.

import Anthropic from '@anthropic-ai/sdk';
import { INSTRUCTIONS } from './_instructions.js';

const FIXED_EQUATION = "y' + tan(x)*y = x*sin(2*x)";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: [{ type: 'text', text: INSTRUCTIONS, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: JSON.stringify({ equation: FIXED_EQUATION }) }],
    });

    if (response.stop_reason === 'refusal') {
      return res.status(502).json({ error: 'model declined' });
    }

    const solution = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    return res.status(200).json({
      equation: FIXED_EQUATION,
      solution,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens,
      },
    });
  } catch (error) {
    console.error('selftest error:', error);
    return res.status(500).json({ error: String(error.message || error) });
  }
}
