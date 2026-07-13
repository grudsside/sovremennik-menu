window.SOVREMENNIK_SUPABASE = {
  url: 'https://tjibbzfdughhjenumzxo.supabase.co',
  anonKey: 'sb_publishable_S0QBmN0f6SYvaPXj_QFvzg_uQmdXSwJ',
  employeeFunctionUrl: 'https://tjibbzfdughhjenumzxo.supabase.co/functions/v1/admin-employees',
  notifyFunctionUrl: 'https://tjibbzfdughhjenumzxo.supabase.co/functions/v1/notify-event',
  pushSendFunctionUrl: 'https://tjibbzfdughhjenumzxo.supabase.co/functions/v1/push-send',
  deadlineFunctionUrl: 'https://tjibbzfdughhjenumzxo.supabase.co/functions/v1/deadline-checker',
  // Публичный VAPID-ключ. Приватный ключ хранится только в Supabase Secrets.
  vapidPublicKey: 'BKm7-qVECgd-74cQtk5PtnDaiUAPHpN6_3y3rCQSdC_QL-GX_QhasYVO40226QToDPmfNnxjnmLbTc-HtiEHgF0',
  loginDomain: 'sovremennik.local'
};

// Временный безопасный модуль переподписки устройств после ротации VAPID-ключей.
(function loadVapidRotationHelper(){
  const script = document.createElement('script');
  script.src = './assets/js/push-vapid-rotation.js';
  script.async = false;
  document.head.appendChild(script);
})();
