import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const formula = require('../assets/js/coffee-revision-formula-core.js');
const integration = fs.readFileSync('assets/js/coffee-revision-formula-fix.js', 'utf8');
const editor = fs.readFileSync('assets/js/coffee-revision-editor.js', 'utf8');
const stockMigration = fs.readFileSync('supabase/migrations/20260721203000_coffee_revision_total_stock.sql', 'utf8');

const calculated = formula.calculateRevisionSeries([
  {
    dateKey:'2099-12-27', hopperWeight:1.847, openedPacks:0, writeOffs:0, iikoSales:0,
    grainDelivery:0, stockBalanceOverride:60,
  },
  {
    dateKey:'2099-12-28', hopperWeight:1.347, openedPacks:4, writeOffs:0.2, iikoSales:4.4,
    grainDelivery:10,
  },
  {
    dateKey:'2099-12-29', hopperWeight:1.047, openedPacks:4, writeOffs:0.1, iikoSales:4.5,
    grainDelivery:0,
  },
  {
    dateKey:'2099-12-30', hopperWeight:0.947, openedPacks:2, writeOffs:0.1, iikoSales:2.0,
    grainDelivery:0, stockBalanceOverride:58,
  },
  {
    dateKey:'2099-12-31', hopperWeight:0.847, openedPacks:3, writeOffs:0, iikoSales:3.0,
    grainDelivery:5,
  },
]);

assert.equal(calculated[0].cleanHopperWeight, '1');
assert.equal(calculated[0].totalCoffeeUsage, '', 'First revision must not invent usage without a previous clean balance.');
assert.equal(calculated[0].totalGrainBalance, '60', 'Manual opening stock must establish the first end-of-day control point.');

assert.equal(calculated[1].cleanHopperWeight, '0.5');
assert.equal(calculated[1].totalCoffeeUsage, '4.5');
assert.equal(calculated[1].difference, '-0.3');
assert.equal(calculated[1].totalLossWeight, '0.5');
assert.equal(calculated[1].losses, '11.36%');
assert.equal(calculated[1].totalGrainBalance, '65.5', 'Delivery must be added before daily usage is subtracted.');

assert.equal(calculated[2].cleanHopperWeight, '0.2');
assert.equal(calculated[2].totalCoffeeUsage, '4.3');
assert.equal(calculated[2].difference, '0.1');
assert.equal(calculated[2].totalLossWeight, '0.1', 'Positive surplus must not be counted as additional loss.');
assert.equal(calculated[2].losses, '2.22%');
assert.equal(calculated[2].totalGrainBalance, '61.2');

assert.equal(calculated[3].totalGrainBalance, '58', 'A later manual stock check must replace the calculated balance for that day.');
assert.equal(calculated[4].totalCoffeeUsage, '3.1');
assert.equal(calculated[4].totalGrainBalance, '59.9', 'Days after a new control point must continue from the corrected stock.');

assert.match(integration, /\.from\('coffee_revisions'\)[\s\S]*?\.update\(values\)/, 'Manual control form must update an existing row instead of using upsert.');
assert.doesNotMatch(integration, /\.upsert\(/, 'Manual control fix must not trigger insert logic through upsert.');
assert.match(integration, /Ревизия за выбранную дату не найдена/, 'Missing operational revision must show an actionable message.');
assert.match(integration, /Общий остаток зерна/, 'Total grain stock must be visible in the table and formula note.');
assert.match(integration, /grain_delivery/, 'Remote report mapping must preserve grain deliveries.');
assert.match(editor, /name="grainDelivery"/, 'Administrator editor must accept deliveries.');
assert.match(editor, /name="stockBalanceOverride"/, 'Administrator editor must accept a stock control point.');
assert.match(editor, /p_stock_balance_override/, 'Editor must send the stock control point to the protected RPC.');
assert.match(stockMigration, /previous_row\.total_grain_balance_calc[\s\S]*?coalesce\(current_row\.grain_delivery, 0\)[\s\S]*?current_row\.total_coffee_usage_calc/, 'Database view must continue stock from the prior day with deliveries and usage.');
assert.match(stockMigration, /when current_row\.stock_balance_override is not null/, 'Database view must support later stock control points.');

console.log('Coffee revision formulas, deliveries and total stock checks passed.');
