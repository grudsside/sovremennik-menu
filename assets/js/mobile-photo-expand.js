/* Reliable full-screen photo viewer for touch and mobile devices. */
(function(){
  'use strict';

  const MOBILE_QUERY = '(max-width: 920px), (pointer: coarse)';
  let previousOverflow = '';

  function isMobileViewer(){ return window.matchMedia(MOBILE_QUERY).matches; }

  function ensureViewer(){
    let viewer = document.querySelector('[data-mobile-photo-viewer]');
    if(viewer) return viewer;
    viewer = document.createElement('div');
    viewer.className = 'mobile-photo-viewer';
    viewer.hidden = true;
    viewer.setAttribute('data-mobile-photo-viewer', '');
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-modal', 'true');
    viewer.setAttribute('aria-label', 'Просмотр фотографии');
    viewer.innerHTML = `<button class="mobile-photo-close" type="button" data-mobile-photo-close aria-label="Закрыть фотографию">×</button><div class="mobile-photo-stage"><img alt=""></div>`;
    document.body.appendChild(viewer);
    return viewer;
  }

  function openViewer(button){
    const source = button.querySelector('img');
    if(!source?.src) return;
    const viewer = ensureViewer();
    const image = viewer.querySelector('img');
    image.src = source.currentSrc || source.src;
    image.alt = source.alt || 'Фотография';
    viewer.hidden = false;
    viewer.classList.add('open');
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    button.setAttribute('aria-expanded', 'true');
    viewer.dataset.triggerId = button.id || '';
    viewer._photoTrigger = button;
    viewer.querySelector('[data-mobile-photo-close]')?.focus({ preventScroll:true });
  }

  function closeViewer(){
    const viewer = document.querySelector('[data-mobile-photo-viewer]');
    if(!viewer || viewer.hidden) return;
    viewer.classList.remove('open');
    viewer.hidden = true;
    document.body.style.overflow = previousOverflow;
    if(viewer._photoTrigger){
      viewer._photoTrigger.setAttribute('aria-expanded', 'false');
      viewer._photoTrigger.focus({ preventScroll:true });
    }
    viewer._photoTrigger = null;
    const image = viewer.querySelector('img');
    if(image) image.removeAttribute('src');
  }

  document.addEventListener('click', event => {
    const toggle = event.target.closest('[data-photo-toggle]');
    if(toggle && isMobileViewer()){
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openViewer(toggle);
      return;
    }
    if(event.target.closest('[data-mobile-photo-close]')){
      event.preventDefault();
      closeViewer();
      return;
    }
    const viewer = event.target.closest('[data-mobile-photo-viewer]');
    if(viewer && event.target === viewer) closeViewer();
  }, true);

  document.addEventListener('keydown', event => {
    if(event.key === 'Escape') closeViewer();
  });

  window.addEventListener('orientationchange', () => {
    const viewer = document.querySelector('[data-mobile-photo-viewer]');
    if(viewer && !viewer.hidden && !isMobileViewer()) closeViewer();
  });
})();
