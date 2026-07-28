/* Современник: повторная инициализация управления вопросами после авторизации администратора. */
(function(global){
  'use strict';

  let loadedAfterAuth = false;
  let loading = false;
  let timer = 0;

  function role(){
    try{
      const value = typeof currentUser === 'function' ? currentUser()?.role : '';
      return typeof normalizeRole === 'function' ? normalizeRole(value) : String(value || '').trim().toLowerCase();
    }catch(error){ return ''; }
  }
  function authenticated(){
    try{ return typeof isAuthenticated === 'function' && isAuthenticated(); }
    catch(error){ return false; }
  }

  function reloadAfterLogin(){
    if(loadedAfterAuth || loading || !authenticated() || role() !== 'admin') return;
    loading = true;
    const script = document.createElement('script');
    script.src = 'assets/js/attestations-question-management.js?v=20260728-auth-2';
    script.async = false;
    script.dataset.attestationQuestionManagementAuth = 'true';
    script.onload = () => {
      loadedAfterAuth = true;
      loading = false;
    };
    script.onerror = () => {
      loading = false;
      console.error('Attestation question management could not restart after administrator login.');
    };
    document.head.appendChild(script);
  }

  function schedule(){
    clearTimeout(timer);
    timer = setTimeout(reloadAfterLogin, 80);
  }

  document.addEventListener('submit', event => {
    if(event.target?.id === 'login-form'){
      setTimeout(reloadAfterLogin, 250);
      setTimeout(reloadAfterLogin, 900);
      setTimeout(reloadAfterLogin, 1800);
    }
  }, true);
  new MutationObserver(schedule).observe(document.documentElement, {childList:true, subtree:true});
  setInterval(reloadAfterLogin, 1500);
  schedule();
})(window);