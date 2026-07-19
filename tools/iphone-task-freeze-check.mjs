import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const mobileScript = read('assets/js/mobile-tasks-performance.js');
const mobileStyles = read('assets/css/mobile-tasks-performance.css');
const viewportLayerSources = [
  'assets/js/app.js',
  'assets/js/push-legacy.js',
  'assets/js/interface-redesign.js',
  'assets/js/interface-v3.js',
  'assets/js/tasks-hotfix.js',
  'assets/js/interface-followup.js',
  'assets/js/mobile-tasks-performance.js',
  'assets/js/mobile-active-panel.js',
].map(read).join('\n');

assert.doesNotMatch(viewportLayerSources, /visualViewport/, 'Static scan: task layers must not attach keyboard-driven visualViewport work');
assert.match(mobileScript, /window\.addEventListener\('resize', syncTaskModeClass/, 'Resize must only synchronize a body class');
assert.match(mobileScript, /const MOBILE_TASK_QUERY = '\(max-width: 920px\), \(pointer: coarse\)'/, 'JS must use the mobile task CSS media query');
assert.match(mobileStyles, /@media \(max-width:920px\), \(pointer:coarse\)\{[\s\S]*?\.task-modal\{/, 'CSS page mode must use the mobile task JS media query');
assert.match(mobileStyles, /\.task-modal\{\s*position:static!important/, 'The narrow task form must stay in document flow');
assert.match(mobileStyles, /\.task-modal \.task-form-card\{[\s\S]*?height:auto!important/, 'The task form must use content height');
assert.doesNotMatch(mobileStyles, /100dvh/, 'The task form must not track every dynamic viewport height change');
assert.doesNotMatch(mobileStyles, /position:absolute!important/, 'The task form must not create an absolute nested scroller');

const windowListeners = new Map();
const documentListeners = new Map();
const classNames = new Set();
const makeClassList = (names) => ({
  add: (...values) => values.forEach((value) => names.add(value)),
  remove: (...values) => values.forEach((value) => names.delete(value)),
  contains: (value) => names.has(value),
  toggle: (name, force) => {
    const enabled = force === undefined ? !names.has(name) : Boolean(force);
    if(enabled) names.add(name);
    else names.delete(name);
    return enabled;
  },
});
const bodyClassList = makeClassList(classNames);
const modalClassNames = new Set();
const modal = {
  parentElement:null,
  dataset:{},
  classList:makeClassList(modalClassNames),
  setAttribute() {},
  querySelector:(selector) => selector === 'select[name="assigneeLogin"]' ? { options:[{}, {}] } : null,
};
const taskPanel = {
  appendChild:(node) => { node.parentElement = taskPanel; },
};
const body = {
  classList:bodyClassList,
  appendChild:(node) => { node.parentElement = body; },
};
taskPanel.appendChild(modal);
let viewportWidth = 390;
let coarsePointer = false;
const mobileTaskMedia = {
  get matches(){ return viewportWidth <= 920 || coarsePointer; },
  addEventListener() {},
};
const sandbox = {
  console,
  queueMicrotask: (callback) => callback(),
  setTimeout,
  performance,
  state:{ activeTop:'tasks', taskAssignees:[] },
  activeTasks:() => [],
  renderTaskItem:() => '',
  renderTasksList:() => '',
  refreshTasks:() => {},
  renderApp:() => {},
  setTop:() => {},
  loadTasks:() => {},
  loadTaskAssignees:() => Promise.resolve(),
  openTaskModal:() => {},
  closeTaskModal:() => {},
  document:{
    body,
    documentElement:{ dataset:{} },
    querySelector:(selector) => {
      if(selector === '#tasks-list') return null;
      if(selector === '#top-tasks') return taskPanel;
      if(selector === '#task-modal') return modal;
      if(selector === '#task-modal.open') return modalClassNames.has('open') ? modal : null;
      return null;
    },
    querySelectorAll:(selector) => selector === '#task-modal' ? [modal] : [],
    addEventListener:(type, callback) => documentListeners.set(type, callback),
  },
  matchMedia:(query) => query === '(max-width: 920px), (pointer: coarse)'
    ? mobileTaskMedia
    : { matches:false, addEventListener() {} },
  addEventListener:(type, callback) => {
    const callbacks = windowListeners.get(type) || [];
    callbacks.push(callback);
    windowListeners.set(type, callbacks);
  },
};
sandbox.window = sandbox;
vm.runInNewContext(mobileScript, sandbox, { filename:'assets/js/mobile-tasks-performance.js' });

sandbox.openTaskModal();
assert.equal(modal.parentElement, taskPanel, 'Narrow screens must keep the form inside the tasks page');
assert.equal(classNames.has('task-form-panel-open'), true, 'Narrow screens must enable ordinary page mode');
assert.equal(classNames.has('task-modal-open'), false, 'Narrow screens must not lock body scrolling');
sandbox.closeTaskModal();

viewportWidth = 1024;
coarsePointer = true;
sandbox.openTaskModal();
assert.equal(modal.parentElement, taskPanel, 'Wide coarse-pointer devices must keep the form inside the tasks page');
assert.equal(classNames.has('task-form-panel-open'), true, 'Wide coarse-pointer devices must enable ordinary page mode');
assert.equal(classNames.has('task-modal-open'), false, 'Wide coarse-pointer devices must not enable desktop body lock');
sandbox.closeTaskModal();

viewportWidth = 1280;
coarsePointer = false;
sandbox.openTaskModal();
assert.equal(modal.parentElement, body, 'Desktop must keep the existing body portal');
assert.equal(classNames.has('task-modal-open'), true, 'Desktop must keep the modal body lock');
assert.equal(classNames.has('task-form-panel-open'), false, 'Desktop must not use mobile page mode');
sandbox.closeTaskModal();

const names = ['renderApp', 'setTop', 'refreshTasks', 'loadTasks', 'loadTaskAssignees'];
const mobileLayerCalls = Object.fromEntries(names.map((name) => [name, 0]));
for(const name of names){
  sandbox[name] = () => { mobileLayerCalls[name] += 1; };
}
for(let index = 0; index < 50; index += 1){
  for(const callback of windowListeners.get('resize') || []) callback();
}

assert.deepEqual(mobileLayerCalls, {
  renderApp:0,
  setTop:0,
  refreshTasks:0,
  loadTasks:0,
  loadTaskAssignees:0,
}, 'The final mobile layer resize handler must not render or reload tasks');

console.log('iPhone task freeze regression checks passed.');
console.log(`Final mobile layer calls after 50 resize events: ${JSON.stringify(mobileLayerCalls)}`);
