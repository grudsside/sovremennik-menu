import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [script, styles, mobileScript, mobileStyles, activePanelScript, activePanelStyles, loader, workflow] = await Promise.all([
  read('assets/js/interface-followup.js'),
  read('assets/css/interface-followup.css'),
  read('assets/js/mobile-tasks-performance.js'),
  read('assets/css/mobile-tasks-performance.css'),
  read('assets/js/mobile-active-panel.js'),
  read('assets/css/mobile-active-panel.css'),
  read('assets/js/push.js'),
  read('.github/workflows/ci.yml')
]);

assert.match(loader, /interface-followup\.css\?v=20260719-1/, 'Follow-up CSS must load after the interface bundles');
assert.match(loader, /interface-followup\.js\?v=20260719-1/, 'Follow-up JS must load after task hotfixes');
assert.match(loader, /mobile-tasks-performance\.css\?v=20260719-1/, 'Mobile task performance CSS must be cache-busted');
assert.match(loader, /mobile-tasks-performance\.js\?v=20260719-1/, 'Mobile task performance JS must load after interface follow-up');
assert.match(loader, /mobile-active-panel\.css\?v=20260719-1/, 'Mobile active-panel CSS must be cache-busted');
assert.match(loader, /mobile-active-panel\.js\?v=20260719-1/, 'Mobile active-panel JS must load last');
assert.match(script, /function isOrdinaryShift\(/, 'Upcoming events must identify ordinary shifts');
assert.match(script, /!isOrdinaryShift\(item\.event\)/, 'Upcoming events must exclude ordinary shifts');
assert.match(script, /Заготовочный план/, 'The preparation-plan placeholder must replace checklists');
assert.match(script, /revisionAvailableToday\(\)/, 'The home dashboard must show daily revision availability');
assert.match(script, /table:'coffee_revisions'/, 'Revision availability must synchronize across employees');
assert.match(script, /document\.body\.appendChild\(modal\)/, 'The mobile task modal must be portaled outside animated panels');
assert.match(script, /data-refresh-control-summary-all/, 'Control summary must have one global refresh action');
assert.match(styles, /\.v3-date-day/, 'Upcoming date day must have centered dedicated styling');
assert.match(styles, /\.notification-mark-all:not\(:disabled\)/, 'The active mark-all button must be visually prominent');
assert.match(mobileScript, /MOBILE_PAGE_SIZE = 12/, 'Mobile task rendering must be paginated to limit DOM work');
assert.match(mobileScript, /mobile-task-summary/, 'Mobile tasks must use lightweight buttons instead of details elements');
assert.match(mobileScript, /function openTaskModalOptimized\(/, 'The task modal must have a dedicated mobile-safe opener');
assert.doesNotMatch(mobileScript, /\.focus\(/, 'The mobile task modal must not force iOS keyboard focus');
assert.match(mobileStyles, /transform:none!important/, 'The iOS task modal must avoid transformed scrolling containers');
assert.match(mobileStyles, /body\.mobile-tasks-active \.hero/, 'Expensive header blur must be disabled in the mobile task section');
assert.match(mobileStyles, /border-left-width:1px!important/, 'Notification cards must keep a complete permanent border');
assert.match(mobileStyles, /translateY\(-2px\)/, 'Notification hover must animate without creating the missing border');
assert.match(activePanelScript, /function pruneInactivePanels\(/, 'Mobile mode must remove inactive panels from the DOM');
assert.match(activePanelScript, /node\.id !== keepId\) node\.remove\(\)/, 'Inactive mobile panels must be physically removed');
assert.match(activePanelScript, /function renderAppLean\(/, 'Full renders must be followed by mobile DOM pruning');
assert.match(activePanelScript, /if\(!expected\) renderAppLean\(\)/, 'Navigation must recreate only the requested missing panel');
assert.match(activePanelStyles, /body\.mobile-active-panel-only #panels/, 'Mobile active-panel layout containment must be enabled');
assert.match(activePanelStyles, /animation:none!important/, 'Mobile active panels must avoid expensive transition work');
assert.match(workflow, /node tools\/interface-followup-check\.mjs/, 'CI must run the interface follow-up regression check');

console.log('Interface follow-up regression checks passed.');
