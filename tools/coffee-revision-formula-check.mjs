import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const formula = require('../assets/js/coffee-revision-formula-core.js');
const integration = fs.readFileSync('assets/js/coffee-revision-formula-fix.js', 'utf8');

const calculated = formula.calculateRevisionSeries([
  { dateKey:'2099-12-27', hopperWeight:1.847, openedPacks:0, writeOffs:0, iikoSales:0 },
  { dateKey:'2099-12-28', hopperWeight:1.347, openedPacks:4, writeOffs:0.2, iikoSales:4.4 },
  { dateKey:'2099-12-29', hopperWeight:1.047, openedPacks:4, writeOffs:0.1, iikoSales:4.5 },
]);

assert.equal(calculated[0].cleanHopperWeight, '1');
assert.equal(calculated[0].totalCoffeeUsage, '', 'First revision must not invent usage without a previous clean balance.');

assert.equal(calculated[1].cleanHopperWeight, '0.5');
assert.equal(calculated[1].totalCoffeeUsage, '4.5');
assert.equal(calculated[1].difference, '-0.3');
assert.equal(calculated[1].totalLossWeight, '0.5');
assert.equal(calculated[1].losses, '11.36%');

assert.equal(calculated[2].cleanHopperWeight, '0.2');
assert.equal(calculated[2].totalCoffeeUsage, '4.3');
assert.equal(calculated[2].difference, '0.1');
assert.equal(calculated[2].totalLossWeight, '0.1', 'Positive surplus must not be counted as additional loss.');
assert.equal(calculated[2].losses, '2.22%');

assert.match(integration, /\.from\('coffee_revisions'\)[\s\S]*?\.update\(values\)/, 'Manual control form must update an existing row instead of using upsert.');
assert.doesNotMatch(integration, /\.upsert\(/, 'Manual control fix must not trigger insert logic through upsert.');
assert.match(integration, /Ревизия за выбранную дату не найдена/, 'Missing operational revision must show an actionable message.');
assert.match(integration, /Потери всего/, 'Correct total-loss label must be visible.');

console.log('Coffee revision formulas and manual control update checks passed.');
