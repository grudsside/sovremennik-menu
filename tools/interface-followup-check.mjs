import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [script, styles, activePanelScript, activePanelStyles, loader, workflow] = await Promise.all([
  read('assets/js/interface-followup.js'),
  read('assets/css/interface-followup.css'),
  read('assets/js/mobile-active-panel.js'),
  read('assets/css/mobile-active-panel.css'),
  read('assets/js/push.js'),
  read('.github/workflows/ci.yml')
]);

assert.match(loader, /interface-followup\.css\?v=20260719-1/, 'Follow-up CSS must load after the interface bundles');
assert.match(loader, /interface-followup\.js\?v=20260719-2/, 'Updated follow-up JS must be cache-busted');
assert.match(loader, /mobile-active-panel\.css\?v=20260719-2/, 'Mobile active-panel CSS must remain loaded');
assert.match(loader, /mobile-active-panel\.js\?v=20260719-3/, 'Updated mobile active-panel JS must be cache-busted');
assert.doesNotMatch(loader, /mobile-tasks-performance\.(?:js|css)/, 'The old mobile task override must stay disabled');
assert.match(script, /function isOrdinaryShift\(/, 'Upcoming events must identify ordinary shifts');
assert.match(script, /!isOrdinaryShift\(item\.event\)/, 'Upcoming events must exclude ordinary shifts');
assert.match(script, /Заготовочный план/, 'The preparation-plan placeholder must replace checklists');
assert.match(script, /revisionAvailableToday\(\)/, 'The home dashboard must show daily revision availability');
assert.match(script, /table:'coffee_revisions'/, 'Revision availability must synchronize across employees');
assert.match(script, /SovremennikTasksV2\?\.getActiveCount/, 'Home metrics must read the isolated module count');
assert.doesNotMatch(script, /task-modal|data-task-|loadTasks|refreshTasks|openTaskModal|closeTaskModal/, 'Follow-up must not intercept task actions');
assert.match(script, /data-refresh-control-summary-all/, 'Control summary must have one global refresh action');
assert.match(styles, /\.v3-date-day/, 'Upcoming date day must have centered dedicated styling');
assert.match(styles, /\.notification-mark-all:not\(:disabled\)/, 'The active mark-all button must be visually prominent');
assert.match(activePanelScript, /function pruneInactivePanels\(/, 'Mobile mode must remove inactive panels from the DOM');
assert.match(activePanelScript, /node\.id !== keepId\) node\.remove\(\)/, 'Inactive mobile panels must be physically removed');
assert.match(activePanelScript, /function renderAppLean\(/, 'Full renders must be followed by mobile DOM pruning');
assert.match(activePanelScript, /if\(!expected\) renderAppLean\(\)/, 'Navigation must recreate only the requested missing panel');
assert.doesNotMatch(activePanelScript, /task-modal|task-form-panel-open/, 'The mobile panel layer must not contain task-specific cleanup');
assert.match(activePanelStyles, /body\.mobile-active-panel-only #panels/, 'Mobile active-panel layout containment must be enabled');
assert.match(activePanelStyles, /animation:none!important/, 'Mobile active panels must avoid expensive transition work');
assert.match(workflow, /node tools\/interface-followup-check\.mjs/, 'CI must run the interface follow-up regression check');
assert.match(workflow, /node tools\/tasks-v2-check\.mjs/, 'CI must run the isolated task-module check');

console.log('Interface follow-up regression checks passed.');
