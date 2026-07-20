import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const read = path => readFileSync(resolve(process.cwd(), path), 'utf8');

const workerListeners = new Map();
const openedWindows = [];
const workerSandbox = {
  URL,
  console,
  clients:{
    matchAll:async () => [],
    openWindow:async url => { openedWindows.push(url); return { url }; }
  },
  self:{
    registration:{ scope:'https://preview.example/sovremennik/' },
    clients:{ claim:async () => {} },
    skipWaiting(){},
    addEventListener:(type, listener) => workerListeners.set(type, listener)
  }
};
vm.runInNewContext(read('service-worker.js'), workerSandbox, { filename:'service-worker.js' });

let clickWork = null;
workerListeners.get('notificationclick')({
  notification:{ data:{ url:'./#tasks' }, close(){} },
  waitUntil:promise => { clickWork = promise; }
});
await clickWork;
assert.deepEqual(openedWindows, ['https://preview.example/sovremennik/#tasks'], 'Push click must preserve #tasks against the service-worker scope');

class FakeClassList {
  constructor(...values){ this.values = new Set(values); }
  add(...values){ values.forEach(value => this.values.add(value)); }
  remove(...values){ values.forEach(value => this.values.delete(value)); }
  contains(value){ return this.values.has(value); }
  toggle(value, force){
    const enabled = force === undefined ? !this.values.has(value) : Boolean(force);
    if(enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }
}

class FakeNode {
  constructor({ id = '', classes = [] } = {}){
    this.id = id;
    this.classList = new FakeClassList(...classes);
    this.dataset = {};
    this.listeners = new Map();
    this.children = [];
    this.className = classes.join(' ');
    this.textContent = '';
    this._innerHTML = '';
  }
  get innerHTML(){ return this._innerHTML; }
  set innerHTML(value){ this._innerHTML = String(value); }
  addEventListener(type, listener){
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener){
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter(item => item !== listener));
  }
  querySelector(){ return null; }
  querySelectorAll(){ return []; }
  setAttribute(name, value){ this[name] = String(value); }
  getAttribute(name){ return this[name] || ''; }
  contains(node){ return Boolean(node); }
  remove(){ this.removed = true; }
}

class FakeTaskRoot extends FakeNode {
  async emit(type, target){
    const event = { target, preventDefault(){} };
    await Promise.all((this.listeners.get(type) || []).map(listener => listener(event)));
  }
}

const action = name => {
  const node = {
    dataset:{ tasksV2Action:name, taskId:'' },
    closest:selector => selector === '[data-tasks-v2-action]' ? node : null
  };
  return node;
};

const brand = new FakeNode();
const kicker = new FakeNode();
const muted = new FakeNode();
const userPanel = new FakeNode();
const mainTabs = new FakeNode();
const page = new FakeNode();
const body = new FakeNode();
body.dataset = {};
let taskPanel = null;
let taskRoot = null;
let panelReplacements = 0;
const panels = new FakeNode({ id:'panels' });
Object.defineProperty(panels, 'innerHTML', {
  get(){ return this._innerHTML; },
  set(value){
    this._innerHTML = String(value);
    panelReplacements += 1;
    this.children = [];
    taskPanel = null;
    taskRoot = null;
    if(this._innerHTML.includes('id="top-tasks"')){
      taskRoot = new FakeTaskRoot();
      taskPanel = new FakeNode({ id:'top-tasks', classes:['top-panel', 'active'] });
      taskPanel.querySelector = selector => selector === '[data-tasks-v2-root]' ? taskRoot : null;
      this.children.push(taskPanel);
    }
  }
});
panels.insertAdjacentHTML = (_position, markup) => { panels.innerHTML = `${panels.innerHTML}${markup}`; };

const documentListeners = new Map();
const document = {
  title:'',
  body,
  documentElement:{ dataset:{} },
  querySelector(selector){
    if(selector === '.brand') return brand;
    if(selector === '.kicker') return kicker;
    if(selector === '.muted') return muted;
    if(selector === '#user-panel') return userPanel;
    if(selector === '.main-tabs') return mainTabs;
    if(selector === '#panels') return panels;
    if(selector === '.page') return page;
    if(selector === '#top-tasks') return taskPanel;
    if(selector === '[data-tasks-v2-root]') return taskRoot;
    return null;
  },
  querySelectorAll(selector){
    if(selector === '.top-panel') return panels.children;
    return [];
  },
  addEventListener(type, listener){ documentListeners.set(type, listener); },
  createElement(){ return new FakeNode(); }
};

const state = {
  menu:{
    site:{
      title:'Современник',
      subtitle:'Тест',
      description:'Интеграционный тест',
      mainTabs:[{ id:'home', title:'Главная' }],
      methodTabs:[]
    },
    checklists:[]
  },
  activeTop:'home',
  activeMethod:'bar',
  activeControl:'checklists',
  rolePermissions:{ admin:['home'] },
  rolePermissionsLoading:false,
  scheduleEvents:[]
};
let taskRequests = 0;
let assigneeRequests = 0;
let bindCalls = 0;

const sandbox = {
  console,
  Date,
  Map,
  Set,
  Promise,
  URL,
  document,
  state,
  location:new URL(openedWindows[0]),
  history:{ replaceState(){} },
  queueMicrotask:callback => callback(),
  requestAnimationFrame:callback => callback(),
  MutationObserver:class { observe(){} },
  addEventListener(){},
  scrollTo(){},
  SOVREMENNIK_TASKS_MAINTENANCE:false,
  ALL_SECTIONS:['home'],
  DEFAULT_ACCESS_BY_ROLE:{ admin:['home'] },
  ACCESS_BY_ROLE:{ admin:['home'] },
  isAuthenticated:() => true,
  showLogin(){ throw new Error('Login must not open for the restored test session'); },
  currentUser:() => ({ id:'admin-1', name:'Анна', role:'admin' }),
  roleLabel:() => 'Администратор',
  esc:value => String(value ?? ''),
  allMainTabs:() => state.menu.site.mainTabs,
  hasAccess:target => target === 'home',
  allowedMainTabs:() => sandbox.allMainTabs().filter(tab => sandbox.hasAccess(tab.id)),
  ensureAllowedTop(){
    const allowed = sandbox.allowedMainTabs().map(tab => tab.id);
    if(!allowed.includes(state.activeTop)) state.activeTop = allowed.includes('home') ? 'home' : allowed[0];
  },
  renderApp(){},
  setTop(){},
  renderHome:() => '',
  renderReportError:() => '',
  submitErrorReport(){},
  bindEvents(){ bindCalls += 1; },
  isAdmin:() => false,
  loadEmployees:async () => [],
  loadScheduleEvents:async () => [],
  loadControlRecords:async () => [],
  loadRevisionRecords:async () => [],
  loadErrorReports:async () => [],
  getScheduleEvents:() => [],
  normalizeDateKey:value => value,
  renderMethod:() => '',
  renderTheoryTopPanel:() => '',
  renderChecklists:() => '',
  renderRevisions:() => '',
  renderTechCards:() => '',
  renderSchedule:() => '',
  renderEmployees:() => '',
  renderControl:() => ''
};
sandbox.window = sandbox;
sandbox.loadRolePermissions = async function(){
  state.rolePermissions = { admin:['home', 'tasks'] };
  sandbox.renderApp();
  return state.rolePermissions;
};

vm.runInNewContext(read('assets/js/tasks-v2.js'), sandbox, { filename:'assets/js/tasks-v2.js' });
const baseTasksApi = sandbox.SovremennikTasksV2;
const taskModule = baseTasksApi.createModule({
  dataLayer:{
    listTasks:async () => {
      taskRequests += 1;
      return [{
        id:'task-1', title:'Проверить зал', description:'До открытия',
        creator_id:'admin-1', assignee_id:'admin-1', status:'open',
        created_at:'2026-07-19T10:00:00.000Z'
      }];
    },
    listAssignees:async () => {
      assigneeRequests += 1;
      return [{ id:'admin-1', name:'Анна', role:'admin' }];
    }
  },
  getCurrentUser:sandbox.currentUser,
  maintenanceEnabled:() => false,
  confirm:() => true
});
sandbox.SovremennikTasksV2 = {
  ...baseTasksApi,
  activate:root => taskModule.activate(root),
  deactivate:() => taskModule.deactivate(),
  refresh:() => taskModule.refresh(),
  ownsRoot:root => taskModule.ownsRoot(root),
  getActiveCount:() => taskModule.getActiveCount(),
  getInstrumentation:() => taskModule.getInstrumentation(),
  getSnapshot:() => taskModule.getSnapshot()
};

vm.runInNewContext(read('assets/js/interface-v3.js'), sandbox, { filename:'assets/js/interface-v3.js' });
await new Promise(resolve => setImmediate(resolve));

assert.equal(state.activeTop, 'tasks', 'Cold authenticated startup must apply the #tasks route added after app.js init');
assert.ok(taskRoot, 'Cold #tasks startup must create the isolated task root');
assert.equal(taskModule.ownsRoot(taskRoot), true, 'The created root must belong to the active tasks module');
assert.equal(taskRequests, 1, 'Cold #tasks startup must issue one task-list request');
assert.equal(assigneeRequests, 1, 'Cold #tasks startup must issue one session assignee request');

await taskRoot.emit('click', action('form-open'));
assert.equal(taskModule.getSnapshot().formOpen, true, 'The integration fixture must open the task form');
taskRoot.formDraft = { title:'Не потерять заполненный текст', description:'Черновик формы' };
const preservedRoot = taskRoot;
const preservedMarkup = taskRoot.innerHTML;
const replacementsBeforeExternalRender = panelReplacements;
const bindsBeforeExternalRender = bindCalls;

sandbox.renderApp();
assert.equal(taskRoot, preservedRoot, 'An external renderApp must preserve the active task-root identity');
assert.equal(taskRoot.innerHTML, preservedMarkup, 'An external renderApp must not rerender the open form');
assert.deepEqual(taskRoot.formDraft, { title:'Не потерять заполненный текст', description:'Черновик формы' }, 'An external renderApp must preserve typed form values');
assert.equal(panelReplacements, replacementsBeforeExternalRender, 'An external renderApp must not replace #panels while tasks own the root');
assert.equal(bindCalls, bindsBeforeExternalRender, 'The guarded render must not duplicate shell bindings');
assert.equal(taskRequests, 1, 'An external renderApp must not repeat the task-list request');

await sandbox.loadRolePermissions();
assert.equal(taskRoot, preservedRoot, 'loadRolePermissions completion must preserve the active task-root identity');
assert.equal(taskRoot.innerHTML, preservedMarkup, 'loadRolePermissions completion must preserve the open form DOM');
assert.deepEqual(taskRoot.formDraft, { title:'Не потерять заполненный текст', description:'Черновик формы' }, 'loadRolePermissions completion must preserve typed form values');
assert.equal(panelReplacements, replacementsBeforeExternalRender, 'loadRolePermissions completion must not replace #panels');
assert.equal(taskRequests, 1, 'loadRolePermissions completion must not repeat the task-list request');
assert.equal(taskModule.getSnapshot().formOpen, true, 'The module form state must remain open after both external renders');

console.log('Tasks v2 push-route and external-render integration checks passed.');
console.log(`Push URL: ${openedWindows[0]}; panel replacements: ${panelReplacements}; task requests: ${taskRequests}.`);
