import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const summary = require('../assets/js/coffee-revision-summary-core.js');
const formula = require('../assets/js/coffee-revision-formula-core.js');

const serverCalculated = formula.calculateRevisionSeries([
  {
    dateKey:'2026-07-13',
    hopperWeight:1.194,
    openedPacks:4,
    writeOffs:0.504,
    iikoSales:4.2,
    totalCoffeeUsage:3.888,
    difference:-0.192,
    totalLossWeight:0.696,
    losses:'16.57%',
    totalGrainBalance:56.347,
  },
  {
    dateKey:'2026-07-14',
    hopperWeight:1.613,
    openedPacks:4,
    writeOffs:0.198,
    iikoSales:3.33,
    totalGrainBalance:52.766,
  },
]);
assert.equal(serverCalculated[0].totalCoffeeUsage, '3.888', 'The browser must preserve the server calculation for the first visible revision.');
assert.equal(serverCalculated[0].totalGrainBalance, '56.347');
assert.equal(serverCalculated[1].totalCoffeeUsage, '3.581');

const records = [
  {
    dateKey:'2026-07-13',
    iikoSales:'4.2',
    writeOffs:'0.504',
    difference:'-0.192',
    totalLossWeight:'0.696',
  },
  {
    dateKey:'2026-07-14',
    iikoSales:'3.33',
    writeOffs:'0.198',
    difference:'-0.449',
    totalLossWeight:'0.647',
  },
  {
    dateKey:'2026-07-15',
    iikoSales:'3.528',
    writeOffs:'0.118',
    difference:'0.189',
    totalLossWeight:'0.118',
  },
  {
    dateKey:'2026-07-22',
    iikoSales:'100',
    totalLossWeight:'100',
  },
];

const period = summary.calculatePeriodSummary(records, 7, '2026-07-15');
assert.equal(period.revisionCount, 3, 'Future revisions must not enter the summary.');
assert.equal(period.totalSales, 11.058);
assert.equal(period.totalLossWeight, 1.461);
assert.equal(period.lossPercent, 13.21, 'Period loss must be weighted by total sales, not averaged by day.');

const latestReportRows = summary.recordsForLatestReportDates([
  { dateKey:'2026-06-01', iikoSales:1 },
  { dateKey:'2026-07-02', iikoSales:2 },
  { dateKey:'2026-07-10', iikoSales:3 },
  { dateKey:'2026-07-16', iikoSales:4 },
  { dateKey:'2026-07-19', iikoSales:5 },
  { dateKey:'2026-07-25', iikoSales:100 },
], 3, '2026-07-20');
assert.deepEqual(
  latestReportRows.map(row => row.dateKey),
  ['2026-07-10', '2026-07-16', '2026-07-19'],
  'Calendar gaps must be skipped while the latest three report dates are selected.',
);
const latestReportSummary = summary.calculatePeriodSummary(latestReportRows, 3, '2026-07-20');
assert.equal(latestReportSummary.revisionCount, 3);
assert.equal(latestReportSummary.totalSales, 12);

const selectedReport = summary.calculateRecordsSummary(records.slice(0, 2));
assert.equal(selectedReport.revisionCount, 2);
assert.equal(selectedReport.totalSales, 7.53);
assert.equal(selectedReport.totalLossWeight, 1.343);
assert.equal(selectedReport.lossPercent, 17.84, 'Manual report totals must use the selected rows and weighted sales.');

const fallback = summary.calculatePeriodSummary([
  { dateKey:'2026-07-15', iikoSales:4, writeOffs:0.2, difference:-0.3 },
], 1, '2026-07-15');
assert.equal(fallback.totalLossWeight, 0.5);
assert.equal(fallback.lossPercent, 12.5);

const calendar = summary.recordsForCalendarDays([
  { dateKey:'2026-07-09' },
  { dateKey:'2026-07-10' },
  { dateKey:'2026-07-16' },
  { dateKey:'2026-07-17' },
], 7, '2026-07-16');
assert.deepEqual(calendar.map(row => row.dateKey), ['2026-07-10', '2026-07-16']);

const integration = fs.readFileSync('assets/js/coffee-revision-integrity-fix.js', 'utf8');
const labels = fs.readFileSync('assets/js/coffee-revision-summary-labels.js', 'utf8');
const reportStyles = fs.readFileSync('assets/css/coffee-revision-report-summary.css', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260721223000_coffee_revision_integrity_summary.sql', 'utf8');
const config = fs.readFileSync('assets/js/supabase-config.js', 'utf8');

assert.match(integration, /addEventListener\('submit', interceptRevisionSubmit, true\)/);
assert.match(integration, /\.from\('coffee_revisions'\)[\s\S]*?\.insert\(row\)/);
assert.doesNotMatch(integration, /\.upsert\(row/);
assert.match(integration, /23505/);
assert.match(integration, /manual-report-total/);
assert.match(integration, /Итог отчёта/);
assert.match(integration, /calculateRecordsSummary\(revisions\)/);
assert.match(integration, /exportManualReportWithTotals/);
assert.match(integration, /сумма всех потерь делится на сумму продаж/);
assert.match(labels, /Последние \$\{limit\} дней, по которым есть отчёт/);
assert.match(labels, /Календарные дни без отчёта пропускаются/);
assert.doesNotMatch(labels, /включая сегодня/);
assert.match(reportStyles, /grid-template-columns: minmax\(220px, 0\.9fr\) minmax\(0, 2\.2fr\) minmax\(220px, 0\.9fr\)/);
assert.match(reportStyles, /@media \(min-width: 621px\) and \(max-width: 1079px\)/);
assert.match(reportStyles, /\.revision-summary-periods[\s\S]*?grid-template-columns: repeat\(2/);
assert.match(reportStyles, /\.revision-summary-period-metrics[\s\S]*?grid-template-columns: repeat\(2/);
assert.match(reportStyles, /\.manual-report-total-metrics[\s\S]*?grid-template-columns: repeat\(4/);
assert.match(reportStyles, /@media \(max-width: 620px\)/);
assert.match(migration, /opening_clean_hopper_weight/);
assert.match(migration, /opening_total_grain_balance/);
assert.match(migration, /app\.coffee_revision_admin_correction/);
assert.match(migration, /2026-07-13/);
assert.match(migration, /1\.194/);
assert.match(migration, /60\.235/);
assert.match(config, /20260722-2/);
assert.match(config, /coffee-revision-report-summary\.css/);
assert.match(config, /coffee-revision-summary-core\.js/);
assert.match(config, /coffee-revision-integrity-fix\.js/);
assert.match(config, /coffee-revision-summary-labels\.js/);

console.log('Coffee revision latest report dates, compact summary grid and manual report totals checks passed.');
