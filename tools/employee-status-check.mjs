import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const edge = read('supabase/functions/admin-employees/index.ts');
const client = read('assets/js/employee-status.js');
const loader = read('assets/js/push-legacy.js');
const roleMigration = read('supabase/migrations/20260724170000_role_security_finalize.sql');
const roleInterface = read('assets/js/role-interface.js');

const required = [
  [edge.includes('action === "set_active"'), 'admin-employees must support set_active'],
  [edge.includes('.update({ is_active: isActive })'), 'admin-employees must update profile activity'],
  [edge.includes('Cannot deactivate current admin'), 'current admin deactivation guard is required'],
  [edge.includes('Cannot deactivate the last active admin'), 'last active admin guard is required'],
  [edge.includes('action === "set_role"'), 'admin-employees must support set_role'],
  [edge.includes('requester.rpc("change_employee_role"'), 'employee role changes must use the authenticated audited RPC'],
  [edge.includes('"admin", "manager", "barista", "waiter"'), 'all four exclusive roles must be assignable by an administrator'],
  [roleMigration.includes('role_change_audit'), 'role changes must be audited in the database'],
  [roleMigration.includes('Нельзя понизить последнего действующего администратора'), 'last active admin role guard is required'],
  [roleMigration.includes('protect_last_active_admin'), 'direct profile writes must also protect the last admin'],
  [roleMigration.includes("event_type,event_key") && roleMigration.includes("'role_changed'"), 'role changes must create a user notification'],
  [edge.includes('Permanent employee deletion is disabled. Use set_active instead.'), 'permanent employee deletion must stay disabled'],
  [client.includes('data-employee-status'), 'employee status buttons are required'],
  [client.includes("action: 'set_active'"), 'client must call set_active'],
  [client.includes('data-employee-role'), 'employee role controls are required'],
  [client.includes("action: 'set_role'"), 'client must call set_role'],
  [client.includes("view !== 'employees'"), 'inactive profiles must be limited to employee administration'],
  [roleInterface.includes('function refreshOwnProfile()'), 'open clients must refresh their own role'],
  [roleInterface.includes("table:'profiles'") && roleInterface.includes("event:'UPDATE'"), 'role refresh must subscribe to profile updates'],
  [loader.includes('assets/js/employee-status.js'), 'employee status module must be loaded'],
];

const failures = required.filter(([ok]) => !ok).map(([, message]) => message);
if(failures.length){
  console.error('Employee status checks failed:');
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log('Employee activation, audited role changes and live refresh checks passed.');