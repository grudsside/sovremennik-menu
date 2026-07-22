/* Clarify coffee revision periods after the shared summary renderer updates the DOM. */
(() => {
  'use strict';

  const summary = window.SovremennikCoffeeRevisionSummary;
  if(!summary?.recordsForLatestReportDates || !summary?.dateKey){
    console.error('Coffee revision report-date helpers are unavailable.');
    return;
  }

  let queued = false;

  function revisionRows(){
    try {
      return typeof getRevisionRecords === 'function' ? getRevisionRecords() || [] : [];
    } catch(error){
      return [];
    }
  }

  function localToday(){
    return summary.localDateKey(new Date());
  }

  function shortDate(key){
    const normalized = summary.dateKey(key);
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}.${match[2]}` : normalized;
  }

  function fullDate(key){
    const normalized = summary.dateKey(key);
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}.${match[2]}.${match[1]}` : normalized;
  }

  function reportDayWord(count){
    const value = Math.abs(Number(count) || 0);
    const mod100 = value % 100;
    const mod10 = value % 10;
    if(mod100 >= 11 && mod100 <= 14) return 'отчётных дней';
    if(mod10 === 1) return 'отчётный день';
    if(mod10 >= 2 && mod10 <= 4) return 'отчётных дня';
    return 'отчётных дней';
  }

  function selectedDateKeys(limit){
    return Array.from(new Set(
      summary.recordsForLatestReportDates(revisionRows(), limit, localToday())
        .map(record => summary.recordDateKey ? summary.recordDateKey(record) : summary.dateKey(record?.dateKey || record?.date))
        .filter(Boolean)
    )).sort();
  }

  function periodCaption(keys){
    if(!keys.length) return 'Нет отчётов';
    if(keys.length === 1) return `${fullDate(keys[0])} · 1 отчётный день`;
    return `${shortDate(keys[0])}–${shortDate(keys[keys.length - 1])} · ${keys.length} ${reportDayWord(keys.length)}`;
  }

  function setText(element, text){
    if(element && element.textContent !== text) element.textContent = text;
  }

  function enhanceSummary(){
    queued = false;

    document.querySelectorAll('.control-summary-grid').forEach(grid => {
      const cards = Array.from(grid.children).filter(card => card.classList?.contains('summary-card'));
      cards[0]?.classList.add('checklist-summary-card');
      cards[1]?.classList.add('revision-summary-card');
      cards[2]?.classList.add('error-summary-card');
    });

    document.querySelectorAll('.revision-summary-period[data-revision-period]').forEach(period => {
      const limit = Math.max(1, Number(period.dataset.revisionPeriod) || 1);
      const keys = selectedDateKeys(limit);
      setText(period.querySelector('.revision-summary-period-head strong'), `Последние ${limit} дней, по которым есть отчёт`);
      setText(period.querySelector('.revision-summary-period-head span'), periodCaption(keys));
    });

    setText(
      document.querySelector('.revision-summary-explanation'),
      'В каждом блоке берутся последние даты, по которым есть ревизия: до 7 или до 30 отчётных дней. Календарные дни без отчёта пропускаются. Процент считается по итогам выбранных ревизий: сумма всех потерь делится на сумму продаж. Будущие даты в сводку не попадают.'
    );
  }

  function queueEnhance(){
    if(queued) return;
    queued = true;
    requestAnimationFrame(enhanceSummary);
  }

  const root = document.querySelector('#panels') || document.body;
  new MutationObserver(queueEnhance).observe(root, { childList:true, subtree:true });
  window.addEventListener('sovremennik:revision-records-updated', queueEnhance);
  window.addEventListener('pageshow', queueEnhance);
  queueEnhance();
})();
