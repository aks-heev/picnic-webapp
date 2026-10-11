# Plan: /brochure becomes the public packages page; /packages becomes the venue step

Written 2026-10-11 using the plan-optimizer loop (scores 64 → 78 → 86 → 91 → 91, then a best-of-3 round, then stopped). Status: NOT started.

## Goal and definition of done
One public page describes the packages: /brochure. /packages stops being a second place to choose a package and becomes only the "pick your venue" step of booking.

Done means all of the following:
1. A visitor to bare `/packages` (no `tier`, no `occasion`) lands on `/brochure` with a 308 redirect.
2. `/packages?tier=X` opens straight on the venue picker for X, with no package cards above it.
3. Every existing link still lands somewhere sensible. That covers homepage, blog, venue/city pages, ads, the bot and old WhatsApp-shared links.
4. /brochure can be found on Google and fires Meta ViewContent.
5. Each rule passes the verification table below on a Vercel preview deployment before it goes to `main`.

## Facts this plan rests on (probed live 2026-10-11)
- Bookings by package (confirmed): Prelude 16, Setting 14, Moment 4, Story 1. Date Night, Date Night Deluxe, Movie Night and Movie Night Deluxe have 0 bookings ever. The brochure doesn't show the occasion packages; only /packages does, behind its occasion chips.
- /packages in Google Search Console, last 90 days: 204 impressions, 5 clicks, position 8.1. /brochure has `noindex`.
- /brochure has no Meta Pixel. /packages fires `ViewContent` in `showPackagesPage`.
- `dist/packages.html` is written by `scripts/prerender-venues.mjs` (`buildPackagesPage`). It is an SPA shell plus SEO copy and Offer JSON-LD.
- Inbound links to /packages: the homepage hero CTA (SPA onclick), homepage teaser cards (`/packages?tier=`), `Packages` pills and buttons on prerendered pages (`prerender-venues.mjs` ~L1032/1044/1052), 4 blog posts (~10 links), ads (`?tier=` / `?occasion=`, `app.js` ~L12385), the sitemap and the picnic bot.

## Approach
This is one Vercel redirect plus a small `app.js` change. No files get renamed. `/packages` stays the SPA URL for the venue step, because every `?tier=` link already points there.

## Phase 0: Decisions and checks before any code
Exit: both answered and written into this doc.
- D1 DECIDED 2026-10-11 (Aksheev): the 4 occasion packages were deactivated (migration `20261011_deactivate_occasion_packages.sql`, applied live). "Date Night" stays an occasion in the booking form. `OCCASION_DEFAULT_TIER` now maps Date Night and Movie Night to `setting`. `?occasion=` links now show the universal ladder, so in Phase 2 the redirect can drop the `occasion` exception: bare `/packages` and `/packages?occasion=…` both go to /brochure. Rejected the same day: asking for the occasion after "Book now". The form already captures it (23/26 website leads in 120 days filled it in), and the extra step would contradict the package the customer just chose.
- C1 (Claude): List the destination URLs of active Meta ads with the Meta connector. Any ad pointing at bare `/packages` will land on /brochure after this change. That is intended, but the ad's ViewContent will now come from the brochure pixel (Phase 1). Write the list here.

## Phase 1: Make /brochure public-ready (safe on its own; ship first)
Exit: deployed and checked on prod; nothing redirects yet.
1. `brochure.html`: remove `<meta name="robots" content="noindex, nofollow">` and the comment above it. Add `<link rel="canonical" href="https://www.picnicstories.com/brochure">` and a meta description.
2. Add the Meta Pixel base code to `brochure.html`, copied from `index.html`, so it uses the same pixel ID. In `brochure.js` `fillLivePrices`, fire `fbq('track','ViewContent',{content_name:'Picnic Packages', content_type:'product_group', content_ids:[visible package keys], currency:'INR', value:<lowest from price>})`. This has the same shape as `showPackagesPage`, so Meta reporting stays comparable.
3. `prerender-venues.mjs`: add `/brochure` to the sitemap. Leave `/packages` in until Phase 3.
4. Verify: view-source on prod shows no noindex. Meta Pixel Helper or the Events Manager test view shows ViewContent on /brochure.

## Phase 2: /packages is the venue step only
Exit: all rows of the verification table pass on a preview deploy.
1. `vercel.json` `redirects`: `{ "source": "/packages", "missing": [{"type":"query","key":"tier"},{"type":"query","key":"occasion"}], "destination": "/brochure", "permanent": true }`. `missing` requires all listed conditions, so `?tier=` and `?occasion=` links still go to the SPA.
2. `app.js` router (~L12385): `scrollToVenues` becomes `!!qsTier` instead of `step === 'venue'`. Any tier link starts at the venue step.
3. `app.js` `renderPackagesPage`: when `pkgPageState.tierKey` is set, don't render the occasion chips or the package cards. Render a one-line summary instead ("Booking **The Moment** · from ₹X · Change package → /brochure#packages"), then the existing venue picker. Leave the occasion-only path (`?occasion=` with no tier) unchanged.
4. In-SPA links that call `showPackagesPage()` with no tier (homepage hero CTA ~L163 in `index.html`, the bare route at `app.js` ~L12174): change them to do a full navigation to `/brochure`. The `/packages?tier=` teaser cards stay as they are, because they now open on the venue step, which is the intended result.
5. `/brochure` "Book online" links: drop `&step=venue`, since `tier` now implies it. Keep the parameter accepted so old links still work.
6. Prerender: `buildPackagesPage` still writes `dist/packages.html` (the SPA shell for `?tier=`). Change its `<link rel="canonical">` to `/brochure`, add `noindex`, and remove `/packages` from the sitemap. Change the `Packages` nav pills and buttons (~L1032/1044/1052) and the 4 blog posts to link to `/brochure`, which avoids a redirect hop.
7. Bot (`picnic-bot/src/tools.mjs`): if it links to `/packages`, switch the link to `/brochure` and redeploy the bot.
8. Push to a branch (Aksheev runs git), then test on the Vercel preview URL.

### Verification table (run on the preview, then again on prod)
| Request | Expected |
|---|---|
| `/packages` | 308 → `/brochure` |
| `/packages?utm_source=x` | 308 → `/brochure?utm_source=x` (query kept) |
| `/packages?tier=moment` | 200, venue picker for The Moment, no package cards |
| `/packages?tier=moment&step=venue` (old brochure link) | same as above |
| `/packages?tier=bogus` | 200 with the tier dropped, so the page has no tier. Must NOT show an empty page: redirect to `/brochure` client-side |
| `/packages?occasion=Date%20Night` | 200, current occasion behaviour (or per D1) |
| `/brochure` | 200, indexable, ViewContent fires |
| Homepage hero "Packages" button | lands on `/brochure` |
| Full booking from `/brochure` → Book online → venue → form | reaches the booking form with the right package and price; stop before payment (never complete a Razorpay charge) |

## Phase 3: Clean-up (2+ weeks after Phase 2, once metrics look fine)
- Delete the unreachable code for the bare packages page (tier cards and occasion chips) only after D1 is settled.
- Consider renaming /brochure to a nicer public URL. Only worth it if it gets search traffic; otherwise skip.

## Risks and mitigations
- No staging environment: every step is verified on the branch's Vercel preview deploy before `main`. Rollback is reverting the commit; the redirect is one JSON block.
- SEO: the 308 passes /packages' small ranking to /brochure. The baseline is 204 impressions per 90 days at position 8.1. Check GSC 28 days after launch.
- Meta: ads to bare /packages land on the brochure. Phase 1 adds the brochure pixel first, so ViewContent isn't lost.
- `?tier=bogus` or an inactive tier: the page is empty after the cards are removed. This is handled by the client-side fallback to /brochure (table row 5).
- The brochure loads before prices fill in, so it shows the static fallback until then. It already behaves this way; nothing changes.

## How we'll know it worked (directional; volumes are tiny, so state n)
- `brochure_book_online_click` → `package_tier_selected` / booking submitted: the funnel should not drop. Compare 28 days before and after, with n stated.
- Website-sourced bookings/leads (`entry_source='site'`) over 28 days are no lower than the prior 28.
- GSC: `/brochure` picks up the impressions that `/packages` had.
- Zero 404s or blank venue steps in PostHog over the first week.

## First action
Aksheev answers D1. Claude runs C1 and builds Phase 1.
