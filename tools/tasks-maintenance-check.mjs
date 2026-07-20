import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const releaseId = '20260720-1';
const loader = readFileSync('assets/js/push.js', 'utf8');
const index = readFileSync('index.html', 'utf8');
const maintenanceScript = readFileSync('assets/js/tasks-maintenance.js', 'utf8');
const maintenanceStyles = readFileSync('assets/css/tasks-maintenance.css', 'utf8');

assert.doesNotMatch(
  loader,
  /SOVREMENNIK_TASKS_MAINTENANCE\s*=\s*true/,
  'The production loader must not enable tasks maintenance'
);
assert.doesNotMatch(
  loader,
  /tasks-maintenance\.(?:js|css)/,
  'The production loader must not load the maintenance interception layer'
);
assert.match(
  loader,
  new RegExp(`assets/js/tasks-v2\\.js\\?v=${releaseId}`),
  'Tasks v2 must remain connected in the production loader'
);
assert.doesNotMatch(
  loader,
  /tasks-hotfix\.js|mobile-tasks-performance\.(?:js|css)/,
  'Legacy task override layers must stay disconnected'
);

const releasedAssets = [
  'assets/css/tasks-v2.css',
  'assets/js/interface-redesign.js',
  'assets/js/tasks-v2.js',
  'assets/js/interface-v3.js',
  'assets/js/interface-followup.js',
  'assets/js/mobile-active-panel.js'
];

for(const asset of releasedAssets){
  const escapedAsset = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    loader,
    new RegExp(`${escapedAsset}\\?v=${releaseId}`),
    `${asset} must use the release cache-bust`
  );
}

assert.match(
  index,
  new RegExp(`assets/js/push\\.js\\?v=${releaseId}`),
  'index.html must cache-bust the production loader'
);
assert.ok(
  loader.indexOf(`assets/js/tasks-v2.js?v=${releaseId}`) < loader.indexOf(`assets/js/interface-v3.js?v=${releaseId}`),
  'Tasks v2 must load before its lifecycle adapter'
);

assert.match(maintenanceScript, /window\.loadTasks = disabledAsync/, 'Emergency maintenance JS must remain available in the repository');
assert.match(maintenanceStyles, /\.tasks-maintenance-card/, 'Emergency maintenance CSS must remain available in the repository');

console.log(`Tasks release mode checks passed for ${releaseId}.`);
