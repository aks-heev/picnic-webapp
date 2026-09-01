// export-ical  (PUBLIC — verify_jwt = false)
// =================================================================
// Site -> Airbnb. Emits an iCalendar feed of this venue's
// unavailability so Airbnb can import it and stop taking stays
// we've already filled.
//
// Busy set = admin full-day blocks + BOOKING-LINKED parent blocks
//            UNION confirmed site bookings on dates that reach
//            max_concurrent_setups.
//            'parent' rows with booking_id set are combo-origin blocks
//            (whole floor booked on the site); they are full-day, carry
//            no PII, and MUST reach Airbnb.
// EXCLUDES this venue's OWN source='ical' rows AND its booking_id-NULL
//            'parent' rows -> self-echo prevention. Both are derived from
//            THIS listing's own Airbnb feed; re-exporting them to Airbnb
//            is the classic two-way-sync feedback loop.
//
// COMBO PARENTS (venues with children via parent_venue_id): inherit every
//            child floor's occupancy — admin blocks, booking-linked parent
//            blocks, confirmed site bookings, AND (v12) the child's own
//            source='ical' rows — so the whole-cottage listing shows busy
//            whenever either floor is gone, however it was filled.
//
// v12 (2026-07-27) RE-INCLUDES child 'ical' rows, reversing the v11
//            exclusion. v11 removed them to break a loop whose second step
//            was "Airbnb's linked-listing feature pushes the parent's block
//            DOWN to both child rooms". That step cannot occur: as verified
//            in the Airbnb host UI on 2026-07-27, NO listing linking is
//            configured on any of the three TerraCottage listings. The v11
//            comment asserted Airbnb "ALREADY blocks the whole-home listing
//            natively when a child room is booked" — it does not, and the
//            exclusion therefore left the whole-cottage listing open while a
//            floor was occupied by an Airbnb guest. Proven: Ochre held a real
//            Airbnb reservation 2026-07-20..26 (HMH4X8EWTR) while Sienna sat
//            bookable on Airbnb for those exact nights.
//            See docs/ICAL_AUDIT_2026-07-27.md section 2.
//
//            TWO STANDING ASSUMPTIONS. If either stops holding, this
//            inclusion must be reverted to the v11 behaviour:
//              1. Airbnb does not re-export imported-calendar blocks in its
//                 own .ics feed. (Verified 2026-07-27: Sienna's UI showed
//                 27 Jul-30 Sep blocked from our feed; its .ics contained
//                 none of it.) So what we publish cannot return to us.
//              2. No Airbnb listing linking / listing group is configured.
//                 (Verified 2026-07-27 in the host UI for all three.) So a
//                 block Airbnb accepts on the parent cannot be pushed down
//                 onto the children.
//            A child's own 'ical' rows are still never re-exported on the
//            CHILD's own feed — only inherited upward by a combo parent.
//            booking_id-NULL 'parent' rows on a child stay excluded there
//            too: those are this same combo's feed already fanned down by
//            sync-ical, so inheriting them back up is a genuine self-echo.
//
//            Child-booking inheritance is binary: any occupied child night
//            blocks the combo outright, independent of
//            max_concurrent_setups. Mirrors the read-only combo logic in
//            app.js fetchBookedData. No-op for non-combo venues (the child
//            lookup returns zero rows).
// No guest PII is ever emitted (no names, emails, external refs).
// DTEND is EXCLUSIVE (all-day VEVENT convention), matching the
//            [preferred_date, checkout_date) night model used in app.js.
//
// Public on purpose: Airbnb fetches it anonymously. It only reveals
// which dates a venue is busy — the same information already shown on
// the public website calendar.
//
// v13 (2026-08-31) Fail closed on the venue's OWN confirmed-bookings query.
//            bookingsRes.error was the only one of the four parallel
//            queries never checked; on a transient read failure
//            `bookingsRes.data || []` silently treated it as "no confirmed
//            bookings", which could publish a feed missing real busy
//            nights and let Airbnb accept a reservation on an
//            already-booked night. Never reproduced live — found in
//            source review — but the same fail-closed pattern already
//            used for adminRes/kidsRes/childBlocksRes/childBookingsRes
//            belongs here too.
// =================================================================

import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const pad = (n: number) => String(n).padStart(2, "0")
// 'YYYY-MM-DD' -> 'YYYYMMDD'
const compact = (ymd: string) => ymd.replaceAll("-", "")

// Pure UTC string date math — never touch local time / Date parsing of
// 'YYYY-MM-DD' (which Deno reads as UTC midnight and can shift a day).
function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86400000)
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

function icalStamp(): string {
  const n = new Date()
  return `${n.getUTCFullYear()}${pad(n.getUTCMonth() + 1)}${pad(n.getUTCDate())}` +
    `T${pad(n.getUTCHours())}${pad(n.getUTCMinutes())}${pad(n.getUTCSeconds())}Z`
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url)
    const venueId = url.searchParams.get("venue_id")
    if (!venueId || !/^\d+$/.test(venueId)) {
      return new Response("Missing or invalid venue_id", { status: 400 })
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

    const [venueRes, adminRes, bookingsRes, kidsRes] = await Promise.all([
      supabase.from("venues").select("id, max_concurrent_setups").eq("id", venueId).single(),
      // admin full-day blocks + booking-linked 'parent' blocks (slot blocks
      // are cafe-specific, not exported). This venue's own 'ical' rows and its
      // booking_id-NULL 'parent' rows are excluded — see self-echo note in
      // the header.
      supabase.from("venue_availability").select("date")
        .eq("venue_id", venueId)
        .or("source.eq.admin,and(source.eq.parent,booking_id.not.is.null)")
        .is("time_slot", null),
      // confirmed site bookings — only the two date columns, never PII
      supabase.from("bookings").select("preferred_date, checkout_date")
        .eq("venue_id", venueId).eq("confirmed", true),
      // Child floors of this venue, if it's a combo parent. Empty array for
      // every non-combo venue — the block below is then a no-op.
      supabase.from("venues").select("id").eq("parent_venue_id", venueId),
    ])
    if (venueRes.error || !venueRes.data) {
      return new Response("Venue not found", { status: 404 })
    }
    if (adminRes.error) throw adminRes.error
    // Fail closed: if we can't determine this venue's children, don't emit a
    // feed that might be silently missing child-driven unavailability.
    if (kidsRes.error) throw kidsRes.error
    // Fail closed: a booking-query error must not silently degrade to "no
    // confirmed bookings" via `bookingsRes.data || []` below — that would
    // publish a feed missing real busy nights and risk a double-booking.
    if (bookingsRes.error) throw bookingsRes.error

    // deno-lint-ignore no-explicit-any
    const childIds = (kidsRes.data || []).map((k: any) => k.id as number)

    let childBlockDates: string[] = []
    let childBookingRows: Array<{ preferred_date: string; checkout_date: string | null }> = []
    if (childIds.length) {
      const [childBlocksRes, childBookingsRes] = await Promise.all([
        // Child unavailability: admin blocks + booking-linked parent blocks
        // + (v12) the child's OWN Airbnb-origin 'ical' rows. The last of
        // these is what closes the whole-cottage double-booking hole; see
        // the v12 note and its two standing assumptions in the header.
        // booking_id-NULL 'parent' rows on a child remain excluded: those
        // are this combo's own feed fanned down by sync-ical, so pulling
        // them back up would be a self-echo.
        supabase.from("venue_availability").select("date")
          .in("venue_id", childIds)
          .or("source.eq.admin,source.eq.ical,and(source.eq.parent,booking_id.not.is.null)")
          .is("time_slot", null),
        supabase.from("bookings").select("preferred_date, checkout_date")
          .in("venue_id", childIds).eq("confirmed", true),
      ])
      // Fail closed here too — a half-known child state is worse than no feed.
      if (childBlocksRes.error) throw childBlocksRes.error
      if (childBookingsRes.error) throw childBookingsRes.error
      // deno-lint-ignore no-explicit-any
      childBlockDates = (childBlocksRes.data || []).map((r: any) => r.date as string)
      childBookingRows = childBookingsRes.data || []
    }

    const maxSetups = venueRes.data.max_concurrent_setups || 1
    const busy = new Set<string>()

    for (const r of adminRes.data || []) busy.add(r.date as string)
    for (const d of childBlockDates) busy.add(d)

    // Count confirmed bookings per night; a date is busy only once it
    // reaches capacity (keeps a multi-setup venue open after 1 booking).
    const counts = new Map<string, number>()
    for (const b of bookingsRes.data || []) {
      const start = b.preferred_date as string
      const end = (b.checkout_date as string) || addDays(start, 1) // exclusive
      for (let d = start; d < end; d = addDays(d, 1)) {
        counts.set(d, (counts.get(d) || 0) + 1)
      }
    }
    for (const [d, c] of counts) if (c >= maxSetups) busy.add(d)

    // Child bookings are binary — any night a child floor is booked blocks
    // the whole combo outright, independent of the combo's own capacity
    // counting above (max_concurrent_setups doesn't apply to "a floor is gone").
    for (const b of childBookingRows) {
      const start = b.preferred_date
      const end = b.checkout_date || addDays(start, 1)
      for (let d = start; d < end; d = addDays(d, 1)) busy.add(d)
    }

    const stamp = icalStamp()
    const out: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//The Picnic Stories//Availability Export//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
    ]
    for (const d of [...busy].sort()) {
      const ds = compact(d)
      out.push(
        "BEGIN:VEVENT",
        `UID:tps-${venueId}-${ds}@thepicnicstory`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${ds}`,
        `DTEND;VALUE=DATE:${compact(addDays(d, 1))}`, // exclusive end
        "SUMMARY:Reserved",
        "TRANSP:OPAQUE",
        "END:VEVENT",
      )
    }
    out.push("END:VCALENDAR")

    // RFC 5545 requires CRLF line breaks.
    return new Response(out.join("\r\n") + "\r\n", {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="venue-${venueId}.ics"`,
        "Cache-Control": "public, max-age=300",
      },
    })
  } catch (err) {
    console.error("export-ical error:", err)
    return new Response("Internal error", { status: 500 })
  }
})
