// Shared helper: resolve venue display label + a "Get Directions" URL for emails.
// Bookings store venue_id (+ optional venue_address); venues store name/area/city
// and an optional maps_url (a pasted Google Maps share link).

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

export interface VenueInfo {
  label: string | null // human-readable location, e.g. "Terracottage Umber, DLF Phase 2, Gurugram"
  directionsUrl: string | null // link that opens directions, or null if no location known
}

export async function getVenueInfo(
  venueId: number | null | undefined,
  venueAddress: string | null | undefined,
): Promise<VenueInfo> {
  let label: string | null = null
  let mapsUrl: string | null = null

  if (venueId) {
    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/venues?id=eq.${venueId}&select=name,area,city,maps_url,team_id`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
      )
      if (res.ok) {
        const v = (await res.json())?.[0]
        if (v) {
          label = [v.name, v.area, v.city].filter(Boolean).join(", ") || null
          mapsUrl = v.maps_url || null
          if (v.team_id) {
            try {
              const tRes = await fetch(
                `${supabaseUrl}/rest/v1/teams?id=eq.${v.team_id}&select=contact_email`,
                { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
              )
              if (tRes.ok) {
                const t = (await tRes.json())?.[0]
                teamEmail = t?.contact_email || null
              }
            } catch (_err) {
              // fall through — teamEmail stays null
            }
          }
        }
      }
    } catch (_err) {
      // fall through to address-based handling
    }
  }

  // Display label: venue name/area/city, else the booking-specific address.
  if (!label) label = venueAddress || null

  // Directions destination priority:
  //   1. booking-specific venue_address (custom / at-customer-location bookings win)
  //   2. venue's pasted maps_url (precise pin)
  //   3. name/area/city text search
  let directionsUrl: string | null = null
  if (venueAddress) {
    directionsUrl = mapsDirLink(venueAddress)
  } else if (mapsUrl) {
    directionsUrl = mapsUrl
  } else if (label) {
    directionsUrl = mapsDirLink(label)
  }

  return { label, directionsUrl }
}

// Provider-neutral Google directions deep link (opens the user's maps app on mobile).
function mapsDirLink(destination: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
}

// HTML <p> detail row for the location, or "" so emails never render "undefined".
export function locationRow(label: string | null): string {
  return label
    ? `<p style="margin: 0 0 8px;"><strong>📍 Location:</strong> ${label}</p>`
    : ""
}

// "Get Directions" button, or "" when there's no destination to point at.
export function directionsButton(url: string | null): string {
  if (!url) return ""
  return `
    <p style="text-align: center; margin: 24px 0;">
      <a href="${url}"
         style="background: #2d6a4f; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-size: 15px; font-weight: bold; display: inline-block;">
        📍 Get Directions
      </a>
    </p>`
}
