/* Современник script loader: preserve push logic, then add the interface shell. */
/* push-legacy.js keeps loading assets/js/employee-status.js and all existing push handlers. */
document.write('<link rel="stylesheet" href="assets/css/interface-v3-hotfix.css?v=20260718-1">');
document.write('<link rel="stylesheet" href="assets/css/interface-followup.css?v=20260719-1">');
document.write('<link rel="stylesheet" href="assets/css/tasks-v2.css?v=20260720-1">');
document.write('<link rel="stylesheet" href="assets/css/schedule-manager.css?v=20260720-1">');
document.write('<link rel="stylesheet" href="assets/css/schedule-departments.css?v=20260720-2">');
document.write('<link rel="stylesheet" href="assets/css/home-shift-roles.css?v=20260722-1">');
document.write('<link rel="stylesheet" href="assets/css/schedule-shift-status-fix.css?v=20260724-1">');
document.write('<link rel="stylesheet" href="assets/css/mobile-active-panel.css?v=20260719-2">');
document.write('<link rel="stylesheet" href="assets/css/section-maintenance.css?v=20260720-1">');
document.write('<link rel="stylesheet" href="assets/css/mobile-photo-expand.css?v=20260720-1">');
document.write('<link rel="stylesheet" href="assets/css/checklist-photo-reports.css?v=20260722-1">');
document.write('<link rel="stylesheet" href="assets/css/checklist-photo-viewer-fit.css?v=20260722-1">');
document.write('<link rel="stylesheet" href="assets/css/checklist-review-tools.css?v=20260725-2">');
document.write('<link rel="stylesheet" href="assets/css/offline-reliability.css?v=20260723-1">');
document.write('<link rel="stylesheet" href="assets/css/shift-handoff.css?v=20260723-5">');
document.write('<link rel="stylesheet" href="assets/css/shift-handoff-hotfix.css?v=20260724-1">');
document.write('<link rel="stylesheet" href="assets/css/checklist-editor.css?v=20260724-1">');
document.write('<link rel="stylesheet" href="assets/css/role-interface.css?v=20260724-3">');
document.write('<link rel="stylesheet" href="assets/css/checklist-role-workflow.css?v=20260724-1">');
document.write('<link rel="stylesheet" href="assets/css/home-layout-v4.css?v=20260724-4">');
document.write('<link rel="stylesheet" href="assets/css/attestations-question-management.css?v=20260728-1">');
document.write('<script src="assets/js/push-legacy.js?v=20260718"><\/script>');
document.write('<script src="assets/js/interface-redesign.js?v=20260720-2"><\/script>');
document.write('<script src="assets/js/tasks-v2.js?v=20260720-1"><\/script>');
document.write('<script src="assets/js/interface-v3.js?v=20260720-1"><\/script>');
document.write('<script src="assets/js/greeting-name.js?v=20260720-1"><\/script>');
document.write('<script src="assets/js/schedule-manager.js?v=20260720-1"><\/script>');
document.write('<script src="assets/js/schedule-submit-fix.js?v=20260720-1"><\/script>');
document.write('<script src="assets/js/schedule-departments.js?v=20260720-2"><\/script>');
document.write('<script src="assets/js/interface-followup.js?v=20260720-1"><\/script>');
document.write('<script src="assets/js/home-shift-roles.js?v=20260722-1"><\/script>');
document.write('<script src="assets/js/schedule-shift-status-fix.js?v=20260724-1"><\/script>');
document.write('<script src="assets/js/mobile-active-panel.js?v=20260720-1"><\/script>');
document.write('<script src="assets/js/section-maintenance.js?v=20260720-1"><\/script>');
document.write('<script src="assets/js/role-interface-core.js?v=20260728-2"><\/script>');
document.write('<script src="assets/js/role-interface.js?v=20260724-2"><\/script>');
document.write('<script src="assets/js/checklist-role-core.js?v=20260724-1"><\/script>');
document.write('<script src="assets/js/checklist-role-workflow.js?v=20260724-1"><\/script>');
document.write('<script src="assets/js/mobile-photo-expand.js?v=20260720-1"><\/script>');
document.write('<script src="assets/js/checklist-details-fix.js?v=20260722-1"><\/script>');
document.write('<script src="assets/js/checklist-photo-core.js?v=20260722-1"><\/script>');
document.write('<script src="assets/js/checklist-editor-core.js?v=20260724-1"><\/script>');
document.write('<script src="assets/js/checklist-photo-reports.js?v=20260722-1"><\/script>');
document.write('<script src="assets/js/checklist-editor.js?v=20260724-1"><\/script>');
document.write('<script src="assets/js/menu-render-guard.js?v=20260724-1"><\/script>');
document.write('<script src="assets/js/offline-core.js?v=20260723-1"><\/script>');
document.write('<script src="assets/js/offline-sync.js?v=20260723-1"><\/script>');
document.write('<script src="assets/js/shift-handoff-core.js?v=20260723-1"><\/script>');
document.write('<script src="assets/js/shift-handoff.js?v=20260723-4"><\/script>');
document.write('<script src="assets/js/shift-handoff-mobile-input-fix.js?v=20260724-1"><\/script>');
document.write('<script src="assets/js/home-layout-v4.js?v=20260724-3"><\/script>');
document.write('<script src="assets/js/checklist-review-observer-guard.js?v=20260724-1"><\/script>');
document.write('<script src="assets/js/checklist-review-tools.js?v=20260725-2"><\/script>');
document.write('<script src="assets/js/checklist-photo-draft-fix.js?v=20260725-2"><\/script>');
document.write('<script src="assets/js/attestations-tab-guard.js?v=20260728-guard-1"><\/script>');

/*
 * The Control coordinator must be the final wrapper around renderApp/refreshControl.
 * Attestations are parser-loaded after push.js and also wrap these functions, so the
 * coordinator is intentionally installed on window.load, after all feature modules.
 */
(function loadControlCoordinatorLast(){
  const sources = [
    'assets/js/control-section-stability-v2.js?v=20260729-order-1',
    'assets/js/control-section-draft-key-bridge.js?v=20260729-order-1',
    'assets/js/control-viewport-jitter-fix.js?v=20260730-1'
  ];
  let loading = false;

  const loadScript = src => new Promise((resolve, reject) => {
    const path = src.split('?')[0];
    const existing = Array.from(document.scripts).find(script => script.src.includes(path));
    if(existing){
      if(existing.dataset.controlCoordinatorReady === 'true' || existing.readyState === 'complete') resolve();
      else {
        existing.addEventListener('load', resolve, { once:true });
        existing.addEventListener('error', reject, { once:true });
      }
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset.controlCoordinatorDeferred = 'true';
    script.onload = () => { script.dataset.controlCoordinatorReady = 'true'; resolve(); };
    script.onerror = reject;
    document.head.appendChild(script);
  });

  const load = async () => {
    if(loading || window.SovremennikControlSectionStability) return;
    loading = true;
    try{
      for(const source of sources) await loadScript(source);
      window.SovremennikControlCoordinatorLoad = { status:'ready', loadedAt:new Date().toISOString() };
    }catch(error){
      window.SovremennikControlCoordinatorLoad = { status:'error', message:String(error?.message || error) };
      console.error('Control section coordinator failed to load after feature modules.', error);
    }finally{
      loading = false;
    }
  };

  if(document.readyState === 'complete') setTimeout(load, 0);
  else window.addEventListener('load', load, { once:true });
})();

(function loadReadyAttestationBank(){
  const src = 'assets/js/attestations-ready-bank.js?v=20260728-ready-1';
  const load = () => {
    if(document.querySelector(`script[src="${src}"]`) || window.SovAttestationsReadyBank) return;
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset.attestationsReadyBank = 'true';
    document.head.appendChild(script);
  };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load, {once:true});
  else load();
})();

(function loadAttestationQuestionManagement(){
  const loadScript = src => new Promise((resolve, reject) => {
    const existing = Array.from(document.scripts).find(script => script.src.includes(src.split('?')[0]));
    if(existing){ resolve(); return; }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  const waitForBank = async () => {
    for(let attempt = 0; attempt < 150; attempt += 1){
      if(window.SovAttestationsCore?.__readyQuestionBankInstalled) return true;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return Boolean(window.SovAttestationsCore);
  };
  const load = async () => {
    try{
      await waitForBank();
      await loadScript('assets/js/attestations-question-management-core.js?v=20260728-1');
      await loadScript('assets/js/attestations-question-management.js?v=20260728-1');
      await loadScript('assets/js/attestations-question-management-guard.js?v=20260728-1');
      await loadScript('assets/js/attestations-question-management-buttons.js?v=20260728-1');
    }catch(error){ console.error('Attestation question management failed to load.', error); }
  };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load, {once:true});
  else load();
})();
