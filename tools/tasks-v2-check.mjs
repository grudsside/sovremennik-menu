import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const rootPath = process.cwd();
const read = path => readFileSync(resolve(rootPath, path), 'utf8');
const source = read('assets/js/tasks-v2.js');
const styles = read('assets/css/tasks-v2.css');
const loader = read('assets/js/push.js');
const interfaceV3 = read('assets/js/interface-v3.js');
const followup = read('assets/js/interface-followup.js');
const followupStyles = read('assets/css/interface-followup.css');
const activePanel = read('assets/js/mobile-active-panel.js');
const activePanelStyles = read('assets/css/mobile-active-panel.css');

let documentTouches = 0;
let fullAppRenderCalls = 0;
const documentProbe = new Proxy({}, {
  get(){
    documentTouches += 1;
    return undefined;
  }
});
const globalListeners = new Map();
const sandbox = {
  console,
  Date,
  Map,
  Set,
  Promise,
  document:documentProbe,
  crypto:{ randomUUID:() => '00000000-0000-4000-8000-000000000099' },
  confirm:() => true,
  requestAnimationFrame:callback => callback(),
  renderApp:() => { fullAppRenderCalls += 1; },
  addEventListener:(type, listener) => {
    const listeners = globalListeners.get(type) || [];
    listeners.push(listener);
    globalListeners.set(type, listeners);
  }
};
sandbox.window = sandbox;
vm.runInNewContext(source, sandbox, { filename:'assets/js/tasks-v2.js' });

assert.equal(documentTouches, 0, 'Importing tasks v2 must not touch the DOM before the section opens');
assert.equal(globalListeners.size, 0, 'Tasks v2 must not register global listeners');
assert.equal(typeof sandbox.SovremennikTasksV2?.createModule, 'function', 'Tasks v2 must expose one namespaced module');
assert.equal(sandbox.SovremennikTasksV2.MOBILE_QUERY, '(max-width: 920px), (pointer: coarse)', 'JS must expose the agreed mobile query');
assert.equal(sandbox.SovremennikTasksV2.PAGE_SIZE, 24, 'The DOM batch must stay within the requested 20–30 cards');

const permissionTask = { creatorId:'manager-1', assigneeId:'barista-1' };
assert.equal(sandbox.SovremennikTasksV2.canCompleteTask(permissionTask, { id:'barista-1', role:'barista' }), true, 'An assignee must be able to complete a task');
assert.equal(sandbox.SovremennikTasksV2.canCompleteTask(permissionTask, { id:'manager-1', role:'manager' }), true, 'A manager creator must be able to complete a task');
assert.equal(sandbox.SovremennikTasksV2.canCompleteTask(permissionTask, { id:'other-1', role:'manager' }), false, 'An unrelated manager must not get a completion action');
assert.equal(sandbox.SovremennikTasksV2.canCompleteTask(permissionTask, { id:'manager-1', role:'barista' }), false, 'A non-manager creator must not get a completion action');
assert.equal(sandbox.SovremennikTasksV2.canCompleteTask(permissionTask, { id:'admin-1', role:'admin' }), true, 'An admin must be able to complete a task');
assert.equal(sandbox.SovremennikTasksV2.canDeleteTask({ id:'admin-1', role:'admin' }), true, 'An admin must get the delete action');
assert.equal(sandbox.SovremennikTasksV2.canDeleteTask({ id:'manager-1', role:'manager' }), false, 'A manager must not get the delete action');

class FakeRoot {
  constructor(){
    this.className = '';
    this.innerHTML = '';
    this.listeners = new Map();
    this.formScrolls = [];
    this.titleFocuses = [];
    this.titleInput = {
      focus:options => this.titleFocuses.push(options)
    };
    this.formElement = {
      scrollIntoView:options => this.formScrolls.push(options),
      querySelector:selector => selector === 'input[name="title"]' ? this.titleInput : null
    };
  }

  addEventListener(type, listener){
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener){
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter(item => item !== listener));
  }

  contains(node){
    return Boolean(node);
  }

  querySelector(selector){
    if(selector === '.tasks-v2__form' && this.innerHTML.includes('class="tasks-v2__form"')){
      return this.formElement;
    }
    return null;
  }

  async emit(type, target){
    const event = { target, preventDefault(){} };
    await Promise.all((this.listeners.get(type) || []).map(listener => listener(event)));
  }
}

const action = (name, taskId = '') => {
  const node = {
    dataset:{ tasksV2Action:name, taskId },
    closest:selector => selector === '[data-tasks-v2-action]' ? node : null
  };
  return node;
};

const counters = {
  listTasks:0,
  listAssignees:0,
  createTask:0,
  completeTask:0,
  deleteTask:0
};
const initialTask = {
  id:'task-1',
  title:'Проверить витрину',
  description:'До открытия',
  creator_id:'admin-1',
  assignee_id:'employee-1',
  is_vip:true,
  due_at:'2030-01-01T08:00:00.000Z',
  status:'open',
  created_at:'2026-07-19T08:00:00.000Z'
};
const dataLayer = {
  async listTasks(){
    counters.listTasks += 1;
    return [initialTask];
  },
  async listAssignees(){
    counters.listAssignees += 1;
    return [
      { id:'admin-1', name:'Анна', role:'admin' },
      { id:'employee-1', name:'Борис', role:'barista' }
    ];
  },
  async createTask(input, user){
    counters.createTask += 1;
    await Promise.resolve();
    return {
      id:'task-2',
      title:input.title,
      description:input.description,
      creator_id:user.id,
      assignee_id:input.assigneeId,
      is_vip:input.isVip,
      due_at:input.dueAt || null,
      status:'open',
      created_at:'2026-07-19T09:00:00.000Z'
    };
  },
  async completeTask(){
    counters.completeTask += 1;
    await Promise.resolve();
    return { id:'task-1', status:'done' };
  },
  async deleteTask(){
    counters.deleteTask += 1;
    await Promise.resolve();
    return { id:'task-2' };
  }
};
const user = { id:'admin-1', name:'Анна', role:'admin' };
const module = sandbox.SovremennikTasksV2.createModule({
  dataLayer,
  getCurrentUser:() => user,
  maintenanceEnabled:() => false,
  confirm:() => true
});
const root = new FakeRoot();

await module.activate(root);
assert.equal(counters.listTasks, 1, 'Opening the section must issue exactly one task-list request');
assert.equal(counters.listAssignees, 1, 'The assignee list must be requested once');
assert.equal(root.listeners.get('click')?.length, 1, 'The module must bind one root click listener');
assert.equal(root.listeners.get('submit')?.length, 1, 'The module must bind one root submit listener');

const listenerAddsBeforeFormCycles = module.getInstrumentation().listenerAdds;
const fullAppRendersBeforeFormCycles = fullAppRenderCalls;
for(let cycle = 0; cycle < 20; cycle += 1){
  await root.emit('click', action('form-open'));
  assert.equal(module.getSnapshot().formOpen, true, `Form cycle ${cycle + 1}: form must open`);
  const formIndex = root.innerHTML.indexOf('class="tasks-v2__form"');
  const listIndex = root.innerHTML.indexOf('class="tasks-v2__list"');
  assert.ok(formIndex >= 0 && formIndex < listIndex, `Form cycle ${cycle + 1}: form markup must precede the task list`);
  await root.emit('click', action('form-close'));
  assert.equal(module.getSnapshot().formOpen, false, `Form cycle ${cycle + 1}: form must close`);
}
assert.equal(counters.listTasks, 1, 'Twenty form cycles must not reload tasks');
assert.equal(counters.listAssignees, 1, 'Twenty form cycles must not replace or reload assignees');
assert.equal(root.listeners.get('click')?.length, 1, 'Twenty form cycles must not duplicate click listeners');
assert.equal(root.listeners.get('submit')?.length, 1, 'Twenty form cycles must not duplicate submit listeners');
assert.equal(module.getInstrumentation().listenerAdds, listenerAddsBeforeFormCycles, 'Opening the form must not add root listeners');
assert.equal(fullAppRenderCalls, fullAppRendersBeforeFormCycles, 'Opening the form must not invoke the full-app render');
assert.equal(root.formScrolls.length, 20, 'Each form opening must reveal the inline form once');
assert.equal(root.formScrolls[0]?.block, 'start', 'The form must align its start edge when revealed');
assert.equal(root.formScrolls[0]?.behavior, 'smooth', 'The form reveal must use smooth scrolling');
assert.equal(root.titleFocuses.length, 20, 'Each form opening must focus the title field once');
assert.equal(root.titleFocuses[0]?.preventScroll, true, 'Title focus must not cause a second page jump');

await root.emit('click', action('form-open'));
const textField = { value:'Подготовить зал' };
const formStatus = { textContent:'', classList:{ toggle(){} } };
const submitButton = { disabled:false, textContent:'Поставить задачу' };
const fields = {
  title:textField,
  description:{ value:'До прихода гостей' },
  assigneeId:{ value:'employee-1' },
  dueAt:{ value:'2030-01-02T09:30' },
  isVip:{ checked:false }
};
const form = {
  elements:{ namedItem:name => fields[name] },
  matches:selector => selector === '[data-tasks-v2-form]',
  querySelector:selector => {
    if(selector === 'button[type="submit"]') return submitButton;
    if(selector === '[data-tasks-v2-form-status]') return formStatus;
    return null;
  }
};
const firstCreate = root.emit('submit', form);
const duplicateCreate = root.emit('submit', form);
await Promise.all([firstCreate, duplicateCreate]);
assert.equal(counters.createTask, 1, 'A double submit must create only one task');
assert.equal(module.getSnapshot().tasks.length, 2, 'A created task must be inserted locally without a list reload');
assert.equal(counters.listTasks, 1, 'Creating a task must not reload the whole list');

await Promise.all([
  root.emit('click', action('complete', 'task-1')),
  root.emit('click', action('complete', 'task-1'))
]);
assert.equal(counters.completeTask, 1, 'A repeated completion click must issue one update');
assert.equal(module.getSnapshot().tasks.some(task => task.id === 'task-1'), false, 'Completed task must be removed locally');
assert.equal(counters.listTasks, 1, 'Completing a task must not reload the whole list');

await Promise.all([
  root.emit('click', action('delete', 'task-2')),
  root.emit('click', action('delete', 'task-2'))
]);
assert.equal(counters.deleteTask, 1, 'A repeated delete click must issue one delete');
assert.equal(module.getSnapshot().tasks.length, 0, 'Deleted task must be removed locally');
assert.equal(counters.listTasks, 1, 'Deleting a task must not reload the whole list');

module.deactivate();
assert.equal(root.listeners.get('click')?.length, 0, 'Leaving the section must remove the root click listener');
assert.equal(root.listeners.get('submit')?.length, 0, 'Leaving the section must remove the root submit listener');
assert.equal(root.innerHTML, '', 'Leaving the section must clear the module DOM');
assert.equal(module.getInstrumentation().listenerBalance, 0, 'Listener balance must return to zero after leaving');

for(let entry = 0; entry < 10; entry += 1){
  await module.activate(root);
  module.deactivate();
}
assert.equal(counters.listTasks, 11, 'Each of eleven section entries must make one task-list request');
assert.equal(counters.listAssignees, 1, 'Assignees must remain cached across section entries for the session');
assert.equal(module.getInstrumentation().listenerBalance, 0, 'Repeated entries must not leak root listeners');

let releaseCompletion;
const raceRoot = new FakeRoot();
const raceModule = sandbox.SovremennikTasksV2.createModule({
  dataLayer:{
    listTasks:async () => [initialTask],
    listAssignees:async () => [{ id:'employee-1', name:'Борис', role:'barista' }],
    completeTask:() => new Promise(resolve => { releaseCompletion = resolve; })
  },
  getCurrentUser:() => user,
  maintenanceEnabled:() => false,
  confirm:() => true
});
await raceModule.activate(raceRoot);
const staleCompletion = raceRoot.emit('click', action('complete', 'task-1'));
raceModule.deactivate();
await raceModule.activate(raceRoot);
releaseCompletion({ id:'task-1', status:'done' });
await staleCompletion;
assert.equal(raceModule.getSnapshot().tasks.length, 1, 'A response from a previous entry must not mutate the new section instance');
raceModule.deactivate();
assert.equal(raceModule.getInstrumentation().listenerBalance, 0, 'An in-flight action must not leak listeners after navigation');

const stressRows = Array.from({ length:480 }, (_, index) => ({
  id:`stress-${index}`,
  title:`Задача ${index + 1}`,
  description:`Описание ${index + 1}`,
  creator_id:'admin-1',
  assignee_id:'employee-1',
  is_vip:index % 17 === 0,
  status:'open',
  created_at:new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
}));
let stressRequests = 0;
const stressRoot = new FakeRoot();
const stressModule = sandbox.SovremennikTasksV2.createModule({
  dataLayer:{
    listTasks:async () => { stressRequests += 1; return stressRows; },
    listAssignees:async () => [{ id:'employee-1', name:'Борис', role:'barista' }]
  },
  getCurrentUser:() => user,
  maintenanceEnabled:() => false,
  confirm:() => true
});
const renderedCardCount = () => (stressRoot.innerHTML.match(/data-tasks-v2-card/g) || []).length;
await stressModule.activate(stressRoot);
assert.equal(stressModule.getSnapshot().tasks.length, 480, 'The stress fixture must contain 480 RLS-visible tasks');
assert.equal(renderedCardCount(), 24, 'Only the first 24 task cards may enter the DOM');
assert.match(stressRoot.innerHTML, /Показать ещё · 24/, 'A bounded list must expose the next batch action');
const firstStressId = stressModule.getSnapshot().tasks[0].id;
for(let cycle = 0; cycle < 100; cycle += 1){
  await stressRoot.emit('click', action('toggle', firstStressId));
  await stressRoot.emit('click', action('toggle', firstStressId));
}
await stressRoot.emit('click', action('toggle', firstStressId));
assert.match(stressRoot.innerHTML, new RegExp(`data-task-id="${firstStressId}" aria-expanded="true"`), 'A card must still expand after 200 repeated toggles');
assert.equal(renderedCardCount(), 24, 'Repeated expansion must not grow the DOM batch');
await stressRoot.emit('click', action('show-more'));
assert.equal(renderedCardCount(), 48, 'Show more must add exactly one 24-card batch');
assert.equal(stressModule.getSnapshot().visibleCount, 48, 'Visible count must track the second batch');
assert.equal(stressRequests, 1, 'Expansion and show-more actions must not repeat the task request');
assert.equal(stressRoot.listeners.get('click')?.length, 1, 'Stress interactions must keep one root click listener');
stressModule.deactivate();
assert.equal(stressModule.getInstrumentation().listenerBalance, 0, 'The 480-task stress run must clean up its listeners');

const maintenanceCounters = { tasks:0, assignees:0 };
const maintenanceRoot = new FakeRoot();
const maintenanceModule = sandbox.SovremennikTasksV2.createModule({
  dataLayer:{
    listTasks:async () => { maintenanceCounters.tasks += 1; return []; },
    listAssignees:async () => { maintenanceCounters.assignees += 1; return []; }
  },
  maintenanceEnabled:() => true
});
await maintenanceModule.activate(maintenanceRoot);
assert.deepEqual(maintenanceCounters, { tasks:0, assignees:0 }, 'Maintenance mode must prevent all task data requests');
assert.equal(maintenanceRoot.listeners.size, 0, 'Maintenance mode must not bind the module');

assert.doesNotMatch(source, /MutationObserver|visualViewport/, 'Tasks v2 must not observe global DOM or viewport state');
assert.doesNotMatch(source, /(?:document|window)\.addEventListener/, 'Tasks v2 must keep events on its root');
assert.doesNotMatch(source, /renderApp\s*=|setTop\s*=|refreshTasks\s*=|openTaskModal\s*=/, 'Tasks v2 must not wrap legacy globals');
assert.match(styles, /@media \(max-width: 920px\), \(pointer: coarse\)/, 'CSS must use the same mobile query as JS');
assert.match(styles, /\.tasks-v2__form\{[\s\S]*?position:static;[\s\S]*?height:auto;[\s\S]*?overflow:visible;/, 'The form must stay in ordinary page flow');
assert.doesNotMatch(styles, /100(?:d)?vh|position:\s*fixed|body[^\n{]*scroll[^\n{]*lock/i, 'The task form must not use viewport sizing, fixed positioning or body scroll lock');
assert.doesNotMatch(source, /task-modal|openTaskModal|closeTaskModal/, 'Tasks v2 must not introduce a modal form workflow');

assert.match(loader, /SOVREMENNIK_TASKS_MAINTENANCE = true;[\s\S]*tasks-v2\.js/, 'Maintenance must be enabled before tasks v2 loads');
assert.match(loader, /tasks-v2\.js[\s\S]*interface-v3\.js/, 'Tasks v2 must load before its interface lifecycle adapter');
assert.doesNotMatch(loader, /tasks-hotfix\.js|mobile-tasks-performance\.(?:js|css)/, 'Old task override layers must stay disabled');
assert.match(loader, /mobile-active-panel\.js[\s\S]*tasks-maintenance\.js/, 'Maintenance must remain the last script');
assert.match(interfaceV3, /tasksV2\(\)\?\.activate/, 'Interface v3 must activate the module only for its panel');
assert.match(interfaceV3, /tasksV2\(\)\?\.deactivate/, 'Interface v3 must deactivate the module on navigation and full renders');
assert.doesNotMatch(interfaceV3, /renderTasksList|renderTaskModal|loadTaskAssignees|refreshTasks/, 'Interface v3 must not use the legacy task workflow');
assert.doesNotMatch(followup, /task-modal|data-task-|loadTasks|refreshTasks|openTaskModal|closeTaskModal/, 'Follow-up must not intercept task behavior');
assert.doesNotMatch(followupStyles, /task-modal|task-form|task-details|#top-tasks/, 'Follow-up CSS must not style the old task implementation');
assert.doesNotMatch(activePanel, /task-modal|task-form-panel-open/, 'The mobile panel layer must not own task-form cleanup');
assert.doesNotMatch(activePanelStyles, /mobile-task|task-modal|#top-tasks/, 'The mobile panel CSS must not style old task layers');

const wideCoarseDevice = { width:1024, pointer:'coarse' };
const mobileQueryMatches = device => device.width <= 920 || device.pointer === 'coarse';
assert.equal(mobileQueryMatches(wideCoarseDevice), true, 'A device wider than 920px with a coarse pointer must use the mobile form rules');

console.log('Tasks v2 isolation, lifecycle and mocked CRUD checks passed.');
console.log(`Instrumentation: ${JSON.stringify(module.getInstrumentation())}`);
