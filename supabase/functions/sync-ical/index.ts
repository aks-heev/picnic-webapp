// sync-ical  (PROTECTED — verify_jwt = true)
// Airbnb -> site. For each active venue with airbnb_ical_url, fetch the
// .ics, parse reserved dates, reconcile source='ical' rows via the atomic
// replace_ical_blocks(). Failure-safe: validate feed BEFORE any DB write;
// skip venue on any error so existing blocks are never wiped.
//
// PHASE 1.5 (combo -> children propagation): if the synced venue is a combo
// parent with its own whole-property Airbnb listing (distinct from each
// child floor's own listing), busy dates are also written onto every child
// floor via replace_parent_ical_blocks(), as source='parent',
// booking_id=NULL. This closes the gap where a whole-cottage Airbnb booking
// would otherwise leave individual floors bookable on the site. Real
// booking-linked 'parent' rows (a site-side combo hold/booking) are never
// touched — that RPC only ever deletes/inserts booking_id IS NULL rows.
//
// ⚠ ONLY GENUINE RESERVATIONS PROPAGATE. Airbnb's linked-listing feature
// blocks the whole-property listing whenever EITHER child floor is booked,
// and those linked blocks appear in the combo's feed as
// "Airbnb (Not available)". Propagating those to BOTH children made
// a booking on one floor block its sibling (the Umber-blocked-by-Ochre bug,
// 2026-07). Genuine whole-property bookings carry SUMMARY "Reserved" — only
// those fan out. Fail-safe: if a feed carries no SUMMARY lines at all we
// can't distinguish, so we fall back to propagating everything (over-block
// beats double-book) and flag it in the sync status.
//
// PHASE 1.6 (child-feed echo suppression, 2026-07-26): the same linked-
// listing behaviour ALSO reaches a floor's OWN feed. Airbnb blocks a floor's
// listing whenever its SIBLING floor is unavailable, and that block lands on
// this floor's feed as "Airbnb (Not available)". Importing it took a bookable
// floor off sale (Umber blocked 31 Jul–2 Aug 2026 by Ochre booking #54).
// The v10 SUMMARY filter only guarded the parent->child fanout, not a child's
// own feed.
//
// HOUSE RULE: one floor's occupancy NEVER blocks the other. The floors are
// sold independently; only a whole-home (Sienna) booking takes both. So a
// child's "Not available" date is dropped when the sibling floor is occupied
// by EITHER a confirmed site booking OR a genuine Airbnb reservation
// (SUMMARY "Reserved" on the sibling's own feed) — and this floor is not
// itself booked that night. See occupancyContext().
//
// PHASE 0 OF docs/ICAL_FIX_PLAN_2026-07-27.md (v14a, 2026-07-27):
// this version adds OBSERVATION ONLY — every fetched feed is recorded to
// public.ical_feed_snapshots before any decision is made with it. No
// reconciliation logic changed. The purpose is to settle, with data rather
// than inference, whether the cross-floor echo described above still occurs
// at all: the 2026-07-27 audit found NO Airbnb listing linking configured on
// any of the three listings, which is the mechanism the suppression above
// exists to defend against. If snapshots show zero cross-floor echoes over a
// full observation window, Phase 3 of the plan removes occupancyContext()
// entirely and switches to over-blocking. Do NOT remove it before then.
// Snapshot writing is wrapped so it can never fail a sync.
//
// PHASE 2 (after import): reconcile held floors. For every combo booking
// still on hold, re-test its nights against the freshly-imported child data
// (excluding the hold's own parent blocks) and stamp a verdict:
//   conflict — a child night is now taken (likely a direct Airbnb booking)
//   ripe     — clear and past one sync cycle; safe to confirm (manually)
//   clear    — clear but still inside the buffer window
// Emails the admin ONLY on a transition into conflict/ripe. Confirmation is
// never automated — that stays a human + payment decision.

import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const FETCH_TIMEOUT_MS = 15000

const ADMIN_EMAIL = "aksheevs@gmail.com"
const RIPE_MIN_AGE_MS = 60 * 60 * 1000 // a hold is "ripe" once it's at least one sync cycle old

const pad = (n: number) => String(n).padStart(2, "0")

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86400000)
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

function unfold(ics: string): string[] {
  const lines = ics.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
  const out: string[] = []
  for (const ln of lines) {
    if ((ln.startsWith(" ") || ln.startsWith("\t")) && out.length) out[out.length - 1] += ln.slice(1)
    else out.push(ln)
  }
  return out
}

function toYMD(value: string): string | null {
  const m = value.match(/(\d{4})(\d{2})(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

interface VEvent { start?: string; end?: string; cancelled?: boolean; summary?: string }

function parseEvents(ics: string): VEvent[] {
  const events: VEvent[] = []
  let cur: VEvent | null = null
  for (const line of unfold(ics)) {
    const upper = line.toUpperCase()
    if (upper === "BEGIN:VEVENT") cur = {}
    else if (upper === "END:VEVENT") { if (cur) events.push(cur); cur = null }
    else if (cur) {
      const i = line.indexOf(":")
      if (i === -1) continue
      const name = line.slice(0, i).toUpperCase()
      const val = line.slice(i + 1).trim()
      if (name.startsWith("DTSTART")) cur.start = toYMD(val) ?? undefined
      else if (name.startsWith("DTEND")) cur.end = toYMD(val) ?? undefined
      else if (name.startsWith("STATUS")) cur.cancelled = val.toUpperCase() === "CANCELLED"
      else if (name.startsWith("SUMMARY")) cur.summary = val
    }
  }
  return events
}

// Airbnb labels genuine guest bookings "Reserved" (often with a reservation
// code); host blocks and linked-listing blocks are "Airbnb (Not available)".
const isReservation = (ev: VEvent) => /reserved/i.test(ev.summary ?? "")

function busyDates(events: VEvent[]): string[] {
  const set = new Set<string>()
  for (const ev of events) {
    if (ev.cancelled || !ev.start) continue
    const start = ev.start
    const end = ev.end && ev.end > start ? ev.end : addDays(start, 1)
    for (let d = start; d < end; d = addDays(d, 1)) set.add(d)
  }
  return [...set].sort()
}

// Fingerprint of the raw feed, so an unchanged feed is obvious in the
// snapshot history without diffing the whole event list.
async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

async function fetchICS(feedUrl: string): Promise<string> {
  if (!/^https:\/\//i.test(feedUrl)) throw new Error("feed url must be https")
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(feedUrl, { signal: ctrl.signal, headers: { Accept: "text/calendar" } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

// Phase 2 helpers

// Inlined so this function stays a single deployable file (no cross-function
// _shared import). Best-effort: a mail failure must never break the sync.
async function sendAdminEmail(subject: string, html: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY")
  if (!apiKey) { console.warn("RESEND_API_KEY not set; skipping admin email"); return }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "The Picnic Stories <team@picnicstories.com>",
        to: ADMIN_EMAIL, subject, html,
      }),
    })
    if (!res.ok) console.warn("Resend error", res.status, await res.text())
  } catch (e) {
    console.warn("sendAdminEmail failed:", e)
  }
}

// A venue's parsed Airbnb feed. Cached per request so a sibling's feed is
// fetched at most once even when several floors reference it.
interface Feed { events: VEvent[]; allBusy: string[]; reserved: string[]; hasSummaries: boolean; sha: string }

// Expand a [start, checkout) night range into YMD strings (checkout exclusive).
function expandNights(start: string, end: string | null): string[] {
  const out: string[] = []
  const last = end && end > start ? end : addDays(start, 1)
  for (let d = start; d < last; d = addDays(d, 1)) out.push(d)
  return out
}

// Occupancy context for a child floor: which nights the SIBLING floor is
// taken, and which nights THIS floor is taken by our own confirmed bookings.
//
// Why this exists: Airbnb's linked-listing feature blocks this floor's listing
// whenever the sibling floor is unavailable, so the sibling's occupancy comes
// back on THIS floor's feed as an "Airbnb (Not available)" event. But the
// floors are sold independently — Ochre being taken does not make Umber
// unsellable. Importing those dates silently removed a bookable floor.
//
// Two sources of sibling occupancy, both suppressed:
//   (a) our own confirmed SITE bookings, which export-ical publishes to the
//       sibling's Airbnb listing (this is our own output bouncing back);
//   (b) genuine AIRBNB reservations on the sibling, identified by SUMMARY
//       "Reserved" on the sibling's own feed.
//
// Sibling floors ONLY. A whole-home (combo parent) booking legitimately takes
// both floors: it shows as "Reserved" on the PARENT's feed, never a sibling's,
// so it is never suppressed here and still blocks via the parent fanout /
// booking-linked source='parent' rows.
//
// Fail-safe: if a sibling's feed can't be fetched, or carries no SUMMARY lines
// to classify, its reservations are simply not counted — nothing is
// suppressed and the date stays blocked. Over-block beats double-book.
//
// A date is only ever suppressed when THIS floor is otherwise free: a night
// held by our own confirmed booking on this floor is never dropped, even if
// the sibling is booked too (that regression shipped briefly as v12 and took
// 4 genuinely-booked Ochre nights off the block list).
//
// Residual ambiguity: a manual host block set on THIS floor in Airbnb is
// indistinguishable from a linked-listing echo, so one that overlaps a sibling
// booking will be dropped. Set deliberate blocks in the admin panel
// (source='admin') instead — those are never touched by this sync.
// This is Leak #3 in docs/ICAL_AUDIT_2026-07-27.md and is scheduled for
// removal in Phase 3 of the fix plan, gated on the snapshot evidence this
// version collects.
// deno-lint-ignore no-explicit-any
async function occupancyContext(
  supabase: any,
  venueId: number,
  parentId: number,
  loadFeed: (id: number, url: string | null) => Promise<Feed | null>,
): Promise<{ sibling: Set<string>; self: Set<string> }> {
  const sibling = new Set<string>()
  const self = new Set<string>()

  const { data: sibs, error: sibErr } = await supabase
    .from("venues").select("id, airbnb_ical_url").eq("parent_venue_id", parentId).neq("id", venueId)
  if (sibErr) { console.warn("occupancyContext: venues error", sibErr); return { sibling, self } }
  const siblings = sibs || []

  // Confirmed site bookings on this floor AND its siblings, in one query.
  // deno-lint-ignore no-explicit-any
  const ids = [venueId, ...siblings.map((s: any) => s.id)]
  const { data: bks, error: bkErr } = await supabase
    .from("bookings").select("venue_id, preferred_date, checkout_date")
    .in("venue_id", ids).eq("confirmed", true)
  if (bkErr) console.warn("occupancyContext: bookings error", bkErr)
  else for (const b of bks || []) {
    const target = String(b.venue_id) === String(venueId) ? self : sibling
    for (const d of expandNights(b.preferred_date as string, b.checkout_date as string | null)) target.add(d)
  }

  // Genuine Airbnb reservations on the sibling floors.
  for (const s of siblings) {
    const feed = await loadFeed(s.id as number, (s.airbnb_ical_url as string | null) ?? null)
    if (!feed || !feed.hasSummaries) continue // unfetchable / unclassifiable -> suppress nothing
    for (const d of feed.reserved) sibling.add(d)
  }
  return { sibling, self }
}

// deno-lint-ignore no-explicit-any
async function reconcileHolds(supabase: any): Promise<Array<Record<string, unknown>>> {
  const { data: holds, error } = await supabase
    .from("bookings")
    .select("id, venue_id, preferred_date, checkout_date, held_at, full_name, hold_status, venues ( type, name )")
    .not("held_at", "is", null)
    .eq("confirmed", false)
  if (error) { console.warn("reconcileHolds: load error", error); return [] }

  const out: Array<Record<string, unknown>> = []
  for (const h of holds || []) {
    if (h.venues?.type !== "combo") continue // held_at is combo-only, but be safe

    const { data: kids } = await supabase.from("venues").select("id").eq("parent_venue_id", h.venue_id)
    // deno-lint-ignore no-explicit-any
    const childIds = (kids || []).map((k: any) => k.id)

    const occupied = new Set<string>()
    if (childIds.length) {
      const [blkRes, bkRes] = await Promise.all([
        supabase.from("venue_availability").select("date, source, booking_id")
          .in("venue_id", childIds).in("source", ["admin", "ical", "parent"]),
        supabase.from("bookings").select("preferred_date, checkout_date")
          .in("venue_id", childIds).eq("confirmed", true),
      ])
      for (const r of blkRes.data || []) {
        if (r.source === "parent" && String(r.booking_id) === String(h.id)) continue // exclude own hold
        occupied.add(r.date as string)
      }
      for (const b of bkRes.data || []) {
        for (const d of expandNights(b.preferred_date as string, b.checkout_date as string | null)) occupied.add(d)
      }
    }

    const nights = expandNights(h.preferred_date as string, h.checkout_date as string | null)
    const clashes = nights.filter((n) => occupied.has(n))
    const ageMs = Date.now() - new Date(h.held_at as string).getTime()

    const status = clashes.length ? "conflict" : (ageMs >= RIPE_MIN_AGE_MS ? "ripe" : "clear")
    const prev = h.hold_status as string | null

    await supabase.from("bookings").update({
      hold_status: status,
      hold_checked_at: new Date().toISOString(),
      hold_conflict_dates: clashes.length ? clashes : null,
    }).eq("id", h.id)

    // Notify only on a transition INTO conflict/ripe (avoids hourly spam).
    if (status !== prev && (status === "conflict" || status === "ripe")) {
      const floor = (h.venues?.name as string) || `Floor #${h.venue_id}`
      if (status === "conflict") {
        await sendAdminEmail(
          `⚠ Hold conflict — ${floor} (${h.preferred_date})`,
          `<div style="font-family:sans-serif;max-width:600px;color:#333">
            <h2 style="color:#b4452f">Hold conflict on ${floor}</h2>
            <p>Booking <strong>#${h.id}</strong> (${h.full_name || "guest"}) is on hold, but one or more nights are now taken on a single unit — most likely a direct Airbnb booking:</p>
            <p style="font-size:18px"><strong>${clashes.join(", ")}</strong></p>
            <p><strong>Release this hold</strong> — do not confirm. The whole floor can't be delivered for these dates.</p>
          </div>`,
        )
      } else {
        await sendAdminEmail(
          `✓ Hold ready to confirm — ${floor} (${h.preferred_date})`,
          `<div style="font-family:sans-serif;max-width:600px;color:#333">
            <h2 style="color:#2d6a4f">Hold is clear on ${floor}</h2>
            <p>Booking <strong>#${h.id}</strong> (${h.full_name || "guest"}) for <strong>${h.preferred_date}</strong> has been on hold past a full sync cycle with no conflict. It's safe to confirm once the guest pays.</p>
            <p>Confirmation stays manual — take the advance, then Confirm in the dashboard.</p>
          </div>`,
        )
      }
    }
    out.push({ booking_id: h.id, status, clashes })
  }
  return out
}

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  // Per-request feed cache. A child floor needs its sibling's feed to tell a
  // linked-listing echo from a real block, and the sibling is usually synced
  // in the same pass — fetch each feed at most once. null = fetch/parse failed.
  const feedCache = new Map<number, Feed | null>()
  const feedErrors = new Map<number, string>()
  const loadFeed = async (id: number, feedUrl: string | null): Promise<Feed | null> => {
    if (feedCache.has(id)) return feedCache.get(id)!
    let feed: Feed | null = null
    try {
      if (!feedUrl) throw new Error("no airbnb_ical_url")
      const ics = await fetchICS(feedUrl)
      if (!/BEGIN:VCALENDAR/i.test(ics)) throw new Error("response is not a VCALENDAR feed")
      const events = parseEvents(ics)
      feed = {
        events,
        allBusy: busyDates(events),
        reserved: busyDates(events.filter(isReservation)),
        hasSummaries: events.some((e) => e.summary),
        sha: await sha256Hex(ics),
      }
    } catch (e) {
      feedErrors.set(id, String(e))
      feed = null
    }
    feedCache.set(id, feed)
    return feed
  }

  const url = new URL(req.url)
  let onlyVenue = url.searchParams.get("venue_id")
  if (!onlyVenue && req.method === "POST") {
    try { const b = await req.json(); if (b?.venue_id) onlyVenue = String(b.venue_id) } catch { /* no body */ }
  }

  let q = supabase.from("venues").select("id, airbnb_ical_url, parent_venue_id")
    .not("airbnb_ical_url", "is", null).eq("is_active", true)
  if (onlyVenue) q = q.eq("id", onlyVenue)
  const { data: venues, error } = await q
  if (error) return json({ error: error.message }, 500)

  const results: Array<Record<string, unknown>> = []

  for (const v of venues || []) {
    try {
      const feed = await loadFeed(v.id as number, (v.airbnb_ical_url as string | null) ?? null)
      if (!feed) throw new Error(feedErrors.get(v.id as number) || "feed unavailable")

      const allBusy = feed.allBusy
      const hasSummaries = feed.hasSummaries

      // Child floor: drop "Airbnb (Not available)" dates that are only the
      // SIBLING floor's occupancy echoing back through Airbnb's linked
      // listings (see occupancyContext). This floor's own "Reserved"
      // dates are always kept. A feed with no SUMMARY lines can't be
      // classified -> import everything (fail safe).
      let dates = allBusy
      let suppressed: string[] = []
      if (v.parent_venue_id && hasSummaries) {
        const occ = await occupancyContext(
          supabase, v.id as number, v.parent_venue_id as number, loadFeed,
        )
        if (occ.sibling.size) {
          const reserved = new Set(feed.reserved)
          // Drop only dates that are: not this floor's own Airbnb reservation,
          // not this floor's own confirmed site booking, and explained by the
          // sibling floor being occupied.
          suppressed = allBusy.filter((d) => !reserved.has(d) && !occ.self.has(d) && occ.sibling.has(d))
          if (suppressed.length) {
            const drop = new Set(suppressed)
            dates = allBusy.filter((d) => !drop.has(d))
          }
        }
      }

      const { error: rpcErr } = await supabase.rpc("replace_ical_blocks", {
        p_venue_id: v.id,
        p_dates: dates,
      })
      if (rpcErr) throw rpcErr

      // Combo parent -> children: propagate ONLY genuine whole-property
      // reservations. Airbnb's linked-listing blocks ("Airbnb (Not
      // available)") appear in this feed whenever EITHER child floor is
      // booked — fanning those out would block the sibling floor too (the
      // Umber-blocked-by-Ochre bug). If the feed carries no SUMMARY lines we
      // can't distinguish, so fail safe: propagate everything and flag it.
      // No-op for non-combo venues (no child rows come back).
      const { data: kids, error: kidsErr } = await supabase
        .from("venues").select("id").eq("parent_venue_id", v.id)
      if (kidsErr) throw kidsErr

      const reservedDates = hasSummaries ? feed.reserved : dates

      let childrenSynced = 0
      for (const kid of kids || []) {
        const { error: childErr } = await supabase.rpc("replace_parent_ical_blocks", {
          p_child_venue_id: kid.id,
          p_dates: reservedDates,
        })
        if (childErr) throw childErr
        childrenSynced++
      }

      const statusMsg = (childrenSynced
        ? `ok — ${dates.length} date(s), ${reservedDates.length} reserved → ${childrenSynced} floor(s)` +
          (hasSummaries ? "" : " (no SUMMARY in feed — propagated all)")
        : `ok — ${dates.length} date(s)`) +
        (suppressed.length ? `, ${suppressed.length} sibling echo(es) ignored` : "")

      await supabase.from("venues").update({
        last_ical_sync_at: new Date().toISOString(),
        last_ical_sync_status: statusMsg,
      }).eq("id", v.id)

      results.push({ venue_id: v.id, ok: true, dates: dates.length, reserved: reservedDates.length, children_synced: childrenSynced, suppressed })
    } catch (err) {
      await supabase.from("venues").update({
        last_ical_sync_status: `error — ${String(err).slice(0, 200)}`,
      }).eq("id", v.id)
      results.push({ venue_id: v.id, ok: false, error: String(err) })
    }
  }

  // Phase 0 observation: record what every feed touched this run actually
  // contained, including sibling feeds pulled only for occupancyContext.
  // Purely for offline analysis (docs/ICAL_FIX_PLAN_2026-07-27.md Phase 0);
  // nothing reads this back to make an availability decision. Wrapped so a
  // snapshot failure can never change the sync outcome.
  let snapshotsWritten = 0
  try {
    const snapRows: Array<Record<string, unknown>> = []
    for (const [venueId, feed] of feedCache) {
      snapRows.push(feed
        ? {
          venue_id: venueId,
          ok: true,
          error: null,
          event_count: feed.events.length,
          has_summaries: feed.hasSummaries,
          raw_sha256: feed.sha,
          events: feed.events,
        }
        : {
          venue_id: venueId,
          ok: false,
          error: (feedErrors.get(venueId) || "feed unavailable").slice(0, 500),
          event_count: 0,
          has_summaries: null,
          raw_sha256: null,
          events: [],
        })
    }
    if (snapRows.length) {
      const { error: snapErr } = await supabase.from("ical_feed_snapshots").insert(snapRows)
      if (snapErr) console.warn("snapshot insert failed:", snapErr)
      else snapshotsWritten = snapRows.length
    }
  } catch (e) {
    console.warn("snapshot block failed:", e)
  }

  // Phase 2: reconcile held floors against the freshly-imported data. Runs
  // unconditionally (even with zero feeds) so the age-based "ripe" signal and
  // site-side conflicts are still caught. Never blocks the import response.
  let holds: Array<Record<string, unknown>> = []
  try { holds = await reconcileHolds(supabase) } catch (e) { console.error("reconcileHolds failed:", e) }

  return json({ ok: true, count: results.length, results, holds, snapshots: snapshotsWritten })
})
