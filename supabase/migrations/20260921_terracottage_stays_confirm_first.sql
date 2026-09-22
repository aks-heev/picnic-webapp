-- Stays go confirm-first: the website hides "Pay advance & lock" and offers only "Send a request"
-- (buildIntentScreenHTML: queryOnly = isCombo || venue.requires_confirmation).
-- Reason: self-serve stay locks depend on Airbnb calendar blocking (manual / hourly iCal) — double-booking risk.
-- Rollback: update public.venues set requires_confirmation = false where id in (15, 16);  (17 is combo — query-only regardless)
update public.venues set requires_confirmation = true where id in (15, 16, 17);
