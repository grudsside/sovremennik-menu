import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [script, styles, greetingScript, activePanelScript, activePanelStyles, loader, workflow] = await Promise.all([
  read('assets/js/interface-followup.js'),
  read('assets/css/interface-followup.css'),
  read('assets/js/greeting-name.js'),
  read('assets/js/mobile-active-panel.js'),
  read('assets/css/mobile-active-panel.css'),
  read('assets/js/push.js'),
  read('.github/workflows/ci.yml')
]);

assert.match(loader, /interface-followup\.css\?v=20260719-1/, 'Follow-up CSS must load after the interface bundles');
assert.match(loader, /interface-followup\.js\?v=20260720-1/, 'Updated follow-up JS must use the release cache-bust');
assert.match(loader, /mobile-active-panel\.css\?v=20260719-2/, 'Mobile active-panel CSS must remain loaded');
assert.match(loader, /mobile-active-panel\.js\?v=20260720-1/, 'Updated mobile active-panel JS must use the release cache-bust');
assert.match(loader, /interface-v3\.js[\s\S]*greeting-name\.js\?v=20260720-1[\s\S]*interface-followup\.js/, 'The greeting fix must load after interface v3 and before follow-up rendering');
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
assert.match(workflow, /node tools\/tasks-v2-integration-check\.mjs/, 'CI must run the push-route and external-render integration check');

const visibleGreeting = { textContent:'' };
const greetingSandbox = {
  currentUser:() => ({ name:'Амелина Ольга Дмитриевна' }),
  renderHome:() => '<section><p>Амелина, здесь собраны актуальные задачи, расписание, чек-листы, методические материалы и рабочие документы.</p></section>',
  document:{
    querySelector:selector => selector === '.v3-welcome-copy > p:not(.section-kicker)' ? visibleGreeting : null
  }
};
greetingSandbox.window = greetingSandbox;
vm.runInNewContext(greetingScript, greetingSandbox, { filename:'assets/js/greeting-name.js' });

assert.equal(greetingSandbox.SovremennikProfileName.givenName('Амелина Ольга Дмитриевна'), 'Ольга', 'Surname-first full names must show the given name');
assert.equal(greetingSandbox.SovremennikProfileName.givenName('Анна'), 'Анна', 'Single given names must remain unchanged');
assert.equal(greetingSandbox.SovremennikProfileName.givenName(''), 'сотрудник', 'An empty profile name must keep a neutral fallback');
assert.match(greetingSandbox.renderHome(), /<p>Ольга, здесь собраны/, 'Future home renders must use the given name');
assert.match(visibleGreeting.textContent, /^Ольга, здесь собраны/, 'The already visible greeting must update immediately');

console.log('Interface follow-up regression checks passed.');
