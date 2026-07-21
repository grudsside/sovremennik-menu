/* Shared coffee revision calculations for browser and automated tests. */
(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.SovremennikCoffeeRevisionFormula = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  const DEFAULT_TARE_KG = 0.847;

  function numberValue(value){
    if(value === undefined || value === null || String(value).trim() === '') return null;
    const number = Number(String(value).replace(',', '.').replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(number) ? number : null;
  }

  function round(value, digits){
    const multiplier = 10 ** digits;
    return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
  }

  function round3(value){ return round(value, 3); }
  function round2(value){ return round(value, 2); }

  function calculateRevisionSeries(records, options = {}){
    const tareKg = Number.isFinite(Number(options.tareKg)) ? Number(options.tareKg) : DEFAULT_TARE_KG;
    let previousClean = null;
    let previousTotalGrainBalance = null;

    return (records || []).map(source => {
      const item = { ...source };
      const hopperWeight = numberValue(item.hopperWeight ?? item.hopper_weight);
      const openedPacks = numberValue(item.openedPacks ?? item.opened_packs);
      const writeOffs = numberValue(item.writeOffs ?? item.write_offs);
      const sales = numberValue(item.iikoSales ?? item.iiko_sales);
      const grainDelivery = numberValue(item.grainDelivery ?? item.grain_delivery);
      const stockBalanceOverride = numberValue(item.stockBalanceOverride ?? item.stock_balance_override);
      const storedClean = numberValue(item.cleanHopperWeight ?? item.clean_hopper_weight);
      const cleanWeight = hopperWeight === null
        ? storedClean
        : round3(Math.max(0, hopperWeight - tareKg));

      const usage = previousClean !== null && openedPacks !== null && cleanWeight !== null
        ? round3(previousClean + openedPacks - cleanWeight)
        : null;
      const difference = usage !== null && sales !== null && writeOffs !== null
        ? round3(sales - writeOffs - usage)
        : null;
      const unaccountedLoss = difference === null ? null : round3(Math.max(0, -difference));
      const totalLossWeight = difference !== null && writeOffs !== null
        ? round3(writeOffs + unaccountedLoss)
        : null;
      const lossPercent = totalLossWeight !== null && sales !== null && sales > 0
        ? round2((totalLossWeight / sales) * 100)
        : null;

      let totalGrainBalance = null;
      if(stockBalanceOverride !== null){
        totalGrainBalance = round3(stockBalanceOverride);
      } else if(previousTotalGrainBalance !== null && usage !== null){
        totalGrainBalance = round3(previousTotalGrainBalance + (grainDelivery ?? 0) - usage);
      }

      item.cleanHopperWeight = cleanWeight === null ? '' : String(cleanWeight);
      item.totalCoffeeUsage = usage === null ? '' : String(usage);
      item.difference = difference === null ? '' : String(difference);
      item.totalLossWeight = totalLossWeight === null ? '' : String(totalLossWeight);
      item.losses = lossPercent === null ? '' : `${lossPercent}%`;
      item.grainDelivery = grainDelivery === null ? '' : String(grainDelivery);
      item.stockBalanceOverride = stockBalanceOverride === null ? '' : String(stockBalanceOverride);
      item.totalGrainBalance = totalGrainBalance === null ? '' : String(totalGrainBalance);

      if(cleanWeight !== null) previousClean = cleanWeight;
      previousTotalGrainBalance = totalGrainBalance;
      return item;
    });
  }

  return {
    DEFAULT_TARE_KG,
    calculateRevisionSeries,
    numberValue,
    round2,
    round3,
  };
});
