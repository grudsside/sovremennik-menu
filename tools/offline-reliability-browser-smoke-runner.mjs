import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Control v4 has a dedicated deterministic offline scenario. The former runner
// rewrote blocks inside the legacy monolithic test; those runtime patches are no
// longer appropriate because drafts, queueing and reconnect sync now have one owner.
const sourcePath = resolve(process.cwd(), 'tools/offline-reliability-browser-smoke.mjs');
const watchdog = setTimeout(() => {
  console.error('[control-v4-offline] overall timeout');
  process.exit(124);
}, 120000);

try {
  await import(`${pathToFileURL(sourcePath).href}?run=${Date.now()}`);
} finally {
  clearTimeout(watchdog);
}
