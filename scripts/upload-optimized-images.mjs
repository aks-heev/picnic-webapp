#!/usr/bin/env node
/**
 * Upload the pre-encoded image variants produced into _temp/optimized/ to
 * Storage, under an `opt/<sm|lg>/` prefix inside each image bucket.
 *
 * Originals are NEVER touched. Nothing is deleted. The variants land beside
 * the originals under a new prefix, so this is additive and the DB migration
 * that repoints venues.images / packages.images / add_ons.image_url can be
 * reverted independently (see image_refs_backup_20260907).
 *
 * cacheControl is set to 1 year: the object keys are content-addressed by the
 * original upload timestamp, so a given key's bytes never change. The old
 * 3600 default was making returning visitors re-download everything hourly.
 *
 * SAFETY:
 *   - Dry-run by default. Prints what it WOULD upload, touches nothing.
 *   - Add --commit to actually upload.
 *   - --bucket=package-images  restricts to one bucket (do this first).
 *
 * Requires env vars (never commit these):
 *   SUPABASE_URL=https://evmftrogyzoudiccqkya.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key>
 *
 * Run:
 *   node scripts/upload-optimized-images.mjs                      # dry run, all buckets
 *   node scripts/upload-optimized-images.mjs --bucket=addon-images
 *   node scripts/upload-optimized-images.mjs --commit             # everything
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dir = dirname(fileURLToPath(import.meta.url));
const OPT_DIR  = join(__dir, '..', '_temp', 'optimized');
const MANIFEST = join(OPT_DIR, 'manifest.json');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const bucketArg = args.find(a => a.startsWith('--bucket='));
const ONLY_BUCKET = bucketArg ? bucketArg.split('=')[1] : null;

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars first.');
  process.exit(1);
}
if (!existsSync(MANIFEST)) {
  console.error(`No manifest at ${MANIFEST}. The encode step has not been run.`);
  process.exit(1);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

// Flatten manifest -> one row per file to upload.
const jobs = [];
for (const [origKey, variants] of Object.entries(manifest)) {
  for (const tag of ['sm', 'lg']) {
    const v = variants[tag];
    if (!v) continue;
    const [bucket, ...rest] = v.key.split('/');
    if (ONLY_BUCKET && bucket !== ONLY_BUCKET) continue;
    jobs.push({ origKey, tag, bucket, name: rest.join('/'), bytes: v.bytes });
  }
}

const totalBytes = jobs.reduce((n, j) => n + j.bytes, 0);
const byBucket = jobs.reduce((m, j) => (m[j.bucket] = (m[j.bucket] || 0) + 1, m), {});
console.log(`${COMMIT ? 'UPLOADING' : 'DRY RUN'} — ${jobs.length} files, ${(totalBytes / 1048576).toFixed(2)} MB`);
for (const [b, n] of Object.entries(byBucket)) console.log(`  ${b}: ${n} files`);
if (!COMMIT) {
  console.log('\nSample:');
  for (const j of jobs.slice(0, 6)) console.log(`  ${j.bucket}/${j.name}  (${(j.bytes / 1024).toFixed(0)} KB)`);
  console.log('\nRe-run with --commit to upload.');
  process.exit(0);
}

let ok = 0, failed = 0;
const CONCURRENCY = 8;
const queue = jobs.slice();

async function worker() {
  while (queue.length) {
    const j = queue.shift();
    const localPath = join(OPT_DIR, j.bucket, j.name);
    try {
      const body = readFileSync(localPath);
      const { error } = await supabase.storage.from(j.bucket).upload(j.name, body, {
        contentType: 'image/webp',
        cacheControl: '31536000',
        upsert: true,
      });
      if (error) throw error;
      ok++;
      if (ok % 25 === 0) console.log(`  ...${ok}/${jobs.length}`);
    } catch (e) {
      failed++;
      console.error(`  FAIL ${j.bucket}/${j.name}: ${e.message || e}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`\nDone. uploaded=${ok} failed=${failed}`);
if (failed) process.exit(1);
