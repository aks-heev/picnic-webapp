#!/usr/bin/env node
/**
 * One-off cleanup: delete unreferenced Storage images listed in
 * storage-orphans-safe-to-delete.csv (bucket,name,size_mb,uploaded).
 *
 * Uses the Storage API remove() so BOTH the object row AND the backing
 * file are deleted. (Deleting via SQL on storage.objects leaves the file
 * behind and keeps billing storage — do not do that.)
 *
 * SAFETY:
 *   - Dry-run by default. Prints what it WOULD delete, touches nothing.
 *   - Add --commit to actually delete.
 *   - --bucket=package-images  restricts to one bucket (do this first).
 *
 * Requires env vars (never commit these):
 *   SUPABASE_URL=https://evmftrogyzoudiccqkya.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key>
 *
 * Run:
 *   npm i @supabase/supabase-js         # if not already installed
 *   node scripts/delete-orphan-images.mjs                       # dry run, all buckets
 *   node scripts/delete-orphan-images.mjs --bucket=package-images
 *   node scripts/delete-orphan-images.mjs --bucket=package-images --commit
 *   node scripts/delete-orphan-images.mjs --commit             # everything in the CSV
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dir = dirname(fileURLToPath(import.meta.url));
const CSV = join(__dir, '..', 'storage-orphans-safe-to-delete.csv');

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

// Parse CSV (skip header). Group names by bucket.
const rows = readFileSync(CSV, 'utf8').trim().split('\n').slice(1);
const byBucket = {};
for (const line of rows) {
  const [bucket, name] = line.split(',');
  if (!bucket || !name) continue;
  if (ONLY_BUCKET && bucket !== ONLY_BUCKET) continue;
  (byBucket[bucket] ||= []).push(name);
}

const total = Object.values(byBucket).reduce((n, a) => n + a.length, 0);
if (total === 0) { console.log('Nothing matched. Check --bucket value.'); process.exit(0); }

console.log(`${COMMIT ? 'DELETING' : 'DRY RUN — would delete'} ${total} files across ${Object.keys(byBucket).length} bucket(s):`);
for (const [b, names] of Object.entries(byBucket)) console.log(`  ${b}: ${names.length}`);

if (!COMMIT) {
  console.log('\nNo changes made. Re-run with --commit to delete.');
  process.exit(0);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });
const BATCH = 100; // remove() accepts arrays; batch to keep requests small
let deleted = 0;
for (const [bucket, names] of Object.entries(byBucket)) {
  for (let i = 0; i < names.length; i += BATCH) {
    const chunk = names.slice(i, i + BATCH);
    const { data, error } = await supabase.storage.from(bucket).remove(chunk);
    if (error) { console.error(`  ! ${bucket} batch failed:`, error.message); continue; }
    deleted += data.length;
    console.log(`  ${bucket}: removed ${data.length} (${deleted}/${total})`);
  }
}
console.log(`\nDone. Removed ${deleted}/${total} files.`);
