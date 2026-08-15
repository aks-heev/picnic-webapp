# WhatsApp Sales Audit — 2026-07-06

Based on reading 7 full client conversations + the state of ~20 of today's ad leads on the WhatsApp Business account. Goal: increase lead → booking conversion.

---

## The funnel as it works today

Every lead follows the same path:

1. IG/FB ad click → auto-message "Hello! Can I get more info on this?"
2. Team sends the 4-details intake template (name, guests, occasion, date)
3. Lead answers → team sends the 7-page PDF + "checkout the packages"
4. Lead asks a question (price? food? venue?) → short reactive answer
5. Silence. Nobody follows up. Chat dies.

**Where leads die (today's sample):**
- At least 5 leads never replied after the intake template (template was the last message)
- At least 4 chats end with the PDF + "checkout the packages" and no reply
- 3 chats end on the lead saying "Okay" / "Thanks" — never re-engaged
- 44 unread chats sitting in the inbox

---

## Shortcomings (ranked by conversion impact)

### 1. No close attempt, ever
Not a single chat contains "Shall I check availability?", "Want me to hold the date?", a payment link, or an advance ask. Even Mahika's **confirmed ₹24,900 package** was sent with no payment step, no breakdown, no next action. The website has Razorpay live — reps never use it.

### 2. No follow-up cadence
Every stalled conversation just stops. "Okay" (Aman, proposal ₹-lead), "Thanks", and post-PDF silence are all treated as the end. These are warm, high-intent leads from paid ads — each one cost ad money.

### 3. The PDF dump replaces selling
"checkout the packages" + 7-page PDF is the universal answer. Evidence it fails: Mahika asked **"Price please"**, got the PDF, then had to ask **"Exact price?"**. Namratha asked for suggestions and got the PDF. The PDF transfers the sales work to the customer.

### 4. Response latency is erratic
Measured gaps today: 45 min to first response (Aman), 59 min on a meals question (Akanksha), 67 min to send two venue links (Namratha). Intake template sometimes fires in 0 min, sometimes 45. Meta leads decay within minutes.

### 5. Answers end conversations instead of advancing them
- "Hi, no the packages does not include meals" — dead end. Another rep in a parallel chat sells food inclusion at 9,900. Same question, opposite answers.
- "for 2 people also price is 8900" — blunt, no value framing, no alternative.
- Rule violated everywhere: replies end without a question.

### 6. Zero occasion personalization
A **proposal** lead (highest willingness-to-pay occasion) got the identical treatment as everyone else. Mahika opened with a decoration photo ("Want this decoration") and still got the generic 4-details template — the template ignores what the lead actually said.

### 7. Confusing / inconsistent pricing language
"we can include the food for 9900" — is that an add-on price or a package price? "no, dinner is not included. Dinner is included for 9900" — contradicts itself in one sentence. And quotes jump from "starts at 8900" to ₹24,900 with no breakdown → price shock.

### 8. Website is never used to close
Reps send bare venue links at best. The site has /packages with `?tier=` deep links, occasion packages, venue pages with live booking + Razorpay. Nobody sends a "book here" link.

---

## The playbook (what to change)

### A. Speed
- SLA: first response < 5 min, any question < 15 min during business hours.
- Set up WhatsApp Business **quick replies** (`/price`, `/venues`, `/food`) and an **away message** with the price anchor so after-hours leads aren't cold.
- Clear the unread backlog daily; anything unanswered > 2h is a lost ad rupee.

### B. Replace the intake template
Current template asks for 4 things and gives nothing. Value-forward version:

> Hey! 🌿 Love that you found us. Our styled picnics start at **₹8,900** (up to 6 guests) at our venues in Delhi & Gurugram.
> What's the occasion, and what date are you planning? I'll send you the exact options 🧺

Two questions instead of four, price anchor up front, zero forms-feeling.

### C. Kill the naked PDF
Reply to the details with an **in-chat, occasion-tailored summary** — PDF only as backup:

> Perfect for a birthday for 2, [name]! Here are your options at [venue]:
> 🧺 **The Setting** — ₹8,900 · full styled picnic setup
> 💐 **The Moment** — ₹11,000 · setup + decor add-ons (balloons, teddies, string)
> ✨ **The Story** — ₹24,000 · the full experience
> Most birthday couples pick The Moment. Want me to check availability for July 11?

Every message ends with a question or a next step.

### D. Occasion scripts
- **Proposal** → premium anchor first, add-on menu (photographer, cutouts, "Marry Me" letters), urgency ("proposal slots book out fastest").
- **Birthday / Anniversary** → decor add-ons + food add-on bundled into the pitch.
- Send 2–3 photos of *that occasion's* past setups — the ad sold a visual; the chat should too.

### E. Standard objection answers (one source of truth)
- **Meals?** → "The setup itself doesn't include food, but you can add our food package — 3 dishes + 2 beverages — taking it to ₹9,900 total for 2. Most couples add it. Want me to include it?"
- **Price for 2 at a 6-person price?** → explain per-experience value, then: "If budget's a concern, [lighter option / weekday slot]. What's your budget? I'll make it work."
- Fix the 9,900 ambiguity everywhere: always say "₹9,900 **total**" or "+₹X **add-on**".

### F. Close mechanics
- After any quote: "I can hold [date] for you — we take a ₹[X] advance to lock the slot. Here's the link: [Razorpay/venue booking link]."
- Send the exact deep link: `picnicstories.com/packages?tier=moment` or the venue page — the site can take payment; use it.
- Quotes always itemized: base + each add-on = total. No more 8,900 → 24,900 jumps.

### G. Follow-up cadence (biggest single win)
- **+3h** after PDF/quote with no reply: "Hi [name], did the packages make sense? Happy to suggest the best fit for [occasion] 😊"
- **+24h**: social proof — a reel or photos of a similar recent setup ("here's a birthday we did at Sunroom last weekend").
- **+72h**: soft urgency — "Dates for [their date] are filling up — want me to hold yours?"
- Use WhatsApp Business **labels**: New / Quoted / Follow-up / Booked / Lost. The follow-up queue = everything in Quoted older than 3h.

### H. Measure weekly
Leads → replied to intake → quoted → booked, per label counts. You already fire Meta Pixel Lead/Contact events; the label funnel closes the offline gap. Target: intake reply rate and quote→booking rate are the two numbers to move.

---

## Quick wins to do today

1. Add the availability-check close line to every quote ("Shall I hold [date]?").
2. Save the objection quick replies (meals, price-for-2) so all reps give the same answer.
3. Send the 3h/24h/72h follow-ups to every lead currently sitting in "Quoted" silence — today's Aman (proposal!), Ayushi, Akanksha, Namratha, Aishwarya are all still warm.
4. Clear the 44 unread.
