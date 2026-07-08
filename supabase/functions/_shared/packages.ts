// Shared helper: resolve a package tier's bundled add-on ids from its key, so
// email templates can split a booking's add-ons into "included in the
// package" (bundled) vs "extras chosen beyond it" — mirrors the same
// collapsing the storefront already does client-side in buildIntentSummaryHTML().
//
// bookings.package_key is a plain snapshot pointer (no FK) to packages.key —
// see migration add_package_snapshot_to_bookings. A key that no longer
// resolves (package deleted after the booking was made) just yields an empty
// set, which degrades gracefully to "no bundled inclusions to itemize".

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

export async function getBundledAddonIds(
  packageKey: string | null | undefined,
): Promise<Set<number>> {
  if (!packageKey) return new Set()
  try {
    const pkgRes = await fetch(
      `${supabaseUrl}/rest/v1/packages?key=eq.${encodeURIComponent(packageKey)}&select=id`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    )
    if (!pkgRes.ok) return new Set()
    const pkgId = (await pkgRes.json())?.[0]?.id
    if (!pkgId) return new Set()

    const paRes = await fetch(
      `${supabaseUrl}/rest/v1/package_add_ons?package_id=eq.${pkgId}&select=addon_id`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    )
    if (!paRes.ok) return new Set()
    const rows = await paRes.json()
    if (!Array.isArray(rows)) return new Set()
    return new Set(rows.map((r: { addon_id: number }) => Number(r.addon_id)))
  } catch (_err) {
    return new Set()
  }
}
