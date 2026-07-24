import assert from 'node:assert/strict';
import fs from 'node:fs';

const sourcePath = process.argv[2];
assert(sourcePath, 'API key response path is required.');

const rows = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
assert(Array.isArray(rows), 'Supabase Management API did not return an API key list.');

function valueOf(row) {
  return String(row?.api_key || row?.value || '').trim();
}

function descriptor(row) {
  return [row?.type, row?.name, row?.prefix, row?.description]
    .map(value => String(value || '').trim().toLowerCase())
    .join(' ');
}

function publicScore(row) {
  const value = valueOf(row);
  const text = descriptor(row);
  if (value.startsWith('sb_publishable_')) return 100;
  if (/\bpublishable\b/.test(text)) return 90;
  if (/\banon\b/.test(text)) return 80;
  return 0;
}

function secretScore(row) {
  const value = valueOf(row);
  const text = descriptor(row);
  // Supabase Auth Admin still requires the legacy service_role JWT. New sb_secret keys
  // work for Data/Storage APIs but are rejected by GoTrue user administration.
  if (/service[_ -]?role/.test(text)) return 110;
  if (value.startsWith('sb_secret_')) return 100;
  if (/\bsecret\b/.test(text)) return 80;
  return 0;
}

function pick(score) {
  return rows
    .map(row => ({ row, score: score(row) }))
    .filter(entry => entry.score > 0 && valueOf(entry.row))
    .sort((left, right) => right.score - left.score)[0]?.row;
}

const publicRow = pick(publicScore);
const secretRow = pick(secretScore);
const publicKey = valueOf(publicRow);
const secretKey = valueOf(secretRow);

assert(publicKey, 'Publishable/anon API key was not found.');
assert(secretKey, 'Secret/service_role API key was not found.');
assert.notEqual(publicKey, secretKey, 'Public and secret API keys must differ.');

const envPath = process.env.GITHUB_ENV;
assert(envPath, 'GITHUB_ENV is not available.');

console.log(`::add-mask::${publicKey}`);
console.log(`::add-mask::${secretKey}`);
fs.appendFileSync(envPath, `PREVIEW_PUBLIC_KEY=${publicKey}\nPREVIEW_SECRET_KEY=${secretKey}\n`);
console.log('Preview API keys resolved without exposing their values.');
