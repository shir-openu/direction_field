// Gumroad instead of PayPal.
//
// PayPal live needs an Israeli business registration (mispar osek) that Shir
// does not have and does not want. Gumroad is a merchant of record: it is the
// legal seller, it handles VAT, and it pays creators in Israel as individuals -
// ID and proof of address, no business registration. It is also cheaper here:
// a flat 10% with no fixed per-transaction fee, so ~10c on a $1 sale against
// PayPal's ~52c.
//
// Single-use without a database, same trick as before but with Gumroad's own
// primitive: a licence key carries a uses counter that Gumroad increments on
// every verify. First verify returns uses = 1; a replay returns 2 or more, and
// we refuse. Gumroad holds the state, so there is still nothing to provision.
//
// The buyer pastes that key into the page. There is no sale-id lookup here
// because Gumroad's current editor dropped "redirect after purchase", so there
// is no return trip to carry a sale id - the key they are shown, and mailed,
// is the receipt.

const API = 'https://api.gumroad.com/v2';

export function gumroadConfigured() {
  return Boolean(process.env.GUMROAD_ACCESS_TOKEN && process.env.GUMROAD_PRODUCT_ID);
}

// increment_uses_count defaults to true on Gumroad's side, but it is the whole
// mechanism here so it is stated explicitly rather than relied on.
export async function gumroadVerifyLicence(licenceKey) {
  const params = new URLSearchParams({
    product_id: process.env.GUMROAD_PRODUCT_ID,
    license_key: licenceKey,
    increment_uses_count: 'true',
  });
  const r = await fetch(`${API}/licenses/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const body = await r.json().catch(() => null);
  return {
    ok: r.ok && body?.success === true,
    status: r.status,
    uses: body?.uses ?? null,
    refunded: Boolean(body?.purchase?.refunded || body?.purchase?.chargebacked),
    body,
  };
}
