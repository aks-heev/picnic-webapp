/**
 * lead-digest
 * Called daily via pg_cron at 03:30 UTC (09:00 IST).
 * Emails team@ a digest of every open lead (pending / whatsapp_clicked / abandoned,
 * unconfirmed) so each one gets a manual WhatsApp follow-up with reason-capture.
 *
 * Rules (agreed 2026-07-16):
 *  - Team-number exclusion: owner + internal test phones never appear.
 *  - Dedup by phone: a lead is dropped if a CONFIRMED booking exists with the same
 *    last-10-digit phone and the same event date (re-entry case, e.g. booking #5 vs #6).
 *  - Sorted by event-date proximity, not capture date. Upcoming events first
 *    (soonest on top), then a separate "date passed — ask why" section.
 *  - Window: upcoming-event leads always shown; past-date leads only if captured
 *    in the last 30 days (old cold leads age out).
 *  - Rows named like a test ("Test …") are skipped.
 *  - Leads with followed_up_at set drop out of the actionable list (shown as a count).
 *  - No actionable leads → no email (avoid inbox fatigue), 200 with skipped:true.
 *
 * Required function secrets: RESEND_API_KEY (shared), SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY (injected), CRON_SECRET (optional), TEAM_EMAIL (optional).
 */

import { sendEmail } from "./_shared/resend.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const CRON_SECRET = Deno.env.get("CRON_SECRET")
const TEAM_EMAIL = Deno.env.get("TEAM_EMAIL") ?? "team@picnicstories.com"

/** Internal numbers (last-10 form) that must never appear as leads. */
const TEAM_PHONES = new Set(["7742363777", "7425055501"])
const PAST_LEAD_WINDOW_DAYS = 30

interface LeadRow {
  id: number
  created_at: string
  full_name: string | null
  mobile_number: string | null
  email_address: string | null
  preferred_date: string | null
  time_slot: string | null
  guest_count: number | null
  children_count: number | null
  occasion: string | null
  package_name: string | null
  total_amount: string | number | null
  lead_status: string
  followed_up_at: string | null
  followup_reason: string | null
  venues: { name: string } | null
}

const last10 = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10)

/** Today's date string in IST (event dates are IST calendar dates). */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
}

function daysFromToday(dateStr: string, today: string): number {
  return Math.round((Date.parse(dateStr) - Date.parse(today)) / 86400000)
}

async function rest(path: string): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
}

Deno.serve(async (req) => {
  try {
    if (CRON_SECRET) {
      const auth = req.headers.get("Authorization") ?? ""
      if (auth !== `Bearer ${CRON_SECRET}`) {
        console.warn("lead-digest: unauthorized call rejected")
        return new Response("Unauthorized", { status: 401 })
      }
    }

    const today = istToday()

    // ── Open leads ────────────────────────────────────────────────────
    const leadsRes = await rest(
      "bookings?confirmed=eq.false" +
        "&lead_status=in.(pending,whatsapp_clicked,abandoned)" +
        "&select=id,created_at,full_name,mobile_number,email_address,preferred_date," +
        "time_slot,guest_count,children_count,occasion,package_name,total_amount," +
        "lead_status,followed_up_at,followup_reason,venues(name)" +
        "&order=created_at.desc&limit=200",
    )
    if (!leadsRes.ok) throw new Error(`leads fetch ${leadsRes.status}: ${await leadsRes.text()}`)
    const leads: LeadRow[] = await leadsRes.json()

    // ── Confirmed bookings, for phone+date dedup ──────────────────────
    const confRes = await rest(
      "bookings?confirmed=eq.true&select=mobile_number,preferred_date&limit=500",
    )
    if (!confRes.ok) throw new Error(`confirmed fetch ${confRes.status}: ${await confRes.text()}`)
    const confirmed: Array<{ mobile_number: string | null; preferred_date: string | null }> =
      await confRes.json()
    const confirmedKeys = new Set(
      confirmed.map((c) => `${last10(c.mobile_number)}|${c.preferred_date ?? ""}`),
    )

    // ── Filter ────────────────────────────────────────────────────────
    let followedUp = 0
    const actionable: LeadRow[] = []
    for (const l of leads) {
      const phone = last10(l.mobile_number)
      if (TEAM_PHONES.has(phone)) continue
      if ((l.full_name ?? "").trim().toLowerCase().startsWith("test")) continue
      if (l.preferred_date && confirmedKeys.has(`${phone}|${l.preferred_date}`)) continue
      if (l.followed_up_at) {
        followedUp++
        continue
      }
      const eventDelta = l.preferred_date ? daysFromToday(l.preferred_date, today) : null
      const capturedAgo = daysFromToday(l.created_at.slice(0, 10), today) * -1
      if (eventDelta !== null && eventDelta < 0 && capturedAgo > PAST_LEAD_WINDOW_DAYS) continue
      actionable.push(l)
    }

    if (actionable.length === 0) {
      console.log(`lead-digest ${today}: nothing actionable (${followedUp} already followed up) — no email sent`)
      return new Response(JSON.stringify({ ok: true, skipped: true, followedUp }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    // ── Partition + sort by event proximity ───────────────────────────
    const upcoming = actionable
      .filter((l) => l.preferred_date && daysFromToday(l.preferred_date, today) >= 0)
      .sort((a, b) => Date.parse(a.preferred_date!) - Date.parse(b.preferred_date!))
    const past = actionable
      .filter((l) => !l.preferred_date || daysFromToday(l.preferred_date, today) < 0)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))

    await sendEmail({
      to: TEAM_EMAIL,
      subject: `🌿 Lead digest — ${upcoming.length} to follow up${past.length ? ` (+${past.length} date-passed)` : ""} · ${today}`,
      html: buildDigest(today, upcoming, past, followedUp),
    })

    console.log(`lead-digest ${today}: sent — ${upcoming.length} upcoming, ${past.length} past, ${followedUp} already followed up`)
    return new Response(
      JSON.stringify({ ok: true, upcoming: upcoming.length, past: past.length, followedUp }),
      { headers: { "Content-Type": "application/json" } },
    )
  } catch (err) {
    console.error("lead-digest error:", err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
})

// ── Email rendering ─────────────────────────────────────────────────────

function waLink(l: LeadRow): string {
  const phone = last10(l.mobile_number)
  const msg =
    `Hi ${(l.full_name ?? "").split(" ")[0] || "there"}! This is The Picnic Stories 🌿 ` +
    `I saw you were planning ${l.occasion ? `a ${l.occasion.toLowerCase()} ` : ""}picnic` +
    `${l.venues?.name ? ` at ${l.venues.name}` : ""}` +
    `${l.preferred_date ? ` for ${l.preferred_date}` : ""} — happy to help you lock it in. ` +
    `Any questions I can answer?`
  return `https://wa.me/91${phone}?text=${encodeURIComponent(msg)}`
}

function inr(v: string | number | null): string {
  const n = Number(v ?? 0)
  return n > 0 ? `₹${n.toLocaleString("en-IN")}` : "no quote"
}

function statusBadge(s: string): string {
  const color = s === "abandoned" ? "#b4452f" : s === "whatsapp_clicked" ? "#1f7a4d" : "#8a6d1f"
  return `<span style="font-family:sans-serif;font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:1px;">${esc(s.replace("_", " "))}</span>`
}

function leadCard(l: LeadRow, today: string): string {
  const eventDelta = l.preferred_date ? daysFromToday(l.preferred_date, today) : null
  const eventLine =
    l.preferred_date == null
      ? "no date given"
      : eventDelta! >= 0
        ? `${l.preferred_date} · <strong>in ${eventDelta} day${eventDelta === 1 ? "" : "s"}</strong>`
        : `${l.preferred_date} · passed ${-eventDelta!}d ago`
  const capturedAgo = -daysFromToday(l.created_at.slice(0, 10), today)
  const guests = `${l.guest_count ?? "?"} guest${(l.guest_count ?? 0) === 1 ? "" : "s"}${l.children_count ? ` + ${l.children_count} kids` : ""}`

  return `
  <div style="background:#fff;border:1px solid #eee0d5;border-radius:10px;padding:18px 20px;margin:0 0 14px;">
    <div style="margin-bottom:6px;">
      ${statusBadge(l.lead_status)}
      <span style="font-family:sans-serif;font-size:11px;color:#bbb;"> · captured ${capturedAgo}d ago · #${l.id}</span>
    </div>
    <p style="margin:0 0 4px;font-size:17px;color:#333;"><strong>${esc(l.full_name ?? "—")}</strong>
      <span style="font-family:sans-serif;font-size:13px;color:#888;">· ${esc(l.occasion ?? "no occasion")} · ${esc(guests)}</span>
    </p>
    <p style="margin:0 0 4px;font-family:sans-serif;font-size:13px;color:#555;">
      ${esc(l.venues?.name ?? "custom venue")} · ${eventLine}${l.time_slot ? ` · ${esc(l.time_slot)}` : ""}
    </p>
    <p style="margin:0 0 12px;font-family:sans-serif;font-size:13px;color:#555;">
      Quoted <strong>${inr(l.total_amount)}</strong>${l.package_name ? ` · ${esc(l.package_name)}` : ""} ·
      ${esc(l.mobile_number ?? "")}${l.email_address ? ` · ${esc(l.email_address)}` : ""}
    </p>
    <a href="${waLink(l)}" target="_blank" rel="noopener noreferrer"
       style="display:inline-block;background:#1f7a4d;color:#fff;padding:9px 18px;border-radius:6px;
              text-decoration:none;font-size:13px;font-family:sans-serif;font-weight:600;">
      💬 WhatsApp ${esc((l.full_name ?? "").split(" ")[0] || "them")}
    </a>
  </div>`
}

function buildDigest(today: string, upcoming: LeadRow[], past: LeadRow[], followedUp: number): string {
  return `
  <div style="font-family:Georgia,'Times New Roman',serif;max-width:620px;margin:0 auto;color:#333;
              background:#fffbf7;padding:36px 30px;border-radius:10px;">
    <p style="font-size:13px;color:#aaa;text-transform:uppercase;letter-spacing:2px;margin:0 0 6px;font-family:sans-serif;">
      The Picnic Stories — daily lead digest</p>
    <h1 style="font-size:22px;color:#6b2d3e;margin:0 0 20px;font-weight:normal;">${today} — ${upcoming.length + past.length} lead${upcoming.length + past.length === 1 ? "" : "s"} need a follow-up</h1>

    ${upcoming.length ? `<h2 style="font-size:15px;color:#333;font-family:sans-serif;margin:0 0 10px;">📅 Upcoming events — call these first</h2>${upcoming.map((l) => leadCard(l, today)).join("")}` : ""}

    ${past.length ? `<h2 style="font-size:15px;color:#333;font-family:sans-serif;margin:20px 0 10px;">⏳ Event date passed — ask what happened</h2>${past.map((l) => leadCard(l, today)).join("")}` : ""}

    <div style="background:#fdf3e7;border:1px solid #f0dcc0;border-radius:10px;padding:16px 20px;margin:24px 0 0;">
      <p style="margin:0 0 6px;font-family:sans-serif;font-size:13px;font-weight:700;color:#8a6d1f;">
        Ask the why — every conversation:</p>
      <p style="margin:0;font-family:sans-serif;font-size:13px;color:#666;line-height:1.7;">
        "Totally understand if the timing changed — mind sharing what held you back?"<br>
        <strong>Price · advance amount · date unavailable · just browsing · payment trouble · other</strong><br>
        Log the answer on the booking (Claude session: "mark lead #ID followed up, reason: …").
        Leads repeat here daily until marked followed-up.</p>
    </div>

    ${followedUp ? `<p style="margin:16px 0 0;font-family:sans-serif;font-size:12px;color:#aaa;">${followedUp} lead${followedUp === 1 ? "" : "s"} already followed up — hidden.</p>` : ""}
  </div>`
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
