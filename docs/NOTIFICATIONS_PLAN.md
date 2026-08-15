# The Picnic Stories — Email & WhatsApp Notifications Plan

A from-scratch plan for someone with zero experience in email/WhatsApp integrations. It's written to match *your* actual codebase (vanilla JS + Vite + Supabase), and it tells you not just *what* to build but *why* each decision is made.

Scope chosen: **transactional first** (the messages that keep bookings running), **cheapest path / more wiring** (use APIs directly via Supabase Edge Functions), and you currently have only the **free WhatsApp Business app on a phone** — so the WhatsApp section starts from zero.

---

## 1. The one concept that matters most

You have **no server of your own.** Your site is static files (`index.html`, `app.js`, `style.css`) talking directly to Supabase from the browser using the *anon key*. That anon key is public — anyone can read it in DevTools.

That means **you can never send notifications directly from `app.js`.** Email and WhatsApp providers give you a *secret API key*. If you put a secret key in browser code, it's stolen within hours and someone runs up your bill or spams people in your name.

So every notification must be sent from a **trusted server environment**. In your stack, that environment already exists and is free: **Supabase Edge Functions** (small serverless functions that run on Supabase's servers, where secret keys are safe). This is the backbone of the whole plan.

```
Browser (app.js)  ──insert booking──▶  Supabase Database
                                              │
                                    (database webhook fires)
                                              ▼
                                   Supabase Edge Function  ──secret key──▶  Email / WhatsApp provider  ──▶  Customer
```

You will write Edge Functions in TypeScript. They're small (30–60 lines each). I'll give you the skeletons below.

---

## 2. What you can send today vs. what needs setup

| | Email | WhatsApp |
|---|---|---|
| **Account you need** | Resend account (free) | Meta Business account + WhatsApp Business **Platform / Cloud API** (free to host) |
| **Do you have it?** | No, but signup is 5 min | You have the **app**, which is *not* the API — see §6 |
| **Can send freely?** | Yes, any content | No — outside a 24h window you can only send **pre-approved templates** |
| **Cost** | Free up to 3,000/mo, 100/day | Per-message; utility ~₹0.115, marketing ~₹0.86 (see §7) |
| **Setup difficulty** | Easy | Medium (Meta verification + template approval) |

**Recommendation: build email first, get the whole pipeline working, then add WhatsApp as a second channel.** Email has no approval gates, so you'll learn the architecture without fighting Meta's onboarding at the same time.

---

## 3. The notifications your app actually needs

These are mapped to real points in your `app.js` and `bookings` table.

### Transactional (build these — Phase 1 & 2)

| # | Trigger | Where in your code | To whom | Channel | Why |
|---|---|---|---|---|---|
| T1 | Customer submits a query/booking | `submit_booking_intent` RPC, ~`app.js:1946` | **Customer** | Email + WA | "We got your request" — reassurance, reduces "did it go through?" calls |
| T2 | Same event | same | **Admin (you)** | Email + WA | So you act fast; right now you only see it if you open the dashboard |
| T3 | Admin confirms booking | the `.update({ confirmed: true })`, `app.js:2919` | **Customer** | Email + WA | The big one — "Your date is locked in 🎉" with details |
| T4 | Menu link generated | `generateMenuLink`, `app.js:2562` | **Customer** | Email + WA | Sends them the link to pick food/beverages |
| T5 | Customer submits menu order | order insert flow (`orders` table) | **Admin** | Email/WA | You know their menu is in |
| T6 | Event reminder | scheduled, day before `preferred_date` | **Customer** | WA (best) | Cuts no-shows; WhatsApp open rates >90% in India |
| T7 | Login OTP "view my bookings" | already exists via Supabase Auth, `app.js:2334` | Customer | Email | *Already working* — see §5 note |

### Marketing (Phase 3, light touch)

| # | What | Channel | Note |
|---|---|---|---|
| M1 | Post-event thank-you + review request | Email/WA | ~1 day after event; easiest win, feels personal not spammy |
| M2 | Seasonal offers (Valentine's, anniversaries, monsoon picnics) | Email broadcast | Needs explicit opt-in |
| M3 | Re-engagement ("come back" to past customers) | Email | |

> **Consent rule, non-negotiable:** transactional messages (T1–T7) are fine because the customer just transacted with you. Marketing (M1–M3) legally and on WhatsApp **requires opt-in**. Add a checkbox to your booking form: *"Send me offers and picnic ideas on WhatsApp/email."* Store it as a `marketing_opt_in boolean` column on `bookings`. Without this, WhatsApp can ban your number and email lands in spam.

---

## 4. Recommended tools (cheapest path)

**Email → [Resend](https://resend.com).** Free tier is 3,000 emails/month and 100/day, permanently — more than enough for your volume. It's the provider Supabase itself recommends and has first-class Edge Function examples. One catch: the free tier allows **one verified domain**, and to send from `you@thepicnicstory.com` you must verify your domain (add a few DNS records). Until then you can only send from their test address.

**WhatsApp → Meta WhatsApp Cloud API, directly.** Since you chose the cheapest path: Meta *hosts the Cloud API for free* — you don't strictly need a paid provider (BSP) like Wati/Interakt/AiSensy. You only pay Meta per message (§7). The trade-off: more wiring and you manage templates yourself in Meta's dashboard. (If it gets painful, a BSP adds a nice UI for ~₹1,000–2,500/mo — keep it as a fallback, not the starting point.)

**Scheduling (for T6 reminders) → Supabase `pg_cron`.** Built into Supabase, free, lets you run a function "every day at 9am" to find tomorrow's events and send reminders.

---

## 5. Phase 1 — Email transactional pipeline (do this first)

**Goal:** when a booking is confirmed (T3), the customer gets a real email. Once this works, every other notification is a copy-paste variation.

1. **Sign up at Resend**, then verify your sending domain (Resend walks you through the DNS records). Create an API key.
2. **Store the key as a Supabase secret** (never in code):
   `supabase secrets set RESEND_API_KEY=re_xxxxx`
3. **Write an Edge Function** `notify-booking-confirmed`. Skeleton:

   ```ts
   // supabase/functions/notify-booking-confirmed/index.ts
   Deno.serve(async (req) => {
     const { record } = await req.json()            // the booking row
     await fetch("https://api.resend.com/emails", {
       method: "POST",
       headers: {
         "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
         "Content-Type": "application/json",
       },
       body: JSON.stringify({
         from: "The Picnic Stories <hello@thepicnicstory.com>",
         to: record.email_address,
         subject: "Your picnic date is locked in! 🎉",
         html: `<h1>Hi ${record.full_name}!</h1>
                <p>Your booking #${record.id} for ${record.preferred_date} is confirmed.</p>`,
       }),
     })
     return new Response("ok")
   })
   ```
4. **Trigger it.** Two options — pick **A** to start, it's simpler:
   - **A) Database Webhook (recommended):** In Supabase Dashboard → Database → Webhooks, create a webhook on the `bookings` table for `UPDATE` events that calls this function. Inside the function, check `record.confirmed === true && old_record.confirmed === false` so it only fires on the moment of confirmation. **Zero changes to `app.js`.**
   - **B) Call it from code:** in your admin confirm handler (`app.js:2919`) after the update succeeds, `await supabase.functions.invoke('notify-booking-confirmed', { body: { record } })`. More control, but couples it to the UI.
5. **Test** with your own email by confirming a test booking.

Then **clone the function** for T1 (booking received), T2 (admin alert — `to:` your own email), T4 (menu link). Each is the same shape with different copy and a different webhook/trigger point. Budget ~1 focused day for all of Phase 1.

> **Note on T7 (OTP):** your "view my bookings" code (`app.js:2334`) already sends OTP emails via Supabase Auth's built-in mailer. That mailer is rate-limited and meant for auth only — fine for now. If volume grows, point Supabase Auth's SMTP settings at Resend too, so all email comes from your domain and looks consistent.

---

## 6. Phase 2 — WhatsApp, starting from the Business app

**The gap you need to understand first.** You have the **WhatsApp Business app** — the free phone app for chatting with customers manually. It **cannot** be automated and cannot send from your website. Automated/triggered messages require the **WhatsApp Business *Platform* (Cloud API)**, a completely separate Meta product. You can't run both the app and the API on the *same* phone number, so plan to either:
- migrate your existing Business number to the API (you lose the phone app for that number), **or**
- use a fresh number for the API and keep the app for manual chats. ← **recommended** so you don't disrupt current conversations.

**Onboarding steps (all free):**
1. Create a **Meta Business account** at business.facebook.com and complete **Business Verification** (they check you're a real business — can take a few days; have your registration/GST handy).
2. In Meta's developer dashboard, add the **WhatsApp** product, attach a phone number (the fresh one), get your **Phone Number ID** and a **permanent access token**.
3. Store both as Supabase secrets (`WA_TOKEN`, `WA_PHONE_ID`).
4. **Create message templates** in Meta dashboard and submit for approval (usually minutes–hours). You need templates because of the rule below.

**The 24-hour window rule (this governs everything in WhatsApp):**
- When a customer messages *you* first, a **24-hour free service window** opens — you can reply with any free-form message, free.
- Outside that window (e.g. you proactively confirming a booking they made on the website), you may **only** send a **pre-approved template**, and it's billed.

So your booking confirmation (T3) and reminders (T6) will be **utility templates**. Example template to submit:

> *"Hi {{1}}, your picnic with The Picnic Stories on {{2}} is confirmed ✅. Booking #{{3}}. Reply here if you need anything!"*

**The Edge Function** is the same shape as email — different endpoint:

```ts
await fetch(`https://graph.facebook.com/v22.0/${Deno.env.get("WA_PHONE_ID")}/messages`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${Deno.env.get("WA_TOKEN")}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    messaging_product: "whatsapp",
    to: record.mobile_number,            // must be E.164: 91XXXXXXXXXX
    type: "template",
    template: {
      name: "booking_confirmed",
      language: { code: "en" },
      components: [{ type: "body", parameters: [
        { type: "text", text: record.full_name },
        { type: "text", text: record.preferred_date },
        { type: "text", text: String(record.id) },
      ]}],
    },
  }),
})
```

> **Data fix needed:** your `mobile_number` is stored as free text. WhatsApp requires **E.164 format** (country code, no `+`, no spaces): `919876543210`. Add validation/normalization at the booking form, and a migration to clean existing rows, or sends will silently fail.

---

## 7. What it will cost (verified, June 2026)

**Email (Resend):** Free up to **3,000 emails/month, 100/day**. You won't hit this for a long time. Paid Pro starts ~$20/mo (50k emails) only if you scale marketing.

**WhatsApp (Meta, per-message, India, effective Jan 1 2026):**
- **Customer-initiated service messages: free** (the 24h window).
- **Utility templates** (booking confirmations, reminders): **~₹0.115 each** (~$0.0014). Also **free** if sent inside an open 24h window.
- **Marketing templates** (offers, promos): **~₹0.86 each** (~$0.0107) — ~7× more, which is the financial reason to keep marketing opt-in and targeted.

Rough monthly reality at, say, 100 bookings/month with confirmation + reminder = ~200 utility messages ≈ **₹23/month**. Effectively negligible. Marketing is where cost grows, so meter it.

Sources: [Resend pricing](https://resend.com/pricing) · [Resend new free tier](https://resend.com/blog/new-free-tier) · [WhatsApp India pricing 2026 (AiSensy)](https://aisensy.com/pricing) · [Supabase Functions pricing](https://supabase.com/docs/guides/functions/pricing)

---

## 8. Suggested build order

1. **Phase 0 — prep:** add `marketing_opt_in` column + checkbox; normalize phone numbers to E.164. *(half day)*
2. **Phase 1 — email:** Resend account + domain verify; first Edge Function (T3); database webhook; then clone for T1, T2, T4. *(~1 day)*
3. **Phase 2 — WhatsApp:** Meta Business verification (start early — it has a wait); Cloud API setup; templates; mirror the email functions for T1–T4. *(spread over a week, mostly waiting on Meta)*
4. **Phase 2b — reminders (T6):** `pg_cron` job that runs daily, finds tomorrow's confirmed bookings, calls the WhatsApp function. *(half day)*
5. **Phase 3 — marketing:** thank-you/review (M1), then opt-in offer broadcasts (M2/M3). Only after transactional is solid. *(later)*

---

## 9. Things that will bite a beginner (read before you start)

- **Never** put a secret API key in `app.js`. Edge Functions only.
- **Email deliverability = DNS.** If you skip domain verification (SPF/DKIM records), your emails go to spam. Don't skip it.
- **WhatsApp templates aren't free-form.** You can't just write any message; it must be pre-approved and match a category (utility vs marketing). Misusing utility for marketing gets you flagged.
- **Phone format.** E.164 or it fails silently.
- **Opt-in for marketing** is a hard requirement, not a nicety — WhatsApp will suspend numbers that send unsolicited marketing.
- **Test with your own email/number first**, every function, before any real customer sees it.
- **Idempotency:** make sure a webhook firing twice doesn't send two emails (check state before sending).

---

## 10. Open decisions for you

1. **WhatsApp number:** migrate your current Business-app number to the API, or get a fresh one? (Recommend: fresh, keep the app for manual chats.)
2. **Confirmation copy & branding:** want me to draft the actual email HTML templates and WhatsApp template text in your brand voice?
3. **Marketing depth:** if/when you want Phase 3, do you prefer staying on Resend broadcasts, or moving marketing to an all-in-one (Brevo/MailerLite) with a visual campaign builder?

If you want, I can start on **Phase 0 + the first Edge Function** next — that's the concrete first commit.
