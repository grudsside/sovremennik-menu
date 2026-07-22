import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const fixSource = readFileSync('assets/js/checklist-details-fix.js', 'utf8');
const loaderSource = readFileSync('assets/js/push.js', 'utf8');

const context = {
  console,
  normalizeRemoteRecord(row) {
    let details = [];
    try {
      details = typeof row?.details === 'string' ? JSON.parse(row.details) : (row?.details || []);
    } catch {
      details = [];
    }
    return {
      id: row?.id || '',
      tasks: Array.isArray(details)
        ? details.map(item => ({
          text: item?.text || item?.task || 'Пункт чек-листа',
          checked: Boolean(item?.checked),
        }))
        : [],
      completed: Number(row?.completed || 0),
      total: Number(row?.total || 0),
    };
  },
  renderRecordDetails(record) {
    return `<details><summary>Показать заполненный чек-лист</summary><ul>${(record.tasks || []).map(item => `<li>${item.text}</li>`).join('')}</ul></details>`;
  },
  recordDoneTotal(record) {
    return {
      done: (record.tasks || []).filter(item => item.checked).length || Number(record.completed || 0),
      total: (record.tasks || []).length || Number(record.total || 0),
    };
  },
};
context.window = context;
vm.createContext(context);
vm.runInContext(fixSource, context, { filename: 'checklist-details-fix.js' });

const mappedSupabaseRow = context.normalizeRemoteRecord({
  id: 'submission-1',
  tasks: [
    { text: 'Открыть смену', checked: true },
    { text: 'Проверить витрину', checked: false },
  ],
  completed: 1,
  total: 2,
});

assert.equal(mappedSupabaseRow.tasks.length, 2, 'Mapped Supabase tasks must not be erased');
assert.equal(mappedSupabaseRow.tasks[0].text, 'Открыть смену');
assert.equal(mappedSupabaseRow.tasks[0].checked, true);
assert.equal(mappedSupabaseRow.tasks[1].checked, false);
assert.match(context.renderRecordDetails(mappedSupabaseRow), /Открыть смену/);
assert.match(context.renderRecordDetails(mappedSupabaseRow), /Проверить витрину/);

const legacyDetailsRow = context.normalizeRemoteRecord({
  id: 'submission-2',
  details: JSON.stringify([{ task: 'Закрыть кассу', checked: '1' }]),
  completed: 1,
  total: 1,
});
assert.equal(legacyDetailsRow.tasks.length, 1, 'Legacy JSON details must remain supported');
assert.equal(legacyDetailsRow.tasks[0].text, 'Закрыть кассу');

const missingItemsHtml = context.renderRecordDetails({ tasks: [], completed: 15, total: 16 });
assert.match(missingItemsHtml, /Пункты этой записи не сохранились/);
assert.match(missingItemsHtml, /15\/16/);

const loaderMarker = 'assets/js/checklist-details-fix.js?v=20260722-1';
assert.ok(loaderSource.includes(loaderMarker), 'The checklist details fix must be loaded by push.js');

console.log('Checklist details regression check passed.');
