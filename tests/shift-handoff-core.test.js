const assert = require('node:assert/strict');
const core = require('../assets/js/shift-handoff-core.js');

assert.deepEqual(
  core.splitLines('— Овсяное молоко\n- Овсяное молоко\nПравый гриндер'),
  ['Овсяное молоко', 'Правый гриндер'],
  'lines must be cleaned and deduplicated',
);

const draft = core.normalizeDraft({
  unfinished:'Не разобрана поставка',
  out_of_stock:'Овсяное молоко\nСироп ваниль',
  equipment_issues:'Правый гриндер выдаёт ошибку',
  next_shift_control:'Проверить поставку сиропов',
  notes:'Передать администратору',
});
assert.equal(core.hasContent(draft), true);
assert.equal(core.hasContent({}), false);
assert.deepEqual(core.toDatabaseRow(draft).out_of_stock, ['Овсяное молоко', 'Сироп ваниль']);

const now = new Date('2026-07-23T12:00:00Z');
const rows = [
  {
    id:'old', created_by:'author-a', created_at:'2026-07-23T08:00:00Z', visible_until:'2026-07-24T08:00:00Z',
    unfinished:['Старое сообщение'], acknowledgements:[],
  },
  {
    id:'latest', created_by:'author-b', created_at:'2026-07-23T10:00:00Z', visible_until:'2026-07-24T10:00:00Z',
    unfinished:['Новое сообщение'], acknowledgements:[],
  },
];
assert.equal(core.pendingForUser(rows, 'employee-1', now).id, 'latest');
rows[1].acknowledgements.push({ employee_id:'employee-1' });
assert.equal(core.pendingForUser(rows, 'employee-1', now).id, 'old');
assert.equal(core.pendingForUser(rows, 'author-a', now).id, 'latest', 'author must not see own handoff as pending');

assert.equal(
  core.buildStoragePath(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
  ),
  '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.jpg',
);
assert.throws(() => core.buildStoragePath('', 'handoff', 'photo'));

console.log('Shift handoff core checks passed.');
