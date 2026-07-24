import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow=fs.readFileSync('assets/js/checklist-role-workflow.js','utf8');
const css=fs.readFileSync('assets/css/checklist-role-workflow.css','utf8');
const loader=fs.readFileSync('assets/js/push.js','utf8');
const serviceWorker=fs.readFileSync('service-worker.js','utf8');

for(const token of [
  'data-checklist-department-tab',
  'Подразделение чек-листов',
  "role==='manager'",
  'intros.forEach(node=>node.remove())',
  'Работа бариста на сегодня',
  'Работа официанта на сегодня',
  "core.findShiftDoc(docs,department,'opening')",
  "core.findShiftDoc(docs,department,'closing')",
  "role==='barista'?revisionRow(revisionDone):''",
  'data-today-task-complete',
  ".update({status:'done',completed_at:new Date().toISOString()})",
  "from('checklist_submissions')",
  "from('coffee_revisions')",
  "from('tasks')",
  "['checklist','coffeeRevision','coffeeRevisionManual']",
]) assert(workflow.includes(token),`Checklist role workflow token is missing: ${token}`);

for(const token of ['.checklist-department-tabs','.role-today-work','.role-today-row.completed','.role-today-task-toggle']){
  assert(css.includes(token),`Checklist role CSS token is missing: ${token}`);
}
assert(loader.includes('checklist-role-workflow.css?v=20260724-1'));
assert(loader.includes('checklist-role-core.js?v=20260724-1'));
assert(loader.includes('checklist-role-workflow.js?v=20260724-1'));
assert(serviceWorker.includes('assets/js/checklist-role-core.js'));
assert(serviceWorker.includes('assets/js/checklist-role-workflow.js'));
assert(serviceWorker.includes('assets/css/checklist-role-workflow.css'));
console.log('checklist tabs, today workflow, task completion and PWA integration passed');
