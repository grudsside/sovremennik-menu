/* Современник employee greeting — show the given name from surname-first profile names */
(function(global){
  'use strict';

  const VERSION = '2026-07-20-greeting-name-1';
  const GREETING_SUFFIX = 'здесь собраны актуальные задачи, расписание, чек-листы, методические материалы и рабочие документы.';

  function cleanNamePart(value){
    return String(value || '').replace(/^[,.;:]+|[,.;:]+$/g, '').trim();
  }

  function givenName(profileName){
    const parts = String(profileName || '').trim().split(/\s+/).map(cleanNamePart).filter(Boolean);
    if(!parts.length) return 'сотрудник';
    return parts.length > 1 ? parts[1] : parts[0];
  }

  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[character]));
  }

  function currentGivenName(){
    const user = typeof global.currentUser === 'function' ? global.currentUser() : null;
    return givenName(user?.name);
  }

  function greetingMarkup(){
    return `<p>${escapeHtml(currentGivenName())}, ${GREETING_SUFFIX}</p>`;
  }

  function replaceGreetingMarkup(markup){
    return String(markup || '').replace(
      /<p>[^<]*,\s*здесь собраны актуальные задачи, расписание, чек-листы, методические материалы и рабочие документы\.<\/p>/,
      greetingMarkup()
    );
  }

  const renderHomeBeforeGreetingFix = typeof global.renderHome === 'function' ? global.renderHome : null;
  if(renderHomeBeforeGreetingFix){
    const renderHomeWithGivenName = function(...args){
      return replaceGreetingMarkup(renderHomeBeforeGreetingFix.apply(this, args));
    };
    global.renderHome = renderHomeWithGivenName;
    if(typeof renderHome !== 'undefined') renderHome = renderHomeWithGivenName;
  }

  function refreshVisibleGreeting(){
    const paragraph = global.document?.querySelector?.('.v3-welcome-copy > p:not(.section-kicker)');
    if(paragraph) paragraph.textContent = `${currentGivenName()}, ${GREETING_SUFFIX}`;
  }

  global.SovremennikProfileName = Object.freeze({
    VERSION,
    givenName,
    replaceGreetingMarkup,
    refreshVisibleGreeting
  });

  refreshVisibleGreeting();
})(window);
