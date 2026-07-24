/* Современник — keep the shift handoff editor focused while background refreshes finish. */
(function(){
  'use strict';

  if(window.__sovremennikShiftHandoffMobileInputFix) return;
  window.__sovremennikShiftHandoffMobileInputFix = true;

  const selector = '[data-shift-handoff-checklist] textarea, [data-shift-handoff-checklist] input:not([type="hidden"]), [data-shift-handoff-checklist] select';
  const nativeReplaceWith = Element.prototype.replaceWith;

  function isEditable(element){
    return element instanceof HTMLElement
      && element.matches(selector)
      && !element.disabled
      && !element.readOnly;
  }

  Element.prototype.replaceWith = function(){
    const active = document.activeElement;
    const protectsFocusedShiftEditor = this.matches?.('[data-shift-handoff-checklist]')
      && isEditable(active)
      && this.contains(active);

    if(protectsFocusedShiftEditor){
      this.open = true;
      return;
    }

    return nativeReplaceWith.apply(this, arguments);
  };

  document.addEventListener('focusin', event => {
    const field = event.target.closest?.(selector);
    if(!field) return;
    field.removeAttribute('readonly');
    document.documentElement.classList.add('shift-handoff-mobile-editing');
  }, true);

  document.addEventListener('focusout', event => {
    if(!event.target.closest?.(selector)) return;
    queueMicrotask(() => {
      if(!document.activeElement?.closest?.('[data-shift-handoff-checklist]')){
        document.documentElement.classList.remove('shift-handoff-mobile-editing');
      }
    });
  }, true);
})();