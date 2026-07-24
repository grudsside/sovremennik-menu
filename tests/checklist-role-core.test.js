const assert=require('node:assert/strict');
const core=require('../assets/js/checklist-role-core.js');

assert.equal(core.WAITER_OPENING_TASKS.length,18,'waiter opening checklist must keep all spreadsheet rows');
assert.equal(core.WAITER_CLOSING_TASKS.length,29,'waiter closing checklist must keep all spreadsheet rows');
assert.equal(core.WAITER_OPENING_TASKS[0],'Открыть свою смену в айке по приходу');
assert.equal(core.WAITER_OPENING_TASKS.at(-1),'Проверить мусорные баки и туалетную бумагу в гостевых  туалетах');
assert.equal(core.WAITER_CLOSING_TASKS[0],'Проверить, закрыты ли окна');
assert.equal(core.WAITER_CLOSING_TASKS.at(-1),'Выключить в зале свет, приточку, музыку и вывеску');

const injected=core.injectWaiterChecklists([{id:'bar-opening',title:'Чек-лист открытия бариста',sections:[]}]);
assert.equal(injected.length,3);
assert.equal(core.docsForDepartment(injected,'waiter').length,2);
assert.equal(core.docsForDepartment(injected,'barista').length,1);
assert.equal(core.findShiftDoc(injected,'waiter','opening').id,'waiter-opening-checklist');
assert.equal(core.findShiftDoc(injected,'waiter','closing').id,'waiter-closing-checklist');

const today='2026-07-24';
const opening=core.findShiftDoc(injected,'waiter','opening');
const complete=core.submissionProgress([{checklist_id:opening.id,employee_id:'u1',created_at:`${today}T08:00:00Z`,completed_count:18,total_count:18}],opening,'u1',today);
assert.equal(complete.done,true);
const partial=core.submissionProgress([{checklist_id:opening.id,employee_id:'u1',created_at:`${today}T08:00:00Z`,completed_count:12,total_count:18}],opening,'u1',today);
assert.deepEqual(partial,{done:false,completed:12,total:18,label:'12/18'});
assert.equal(core.revisionCompleted([{revision_date:today,employee_id:'u1'}],'u1',today),true);
assert.equal(core.taskForToday({status:'open',due_date:today},today),true);
assert.equal(core.taskForToday({status:'open',due_date:'2026-07-25'},today),false);
assert.equal(core.taskForToday({status:'open',due_date:null},today),true);
assert.equal(core.taskForToday({status:'done',completed_at:`${today}T11:00:00Z`},today),true);
assert.equal(core.taskIsDone({status:'done'}),true);
console.log('waiter checklist source, department tabs and daily completion helpers passed');
