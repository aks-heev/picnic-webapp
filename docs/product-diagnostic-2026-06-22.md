# The Picnic Stories — Product Diagnostic
**Date:** 2026-06-22  
**Mode:** General health check — no specific symptom metric  
**Analyst:** Claude (Cowork)

---

## Funnel Map

| Stage | What happens | Current state |
|---|---|---|
| **Acquisition** | User discovers the product via IG reels, paid Meta ads, SEO, word of mouth | ⚠️ SEO was broken until today's commit — and that commit is currently failing on Vercel |
| **Activation** | Lands on homepage or venue deep-link, browses venues | ⚠️ Venue deep-links were empty HTML shells for scrapers/social previews until today |
| **Consideration** | Reads venue detail, views photos/menu, checks pricing and add-ons | ⚠️ Two venues (Terracottage Ochre + Sienna) have no photos; no social proof at decision point |
| **Intent** | Fills booking form, submits | ⚠️ Complex form + no live pricing estimate + two divergent flows (pay now vs. wait for admin) |
| **Payment** | Razorpay advance (50% of total) | ✅ Working, webhook backstop live |
| **Post-booking** | Confirmation email, success page, WhatsApp contact | 🔴 Emails likely hitting spam; no WhatsApp float deployed; no retention sequence |
| **Retention/Referral** | Review ask, re-booking nudge, referral incentive | 🔴 Does not exist |

---

## Where the Drop-off Is Sharpest

**Hypothesis 1 — Acquisition:** The highest-friction invisible wall is SEO/indexability. The site has been serving scrapers and Google empty HTML for its entire lifetime. Social ads that linked to venue URLs (`/venues/castle-valley`) showed preview scrapers a blank page. Every reel that drove traffic to a venue deep-link gave Instagram/WhatsApp previews a title of "The Picnic Stories" with a stock Unsplash OG image. This is only fixed as of today — and today's build is broken.

**Hypothesis 2 — Post-booking to Referral:** Happy customers leave with no mechanism pulling them back. No post-event email. No review ask. No referral code. The compounding loop doesn't exist.

---

## Root Causes (5)

### RC-1: Vercel build is currently broken (Blocker, Today)
`analytics.js` was imported in `app.js` but never committed. The prerender script and route-based SEO pages will never run until this is fixed. One `git add analytics.js && git commit && git push` fixes it. Every day this isn't done = zero new SEO equity and broken venue deep-links in production.

**Severity: Critical. Fix time: 5 minutes.**

### RC-2: Email confirmations likely hitting spam
The Resend sender is `onboarding@resend.dev`, not a verified custom domain. Gmail, Outlook, and most mobile clients will route this to spam or Promotions. A customer who pays ₹X in advance and gets no confirmation email will panic. This erodes trust, kills referrals, and generates unnecessary WhatsApp support load. The fix is verifying your custom domain in the Resend dashboard (typically 30 minutes of DNS work).

**Severity: High. Every booking confirmation is landing in the wrong folder.**

### RC-3: No escape hatch for high-intent visitors
A user who's 80% decided but has a question — "Can I do this on a Tuesday?", "Do you set up for 12 people?" — has no quick-contact option on the live site. The WhatsApp float button is coded and ready but not committed. The alternative is abandoning or filling the booking form as a question vehicle, which floods admin with low-quality leads. The result: conversion leaks at the consideration stage for anyone who isn't fully ready to commit.

**Severity: Medium-High. The fix is a commit.**

### RC-4: No social proof at the decision point
The homepage has testimonials, but venue cards and venue detail pages show no star ratings, no booking count, no "booked 8 times this month." A user considering a ₹3,000–₹8,000 picnic booking for an anniversary or birthday is making a high-trust purchase. The evidence they need — that other people have done this and loved it — is buried or missing. The testimonials section on the homepage is far from where the decision is made.

**Severity: Medium. This is a conversion multiplier waiting to be unlocked.**

### RC-5: No post-event retention loop
Currently: booking confirmed → customer shows up → customer leaves → nothing. No automated review ask (48–72 hours post-event). No "book again" nudge for anniversary customers. No referral mechanic ("bring a friend, get ₹500 off"). Every satisfied customer is an acquisition opportunity that isn't being captured. For a local experiences business, word-of-mouth is the cheapest and most trusted acquisition channel — and it's currently entirely unstructured.

**Severity: Medium. Won't fix conversion today, but it's the compounding lever.**

---

## Experiments — Ranked by Effort vs. Impact

| # | Experiment | Impact | Effort | Run this when |
|---|---|---|---|---|
| 1 | **Fix analytics.js build blocker** | 🔴 Critical | ⚡ 5 min | Today, before anything else |
| 2 | **Verify custom email domain in Resend** | 🔴 High | ⚡ 30 min DNS | This week |
| 3 | **Commit the WhatsApp float button** | 🟠 High | ⚡ 5 min (it's already coded) | With next commit |
| 4 | **Manual post-event review ask** | 🟠 High | ⚡ Low (can be a WhatsApp template message sent 48h post-event) | Start manually now; automate later |
| 5 | **Add venue booking count or testimonial snippet to venue cards** | 🟡 Medium | 🔧 1–2 days dev | Next sprint |
| 6 | **Verify prerender output in Vercel logs post-deploy** | 🟠 High | ⚡ 15 min | After fix #1 deploys |
| 7 | **Add pricing estimate to venue detail before form submission** | 🟡 Medium | 🔧 1 day dev | Next sprint |
| 8 | **Add photos to Terracottage Ochre + Sienna** | 🟡 Medium | 📸 Depends on shoot | ASAP — blank photos hurt trust |

---

## Verdict

The product works technically. The booking flow is complete, payment is real, admin tooling is solid. The problem is everything around the product — discovery, trust signals, and retention — rather than the core experience itself.

**The three things that matter most right now, in order:**

1. **Unbreak the build.** SEO is your cheapest long-term acquisition channel and it's been zero since launch. It's ready to go — just needs `analytics.js` committed.

2. **Fix email deliverability.** Customers are paying in advance and probably not getting confirmation emails. This is a trust and support-load problem, not a nice-to-have.

3. **Add one post-event touchpoint.** Even a manual WhatsApp message 48 hours after the booking asking "How was your picnic? We'd love a review 🌸" is a compounding flywheel. Start it manually this week.

The venue photos and social proof are the next tier — real, but not on fire.
