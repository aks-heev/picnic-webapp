-- Backstop against un-compressed image uploads.
--
-- The primary control is compressImageForUpload() in app.js, which caps every
-- admin-picked image at 1600px WebP q78 before upload. But it deliberately
-- returns the ORIGINAL file on any failure (unsupported format, old browser,
-- createImageBitmap throwing) rather than blocking the upload. This limit is
-- what catches that path loudly instead of letting a 4MB original through.
--
-- 1MB, not the 512KB first proposed: measured output tops out at 339KB
-- (p99 323KB) across the 114-image library, so 512KB left only 1.5x headroom
-- and a busier-than-usual photo could hit a mystifying rejection. A backstop
-- that produces false failures gets switched off by a frustrated admin. 1MB is
-- ~3x the observed max and still rejects the multi-MB class that caused the
-- 2026-09-06 cached-egress outage (originals averaged 869KB, worst 4.58MB).
--
-- MUST NOT be applied before the compression fix is deployed, or ordinary
-- phone uploads start failing. Compression verified live 2026-09-07 14:24 UTC.
--
-- Existing objects are unaffected: venue-images still holds 34 originals over
-- 1MB. The limit gates new uploads only. Those originals are the re-encode
-- source and the rollback for the opt/ variants - do not delete them.
--
-- site-images keeps its own 10MB limit (hero images are legitimately larger).

update storage.buckets
   set file_size_limit = 1048576
 where id in ('venue-images', 'package-images', 'addon-images');
