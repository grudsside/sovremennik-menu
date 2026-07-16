import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const edge = read('supabase/functions/admin-employees/index.ts');
const client = read('assets/js/employee-status.js');
const loader = read('assets/js/push.js');

const required = [
  [edge.includes('action === "set_active"'), 'admin-employees must support set_active'],
  [edge.includes('.update({ is_active: isActive })'), 'admin-employees must update only profile activity'],
  [edge.includes('Cannot deactivate current admin'), 'current admin deactivation guard is required'],
  [edge.includes('Cannot deactivate the last active admin'), 'last active admin guard is required'],
  [!edge.includes('.deleteUser('), 'admin-employees must not delete Supabase Auth users'],
  [client.includes('data-employee-status'), 'employee status buttons are required'],
  [client.includes("action: 'set_active'"), 'client must call set_active'],
  [client.includes("view !== 'employees'"), 'inactive profiles must be limited to employee administration'],
  [loader.includes('assets/js/employee-status.js'), 'employee status module must be loaded'],
];

const failures = required.filter(([ok]) => !ok).map(([, message]) => message);
if(failures.length){
  console.error('Employee status checks failed:');
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log('Employee status checks passed.');
