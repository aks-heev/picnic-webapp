/**
 * resend-webhook
 * Receives Resend webhook events (bounced / complained / suppressed / failed / suppression.added)
 * and emails an alert to the owner's PERSONAL Gmail — never team@, because team@ being
 * blocked is exactly the failure this exists to catch (incident 2026-10-16 → 10-18:
 * one hard bounce got team@ suppressed and ~14 emails, guest confirmations included,
 * were silently dropped for ~45h).
 *
 * Auth: Svix signature (svix-id / svix-timestamp / svix-signature). Signing secret from
 * RESEND_WEBHOOK_SECRET if set, else fetched from the Resend API (GET /webhooks/:id) using
 * RESEND_API_KEY and the webhook whose endpoint is this function. Fails CLOSED (401).
 * verify_jwt=false (Resend sends no Supabase JWT).
 *
 * Loop guard: events about our own alert emails are ignored, so a failed alert
 * cannot trigger another alert.
 */
import { sendEmail } from "./_shared/resend.ts"

const ALERT_TO = Deno.env.get("ALERT_EMAIL") ?? "aksh.eeev@gmail.com"
const ALERT_PREFIX = "⚠️ Email problem"
const TEAM_ADDR = "team@picnicstories.com"
const SELF_URL = "https://evmftrogyzoudiccqkya.supabase.co/functions/v1/resend-webhook"
const ALERT_TYPES = new Set([
  "email.bounced", "email.complained", "email.suppressed", "email.failed", "suppression.added",
])

let cachedSecret: string | null = null

async function getSecret(): Promise<string | null> {
  const env = Deno.env.get("RESEND_WEBHOOK_SECRET")
  if (env) return env
  if (cachedSecret) return cachedSecret
  const key = Deno.env.get("RESEND_API_KEY")
  if (!key) return null
  const h = { Authorization: `Bearer ${key}` }
  const list = await fetch("https://api.resend.com/webhooks", { headers: h })
  if (!list.ok) { console.error("webhook list", list.status, await list.text()); return null }
  const items: Array<{ id: string; endpoint: string; signing_secret?: string }> = (await list.json()).data ?? []
  const mine = items.find((w) => w.endpoint === SELF_URL)
  if (!mine) return null
  if (mine.signing_secret) return (cachedSecret = mine.signing_secret)
  const one = await fetch(`https://api.resend.com/webhooks/${mine.id}`, { headers: h })
  if (!one.ok) { console.error("webhook get", one.status, await one.text()); return null }
  const s = (await one.json()).signing_secret ?? null
  return (cachedSecret = s)
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function verify(secret: string, id: string, ts: string, body: string, sigHeader: string): Promise<boolean> {
  const tsNum = Number(ts)
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) return false
  const key = await crypto.subtle.importKey(
    "raw", b64ToBytes(secret.replace(/^whsec_/, "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  )
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)))
  const expected = btoa(String.fromCharCode(...mac))
  return sigHeader.split(" ").some((p) => {
    const [ver, sig] = p.split(",")
    if (ver !== "v1" || !sig || sig.length !== expected.length) return false
    let diff = 0
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
    return diff === 0
  })
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } })

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405)
  const body = await req.text()
  const id = req.headers.get("svix-id") ?? ""
  const ts = req.headers.get("svix-timestamp") ?? ""
  const sig = req.headers.get("svix-signature") ?? ""

  const secret = await getSecret()
  if (!secret) { console.error("resend-webhook: no signing secret available — rejecting"); return json({ error: "no secret" }, 401) }
  if (!id || !ts || !sig || !(await verify(secret, id, ts, body, sig))) {
    console.warn("resend-webhook: bad signature")
    return json({ error: "bad signature" }, 401)
  }

  let evt: { type?: string; created_at?: string; data?: Record<string, unknown> }
  try { evt = JSON.parse(body) } catch { return json({ error: "bad json" }, 400) }
  const type = evt.type ?? "unknown"
  const d = (evt.data ?? {}) as Record<string, any>
  if (!ALERT_TYPES.has(type)) return json({ ok: true, ignored: type })

  const subject = String(d.subject ?? "")
  const recipients: string[] = Array.isArray(d.to) ? d.to.map(String)
    : d.to ? [String(d.to)] : d.email ? [String(d.email)] : []
  // Loop guard: never alert about our own alert emails.
  if (subject.startsWith(ALERT_PREFIX)) {
    console.warn(`resend-webhook: ${type} on an alert email — not re-alerting`, recipients)
    return json({ ok: true, loopGuard: true })
  }

  const teamHit = recipients.some((r) => r.toLowerCase().includes(TEAM_ADDR)) ||
    JSON.stringify(d).toLowerCase().includes(`"${TEAM_ADDR}"`) && type === "suppression.added"
  const reason = d.bounce?.message ?? d.bounce?.diagnosticCode ?? d.failed?.reason ?? d.reason ?? d.origin ?? ""
  const label = type.replace("email.", "").replace("suppression.added", "address blocked")

  const html = `
  <div style="font-family:sans-serif;max-width:600px;color:#222;">
    ${teamHit ? `<div style="background:#b4452f;color:#fff;padding:12px 16px;border-radius:8px;font-weight:700;margin-bottom:14px;">
      team@picnicstories.com is involved. If it is blocked, Resend drops EVERY email that copies it — guest confirmations included.
      Fix the cause, then remove it from Resend → Audience → Suppressions.</div>` : ""}
    <h2 style="margin:0 0 10px;">${esc(label)}: ${esc(recipients.join(", ") || "unknown recipient")}</h2>
    <p style="margin:0 0 6px;"><strong>Subject:</strong> ${esc(subject || "—")}</p>
    <p style="margin:0 0 6px;"><strong>Reason:</strong> ${esc(reason || "—")}</p>
    <p style="margin:0 0 6px;"><strong>When:</strong> ${esc(evt.created_at ?? "")}</p>
    ${d.email_id ? `<p style="margin:0 0 12px;"><a href="https://resend.com/emails/${esc(d.email_id)}">Open in Resend</a></p>` : ""}
    <pre style="background:#f5f5f5;padding:10px;border-radius:6px;font-size:11px;white-space:pre-wrap;">${esc(JSON.stringify(d, null, 2).slice(0, 3000))}</pre>
  </div>`

  try {
    await sendEmail({
      to: ALERT_TO,
      subject: `${ALERT_PREFIX}${teamHit ? " 🔴 team@" : ""} — ${label}: ${recipients.join(", ").slice(0, 80) || "unknown"}`,
      html,
    })
  } catch (err) {
    console.error("resend-webhook: alert send failed", err)
    return json({ error: String(err) }, 500) // 5xx → Resend retries
  }
  console.log(`resend-webhook: alerted ${type} for ${recipients.join(",")}${teamHit ? " [TEAM]" : ""}`)
  return json({ ok: true, alerted: type })
})
