// setup-labels.js — the setup every cafe booking gets (The Setting's base
// checklist). Single source for the site (app.js: /packages Setting card,
// venueSetupLabels) and the /brochure page (brochure.js). Food & Beverages are
// left out on purpose — food is arranged separately, not part of the package.
// picnic-bot/src/tools.mjs keeps its own copy (separate runtime) — if you edit
// this list, edit that one too.
export const SHARED_SETUP_LABELS = [
  'Fresh Fruits', 'Fresh Flowers', 'Wax Candles', 'Electric Candles',
  'Macrame Tent', 'Picnic Umbrella', 'Portable Speaker',
  'Board with Message', 'Cutlery & Essentials',
  'Setup & cleanup', 'Dedicated host support',
]
