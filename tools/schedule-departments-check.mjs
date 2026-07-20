import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync('assets/js/schedule-departments.js', 'utf8');
const styles = readFileSync('assets/css/schedule-departments.css', 'utf8');
const loader = readFileSync('assets/js/push.js', 'utf8');
const index = readFileSync('index.html', 'utf8');
const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');

assert.match(loader, /schedule-departments\.css\?v=20260720-1/, 'Department schedule styles must load');
assert.match(loader, /schedule-manager\.js[\s\S]*schedule-departments\.js\?v=20260720-1[\s\S]*interface-followup\.js/, 'Department layer must load after schedule manager');
assert.match(index, /assets\/js\/push\.js\?v=20260720-2/, 'Updated loader must bypass the previous browser cache');
assert.match(workflow, /node tools\/schedule-departments-check\.mjs/, 'CI must run department schedule checks');
assert.match(source, /schedule-department-tabs/, 'Bar and hall tabs must be rendered');
assert.match(source, /schedule-mobile-agenda/, 'A dedicated phone agenda must be rendered');
assert.match(source, /hall:embedded/, 'The uploaded hall schedule must remain separated from Bar');
assert.match(styles, /@media \(max-width:760px\)[\s\S]*schedule-desktop-grid[\s\S]*display:none/, 'Phone mode must replace the wide calendar');
assert.match(styles, /schedule-mobile-day/, 'Phone day cards must have dedicated styling');

let role = 'waiter';
const state = { activeTop:'schedule', scheduleMonth:'2026-07', scheduleEvents:[
  { id:'bar-1', eventDate:'2026-07-01', type:'Смена', title:'Смена: Бариста', description:'09:00–21:00', source:'manual' },
  { id:'event-1', eventDate:'2026-07-02', type:'Собрание', title:'Общее собрание', description:'15:00' }
]};
const listeners = new Map();
const localStorageValues = new Map();
const sandbox = {
  console,
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
  renderSchedule:() => '<section id="top-schedule"></section>',
  renderScheduleGrid:() => '<div class="schedule-grid"></div>',
  SovremennikScheduleManager:{
    localDateKey:date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`,
    normalizeDateValue:value => String(value || '').slice(0,10),
    renderSchedule:() => '<section id="top-schedule"></section>',
    renderScheduleGrid:() => '<div class="schedule-grid"></div>'
  },
  document:{
    documentElement:{ dataset:{} },
    querySelector:() => null,
    createElement:() => ({})
  },
  localStorage:{
    getItem:key => localStorageValues.get(key) || null,
    setItem:(key,value) => localStorageValues.set(key,value)
  },
  addEventListener:(type,listener) => listeners.set(type,listener)
};
sandbox.window = sandbox;
vm.runInNewContext(source, sandbox, { filename:'assets/js/schedule-departments.js' });

const api = sandbox.SovremennikScheduleDepartments;
assert.equal(api.VERSION, '2026-07-20-schedule-departments-1');
assert.equal(api.hallEvents.length, 173, 'The uploaded July waiter schedule must be fully embedded');
assert.equal(api.hallEvents.filter(event => event.type === 'Отпуск').length, 14, 'The merged vacation range must cover July 1–14');
assert.equal(api.activeDepartment, 'hall', 'Waiters should open their own schedule first');
assert.equal(api.sourceDepartment(state.scheduleEvents[0]), 'bar', 'Existing shift records remain in Bar');
assert.equal(api.sourceDepartment(api.hallEvents[0]), 'hall', 'Uploaded waiter shifts belong to Hall');
assert.equal(api.allScheduleEvents().length, 175, 'Remote records and embedded waiter schedule must coexist');

api.setActiveDepartment('hall');
const hallRows = api.filteredScheduleEvents();
assert.ok(hallRows.some(event => event.title === 'Смена: Макс Баринов'));
assert.ok(hallRows.some(event => event.title === 'Общее собрание'), 'Shared non-shift events stay visible');
assert.ok(!hallRows.some(event => event.id === 'bar-1'));

api.setActiveDepartment('bar');
const barRows = api.filteredScheduleEvents();
assert.ok(barRows.some(event => event.id === 'bar-1'));
assert.ok(barRows.some(event => event.id === 'event-1'));
assert.ok(!barRows.some(event => String(event.id).startsWith('hall-embedded-')));

api.setActiveDepartment('hall');
const agenda = api.mobileAgendaMarkup();
assert.match(agenda, /schedule-mobile-day/);
assert.match(agenda, /Макс Баринов/);
assert.match(agenda, /Арина Каянова/);
assert.equal(listeners.has('click'), true);

console.log('Schedule department tabs, waiter data and mobile agenda checks passed.');
