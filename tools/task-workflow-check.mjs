import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [tasksV2, interfaceV3, loader, sw, notify, deadline, css] = await Promise.all([
  read('assets/js/tasks-v2.js'),
  read('assets/js/interface-v3.js'),
  read('assets/js/push.js'),
  read('service-worker.js'),
  read('supabase/functions/notify-event/index.ts'),
  read('supabase/functions/deadline-checker/index.ts'),
  read('assets/css/interface-v3-hotfix.css')
]);

assert.match(tasksV2, /dueAt:row\?\.dueAt \|\| row\?\.due_at/, 'Task normalization must preserve due_at');
assert.match(tasksV2, /notify\('task_assigned'/, 'Task creation must use the notification path');
assert.match(tasksV2, /notify\('task_completed'/, 'Task completion must use the notification path');
assert.match(tasksV2, /data-tasks-v2-action="refresh"/, 'The isolated module must expose manual refresh');
assert.match(tasksV2, /data-tasks-v2-form/, 'The isolated module must render its own task form');
assert.match(tasksV2, /function applyInitialRoute\(/, 'Tasks v2 must expose the cold-start route adapter');
assert.match(interfaceV3, /applyInitialTaskRoute\(\);[\s\S]*if\(activeTaskRoot\(\)\)/, 'Interface v3 must apply #tasks before guarding an owned root');
assert.match(interfaceV3, /tasksV2\(\)\?\.ownsRoot/, 'Interface v3 must preserve an active owned task root');
assert.match(loader, /interface-v3-hotfix\.css/, 'The interface CSS hotfix must remain loaded');
assert.match(loader, /tasks-v2\.js/, 'The isolated task module must be loaded');
assert.doesNotMatch(loader, /tasks-hotfix\.js|mobile-tasks-performance\.(?:js|css)/, 'Legacy task layers must remain disabled');
assert.match(sw, /self\.registration\.scope/, 'Notification URLs must resolve against the application scope');
assert.match(notify, /return "\.\/#tasks";/, 'Task notifications must open #tasks');
assert.match(deadline, /url: "\.\/#tasks"/, 'Deadline notifications must open #tasks');
assert.match(css, /flex-direction:column!important/, 'Sidebar direction must override legacy rules');
assert.match(css, /overflow-y:auto!important/, 'Mobile sidebar must remain vertically scrollable');

console.log('Task workflow regression checks passed.');
