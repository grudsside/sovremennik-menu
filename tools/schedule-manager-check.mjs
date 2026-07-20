import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [source, styles, loader, index, workflow] = await Promise.all([
  read('assets/js/schedule-manager.js'),
  read('assets/css/schedule-manager.css'),
  read('assets/js/push.js'),
  read('index.html'),
  read('.github/workflows/ci.yml')
]);

assert.match(loader, /schedule-manager\.css\?v=20260720-1/, 'Schedule manager styles must be connected');
assert.match(loader, /interface-v3\.js[\s\S]*greeting-name\.js[\s\S]*schedule-manager\.js\?v=20260720-1[\s\S]*interface-followup\.js/, 'Schedule manager must override the schedule after interface v3 and before follow-up wrappers');
assert.match(index, /assets\/js\/push\.js\?v=20260720-2/, 'The updated loader must bypass the previous browser cache');
assert.match(workflow, /node tools\/schedule-manager-check\.mjs/, 'CI must run schedule regressions');
assert.match(styles, /\.schedule-event-actions/, 'Edit and delete controls must have dedicated styling');
assert.match(styles, /\.schedule-import-table-wrap/, 'File import preview must remain usable on small screens');

const listeners = new Map();
let role = 'manager';
const state = {
  activeTop:'schedule',
  scheduleMonth:'2026-07',
  scheduleEvents:[]
};
const document = {
  head:{ appendChild(){} },
  documentElement:{ dataset:{} },
  addEventListener(type, listener){ listeners.set(type, listener); },
  querySelector(){ return null; },
  createElement(){ return {}; }
};
const sandbox = {
  console,
  Date,
  Promise,
  Math,
  Set,
  Map,
  document,
  state,
  currentUser:() => ({ id:'manager-1', name:'Иван Руководитель', role }),
  normalizeRole:value => value,
  getScheduleEvents:() => state.scheduleEvents,
  requestAnimationFrame:callback => callback(),
  crypto:{ randomUUID:() => '00000000-0000-4000-8000-000000000001' },
  sovremennikSupabase:{ from(){ throw new Error('Not used in helper checks'); } }
};
sandbox.window = sandbox;
vm.runInNewContext(source, sandbox, { filename:'assets/js/schedule-manager.js' });

const api = sandbox.SovremennikScheduleManager;
assert.equal(api.VERSION, '2026-07-20-schedule-manager-1');
assert.equal(document.documentElement.dataset.scheduleManagerVersion, api.VERSION);
assert.equal(listeners.has('click'), true);
assert.equal(listeners.has('change'), true);
assert.equal(listeners.has('submit'), true);

const fakePositiveTimezoneMidnight = {
  getFullYear:() => 2026,
  getMonth:() => 6,
  getDate:() => 1,
  toISOString:() => '2026-06-30T21:00:00.000Z'
};
assert.equal(api.localDateKey(fakePositiveTimezoneMidnight), '2026-07-01', 'Calendar keys must use local components instead of UTC ISO dates');
assert.equal(api.normalizeDateValue('20.07.2026'), '2026-07-20');
assert.equal(api.normalizeDateValue('2026-07-21'), '2026-07-21');

const rowRecords = api.parseImportedRows([
  ['Дата','Сотрудник','Начало','Конец','Комментарий'],
  ['20.07.2026','Анна','09:00','21:00','Основной зал'],
  ['21.07.2026','Борис','','','']
]);
assert.equal(rowRecords.length, 2);
assert.deepEqual(JSON.parse(JSON.stringify(rowRecords[0])), {
  eventDate:'2026-07-20',
  type:'Смена',
  title:'Смена: Анна',
  description:'09:00–21:00 · Основной зал',
  source:'file'
});
assert.equal(rowRecords[1].description, 'Целая смена');

const matrixRecords = api.parseImportedRows([
  ['Сотрудник','20.07.2026','21.07.2026'],
  ['Анна','09:00-21:00','Выходной'],
  ['Борис','Целая смена','10:00–18:00']
]);
assert.equal(matrixRecords.length, 3);
assert.equal(matrixRecords[0].title, 'Смена: Анна');
assert.equal(matrixRecords[0].description, '09:00–21:00');
assert.equal(matrixRecords[2].eventDate, '2026-07-21');

state.scheduleEvents = [{
  id:'shift-1', eventDate:'2026-07-01', type:'Смена', title:'Смена: Анна', description:'09:00–21:00', employeeName:'Иван'
}];
const grid = api.renderScheduleGrid();
assert.match(grid, /data-schedule-date="2026-07-01"/);
assert.match(grid, /Смена: Анна/);
assert.match(grid, /data-schedule-edit="shift-1"/);
assert.match(grid, /data-schedule-delete="shift-1"/);
assert.match(source, /const key = localDateKey\(date\)/, 'Grid keys must be generated from local date parts');

const managerPanel = api.renderSchedule();
assert.match(managerPanel, /Добавить смену/);
assert.match(managerPanel, /Загрузить график файлом/);
assert.match(managerPanel, /accept="\.xlsx,\.xls,\.ods,\.csv/);

role = 'barista';
const employeePanel = api.renderSchedule();
assert.doesNotMatch(employeePanel, /Добавить смену/);
assert.doesNotMatch(employeePanel, /Загрузить график файлом/);
assert.doesNotMatch(api.renderScheduleGrid(), /data-schedule-edit/);

assert.match(source, /from\('schedule_events'\)\.update\(row\)/, 'Schedule edits must update the existing database row');
assert.match(source, /from\('schedule_events'\)\.delete\(\)/, 'Schedule entries must be deletable by management');
assert.match(source, /IMPORT_CHUNK_SIZE = 100/, 'Large files must upload in bounded batches');
assert.match(source, /xlsx-0\.20\.3/, 'Excel import must use the pinned SheetJS browser build');

console.log('Schedule local-date, CRUD and file-import regression checks passed.');
