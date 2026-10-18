// Retrieval layer. Every number the bot is allowed to say comes from here.
// Nothing here computes a price locally — it only calls the RPCs that are the
// single source of pricing truth. No dependencies: PostgREST over fetch.
// Config is resolved lazily so this module can be imported for its schema
// (tests, tooling) without a live environment. It fails on first use instead.
let cfg = null;
function config() {
  if (cfg) return cfg;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY required');
  // anon key is sufficient: compute_booking_total, compute_booking_advance and
  // get_cafe_booked_slots all grant EXECUTE to anon (verified 2026-09-09).
  cfg = { url, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
  return cfg;
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A bare fetch here was a single point of failure: one transient blip and the
// whole turn threw, the customer got nothing, and the reply that never arrived
// looks exactly like the ignored-enquiry problem this bot exists to fix.
// (Observed live 2026-09-15: three consecutive "fetch failed" turns.)
// Timeout so a hung socket cannot stall a reply; retry transient failures and
// 5xx; never retry a 4xx, which is our own bad request and will not improve.
async function fetchWithRetry(url, init = {}, attempts = 3) {
  let wait = 400;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
      if (res.status >= 500 && i < attempts - 1) {
        await sleep(wait); wait *= 2; continue;
      }
      return res;
    } catch (err) {
      lastErr = err; // network error, DNS, abort/timeout
      if (i === attempts - 1) break;
      await sleep(wait); wait *= 2;
    }
  }
  throw lastErr || new Error('request failed after retries');
}

async function rpc(fn, args) {
  const { url, headers } = config();
  let res;
  try {
    res = await fetchWithRetry(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers, body: JSON.stringify(args),
    });
  } catch (err) {
    return { ok: false, reason: `could not reach pricing service: ${err.message}` };
  }
  const body = await res.text();
  if (!res.ok) {
    let msg = body;
    try { msg = JSON.parse(body).message || body; } catch {}
    return { ok: false, reason: msg };
  }
  return { ok: true, data: body ? JSON.parse(body) : null };
}

async function select(path) {
  const { url, headers } = config();
  const res = await fetchWithRetry(`${url}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`select ${path}: ${await res.text()}`);
  return res.json();
}

// The shared setup every non-standalone package is built on.
//
// 🔴 MIRRORS SHARED_SETUP_LABELS in ../../setup-labels.js (used by app.js and brochure.js). It is duplicated here on
// purpose, NOT out of laziness: the obvious "fix" — writing these into
// packages.inclusions for `setting` — would BREAK THE LIVE SITE. app.js's
// pkgStandalone() treats any package with non-empty inclusions as a standalone
// tier, which drops it out of the "Everything in The Setting, plus:" ladder,
// so Moment and Story would lose their inclusion lists on /packages.
// Unifying this properly needs an app.js change + site deploy; until then,
// if you edit the list in app.js, edit it here too.
const SHARED_SETUP = [
  'Fresh Fruits', 'Fresh Flowers', 'Wax Candles', 'Electric Candles',
  'Macrame Tent', 'Picnic Umbrella', 'Portable Speaker',
  'Board with Message', 'Cutlery & Essentials',
  'Setup & cleanup', 'Dedicated host support',
];

/**
 * Live catalogue of the venues this bot is scoped to, carrying only packages
 * that are actually priceable. A venue with no venue_packages rows makes
 * compute_booking_total RAISE, so such venues must never reach the model.
 */
export async function loadCatalogue(venueIds) {
  const ids = `(${venueIds.join(',')})`;
  const venues = await select(
    `venues?select=id,name,type,region,city,metadata&is_active=eq.true&id=in.${ids}`
  );
  // `occasion` decides whether a package is occasion-locked (Date Night,
  // Movie Night) or universal (null = fits any occasion). The model cannot
  // pick correctly without it. `inclusions` answers "what do I get".
  // NOTE: `images` is deliberately NOT loaded here — it would bloat the
  // system prompt on every call. Image URLs come from the references() tool
  // instead, so verify.mjs can guard them the same way it guards prices.
  const vp = await select(
    `venue_packages?select=venue_id,price,included_guests,overage_per_person,max_guests,packages(id,key,name,tagline,occasion,inclusions)` +
    `&is_active=eq.true&venue_id=in.${ids}`
  );

  // Bundled add-ons are what a package adds ON TOP of the shared setup. Same
  // source the website's package cards read; display-only, never priced here.
  const [bundles, addons] = await Promise.all([
    select('package_add_ons?select=package_id,addon_id'),
    select('add_ons?select=id,name'),
  ]);
  const addonName = new Map(addons.map((a) => [a.id, a.name]));
  const bundleFor = new Map();
  for (const b of bundles) {
    if (!bundleFor.has(b.package_id)) bundleFor.set(b.package_id, []);
    const n = addonName.get(b.addon_id);
    if (n) bundleFor.get(b.package_id).push(n);
  }
  const extrasFor = new Map(
    venues.map((v) => [v.id, Array.isArray(v.metadata?.includes) ? v.metadata.includes : []])
  );

  const out = [];
  for (const v of venues) {
    const packages = vp
      .filter((r) => r.venue_id === v.id && r.packages)
      .map((r) => ({
        package_key: r.packages.key,
        name: r.packages.name,
        tagline: r.packages.tagline,
        occasion: r.packages.occasion, // null = fits every occasion
        // Composed exactly like the website's package cards:
        //  - standalone package (own free-text inclusions, e.g. The Prelude)
        //    -> that list verbatim, it is NOT shared-setup-plus-extras
        //  - everything else -> shared setup + venue extras + its bundled add-ons
        // Never null now that it is composed, but the model's hard rule about
        // null stays in place as a backstop if a package ever has neither.
        inclusions: (() => {
          const own = r.packages.inclusions;
          if (Array.isArray(own) && own.length) return own;
          const list = [
            ...SHARED_SETUP,
            ...(extrasFor.get(v.id) || []),
            ...(bundleFor.get(r.packages.id) || []),
          ];
          return list.length ? list : null;
        })(),
        price: num(r.price),
        included_guests: r.included_guests,
        overage_per_person: num(r.overage_per_person),
        max_guests: r.max_guests,
      }))
      .sort((a, b) => a.price - b.price);
    if (packages.length === 0) continue; // unpriceable venue — excluded on purpose
    // Food is never part of a package price. At a cafe venue the guest can
    // order from the venue's own menu on the day; elsewhere the bot must not
    // claim food is available at all. Stated by Aksheev 2026-09-14 — do not
    // infer this from venues.metadata (food_multiplier etc. drive internal
    // pricing, not what a customer is told).
    out.push({
      venue_id: v.id,
      name: v.name,
      region: v.region,
      city: v.city,
      venue_type: v.type,
      food_policy: v.type === 'cafe'
        ? 'Food is not part of any package price. This is a cafe, so guests can order food a la carte from the venue on the day.'
        : 'Food is not part of any package price, and this venue is not a cafe — do not tell the customer anything else about food here.',
      packages,
    });
  }
  return out;
}

/**
 * Authoritative quote. Returns { ok, total, advance } or { ok:false, reason }.
 * A raise from the RPC (e.g. PACKAGE_NOT_AVAILABLE) becomes ok:false so the
 * caller escalates instead of guessing.
 */
export async function quote({ venue_id, package_key, guests, time_slot, addon_ids = null }) {
  const args = {
    p_venue_id: venue_id,
    p_billing_guests: guests,
    p_nights: null,
    p_addon_ids: addon_ids,
    p_time_slot: time_slot,
    p_package_key: package_key,
  };
  const [t, a] = await Promise.all([
    rpc('compute_booking_total', args),
    rpc('compute_booking_advance', args),
  ]);
  if (!t.ok) return { ok: false, reason: t.reason };
  if (!a.ok) return { ok: false, reason: a.reason };
  if (t.data === null) return { ok: false, reason: 'no total returned' };
  return { ok: true, total: num(t.data), advance: num(a.data) };
}

/** Dates already taken at a venue. Bot may only say "free" by absence here. */
export async function bookedSlots({ venue_id }) {
  const r = await rpc('get_cafe_booked_slots', { p_venue_id: venue_id });
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true, booked: (r.data || []).map((x) => ({ date: x.preferred_date, slot: x.time_slot })) };
}

/**
 * Reference photos AND videos for a package, straight from packages.images
 * and packages.reels. Customers on WhatsApp ask for "videos" or "reference
 * reels" as often as they ask for photos (confirmed 2026-09-18 reading real
 * threads: two separate customers asked for video specifically and got an
 * Instagram Reel link from a human). `reels` is a second, deliberately
 * separate jsonb column — see its migration comment — so this never touches
 * `images`, which the live /packages page gallery depends on.
 *
 * Why a tool and not part of the catalogue blob: a URL the model invents is
 * the same class of failure as a price it invents — worse, arguably, since a
 * dead link looks broken to the customer. Serving URLs through a tool means
 * verify.mjs can enforce that every link in a reply actually came back from
 * here this turn.
 *
 * Returns photos and videos as separate lists so the model can match what
 * the customer actually asked for (a "video" reply pointing at a photo URL
 * reads as broken). `urls` stays as a flat, video-first list purely so
 * brain.mjs's generic tool-output URL harvesting keeps working unchanged.
 *
 * Returns at most `limit` of EACH kind (WhatsApp replies should not be a
 * gallery). ok:false only when there is neither a photo nor a video on file
 * — the bot must escalate rather than substitute another package's media.
 */
export async function references({ package_key, limit = 3 }) {
  let rows;
  try {
    rows = await select(
      `packages?select=key,name,images,reels&key=eq.${encodeURIComponent(package_key)}&is_active=eq.true`
    );
  } catch (err) {
    return { ok: false, reason: `could not reach photo store: ${err.message}` };
  }
  const row = rows?.[0];
  if (!row) return { ok: false, reason: `no such package: ${package_key}` };

  const imgs = Array.isArray(row.images) ? row.images : [];
  const photos = imgs
    .map((i) => i?.url)
    .filter((u) => typeof u === 'string' && u.startsWith('http'))
    .slice(0, limit);

  const reels = Array.isArray(row.reels) ? row.reels : [];
  const videos = reels
    .map((r) => r?.url)
    .filter((u) => typeof u === 'string' && u.startsWith('http'))
    .slice(0, limit);

  if (!photos.length && !videos.length) {
    return { ok: false, reason: `no reference photos or videos on file for ${row.name}` };
  }
  return { ok: true, package_key: row.key, name: row.name, photos, videos, urls: [...videos, ...photos] };
}
