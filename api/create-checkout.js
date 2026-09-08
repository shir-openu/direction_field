// api/create-checkout.js — step 1 of the paid flow.
//
// Creates a Stripe Checkout Session for one solution and hands the browser the
// hosted payment URL. Nothing is charged here; Stripe collects the card.
//
// Why there is no database anywhere in this flow: at one payment per solution,
// the Checkout Session itself is the receipt. We store the equation on it, and
// api/full-solution.js later asks Stripe whether that session was paid and
// whether it has already been spent. Stripe holds the state, so there is no
// store to provision, pay for, or keep in sync.
//
// A prepaid pack would have needed one - a balance has to live somewhere.

import Stripe from 'stripe';

const ALLOWED_ORIGIN = 'https://shir-openu.github.io';
const RETURN_TO = 'https://shir-openu.github.io/direction_field/';
const PRICE_CENTS = 100; // $1.00

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { equation, initialCondition } = req.body || {};
  if (!equation || typeof equation !== 'string') {
    return res.status(400).json({ error: 'equation is required' });
  }
  // Stripe caps a metadata value at 500 characters, and an equation far shorter
  // than that is already not a real one.
  if (equation.length > 400) {
    return res.status(400).json({ error: 'equation is too long' });
  }

  // Without this the Stripe constructor throws and the caller just sees a 500,
  // which looks like a broken endpoint rather than an unset variable.
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is not set in the Vercel environment');
    return res.status(503).json({ error: 'Payment is not configured yet' });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: PRICE_CENTS,
          product_data: {
            name: 'Full worked solution',
            description: equation.slice(0, 100),
          },
        },
      }],
      // The equation is pinned to the session at purchase time. The redemption
      // endpoint reads it from here rather than trusting whatever the browser
      // sends back, so a paid session can only ever buy the equation it was
      // bought for.
      metadata: {
        equation,
        initialCondition: initialCondition ? String(initialCondition).slice(0, 100) : '',
        redeemed: 'false',
      },
      success_url: `${RETURN_TO}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: RETURN_TO,
    });

    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error('Stripe error:', error);
    return res.status(500).json({ error: 'Could not start checkout' });
  }
}
