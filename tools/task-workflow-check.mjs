import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [hotfix, loader, sw, notify, deadline, css] = await Promise.all([
  read('assets/js/tasks-hotfix.js'),
  read('assets/js/push.js'),
  read('service-worker.js'),
  read('supabase/functions/notify-event/index.ts'),
  read('supabase/functions/deadline-checker/index.ts'),
  read('assets/css/interface-v3-hotfix.css')
]);

assert.match(hotfix, /deadlineAt,\s*\n\s*deadline:/, 'Task normalization must preserve deadlineAt');
assert.match(hotfix, /sendPayloadToSheets\(\{ payloadType:'taskComplete', taskId \}\)/, 'Task completion must use the shared notification-aware path');
assert.match(hotfix, /requestedTopFromHash\(\) !== 'tasks'/, 'Direct #tasks routing must be handled');
assert.match(hotfix, /\[data-refresh-service\]/, 'Refresh controls must use delegated binding');
assert.match(hotfix, /\[data-open-task-modal\]/, 'Task modal buttons must use delegated binding');
assert.match(hotfix, /обязателен для всех авторизованных сотрудников/, 'Mandatory task access must be explained in the permissions UI');
assert.match(loader, /interface-v3-hotfix\.css/, 'The CSS hotfix must be loaded');
assert.match(loader, /tasks-hotfix\.js/, 'The task hotfix must be loaded');
assert.match(sw, /self\.registration\.scope/, 'Notification URLs must resolve against the application scope');
assert.match(notify, /return "\.\/#tasks";/, 'Task notifications must open #tasks');
assert.match(deadline, /url: "\.\/#tasks"/, 'Deadline notifications must open #tasks');
assert.match(css, /flex-direction:column!important/, 'Sidebar direction must override legacy rules');
assert.match(css, /overflow-y:auto!important/, 'Mobile sidebar must remain vertically scrollable');

console.log('Task workflow regression checks passed.');
