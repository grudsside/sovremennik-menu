/* Современник — Control v4 bootstrap: one owner, no legacy runtime wrappers. */
(function(global){
  'use strict';
  if(global.SovremennikControlV4) return;
  const Core=global.SovremennikControlV4Core,Storage=global.SovremennikControlV4Storage,Service=global.SovremennikControlV4Service,Control=global.SovremennikControlV4Control,Checklists=global.SovremennikControlV4Checklists;
  const app=typeof state!=='undefined'?state:global.state;
  if(!Core||!Storage||!Service||!Control||!Checklists||!app||typeof global.renderApp!=='function'){console.error('Control v4 dependencies are unavailable.');return}
  const VERSION='2026-07-30-control-v4-1';
  const legacy=Object.freeze({renderApp:global.renderApp,setControlTab:typeof global.setControlTab==='function'?global.setControlTab:null});
  let rendering=false,started=false;
  function mount(){Control.mount();Checklists.mount()}
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
