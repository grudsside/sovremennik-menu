const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('assets/js/checklist-editor-core.js', 'utf8');
const context = { console, Date, Math, JSON, crypto:{ randomUUID:()=>'00000000-0000-4000-8000-000000000001' } };
context.globalThis = context;
vm.runInNewContext(source, context);
const core = context.SovremennikChecklistEditorCore;
assert.ok(core, 'Checklist editor core export is missing');

const base = {
  id:'opening',
  title:'Открытие',
  description:'До начала смены',
  sections:[
    { title:'Бар', rows:[{ task:'Проверить витрину' }, { task:'Протереть кофемашину' }] },
    { title:'Остатки', type:'minlist', rows:[{ task:'Молоко', min:'4 л' }] }
  ]
};
const normalized = core.normalizeTemplate(base);
assert.equal(normalized.sections[0].rows[0].itemKey, 'opening:0:0');
assert.equal(normalized.sections[0].rows[1].itemKey, 'opening:0:1');
assert.equal(normalized.sections[1].rows[0].itemKey, 'opening:1:0');
assert.equal(core.validateTemplate(base).ok, true);

const reordered = core.normalizeTemplate({
  ...normalized,
  sections:[{
    ...normalized.sections[0],
    rows:[normalized.sections[0].rows[1], normalized.sections[0].rows[0]]
  }, normalized.sections[1]]
});
assert.equal(reordered.sections[0].rows[0].itemKey, 'opening:0:1', 'Stable key must follow the moved item');
assert.equal(reordered.sections[0].rows[1].itemKey, 'opening:0:0', 'Stable key must follow the moved item');

const duplicate = core.validateTemplate({
  ...normalized,
  sections:[{ title:'Бар', rows:[
    { itemKey:'same', task:'Первый' },
    { itemKey:'same', task:'Второй' }
  ] }]
});
assert.equal(duplicate.ok, false);
assert.match(duplicate.errors.join(' '), /повторяющиеся/i);

const applied = core.applyOverrides({ checklists:[base] }, [{
  checklist_id:'opening',
  title:'Открытие смены',
  description:'Обновлено',
  sections:reordered.sections,
  version:3,
  updated_at:'2026-07-24T10:00:00Z'
}]);
assert.equal(applied.checklists[0].title, 'Открытие смены');
assert.equal(applied.checklists[0].__templateVersion, 3);
assert.equal(applied.checklists[0].sections[0].rows[0].itemKey, 'opening:0:1');

const photoCore = context.SovremennikChecklistPhotoCore;
assert.equal(photoCore, undefined, 'Photo core should only be patched when already loaded');

console.log('Checklist editor core tests passed.');
