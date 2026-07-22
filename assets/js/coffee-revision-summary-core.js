/* Shared coffee revision summary calculations for browser and automated tests. */
(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.SovremennikCoffeeRevisionSummary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  function numberValue(value){
    if(value === undefined || value === null || String(value).trim() === '') return null;
    const parsed = Number(String(value).replace(',', '.').replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function round(value, digits){
    const multiplier = 10 ** digits;
    return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
  }

  function dateKey(value){
    if(!value) return '';
    const text = String(value).trim();
    const direct = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;
    const russian = text.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    if(russian) return `${russian[3]}-${russian[2]}-${russian[1]}`;
    const parsed = new Date(text);
    if(Number.isNaN(parsed.getTime())) return '';
    return localDateKey(parsed);
  }

  function localDateKey(value = new Date()){
    const date = value instanceof Date ? value : new Date(value);
    if(Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function shiftDateKey(key, days){
    const match = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!match) return '';
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    date.setDate(date.getDate() + Number(days || 0));
    return localDateKey(date);
  }

  function recordDateKey(record){
    return dateKey(
      record?.dateKey
      || record?.revisionDate
      || record?.revision_date
      || record?.date
      || record?.createdAt
      || record?.created_at
    );
  }

  function recordsForCalendarDays(records, days, todayKey = localDateKey()){
    const safeDays = Math.max(1, Math.trunc(Number(days) || 1));
    const end = dateKey(todayKey);
    const start = shiftDateKey(end, -(safeDays - 1));
    if(!start || !end) return [];
    return (records || []).filter(record => {
      const key = recordDateKey(record);
      return key && key >= start && key <= end;
    });
  }

  function recordsForLatestReportDates(records, days, todayKey = localDateKey()){
    const safeDays = Math.max(1, Math.trunc(Number(days) || 1));
    const end = dateKey(todayKey);
    if(!end) return [];

    const eligible = (records || [])
      .map((record, index) => ({ record, index, key:recordDateKey(record) }))
      .filter(item => item.key && item.key <= end);
    const latestKeys = Array.from(new Set(eligible.map(item => item.key)))
      .sort((left, right) => right.localeCompare(left))
      .slice(0, safeDays);
    const selected = new Set(latestKeys);

    return eligible
      .filter(item => selected.has(item.key))
      .sort((left, right) => left.key.localeCompare(right.key) || left.index - right.index)
      .map(item => item.record);
  }

  function lossWeightForRecord(record){
    const stored = numberValue(record?.totalLossWeight ?? record?.total_loss_weight);
    if(stored !== null) return Math.max(0, stored);
    const writeOffs = numberValue(record?.writeOffs ?? record?.write_offs);
    const difference = numberValue(record?.difference);
    if(writeOffs === null || difference === null) return null;
    return Math.max(0, writeOffs) + Math.max(0, -difference);
  }

  function calculateRecordsSummary(records){
    const revisionRecords = Array.isArray(records) ? records : [];
    let totalSales = 0;
    let totalLossWeight = 0;
    let lossSales = 0;
    let completeLossRows = 0;

    for(const record of revisionRecords){
      const sales = numberValue(record?.iikoSales ?? record?.iiko_sales);
      if(sales !== null) totalSales += sales;

      const lossWeight = lossWeightForRecord(record);
      if(lossWeight === null || sales === null || sales <= 0) continue;
      totalLossWeight += lossWeight;
      lossSales += sales;
      completeLossRows += 1;
    }

    return {
      records:revisionRecords,
      revisionCount:revisionRecords.length,
      totalSales:round(totalSales, 3),
      totalLossWeight:completeLossRows ? round(totalLossWeight, 3) : null,
      lossSales:completeLossRows ? round(lossSales, 3) : null,
      lossPercent:completeLossRows && lossSales > 0
        ? round((totalLossWeight / lossSales) * 100, 2)
        : null,
      completeLossRows,
    };
  }

  function calculatePeriodSummary(records, days, todayKey = localDateKey()){
    return calculateRecordsSummary(recordsForLatestReportDates(records, days, todayKey));
  }

  return {
    calculatePeriodSummary,
    calculateRecordsSummary,
    dateKey,
    localDateKey,
    lossWeightForRecord,
    numberValue,
    recordDateKey,
    recordsForCalendarDays,
    recordsForLatestReportDates,
    shiftDateKey,
  };
});
