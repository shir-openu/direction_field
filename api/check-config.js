// api/check-config.js — TEMPORARY diagnostic. Delete once PayPal authenticates.
//
// PayPal keeps returning 401 and there is no way to tell from the outside which
// of the usual causes it is. This reports the SHAPE of each variable - length,
// first character, whether it is padded with whitespace, whether the two values
// are identical - which is enough to identify every common mistake without any
// credential material leaving the server.
//
// A sandbox client id starts with 'A' and a secret with 'E', both around 80
// characters. Anything else is the bug.

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const shape = (name) => {
    const v = process.env[name];
    if (v === undefined) return { set: false };
    return {
      set: true,
      length: v.length,
      firstChar: v.slice(0, 1),
      lastChar: v.slice(-1),
      hasWhitespace: /\s/.test(v),
      // A pasted value that still carries quotes is a classic copy mistake.
      hasQuotes: /["']/.test(v),
    };
  };

  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;

  return res.status(200).json({
    PAYPAL_CLIENT_ID: shape('PAYPAL_CLIENT_ID'),
    PAYPAL_CLIENT_SECRET: shape('PAYPAL_CLIENT_SECRET'),
    ANTHROPIC_API_KEY: { set: Boolean(process.env.ANTHROPIC_API_KEY) },
    PAYPAL_ENV: process.env.PAYPAL_ENV || '(unset - using sandbox)',
    bothValuesIdentical: Boolean(id && secret && id === secret),
    looksSwapped: Boolean(id && secret && id.startsWith('E') && secret.startsWith('A')),
  });
}
