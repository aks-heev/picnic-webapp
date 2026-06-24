-- Adds a maps_url column to venues: a pasted Google Maps share link per venue.
-- Powers the "Get Directions" button in the booking confirmation email (T3).
-- Nullable — when empty, the email falls back to an address-based directions link
-- built from name/area/city (see supabase/functions/_shared/venue.ts).

alter table public.venues add column if not exists maps_url text;
