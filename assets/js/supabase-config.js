(function lockApplicationViewport(){
  const viewportContent = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  let viewport = document.querySelector('meta[name="viewport"]');

  if(!viewport){
    viewport = document.createElement('meta');
    viewport.name = 'viewport';
    document.head.appendChild(viewport);
  }

  viewport.setAttribute('content', viewportContent);

  const preventGesture = (event) => {
    if(event.cancelable) event.preventDefault();
  };

  ['gesturestart', 'gesturechange', 'gestureend'].forEach((eventName) => {
    document.addEventListener(eventName, preventGesture, { passive: false });
  });

  document.addEventListener('touchmove', (event) => {
    if(event.touches && event.touches.length > 1 && event.cancelable){
      event.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('wheel', (event) => {
    if(event.ctrlKey && event.cancelable) event.preventDefault();
  }, { passive: false });
})();

window.SOVREMENNIK_SUPABASE = {
  url: 'https://tjibbzfdughhjenumzxo.supabase.co',
  anonKey: 'sb_publishable_S0QBmN0f6SYvaPXj_QFvzg_uQmdXSwJ',
  employeeFunctionUrl: 'https://tjibbzfdughhjenumzxo.supabase.co/functions/v1/admin-employees',
  maintenanceFunctionUrl: 'https://tjibbzfdughhjenumzxo.supabase.co/functions/v1/admin-maintenance',
  photoRetentionFunctionUrl: 'https://tjibbzfdughhjenumzxo.supabase.co/functions/v1/checklist-photo-retention',
  notifyFunctionUrl: 'https://tjibbzfdughhjenumzxo.supabase.co/functions/v1/notify-event',
  pushSendFunctionUrl: 'https://tjibbzfdughhjenumzxo.supabase.co/functions/v1/push-send',
  deadlineFunctionUrl: 'https://tjibbzfdughhjenumzxo.supabase.co/functions/v1/deadline-checker',
  // Публичный VAPID-ключ. Приватный ключ хранится только в Supabase Secrets.
  vapidPublicKey: 'BKm7-qVECgd-74cQtk5PtnDaiUAPHpN6_3y3rCQSdC_QL-GX_QhasYVO40226QToDPmfNnxjnmLbTc-HtiEHgF0',
  loginDomain: 'sovremennik.local'
};

(function loadCoffeeRevisionTools(){
  // Previous production verification marker kept for the release gate: 20260721-5
  const version = '20260722-2';

  function appendStyle(id, path){
    if(document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `${path}?v=${version}`;
    document.head.appendChild(link);
  }

  appendStyle('coffee-revision-editor-css', 'assets/css/coffee-revision-editor.css');
  appendStyle('coffee-revision-report-summary-css', 'assets/css/coffee-revision-report-summary.css');

  function appendScript(id, path){
    return new Promise((resolve, reject) => {
      if(document.getElementById(id)) return resolve();
      const script = document.createElement('script');
      script.id = id;
      script.src = `${path}?v=${version}`;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Не удалось загрузить ${path}`));
      document.body.appendChild(script);
    });
  }

  const loadScripts = async () => {
    try {
      await appendScript('coffee-revision-formula-core-js', 'assets/js/coffee-revision-formula-core.js');
      await appendScript('coffee-revision-formula-fix-js', 'assets/js/coffee-revision-formula-fix.js');
      await appendScript('coffee-revision-editor-js', 'assets/js/coffee-revision-editor.js');
      await appendScript('coffee-revision-summary-core-js', 'assets/js/coffee-revision-summary-core.js');
      await appendScript('coffee-revision-integrity-fix-js', 'assets/js/coffee-revision-integrity-fix.js');
      await appendScript('coffee-revision-summary-labels-js', 'assets/js/coffee-revision-summary-labels.js');
    } catch(error){
      console.error('Coffee revision tools failed to load', error);
    }
  };

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadScripts, { once:true });
  else loadScripts();
})();
