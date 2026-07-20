// Shared Resend email helper
// Used by all notify-* edge functions

export interface EmailPayload {
  to: string | string[]
  subject: string
  html: string
  cc?: string | string[]
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY")
  if (!apiKey) throw new Error("RESEND_API_KEY secret is not set")

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "The Picnic Stories <team@picnicstories.com>",
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      ...(payload.cc ? { cc: payload.cc } : {}),
    }),
  })

  const bodyText = await res.text()
  if (!res.ok) {
    throw new Error(`Resend API error ${res.status}: ${bodyText}`)
  }
  // Log the Resend message id so a delivery question can be traced back to a
  // specific send (Resend's own dashboard is the source of truth beyond this).
  console.log(`sendEmail: accepted by Resend — to=${JSON.stringify(payload.to)} cc=${JSON.stringify(payload.cc ?? null)} response=${bodyText}`)
}
