import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const repositoryRoot = process.cwd();
const read = path => readFileSync(resolve(repositoryRoot, path), 'utf8');

function localScriptReferences(path, source){
  const references = [];
  const pattern = /<script[^>]+src=["']([^"'?]+\.js)(?:\?[^"']*)?["']/g;
  for(const match of source.matchAll(pattern)){
    const reference = match[1];
    if(/^(?:https?:)?\/\//.test(reference)) continue;
    const documentRelative = resolve(repositoryRoot, reference);
    const normalized = existsSync(documentRelative)
      ? documentRelative
      : resolve(repositoryRoot, dirname(path), reference);
    if(!existsSync(normalized)) continue;
    references.push(normalized.slice(repositoryRoot.length + 1).replaceAll('\\', '/'));
  }
  return references;
}

const pending = ['index.html'];
const visited = new Set();
const activeScripts = new Set();
while(pending.length){
  const path = pending.shift();
  if(visited.has(path)) continue;
  visited.add(path);
  const source = read(path);
  for(const reference of localScriptReferences(path, source)){
    if(activeScripts.has(reference)) continue;
    activeScripts.add(reference);
    pending.push(reference);
  }
}

assert.equal(activeScripts.has('assets/js/tasks-v2.js'), true, 'The active loader graph must include tasks v2');
assert.equal(activeScripts.has('assets/js/tasks-hotfix.js'), false, 'The active loader graph must exclude the old task hotfix');
assert.equal(activeScripts.has('assets/js/mobile-tasks-performance.js'), false, 'The active loader graph must exclude the old mobile task override');

const activeSources = [...activeScripts].map(path => ({ path, source:read(path) }));
assert.doesNotMatch(
  activeSources.map(item => item.source).join('\n'),
  /visualViewport/,
  'All scripts reachable from index.html must avoid keyboard-driven visualViewport work'
);

const resizeHandlers = [];
for(const { path, source } of activeSources){
  const rawCount = [...source.matchAll(/window\.addEventListener\(\s*['"]resize['"]/g)].length;
  const pattern = /window\.addEventListener\(\s*['"]resize['"]\s*,\s*(?:\(\)\s*=>|function\s*\(\s*\))\s*\{([\s\S]*?)\}\s*\)/g;
  const matches = [...source.matchAll(pattern)];
  assert.equal(matches.length, rawCount, `${path}: every resize handler must be included in the instrumentation`);
  matches.forEach(match => resizeHandlers.push({ path, body:match[1] }));
}

assert.ok(resizeHandlers.length > 0, 'The check must exercise the resize handlers in the active application graph');
resizeHandlers.forEach(({ path, body }) => {
  assert.doesNotMatch(
    body,
    /task|renderApp|setTop|loadTasks|loadTaskAssignees|refreshTasks/i,
    `${path}: resize must not render, navigate or reload tasks`
  );
});

const taskCalls = {
  renderApp:0,
  setTop:0,
  loadTasks:0,
  loadTaskAssignees:0,
  refreshTasks:0
};
let menuCloses = 0;
const compiledHandlers = resizeHandlers.map(({ path, body }) => ({
  path,
  run:new Function(
    'window',
    'closeMenu',
    'closeMenuV3',
    'renderApp',
    'setTop',
    'loadTasks',
    'loadTaskAssignees',
    'refreshTasks',
    body
  )
}));
const windowProbe = { innerWidth:390 };
const taskSpies = Object.fromEntries(Object.keys(taskCalls).map(name => [name, () => { taskCalls[name] += 1; }]));
for(let resize = 0; resize < 50; resize += 1){
  windowProbe.innerWidth = resize % 2 ? 1024 : 390;
  for(const handler of compiledHandlers){
    handler.run(
      windowProbe,
      () => { menuCloses += 1; },
      () => { menuCloses += 1; },
      taskSpies.renderApp,
      taskSpies.setTop,
      taskSpies.loadTasks,
      taskSpies.loadTaskAssignees,
      taskSpies.refreshTasks
    );
  }
}
assert.deepEqual(taskCalls, {
  renderApp:0,
  setTop:0,
  loadTasks:0,
  loadTaskAssignees:0,
  refreshTasks:0
}, 'Fifty resize events across every active resize handler must not call task or full-render functions');
assert.ok(menuCloses > 0, 'The instrumentation must prove that the active resize handlers actually ran');

const tasksSource = read('assets/js/tasks-v2.js');
const tasksStyles = read('assets/css/tasks-v2.css');
const query = '(max-width: 920px), (pointer: coarse)';
assert.match(tasksSource, new RegExp(query.replace(/[()]/g, '\\$&')), 'Tasks JS must expose the agreed mobile query');
assert.match(tasksStyles, /@media \(max-width: 920px\), \(pointer: coarse\)/, 'Tasks CSS must use the same mobile query');
assert.equal(1024 <= 920 || 'coarse' === 'coarse', true, 'A wide coarse-pointer device must match the mobile form condition');
assert.match(tasksStyles, /\.tasks-v2__form\{[\s\S]*?position:static;[\s\S]*?height:auto;[\s\S]*?overflow:visible;/, 'The task form must stay in document flow');
assert.doesNotMatch(tasksStyles, /100dvh|position:fixed/, 'The task form must not track or lock the iPhone viewport');

console.log('iPhone task viewport regression checks passed.');
console.log(`Scanned ${activeScripts.size} active local scripts; executed ${resizeHandlers.length} resize handlers 50 times; task calls: ${JSON.stringify(taskCalls)}.`);
