/* Современник — keep checklist review enhancements from observing their own Control DOM updates. */
(function(){
  'use strict';
  const NativeObserver = window.MutationObserver;
  if(!NativeObserver) return;
  let armed = true;
  function ReviewObserver(callback){
    if(!armed) return new NativeObserver(callback);
    armed = false;
    window.MutationObserver = NativeObserver;
    return new NativeObserver(records => {
      const hasExternalChange = records.some(record => {
        const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
        return !target?.closest?.('#control-records');
      });
      if(hasExternalChange) callback(records);
    });
  }
  ReviewObserver.prototype = NativeObserver.prototype;
  Object.setPrototypeOf(ReviewObserver, NativeObserver);
  window.MutationObserver = ReviewObserver;
})();
