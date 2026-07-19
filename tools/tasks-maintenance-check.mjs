import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const loader = readFileSync('assets/js/push.js', 'utf8');
const script = readFileSync('assets/js/tasks-maintenance.js', 'utf8');
const styles = readFileSync('assets/css/tasks-maintenance.css', 'utf8');

assert.match(loader, /tasks-maintenance\.css\?v=20260719-1/, 'Maintenance CSS must be cache-busted');
assert.match(loader, /mobile-active-panel\.js[\s\S]*tasks-maintenance\.js\?v=20260719-1/, 'Maintenance script must load last');
assert.match(script, /Ведутся технические работы и раздел временно недоступен, приносим свои извинения\./, 'The requested maintenance notice must be displayed');
assert.match(script, /window\.loadTasks = disabledAsync/, 'Remote task loading must be disabled');
assert.match(script, /window\.loadTaskAssignees = disabledAsync/, 'Assignee loading must be disabled');
assert.match(script, /window\.renderTasksList = maintenanceMarkup/, 'Task list rendering must be replaced by the notice');
assert.match(script, /window\.renderTaskModal = function\(\)\{ return ''; \}/, 'Task modal rendering must be disabled');
assert.match(script, /document\.querySelectorAll\('#task-modal'\).*remove/, 'Existing task modals must be removed');
assert.match(styles, /\.tasks-maintenance-card/, 'The maintenance notice must have dedicated styling');

console.log('Tasks maintenance checks passed.');
