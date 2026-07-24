import assert from 'node:assert/strict';
import fs from 'node:fs';

const integration = fs.readFileSync('assets/js/role-interface.js', 'utf8');
const css = fs.readFileSync('assets/css/role-interface.css', 'utf8');
const loader = fs.readFileSync('assets/js/push.js', 'utf8');

for (const token of [
  "panel.querySelector('.user-chip')",
  "trigger.setAttribute('data-role-profile-open','')",
  "logout.textContent='Выйти'",
  "logout.querySelectorAll('.role-badge')",
  'data-role-card-target="control"',
  'data-role-card-target="${action.target}"',
  "event.target.closest('[data-role-home-intro] [data-top-jump]')",
  "event.target.closest('[data-role-card-target]')",
  'function activateRoleCard(card)',
  "event.target.matches('[data-role-card-target]')",
  'function ensureAdminRoleOption()',
  "option.value='admin'",
  'function managerCounts()',
  'function refreshOwnProfile()',
  "table:'profiles'",
  "event:'UPDATE'",
  'clearRoleCaches()',
]) {
  assert(integration.includes(token), `Role interface UI contract is missing: ${token}`);
}

assert(
  integration.indexOf("const introJump=event.target.closest('[data-role-home-intro] [data-top-jump]')") <
    integration.indexOf("const card=event.target.closest('[data-role-card-target]')"),
  'Specific manager actions must be handled before the whole-card target',
);
assert(!integration.includes("trigger.insertAdjacentHTML('beforeend'"), 'Role badge must not be appended to the logout button');

for (const token of [
  '#user-panel button.user-chip.role-profile-trigger',
  '.role-home-intro[data-role-card-target]',
  '.role-manager-links',
  ':focus-visible',
  '#user-panel .logout-btn .role-badge',
  '[data-top="more"]',
]) {
  assert(css.includes(token), `Role interface CSS contract is missing: ${token}`);
}

assert(loader.includes('role-interface.css?v=20260724-2'), 'Updated role CSS cache-busting is missing');
assert(loader.includes('role-interface.js?v=20260724-2'), 'Updated role JS cache-busting is missing');

console.log('Role profile, dashboard, direct navigation and live role refresh are wired correctly.');