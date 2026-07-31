/* Современник — Control v4 bootstrap: one owner, no legacy runtime wrappers. */
(function(global){
  'use strict';
  if(global.SovremennikControlV4) return;
  const Core=global.SovremennikControlV4Core,Storage=global.SovremennikControlV4Storage,Service=global.SovremennikControlV4Service,Control=global.SovremennikControlV4Control,Checklists=global.SovremennikControlV4Checklists;
  const app=typeof state!=='undefined'?state:global.state;
  if(!Core||!Storage||!Service||!Control||!Checklists||!app||typeof global.renderApp!=='function'){console.error('Control v4 dependencies are unavailable.');return}
  const VERSION='2026-07-30-control-v4-1';
  const SUMMARY_RESTORE_VERSION='2026-07-31-summary-restore-2';
  const legacy=Object.freeze({renderApp:global.renderApp,setControlTab:typeof global.setControlTab==='function'?global.setControlTab:null});
  let rendering=false,started=false,summaryRestoreQueued=false;

  function ensurePhotoFitStyles(){
    if(document.querySelector('link[data-control-v4-photo-fit]'))return;
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href='assets/css/control-v4-photo-fit.css?v=20260730-1';
    link.dataset.controlV4PhotoFit='true';
    document.head.appendChild(link);
  }

  function toggleNearest(button,sectionSelector,bodySelector,id,set){
    const section=button?.closest(sectionSelector);
    const body=section?.querySelector(bodySelector);
    if(!button||!body)return;
    const open=body.hidden;
    body.hidden=!open;
    button.setAttribute('aria-expanded',String(open));
    if(open)set.add(id);else set.delete(id);
  }

  function installScopedJournalTaps(){
    const root=document.querySelector('#top-control');
    if(!root||root.dataset.controlV4ScopedTaps==='1')return;
    root.dataset.controlV4ScopedTaps='1';
    root.addEventListener('click',event=>{
      const dayButton=event.target.closest?.('[data-control-v4-day-toggle]');
      if(dayButton){
        event.preventDefault();
        event.stopPropagation();
        toggleNearest(dayButton,'.control-v4-day','.control-v4-day-body',dayButton.dataset.controlV4DayToggle,Control.ui.openDays);
        return;
      }
      const reportButton=event.target.closest?.('[data-control-v4-report-toggle]');
      if(reportButton){
        event.preventDefault();
        event.stopPropagation();
        toggleNearest(reportButton,'.control-v4-report','.control-v4-report-body',reportButton.dataset.controlV4ReportToggle,Control.ui.openReports);
      }
    });
  }

  function syncLegacySummaryState(){
    app.controlRecords=Array.isArray(Control.ui.submissions)?Control.ui.submissions:[];
    app.revisionRecords=Array.isArray(Control.ui.revisions)?Control.ui.revisions:[];
    app.errorReports=Array.isArray(Control.ui.errors)?Control.ui.errors:[];
  }

  function removeDuplicateSummaryToolbars(folder){
    folder?.querySelectorAll('.control-summary-global-toolbar').forEach(toolbar=>toolbar.remove());
  }

  function restoreSummary(){
    const root=document.querySelector('#top-control');
    const folder=root?.querySelector('#control-summary');
    if(!folder||folder.hidden||app.activeControl!=='summary')return;
    removeDuplicateSummaryToolbars(folder);
    if(folder.dataset.controlV4SummaryRestored===SUMMARY_RESTORE_VERSION&&folder.querySelector('#control-summary-wrap'))return;
    if(typeof global.renderControlSummaryV21!=='function'||typeof global.renderManualReportBuilderV23!=='function')return;
    syncLegacySummaryState();
    folder.innerHTML=`<div class="control-v4-toolbar control-v4-summary-toolbar"><p>Сводка собирается из чек-листов, ревизий и сообщений об ошибках.</p><button type="button" class="small-action secondary" data-control-v4-refresh="summary">Обновить сводку</button></div><div id="control-summary-wrap">${global.renderControlSummaryV21()}${global.renderManualReportBuilderV23()}</div>`;
    const oldButton=folder.querySelector('[data-control-summary-refresh]');
    if(oldButton)oldButton.remove();
    removeDuplicateSummaryToolbars(folder);
    folder.dataset.controlV4SummaryRestored=SUMMARY_RESTORE_VERSION;
    if(typeof global.bindControlSummaryEventsV23==='function')global.bindControlSummaryEventsV23();
  }

  function queueSummaryRestore(){
    if(summaryRestoreQueued)return;
    summaryRestoreQueued=true;
    queueMicrotask(()=>{summaryRestoreQueued=false;restoreSummary()});
  }

  function installSummaryRestore(){
    const root=document.querySelector('#top-control');
    if(!root)return;
    if(root.dataset.controlV4SummaryObserver!=='1'){
      root.dataset.controlV4SummaryObserver='1';
      const observer=new MutationObserver(queueSummaryRestore);
      observer.observe(root,{childList:true,subtree:true});
    }
    queueSummaryRestore();
  }

  function mount(){installScopedJournalTaps();Control.mount();Checklists.mount();installSummaryRestore()}
  function install(){
    global.renderControl=Control.render;
    global.refreshControl=Control.refresh;
    global.setControlTab=function(target){if(String(target)==='attestations'&&legacy.setControlTab){try{legacy.setControlTab.call(this,target)}catch(error){console.warn('Attestation tab side effect failed.',error)}}Control.setTab(target)};
    global.loadControlRecords=Control.loadSubmissions;
    global.loadRevisionRecords=Control.loadRevisions;
    global.loadErrorReports=Control.loadErrors;
    global.submitChecklist=Checklists.submit;
    try{renderControl=global.renderControl;refreshControl=global.refreshControl;setControlTab=global.setControlTab;loadControlRecords=global.loadControlRecords;loadRevisionRecords=global.loadRevisionRecords;loadErrorReports=global.loadErrorReports;submitChecklist=global.submitChecklist}catch(error){}
    global.renderApp=function(){if(rendering)return legacy.renderApp.apply(this,arguments);rendering=true;try{const result=legacy.renderApp.apply(this,arguments);mount();return result}finally{rendering=false}};
    try{renderApp=global.renderApp}catch(error){}
  }
  async function start(){
    if(started)return;started=true;
    ensurePhotoFitStyles();
    install();
    await Storage.open();
    await Checklists.restoreOfflineSession();
    Checklists.cacheProfile();
    if(Service.user()?.id)await Storage.migrateLegacy(Service.user().id).catch(error=>console.warn('Legacy Control migration skipped.',error));
    await Control.supporting();
    if(app.menu&&Service.authenticated())global.renderApp();
    if(Service.authenticated()){
      void Checklists.syncPending();
      if(app.activeTop==='control')void Control.loadAll();
    }
  }
  global.SovremennikControlV4=Object.freeze({VERSION,Control,Checklists,Storage,Service,renderControl:Control.render,setTab:Control.setTab,refresh:Control.refresh,loadSubmissions:Control.loadSubmissions,loadRevisions:Control.loadRevisions,submitChecklist:Checklists.submit,syncPending:Checklists.syncPending,pendingCount:Checklists.pendingCount});
  global.SovremennikOffline=Object.freeze({version:VERSION,syncPending:Checklists.syncPending,pendingCount:Checklists.pendingCount,restoreOfflineAccess:Checklists.restoreOfflineSession});
  void start();
})(window);
