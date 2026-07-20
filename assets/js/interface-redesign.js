/* Современник interface redesign — DOM shell enhancement */
(function(){
  'use strict';

  const tabMeta = {
    home: ['⌂','Главная','Рабочая база и документы'],
    tasks: ['✓','Мои задачи','Актуальные задачи и сроки'],
    method: ['▤','Методичка','Меню, составы и рекомендации'],
    theory: ['◇','Теория','Обучающие материалы'],
    checklists: ['✓','Чек-листы','Рабочие задачи смены'],
    revisions: ['□','Ревизии','Учёт и расхождения'],
    techcards: ['⚗','Тех. карты','Ингредиенты и технологии'],
    schedule: ['▦','Расписание','Смены и рабочие события'],
    reportError: ['!','Сообщить об ошибке','Обратная связь по сервису'],
    employees: ['♙','Сотрудники','Управление командой'],
    control: ['▥','Контроль','Отчёты и проверки']
  };
  let enhanceQueued = false;

  function v3OwnsShell(){
    return Boolean(document.body?.dataset?.interfaceVersion);
  }

  function ensureShell(){
    const hero = document.querySelector('.hero');
    const heroCopy = document.querySelector('.hero-copy');
    const tabs = document.querySelector('.main-tabs');
    if(!hero || !heroCopy || !tabs) return;

    document.body.classList.add('interface-redesign');

    if(!heroCopy.querySelector('.shell-brand-mark')){
      const mark = document.createElement('span');
      mark.className = 'shell-brand-mark';
      mark.setAttribute('aria-hidden','true');
      mark.textContent = 'С';
      heroCopy.prepend(mark);
    }

    let context = hero.querySelector('.shell-context');
    if(!context){
      context = document.createElement('div');
      context.className = 'shell-context';
      context.innerHTML = '<button class="shell-menu-btn" type="button" aria-label="Открыть меню" aria-expanded="false"><span></span></button><div class="shell-context-copy"><strong>Главная</strong><span>Рабочая база и документы</span></div>';
      hero.insertBefore(context, document.querySelector('#user-panel'));
    }

    if(!document.querySelector('.shell-overlay')){
      const overlay = document.createElement('div');
      overlay.className = 'shell-overlay';
      overlay.setAttribute('aria-hidden','true');
      document.body.appendChild(overlay);
      if(!v3OwnsShell()) overlay.addEventListener('click', closeMenu);
    }

    // interface-v3 is the final owner of behaviour and navigation markup.
    // The structural shell above must still be restored when v3 starts before
    // DOMContentLoaded; otherwise the mobile menu button never appears.
    if(v3OwnsShell()) return;

    const menuButton = context.querySelector('.shell-menu-btn');
    if(menuButton && !menuButton.dataset.bound){
      menuButton.dataset.bound = '1';
      menuButton.addEventListener('click', function(){
        const open = document.body.classList.toggle('menu-open');
        menuButton.setAttribute('aria-expanded', String(open));
        menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
      });
    }

    enhanceTabs(tabs);
    updateContext();
  }

  function enhanceTabs(tabs){
    tabs.querySelectorAll('.main-tab').forEach(function(button){
      const target = button.dataset.topTarget || '';
      const meta = tabMeta[target] || ['•',button.textContent.trim(),'Рабочий раздел'];
      if(!button.querySelector('.shell-nav-icon')){
        const label = button.textContent.trim();
        button.textContent = '';
        const icon = document.createElement('span');
        icon.className = 'shell-nav-icon';
        icon.setAttribute('aria-hidden','true');
        icon.textContent = meta[0];
        const text = document.createElement('span');
        text.className = 'shell-nav-label';
        text.textContent = label;
        button.append(icon,text);
      }
    });
    if(!tabs.dataset.shellBound){
      tabs.dataset.shellBound = '1';
      tabs.addEventListener('click', function(event){
        const button = event.target.closest('.main-tab');
        if(!button) return;
        window.setTimeout(function(){ updateContext(button.dataset.topTarget); },0);
        closeMenu();
      });
    }
  }

  function activeTarget(){
    return document.querySelector('.main-tab.active')?.dataset.topTarget || (location.hash || '#home').slice(1).split('/')[0] || 'home';
  }

  function updateContext(target){
    if(v3OwnsShell()) return;
    const key = target || activeTarget();
    const meta = tabMeta[key] || ['•','Современник','Рабочая база и документы'];
    const copy = document.querySelector('.shell-context-copy');
    if(!copy) return;
    const title = copy.querySelector('strong');
    const subtitle = copy.querySelector('span');
    if(title && title.textContent !== meta[1]) title.textContent = meta[1];
    if(subtitle && subtitle.textContent !== meta[2]) subtitle.textContent = meta[2];
  }

  function closeMenu(){
    document.body.classList.remove('menu-open');
    const button = document.querySelector('.shell-menu-btn');
    if(button){
      button.setAttribute('aria-expanded','false');
      button.setAttribute('aria-label','Открыть меню');
    }
  }

  function queueEnsureShell(){
    if(enhanceQueued || v3OwnsShell()) return;
    enhanceQueued = true;
    window.requestAnimationFrame(function(){
      enhanceQueued = false;
      ensureShell();
    });
  }

  function observe(){
    const root = document.querySelector('.page') || document.body;
    const observer = new MutationObserver(function(mutations){
      if(v3OwnsShell()) return;
      let needsEnhance = false;
      for(const mutation of mutations){
        if(mutation.type === 'childList') needsEnhance = true;
        if(mutation.type === 'attributes' && mutation.target.classList?.contains('main-tab')) updateContext();
      }
      if(needsEnhance) queueEnsureShell();
    });
    observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  }

  document.addEventListener('keydown', function(event){
    if(event.key === 'Escape') closeMenu();
  });
  window.addEventListener('hashchange', function(){ updateContext(); closeMenu(); });
  window.addEventListener('resize', function(){ if(window.innerWidth > 920) closeMenu(); });

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ ensureShell(); observe(); });
  } else {
    ensureShell();
    observe();
  }
})();