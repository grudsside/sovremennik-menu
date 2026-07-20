import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync('assets/js/schedule-departments.js', 'utf8');
const styles = readFileSync('assets/css/schedule-departments.css', 'utf8');
const submitFix = readFileSync('assets/js/schedule-submit-fix.js', 'utf8');
const loader = readFileSync('assets/js/push.js', 'utf8');
const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');

assert.match(loader, /schedule-departments\.css\?v=20260720-2/, 'Updated department schedule styles must load');
assert.match(loader, /schedule-manager\.js[\s\S]*schedule-submit-fix\.js\?v=20260720-1[\s\S]*schedule-departments\.js\?v=20260720-2[\s\S]*interface-followup\.js/, 'Submit fix and department layer must load after schedule manager');
assert.match(workflow, /node tools\/schedule-departments-check\.mjs/, 'CI must run department schedule checks');

assert.match(submitFix, /fixedScheduleSubmit/, 'The schedule form listener must be replaced safely');
assert.match(submitFix, /\^\(\?:утренняя\|вечерняя\|целая\)/, 'Named shifts must be preserved during editing');
assert.match(submitFix, /activeDepartment === 'hall'/, 'New records must follow the selected department');
assert.match(source, /schedule-common-actions/, 'Edit and delete must use shared controls');
assert.match(source, /data-schedule-action-mode="edit"/, 'Shared edit mode must be available');
assert.match(source, /data-schedule-action-mode="delete"/, 'Shared delete mode must be available');
assert.match(source, /sourceForRecord/, 'Schedule additions must preserve the selected department');
assert.match(source, /hall:manual/, 'Hall additions and edits must be stored as Hall records');
assert.match(source, /HALL_MARKER_SOURCE/, 'Embedded Hall data must migrate to editable shared storage');
assert.match(source, /schedule-mobile-agenda/, 'A dedicated phone agenda must remain rendered');
assert.doesNotMatch(source, /type:vacation\s*\?\s*'Отпуск'/, 'Vacation rows must not be created');
assert.match(styles, /schedule-event--morning/, 'Morning shifts must have a dedicated color');
assert.match(styles, /schedule-event--evening/, 'Evening shifts must have a dedicated color');
assert.match(styles, /schedule-event--full/, 'Full shifts must have a dedicated color');
assert.match(styles, /schedule-event--senior/, 'Senior waiters must have a dedicated highlight');
assert.match(styles, /@media \(max-width:760px\)[\s\S]*schedule-desktop-grid[\s\S]*display:none/, 'Phone mode must replace the wide calendar');

let role = 'waiter';
const state = { activeTop:'schedule', scheduleMonth:'2026-07', scheduleEvents:[
  { id:'bar-1', eventDate:'2026-07-01', type:'Смена', title:'Смена: Бариста', description:'09:00–21:00', source:'bar:manual' },
  { id:'event-1', eventDate:'2026-07-02', type:'Собрание', title:'Общее собрание', description:'15:00', source:'manual' }
]};
const listeners = new Map();
const localStorageValues = new Map();
const queryResult = { data:[
  { id:'bar-1', event_date:'2026-07-01', event_type:'Смена', title:'Смена: Бариста', description:'09:00–21:00', source:'bar:manual' },
  { id:'event-1', event_date:'2026-07-02', event_type:'Собрание', title:'Общее собрание', description:'15:00', source:'manual' }
], error:null };
function chain(){
  return {
    select(){ return this; },
    order(){ return Promise.resolve(queryResult); },
    eq(){ return this; },
    limit(){ return Promise.resolve({data:[],error:null}); },
    upsert(){ return Promise.resolve({data:[],error:null}); },
    update(){ return this; },
    delete(){ return this; },
    insert(){ return this; },
    maybeSingle(){ return Promise.resolve({data:{id:'x'},error:null}); },
    single(){ return Promise.resolve({data:{id:'x'},error:null}); }
  };
}
const sandbox = {
  console:{ log(){}, warn(){}, error(){} },
  Date,
  Math,
  Promise,
  Set,
  Map,
  Object,
  String,
  Array,
  currentUser:() => ({ id:'waiter-1', name:'Официант', role }),
  normalizeRole:value => value,
  state,
  getScheduleEvents:() => state.scheduleEvents,
  loadScheduleEvents:async () => state.scheduleEvents,
  renderSchedule:() => '<section id="top-schedule"></section>',
  renderScheduleGrid:() => '<div class="schedule-grid"></div>',
  SovremennikScheduleManager:{
    localDateKey:date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`,
    normalizeDateValue:value => String(value || '').slice(0,10),
    renderSchedule:() => '<section id="top-schedule"></section>',
    renderScheduleGrid:() => '<div class="schedule-grid"></div>'
  },
  sovremennikSupabase:{ from:chain },
  document:{
    documentElement:{ dataset:{} },
    querySelector:() => null,
    createElement:() => ({})
  },
  localStorage:{
    getItem:key => localStorageValues.get(key) || null,
    setItem:(key,value) => localStorageValues.set(key,value)
  },
  addEventListener:(type,listener) => listeners.set(type,listener),
  requestAnimationFrame:callback => callback(),
  crypto:{ randomUUID:() => '00000000-0000-4000-8000-000000000001' }
};
sandbox.window = sandbox;
vm.runInNewContext(submitFix, sandbox, { filename:'assets/js/schedule-submit-fix.js' });
vm.runInNewContext(source, sandbox, { filename:'assets/js/schedule-departments.js' });
await new Promise(resolve => setTimeout(resolve,0));

const api = sandbox.SovremennikScheduleDepartments;
assert.equal(api.VERSION, '2026-07-20-schedule-departments-2');
assert.equal(api.hallEvents.length, 159, 'Vacation cells must be excluded from the July Hall schedule');
assert.equal(api.hallEvents.some(event => /отпуск/i.test(`${event.type} ${event.description}`)), false);
assert.equal(api.activeDepartment, 'hall', 'Waiters should open Hall first');
assert.equal(api.sourceDepartment(state.scheduleEvents[0]), 'bar');
assert.equal(api.sourceDepartment(api.hallEvents[0]), 'hall');
assert.equal(api.allScheduleEvents().length, 161, 'Remote records and the vacation-free Hall schedule must coexist before migration');

const maxFull = api.hallEvents.find(event => event.title === 'Смена: Макс Баринов' && event.description === 'Целая смена');
const maxMorning = api.hallEvents.find(event => event.title === 'Смена: Макс Баринов' && event.description === 'Утренняя смена');
const maxEvening = api.hallEvents.find(event => event.title === 'Смена: Макс Баринов' && event.description === 'Вечерняя смена');
assert.equal(api.shiftKind(maxFull), 'full');
assert.equal(api.shiftKind(maxMorning), 'morning');
assert.equal(api.shiftKind(maxEvening), 'evening');
const fixApi = sandbox.SovremennikScheduleSubmitFix;
assert.equal(fixApi.buildShiftDescription('','','Утренняя смена'), 'Утренняя смена', 'Editing a named morning shift must not turn it into a full shift');
assert.equal(fixApi.buildShiftDescription('','','Вечерняя смена · примечание'), 'Вечерняя смена · примечание');
assert.equal(api.isSeniorWaiter(maxFull), true);
assert.equal(api.isSeniorWaiter(api.hallEvents.find(event => event.title === 'Смена: Саша Жигалкина')), true);
assert.equal(api.isSeniorWaiter(api.hallEvents.find(event => event.title === 'Смена: Даша Яновская')), false);

api.setActiveDepartment('hall');
const hallRows = api.filteredScheduleEvents();
assert.ok(hallRows.some(event => event.title === 'Смена: Макс Баринов'));
assert.ok(hallRows.some(event => event.title === 'Общее собрание'), 'Legacy shared events stay visible');
assert.ok(!hallRows.some(event => event.id === 'bar-1'));
assert.ok(!hallRows.some(event => /отпуск/i.test(`${event.type} ${event.description}`)));

api.setActiveDepartment('bar');
const barRows = api.filteredScheduleEvents();
assert.ok(barRows.some(event => event.id === 'bar-1'));
assert.ok(barRows.some(event => event.id === 'event-1'));
assert.ok(!barRows.some(event => String(event.source).startsWith('hall:')));

api.setActiveDepartment('hall');
const agenda = api.mobileAgendaMarkup();
assert.match(agenda, /schedule-mobile-day/);
assert.match(agenda, /data-schedule-event-id=/);
assert.match(agenda, /schedule-mobile-event--senior/);
assert.match(agenda, /Макс Баринов/);
assert.doesNotMatch(agenda, /Отпуск/i);
assert.equal(listeners.has('click'), true);
assert.equal(listeners.has('submit'), true);

console.log('Schedule shared controls, Hall editing, shift colors and vacation filtering checks passed.');
