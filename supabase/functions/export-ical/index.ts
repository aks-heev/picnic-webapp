// export-ical  (PUBLIC — verify_jwt = false)
// =================================================================
// Site -> Airbnb. Emits an iCalendar feed of this venue's
// website-origin unavailability so Airbnb can import it and stop
// taking stays we've already filled.
//
// Busy set = admin + parent full-day blocks  UNION  confirmed site
//            bookings on dates that reach max_concurrent_setups.
//            'parent' rows are combo-origin blocks (whole floor booked);
//            they are full-day, carry no PII, and MUST reach Airbnb.
// EXCLUDES source='ical' rows  ->  loop prevention. Re-exporting
//            Airbnb's own imported reservations back to Airbnb is the
//            classic two-way-sync feedback loop.
// No guest PII is ever emitted (no names, emails, external refs).
// DTEND is EXCLUSIVE (all-day VEVENT convention), matching the
//            [preferred_date, checkout_date) night model used in app.js.
//
// Public on purpose: Airbnb fetches it anonymously. It only reveals
// which dates a venue is busy — the same information already shown on
// the public website calendar.
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

    const [venueRes, adminRes, bookingsRes] = await Promise.all([
      supabase.from("venues").select("id, max_concurrent_setups").eq("id", venueId).single(),
      // admin + parent full-day blocks (slot blocks are café-specific, not
      // exported). 'parent' = whole-floor combo booking blocking this child.
      supabase.from("venue_availability").select("date")
        .eq("venue_id", venueId).in("source", ["admin", "parent"]).is("time_slot", null),
      // confirmed site bookings — only the two date columns, never PII
      supabase.from("bookings").select("preferred_date, checkout_date")
        .eq("venue_id", venueId).eq("confirmed", true),
    ])
    if (venueRes.error || !venueRes.data) {
      return new Response("Venue not found", { status: 404 })
    }

    const maxSetups = venueRes.data.max_concurrent_setups || 1
    const busy = new Set<string>()

    for (const r of adminRes.data || []) busy.add(r.date as string)

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
