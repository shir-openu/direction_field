// api/create-checkout.js — step 1 of the paid flow.
//
// Creates a PayPal order for one solution and hands the browser the approval
// URL. Nothing is charged here; PayPal collects the money, and the order is
// only captured later, in api/full-solution.js.
//
// Why there is no database anywhere in this flow: at one payment per solution,
// the PayPal order itself is the receipt. The equation rides on the order, and
// PayPal will not let the same order be captured twice - so the "already used"
// check that a credit balance would have needed comes free.
//
// A prepaid pack would have needed a store; a balance has to live somewhere.

import { paypalToken, paypalFetch, paypalConfigured, paypalBase } from './_paypal.js';

const ALLOWED_ORIGIN = 'https://shir-openu.github.io';
const RETURN_TO = 'https://shir-openu.github.io/direction_field/';
const PRICE = '1.00'; // USD

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Without this the token call throws and the caller just sees a 500, which
  // reads as a broken endpoint rather than an unset environment variable.
  if (!paypalConfigured()) {
    console.error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set in the Vercel environment');
    return res.status(503).json({ error: 'Payment is not configured yet' });
  }

  const { equation, initialCondition } = req.body || {};
  if (!equation || typeof equation !== 'string') {
    return res.status(400).json({ error: 'equation is required' });
  }
  // custom_id is capped at 127 characters AND restricted to letters, digits and
  // -_., - so a plain equation is rejected outright: apostrophes, spaces, "=",
  // "*" and brackets are all outside the set. Base64url encoding keeps the
  // equation byte-exact while using only permitted characters. It costs about a
  // third in length, so the equation itself is capped well below 127.
  if (equation.length > 90) {
    return res.status(400).json({ error: 'equation is too long' });
  }
  const encodedEquation = Buffer.from(equation, 'utf8').toString('base64url');

  try {
    const token = await paypalToken();

    const { ok, status, body } = await paypalFetch('/v2/checkout/orders', token, {
      method: 'POST',
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'USD', value: PRICE },
          // Shown to the buyer on the PayPal page, so it stays human-readable -
          // but stripped of characters PayPal rejects in this field.
          description: `Full solution: ${equation}`.replace(/[^\w\s.,:;+\-*/^()=']/g, '').slice(0, 127),
          // The equation is pinned to the order at purchase time. The redemption
          // endpoint reads it back from here rather than trusting whatever the
          // browser sends, so a paid order can only buy what it was bought for.
          custom_id: encodedEquation,
        }],
        application_context: {
          brand_name: 'ODE Direction Field',
          user_action: 'PAY_NOW',
          return_url: RETURN_TO,
          cancel_url: RETURN_TO,
        },
      }),
    });

    if (!ok) {
      console.error('PayPal create order failed:', status, body);
      return res.status(502).json({ error: 'Could not start checkout' });
    }

    const approve = (body.links || []).find(l => l.rel === 'approve' || l.rel === 'payer-action');
    if (!approve) {
      console.error('PayPal returned no approval link:', body);
      return res.status(502).json({ error: 'Could not start checkout' });
    }

    return res.status(200).json({
      url: approve.href,
      orderId: body.id,
      // Handy while testing: confirms whether real money is in play.
      env: paypalBase().includes('sandbox') ? 'sandbox' : 'live',
    });
  } catch (error) {
    console.error('PayPal error:', error);
    if (error.paypalStatus === 401) {
      // Named explicitly because the fix is specific and otherwise invisible:
      // the credentials do not belong to the environment being called.
      return res.status(502).json({
        error: 'PayPal rejected the credentials',
        hint: `Client id/secret are not valid for the ${paypalBase().includes('sandbox') ? 'sandbox' : 'live'} environment`,
      });
    }
    return res.status(500).json({ error: 'Could not start checkout' });
  }
}
