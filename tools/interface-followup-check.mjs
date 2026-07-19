import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [script, styles, loader, workflow] = await Promise.all([
  read('assets/js/interface-followup.js'),
  read('assets/css/interface-followup.css'),
  read('assets/js/push.js'),
  read('.github/workflows/ci.yml')
]);

assert.match(loader, /interface-followup\.css\?v=20260719-1/, 'Follow-up CSS must load after the interface bundles');
assert.match(loader, /interface-followup\.js\?v=20260719-1/, 'Follow-up JS must load after task hotfixes');
assert.match(script, /function isOrdinaryShift\(/, 'Upcoming events must identify ordinary shifts');
assert.match(script, /!isOrdinaryShift\(item\.event\)/, 'Upcoming events must exclude ordinary shifts');
assert.match(script, /Заготовочный план/, 'The preparation-plan placeholder must replace checklists');
assert.match(script, /revisionAvailableToday\(\)/, 'The home dashboard must show daily revision availability');
assert.match(script, /table:'coffee_revisions'/, 'Revision availability must synchronize across employees');
assert.match(script, /document\.body\.appendChild\(modal\)/, 'The mobile task modal must be portaled outside animated panels');
assert.match(script, /\[data-task-complete\]/, 'Task completion must have a delegated mobile-safe handler');
assert.match(script, /\.task-details > summary/, 'Task opening must have a delegated mobile-safe handler');
assert.match(script, /data-refresh-control-summary-all/, 'Control summary must have one global refresh action');
assert.match(styles, /\.v3-date-day/, 'Upcoming date day must have centered dedicated styling');
assert.match(styles, /\.notification-mark-all:not\(:disabled\)/, 'The active mark-all button must be visually prominent');
assert.match(styles, /width:calc\(100% - 6px\)!important/, 'Mobile notification cards must stay inside the panel');
assert.match(styles, /body\.task-modal-open/, 'Mobile task modal scroll and rendering protections must be present');
assert.match(workflow, /node tools\/interface-followup-check\.mjs/, 'CI must run the interface follow-up regression check');

console.log('Interface follow-up regression checks passed.');
