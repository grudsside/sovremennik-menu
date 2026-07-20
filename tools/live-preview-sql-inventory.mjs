import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const files = execFileSync('git', ['ls-files', 'supabase/sql/*.sql', 'supabase/migrations/*.sql'], {
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .map(value => value.trim())
  .filter(Boolean)
  .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));

if (!files.length) {
  console.error('No Supabase SQL or migration files were found.');
  process.exit(1);
}

const output = `${files.join('\n')}\n`;
fs.mkdirSync('artifacts/live-preview', { recursive: true });
fs.writeFileSync('artifacts/live-preview/sql-inventory.txt', output);

console.log('Tracked Supabase SQL inventory:');
for (const file of files) console.log(`- ${file}`);
