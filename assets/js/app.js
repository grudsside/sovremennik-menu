const state = { menu: null, activeTop: 'home', activeMethod: 'bar', activeControl: 'checklists', controlRecords: null, revisionRecords: null, employees: null, employeesLoading: false, employeesError: '', controlLoading: false, revisionLoading: false, controlError: '', revisionError: '', auth: null };
const CONTROL_STORAGE_KEY = 'sovremennikChecklistControlV1';
const REVISION_STORAGE_KEY = 'sovremennikCoffeeRevisionV1';
const AUTH_STORAGE_KEY = 'sovremennikAuthV1';
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxsT5RXCzV6GVjpYU0DFDMWmM4vQR5t03JumsOb-hdNhtaWL7e6K4G2C9XE1cFYy-nM/exec';
const HOPPER_TARE_KG = 0.847;

// Стартовый администратор нужен, чтобы можно было войти сразу после публикации сайта.
// После обновления Google Apps Script этот же аккаунт будет также создан в листе «Сотрудники».
const BUILTIN_ADMIN = { name: 'Григорий', role: 'admin', login: 'grigory', password: '0808' };
const BUILTIN_ADMIN_TOKEN = 'builtin-admin-grigory-0808-v1';
function isBuiltinAdminCredentials(login, password){
  return String(login || '').trim().toLowerCase() === BUILTIN_ADMIN.login && String(password || '').trim() === BUILTIN_ADMIN.password;
}
function builtinAdminAuth(){
  return { token: BUILTIN_ADMIN_TOKEN, user: { name: BUILTIN_ADMIN.name, role: BUILTIN_ADMIN.role, login: BUILTIN_ADMIN.login } };
}

const ROLE_LABELS = { admin: 'Администратор', barista: 'Бариста', waiter: 'Официант', 'администратор': 'Администратор', 'бариста': 'Бариста', 'официант': 'Официант' };
const ROLE_ALIASES = { 'администратор': 'admin', 'admin': 'admin', 'бариста': 'barista', 'barista': 'barista', 'официант': 'waiter', 'waiter': 'waiter' };
const ACCESS_BY_ROLE = {
  admin: ['home','method','theory','checklists','revisions','techcards','employees','control'],
  barista: ['home','method','theory','checklists','revisions','techcards'],
  waiter: ['home','method','theory']
};
function normalizeRole(role){ return ROLE_ALIASES[String(role || '').trim().toLowerCase()] || String(role || '').trim().toLowerCase(); }
function roleLabel(role){ const normalized=normalizeRole(role); return ROLE_LABELS[normalized] || ROLE_LABELS[role] || role || '—'; }
function currentUser(){ return state.auth?.user || null; }
function currentUserName(){ return currentUser()?.name || ''; }
function getAuthToken(){ return state.auth?.token || ''; }
function isAuthenticated(){ return Boolean(getAuthToken() && currentUser()); }
function isAdmin(){ return normalizeRole(currentUser()?.role) === 'admin'; }
function saveAuth(auth){ state.auth=auth; localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth)); }
function readSavedAuth(){ try { const saved=JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null'); return saved && saved.token && saved.user ? saved : null; } catch(e){ return null; } }
function clearAuth(){ state.auth=null; localStorage.removeItem(AUTH_STORAGE_KEY); }
function hasAccess(target){ if(target==='home') return true; const role=normalizeRole(currentUser()?.role); return (ACCESS_BY_ROLE[role] || []).includes(target); }
function allMainTabs(){ const tabs=[...(state.menu?.site?.mainTabs || [])]; if(!tabs.some(t=>t.id==='employees')){ const controlIndex=tabs.findIndex(t=>t.id==='control'); tabs.splice(controlIndex>=0?controlIndex:tabs.length, 0, {id:'employees', title:'Сотрудники'}); } return tabs; }
function allowedMainTabs(){ return allMainTabs().filter(tab=>hasAccess(tab.id)); }
function ensureAllowedTop(){ const allowed=allowedMainTabs().map(t=>t.id); if(!allowed.includes(state.activeTop)) state.activeTop = allowed.includes('home') ? 'home' : (allowed[0] || 'home'); }
function showLogin(){
  document.body.classList.add('login-mode');
  document.title='Современник — вход';
  document.querySelector('.brand').textContent='Современник';
  document.querySelector('.kicker').textContent='Вход в сервис';
  document.querySelector('.muted').textContent='Введите логин и пароль, чтобы открыть рабочие разделы.';
  const userPanel=document.querySelector('#user-panel'); if(userPanel) userPanel.innerHTML='';
  document.querySelector('.main-tabs').innerHTML='';
  document.querySelector('#panels').innerHTML=`<section class="login-card"><h2>Вход для сотрудников</h2><p>После входа откроются разделы согласно вашей роли.</p><form class="login-form" id="login-form"><label>Логин<input name="login" type="text" autocomplete="username" required></label><label>Пароль<input name="password" type="password" autocomplete="current-password" required></label><button class="login-submit" type="submit">Войти</button><p class="login-error" id="login-error" aria-live="polite"></p></form><div class="login-note">Самостоятельная регистрация отключена. Новые аккаунты добавляет администратор в разделе «Сотрудники».</div></section>`;
  document.querySelector('#login-form')?.addEventListener('submit', handleLogin);
}
function fetchJsonp(params){
  if(!GOOGLE_SCRIPT_URL) return Promise.reject(new Error('Не указана ссылка Google Apps Script.'));
  return new Promise((resolve, reject)=>{
    const callbackName=`sovAuth_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const script=document.createElement('script');
    const allParams={...params, callback: callbackName, _: Date.now()};
    const query=Object.entries(allParams).filter(([,v])=>v!==undefined && v!==null).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const sep=GOOGLE_SCRIPT_URL.includes('?')?'&':'?';
    const timer=setTimeout(()=>{ cleanup(); reject(new Error('Не удалось получить ответ от сервера.')); }, 12000);
    function cleanup(){ clearTimeout(timer); delete window[callbackName]; script.remove(); }
    window[callbackName]=(response)=>{ cleanup(); if(response && response.ok) resolve(response); else reject(new Error(response?.error || 'Сервер вернул ошибку.')); };
    script.onerror=()=>{ cleanup(); reject(new Error('Не удалось подключиться к Google Apps Script.')); };
    script.src=`${GOOGLE_SCRIPT_URL}${sep}${query}`;
    document.body.appendChild(script);
  });
}
async function handleLogin(event){
  event.preventDefault();
  const form=event.currentTarget;
  const errorEl=document.querySelector('#login-error');
  const login=(form.elements.login.value||'').trim();
  const password=(form.elements.password.value||'').trim();
  if(errorEl) errorEl.textContent='Проверяю данные…';

  // Гарантированный вход для стартового администратора.
  // Сначала пробуем серверный вход, чтобы получить нормальный токен Google Apps Script.
  // Если сервер еще не обновлен или временно недоступен, входим локально, чтобы сайт не блокировался.
  if(isBuiltinAdminCredentials(login, password)){
    try {
      const response=await fetchJsonp({ action:'login', login, password });
      saveAuth({ token: response.token, user: response.user });
    } catch(error) {
      console.warn('Серверный вход для стартового администратора не сработал, включен локальный вход:', error);
      saveAuth(builtinAdminAuth());
    }
    state.activeTop='home';
    renderApp();
    return;
  }

  try {
    const response=await fetchJsonp({ action:'login', login, password });
    saveAuth({ token: response.token, user: response.user });
    state.activeTop='home';
    renderApp();
  } catch(error){
    if(errorEl) errorEl.textContent=error.message || 'Не удалось войти.';
  }
}
function handleLogout(){ clearAuth(); state.controlRecords=null; state.revisionRecords=null; state.employees=null; showLogin(); }

function esc(value) { return String(value ?? '').replace(/[&<>\"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[ch])); }
function slugify(text) { const map={'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'}; return String(text).toLowerCase().split('').map(ch=>map[ch]??ch).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
function kbjuText(kbju={}) { return `Ккал: ${kbju.calories || '____'} · Б: ${kbju.protein || '____'} · Ж: ${kbju.fat || '____'} · У: ${kbju.carbs || '____'}`; }
function itemSearchText(item) { return [item.title,item.category,item.price,item.volume,item.description,item.note,...(item.ingredients||[])].join(' ').toLowerCase(); }
function lessonSearchText(lesson) { const blockText=(lesson.blocks||[]).map(block=>{ if(block.text) return block.text; if(block.caption) return block.caption; if(block.items) return block.items.join(' '); if(block.cards) return block.cards.map(c=>`${c.title} ${c.text}`).join(' '); if(block.rows) return block.rows.flat().join(' '); return ''; }).join(' '); return [lesson.title,lesson.category,lesson.summary,lesson.level,lesson.duration,blockText].join(' ').toLowerCase(); }
function categoryGroups(items) { const map=new Map(); for(const item of items){const cat=item.category||'Без раздела'; if(!map.has(cat)) map.set(cat,[]); map.get(cat).push(item);} return Array.from(map.entries()).map(([category,items])=>({category,items})); }
function validChecklistTitles(){ return new Set((state.menu?.checklists||[]).map(doc=>doc.title)); }
function isRealChecklistRecord(record){ const titles=validChecklistTitles(); return titles.has(record.checklistTitle) && ((record.tasks||[]).length > 0 || Number(record.total||0) > 0); }

function renderPhoto(item) { if(item.image) return `<div class="photo-frame has-image"><img src="${esc(item.image)}" alt="${esc(item.title)}" loading="lazy"></div>`; return `<div class="photo-frame"><div><div class="photo-icon">+</div><div class="photo-text">место для фото</div></div></div>`; }
function renderDescription(item) { if(!item.description) return ''; if(item.descriptionCollapsed) return `<details class="description-block"><summary>Описание</summary><p>${esc(item.description)}</p></details>`; return `<p class="description">${esc(item.description)}</p>`; }
function renderFacts(item) { const facts=[]; if(item.volume) facts.push(['Объем',item.volume]); if(item.category && item.section!=='bar') facts.push(['Раздел',item.category]); facts.push(['Время приготовления',item.time||'__________']); return `<div class="facts">${facts.map(([l,v])=>`<div class="fact"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('')}</div>`; }
function renderIngredients(item) { const ingredients=item.ingredients&&item.ingredients.length?item.ingredients:['Состав уточнить']; return `<div class="ingredients"><h4>Состав</h4><ul>${ingredients.map(i=>`<li>${esc(i)}</li>`).join('')}</ul></div>`; }
function renderTags(item) { const tags=[...(item.tags||[])]; if(item.isArchive&&!tags.some(t=>t.toLowerCase().includes('архив'))) tags.push('архив'); if(!tags.length) return ''; return `<div class="tag-row">${tags.map(t=>`<span class="tag ${t.toLowerCase().includes('архив')?'archive':''}">${esc(t)}</span>`).join('')}</div>`; }
function renderNote(item) { if(!item.note) return ''; return `<details class="note"><summary>На заметку</summary><p>${esc(item.note)}</p></details>`; }
function renderCard(item) { return `<article class="product-card" data-search="${esc(itemSearchText(item))}">${renderPhoto(item)}<div class="card-body">${renderTags(item)}<div class="card-head"><h3>${esc(item.title)}</h3>${item.price?`<span class="price-badge">${esc(item.price)}</span>`:''}</div>${renderDescription(item)}${renderFacts(item)}<div class="nutrition"><h4>КБЖУ</h4><p>${esc(kbjuText(item.kbju))}</p></div>${renderIngredients(item)}${renderNote(item)}</div></article>`; }

function renderLessonBlock(block) { if(block.type==='lead') return `<p class="lesson-lead">${esc(block.text)}</p>`; if(block.type==='cards') return `<section class="lesson-block"><h4>${esc(block.title||'')}</h4><div class="mini-card-grid">${(block.cards||[]).map(card=>`<div class="mini-card"><h5>${esc(card.title)}</h5><p>${esc(card.text)}</p></div>`).join('')}</div></section>`; if(block.type==='steps') return `<section class="lesson-block"><h4>${esc(block.title||'')}</h4><ol class="lesson-list">${(block.items||[]).map(i=>`<li>${esc(i)}</li>`).join('')}</ol></section>`; if(block.type==='checklist') return `<section class="lesson-block checklist"><h4>${esc(block.title||'')}</h4><ul class="lesson-checklist">${(block.items||[]).map(i=>`<li>${esc(i)}</li>`).join('')}</ul></section>`; if(block.type==='callout') return `<aside class="lesson-callout"><h4>${esc(block.title||'Важно')}</h4><p>${esc(block.text)}</p></aside>`; if(block.type==='table') return `<section class="lesson-block"><h4>${esc(block.title||'')}</h4><div class="lesson-table-wrap"><table class="lesson-table"><thead><tr>${(block.headers||[]).map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${(block.rows||[]).map(row=>`<tr>${row.map(cell=>`<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`; return ''; }
function renderLessonCard(lesson) { const blocks=(lesson.blocks||[]).map(renderLessonBlock).join(''); return `<article class="lesson-card" data-search="${esc(lessonSearchText(lesson))}" id="lesson-${esc(lesson.id)}"><div class="lesson-content"><div class="lesson-head"><div><p class="lesson-category">${esc(lesson.category||'Теория')}</p><h3>${esc(lesson.title)}</h3></div></div><p class="lesson-summary">${esc(lesson.summary||'')}</p><div class="facts lesson-facts"><div class="fact"><span>Время</span><b>${esc(lesson.duration||'уточнить')}</b></div><div class="fact"><span>Уровень</span><b>${esc(lesson.level||'для сотрудников')}</b></div></div><details class="lesson-details"><summary>Открыть обучение</summary><div class="lesson-body">${blocks}</div></details></div></article>`; }

function renderTheoryTopPanel() { const lessons=state.menu.lessons||[]; const groups=categoryGroups(lessons); const nav=groups.map(group=>`<a class="nav-pill" href="#theory-${slugify(group.category)}">${esc(group.category)}<span>${group.items.length}</span></a>`).join(''); const sections=groups.map(group=>`<section class="lesson-section" id="theory-${slugify(group.category)}"><div class="section-heading"><p>Обучение</p><h2>${esc(group.category)}</h2></div><div class="lesson-grid">${group.items.map(renderLessonCard).join('')}</div></section>`).join(''); return `<section class="top-panel ${state.activeTop==='theory'?'active':''}" id="top-theory"><div class="section-heading"><p>Раздел</p><h2>Теория</h2></div><div class="toolbar"><div class="search-row"><input class="search" placeholder="Поиск по темам обучения, кофе, эспрессо, молоку или латте-арту" type="search"><button class="clear-btn" type="button">Сбросить</button></div><nav class="nav">${nav}</nav></div><main>${sections}</main><div class="empty-state">Ничего не найдено. Попробуйте изменить запрос.</div></section>`; }
function renderMethodPanel(tab) { const allItems=state.menu.items.filter(item=>item.section===tab.id); const groups=categoryGroups(allItems); const nav=groups.map(group=>`<a class="nav-pill" href="#${tab.id}-${slugify(group.category)}">${esc(group.category)}<span>${group.items.length}</span></a>`).join(''); const sections=groups.map(group=>`<section class="product-section" id="${tab.id}-${slugify(group.category)}"><div class="section-heading"><p>Раздел</p><h2>${esc(group.category)}</h2></div><div class="cards-grid">${group.items.map(renderCard).join('')}</div></section>`).join(''); return `<section class="tab-panel ${tab.id===state.activeMethod?'active':''}" id="panel-${tab.id}"><div class="toolbar"><div class="search-row"><input class="search" placeholder="${esc(tab.searchPlaceholder||'Поиск')}" type="search"><button class="clear-btn" type="button">Сбросить</button></div><nav class="nav">${nav}</nav></div><main>${sections}</main><div class="empty-state">Ничего не найдено. Попробуйте изменить запрос.</div></section>`; }

function renderHomeCard(icon,title,text,target){ return `<article class="home-card"><div><div class="home-icon">${esc(icon)}</div><h2>${esc(title)}</h2><p>${esc(text)}</p></div><button type="button" data-top-jump="${esc(target)}">Открыть</button></article>`; }
function renderHome(){
  const cards=[
    ['М','Методичка','Карточки напитков, кухня, десерты и архив. Основной раздел для изучения меню.','method'],
    ['Т','Теория','Обучающие материалы: кофе, молоко, латте-арт и настройка эспрессо.','theory'],
    ['✓','Чек-листы','Открытие и закрытие смены, заготовки, генеральная уборка.','checklists'],
    ['Р','Ревизии','Ежедневная ревизия кофе: вес бункера, вскрытые пачки и ответственный сотрудник.','revisions'],
    ['ТК','Тех. карты','Технологические карты напитков и заготовок: состав, количество и технология.','techcards'],
    ['С','Сотрудники','Аккаунты сотрудников, роли, логины и пароли. Доступно администратору.','employees'],
    ['К','Контроль','Общий журнал чек-листов и ревизий, отправленных сотрудниками со всех устройств.','control']
  ].filter(([, , , target])=>hasAccess(target));
  return `<section class="top-panel ${state.activeTop==='home'?'active':''}" id="top-home"><div class="home-grid">${cards.map(c=>renderHomeCard(...c)).join('')}</div></section>`;
}
function renderMethod() { const tabs=state.menu.site.methodTabs||[]; if(!tabs.some(t=>t.id===state.activeMethod) && tabs.length) state.activeMethod=tabs[0].id; const subtabs=tabs.map(tab=>`<button class="subtab ${tab.id===state.activeMethod?'active':''}" data-method-target="${esc(tab.id)}" type="button">${esc(tab.title)}</button>`).join(''); return `<section class="top-panel ${state.activeTop==='method'?'active':''}" id="top-method"><div class="section-heading"><p>Раздел</p><h2>Методичка</h2></div><div class="subtabs">${subtabs}</div><div id="method-panels">${tabs.map(renderMethodPanel).join('')}</div></section>`; }

function rowSearch(row) { return Object.values(row||{}).join(' ').toLowerCase(); }
function checklistRowLabel(row){ return [row.task, row.min?`Минимум: ${row.min}`:'', row.responsible?`Ответственный: ${row.responsible}`:''].filter(Boolean).join(' · '); }
function renderChecklistSection(section) {
  const rows=section.rows||[];
  if(section.type==='minlist') {
    return `<div class="doc-section"><h4>${esc(section.title)}</h4><div class="min-list">${rows.map((r,i)=>`<label class="min-row checkable-row"><input class="task-checkbox" type="checkbox" data-task="${esc(checklistRowLabel(r))}"><span class="custom-check"></span><span class="min-task">${esc(r.task)}</span><span class="min-value">${esc(r.min||'')}</span></label>`).join('')}</div></div>`;
  }
  return `<div class="doc-section"><h4>${esc(section.title)}</h4>${rows.map((r,i)=>`<label class="check-row checkable-row"><input class="task-checkbox" type="checkbox" data-task="${esc(checklistRowLabel(r))}"><span class="custom-check"></span><span class="check-text">${esc(r.task||'')}</span>${r.responsible?`<span class="responsible">${esc(r.responsible)}</span>`:''}</label>`).join('')}</div>`;
}
function renderSubmitPanel(doc){ return `<div class="submit-panel"><label class="employee-field">Имя сотрудника<input class="employee-name" type="text" placeholder="Например, Анна" autocomplete="name"></label><button class="submit-checklist" type="button" data-checklist-id="${esc(doc.id)}">Отправить</button><p class="submit-status" aria-live="polite"></p></div>`; }
function renderChecklistCard(doc) { const search=[doc.title,doc.description,...(doc.sections||[]).flatMap(s=>(s.rows||[]).map(rowSearch))].join(' ').toLowerCase(); const count=(doc.sections||[]).reduce((a,s)=>a+(s.rows||[]).length,0); return `<article class="doc-card" data-checklist-id="${esc(doc.id)}" data-search="${esc(search)}"><div class="doc-content"><div class="card-head"><h3>${esc(doc.title)}</h3><span class="source-badge">${count} задач</span></div><p class="description">${esc(doc.description||'')}</p><div class="doc-actions"><a class="download-link" href="${esc(doc.file)}" download>Скачать Excel</a></div><details class="doc-details"><summary>Открыть чек-лист</summary>${(doc.sections||[]).map(renderChecklistSection).join('')}${renderSubmitPanel(doc)}</details></div></article>`; }
function renderChecklists() { const docs=state.menu.checklists||[]; return `<section class="top-panel ${state.activeTop==='checklists'?'active':''}" id="top-checklists"><div class="section-heading"><p>Рабочие документы</p><h2>Чек-листы</h2></div><div class="toolbar"><div class="search-row"><input class="search" placeholder="Поиск по чек-листам и задачам" type="search"><button class="clear-btn" type="button">Сбросить</button></div></div><div class="doc-grid">${docs.map(renderChecklistCard).join('')}</div><div class="empty-state">Ничего не найдено. Попробуйте изменить запрос.</div></section>`; }

function renderRevisions(){ const today=new Date().toISOString().slice(0,10); return `<section class="top-panel ${state.activeTop==='revisions'?'active':''}" id="top-revisions"><div class="section-heading"><p>Рабочая форма</p><h2>Ревизии</h2></div><div class="revision-card"><div class="card-head"><h3>Ежедневная ревизия кофе</h3><span class="source-badge">Кофе</span></div><p class="description">Заполните данные по зерну за конкретную дату. Дата нужна, чтобы данные сотрудника и ручные данные по списаниям/iiko попадали в одну колонку.</p><form class="revision-form" id="coffee-revision-form"><div class="form-grid"><label class="employee-field">Дата ревизии<input name="revisionDate" type="date" value="${today}" required></label><label class="employee-field">Имя сотрудника<input name="employeeName" type="text" placeholder="Например, Анна" autocomplete="name" required></label><label class="employee-field">Вес бункера, кг<input name="hopperWeight" type="number" min="0" step="0.001" placeholder="Например, 1.250" required></label><label class="employee-field">Вскрыто пачек, шт.<input name="openedPacks" type="number" min="0" step="1" placeholder="Например, 3" required></label></div><button class="submit-revision" type="submit">Отправить ревизию</button><p class="submit-status revision-status" aria-live="polite"></p></form></div></section>`; }

function getLocalControlRecords(){ try { return JSON.parse(localStorage.getItem(CONTROL_STORAGE_KEY) || '[]'); } catch(e){ return []; } }
function setLocalControlRecords(records){ localStorage.setItem(CONTROL_STORAGE_KEY, JSON.stringify(records)); }
function getControlRecords(){ return Array.isArray(state.controlRecords) ? state.controlRecords : getLocalControlRecords(); }
function saveLocalControlRecord(record){ const records=getLocalControlRecords(); records.unshift(record); setLocalControlRecords(records); }
function getLocalRevisionRecords(){ try { return JSON.parse(localStorage.getItem(REVISION_STORAGE_KEY) || '[]'); } catch(e){ return []; } }
function setLocalRevisionRecords(records){ localStorage.setItem(REVISION_STORAGE_KEY, JSON.stringify(records)); }
function getRevisionRecords(){ return Array.isArray(state.revisionRecords) ? state.revisionRecords : getLocalRevisionRecords(); }
function saveLocalRevisionRecord(record){ const records=getLocalRevisionRecords(); records.unshift(record); setLocalRevisionRecords(records); }
function formatDateTime(iso){ const d=new Date(iso); return !Number.isNaN(d.getTime()) ? d.toLocaleString('ru-RU') : (iso || ''); }
function formatDateOnly(iso){ const d=new Date(iso); return !Number.isNaN(d.getTime()) ? d.toLocaleDateString('ru-RU') : (iso || ''); }
function normalizeDateKey(value){
  if(!value) return '';
  const s=String(value).trim();
  let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m) return `${m[1]}-${m[2]}-${m[3]}`;
  m=s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if(m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d=new Date(s);
  if(!Number.isNaN(d.getTime())) return d.toISOString().slice(0,10);
  return s;
}
function displayDateFromKey(key){
  const m=String(key||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : (key || '');
}
function valuePresent(value){ return value !== undefined && value !== null && String(value).trim() !== ''; }
function numberValue(value){ if(value === undefined || value === null || String(value).trim() === '') return null; const n=Number(String(value).replace(',', '.').replace(/[^0-9.\-]/g,'')); return Number.isFinite(n) ? n : null; }
function round3(value){ return Math.round(value * 1000) / 1000; }
function round4(value){ return Math.round(value * 10000) / 10000; }
function round2(value){ return Math.round(value * 100) / 100; }
function formatPercent(value){ if(value === undefined || value === null || String(value).trim() === '') return ''; const n = numberValue(value); if(n === null) return String(value); return `${round2(n)}%`; }
function revisionValueClass(label, value){ if(label !== 'Разница' && label !== 'Потери') return ''; const n = numberValue(value); if(n === null) return ''; return n >= 0 ? ' revision-positive' : ' revision-negative'; }
function safeParseJson(value, fallback){ try { return typeof value === 'string' ? JSON.parse(value) : (value ?? fallback); } catch(e){ return fallback; } }
function normalizeRemoteRecord(row){
  const tasks = safeParseJson(row.details, []);
  const createdAt = row.createdAt || row.created_at || row.created || new Date().toISOString();
  return { id: row.id || `${row.date || ''}-${row.time || ''}-${Math.random().toString(16).slice(2)}`, checklistId: row.checklistId || '', checklistTitle: row.checklistType || row.checklistTitle || '', employeeName: row.employeeName || row.employee || '', createdAt, date: row.date || '', time: row.time || '', tasks: Array.isArray(tasks) ? tasks.map(t=>({ text: t.text || t.task || 'Пункт чек-листа', checked: Boolean(t.checked) })) : [], completed: Number(row.completed || 0), total: Number(row.total || 0), percent: row.percent || '' };
}
function normalizeRevisionRecord(row){
  const createdAt = row.createdAt || row.created_at || row.created || new Date().toISOString();
  const dateKey = normalizeDateKey(row.dateKey || row.revisionDate || row.date || createdAt);
  return {
    id: row.id || `coffee-${dateKey || Math.random().toString(16).slice(2)}`,
    dateKey,
    date: row.date || displayDateFromKey(dateKey) || formatDateOnly(createdAt),
    employeeName: row.employeeName || row.employee || '',
    hopperWeight: row.hopperWeight ?? row.weight ?? '',
    openedPacks: row.openedPacks ?? row.packs ?? '',
    writeOffs: row.writeOffs || '',
    iikoSales: row.iikoSales || '',
    difference: row.difference || '',
    losses: row.losses || '',
    checked: row.checked || '',
    cleanHopperWeight: row.cleanHopperWeight || '',
    totalCoffeeUsage: row.totalCoffeeUsage || '',
    createdAt
  };
}
function mergeRevisionRecordsByDate(records){
  const map=new Map();
  const fields=['employeeName','hopperWeight','openedPacks','writeOffs','iikoSales','difference','losses','checked','cleanHopperWeight','totalCoffeeUsage'];
  for(const raw of records||[]){
    const r=normalizeRevisionRecord(raw);
    const key=r.dateKey || normalizeDateKey(r.date) || normalizeDateKey(r.createdAt);
    if(!key) continue;
    if(!map.has(key)) map.set(key,{ id:`coffee-${key}`, dateKey:key, date:displayDateFromKey(key), createdAt:r.createdAt });
    const current=map.get(key);
    for(const field of fields){ if(valuePresent(r[field])) current[field]=r[field]; }
    if(valuePresent(r.createdAt)) current.createdAt=r.createdAt;
  }
  return enrichRevisionCalculations(Array.from(map.values()).sort((a,b)=>String(a.dateKey).localeCompare(String(b.dateKey))));
}
function enrichRevisionCalculations(records){
  let previousClean = null;
  return (records||[]).map(r=>{
    const item={...r};
    const scale=numberValue(item.hopperWeight);
    const opened=numberValue(item.openedPacks);
    const writeOffs=numberValue(item.writeOffs);
    const sales=numberValue(item.iikoSales);
    const clean=scale===null ? numberValue(item.cleanHopperWeight) : round3(Math.max(0, scale - HOPPER_TARE_KG));
    if(clean!==null) item.cleanHopperWeight=String(clean);
    let usage=null;
    if(previousClean!==null && opened!==null && clean!==null) usage=round3(previousClean + opened - clean);
    item.totalCoffeeUsage = usage===null ? '' : String(usage);
    let difference=null;
    if(usage!==null && sales!==null && writeOffs!==null) difference=round3(sales - writeOffs - usage);
    item.difference = difference===null ? '' : String(difference);
    let losses=null;
    if(difference!==null && sales!==null && sales!==0) losses=round2((difference / sales) * 100);
    item.losses = losses===null ? '' : `${losses}%`;
    if(clean!==null) previousClean=clean;
    return item;
  });
}

function fetchFromSheets(view){
  if(!GOOGLE_SCRIPT_URL) return Promise.resolve([]);
  return new Promise((resolve, reject)=>{
    const callbackName = `sovremennikCallback_${view}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const script = document.createElement('script');
    const sep = GOOGLE_SCRIPT_URL.includes('?') ? '&' : '?';
    const timer = setTimeout(()=>{ cleanup(); reject(new Error('Не удалось получить данные: превышено время ожидания.')); }, 12000);
    function cleanup(){ clearTimeout(timer); delete window[callbackName]; script.remove(); }
    window[callbackName] = (response)=>{ cleanup(); if(response && response.ok){ resolve(response.rows || []); } else { reject(new Error(response?.error || 'Google Sheets вернул ошибку.')); } };
    script.onerror = ()=>{ cleanup(); reject(new Error('Не удалось подключиться к Google Sheets.')); };
    const tokenParam = getAuthToken() ? `&authToken=${encodeURIComponent(getAuthToken())}` : '';
    script.src = `${GOOGLE_SCRIPT_URL}${sep}view=${encodeURIComponent(view)}&callback=${encodeURIComponent(callbackName)}${tokenParam}&_=${Date.now()}`;
    document.body.appendChild(script);
  });
}
async function loadControlRecords(){
  state.controlLoading = true; state.controlError = ''; refreshControl();
  try { const records = (await fetchFromSheets('checklists')).map(normalizeRemoteRecord).filter(isRealChecklistRecord); state.controlRecords = records; setLocalControlRecords(records); }
  catch(error) { console.warn(error); state.controlError = error.message || 'Не удалось загрузить данные из Google Sheets.'; state.controlRecords = getLocalControlRecords(); }
  finally { state.controlLoading = false; refreshControl(); }
}
async function loadRevisionRecords(){
  state.revisionLoading = true; state.revisionError = ''; refreshControl();
  try { const records = mergeRevisionRecordsByDate(await fetchFromSheets('coffeeRevision')); state.revisionRecords = records; setLocalRevisionRecords(records); }
  catch(error) { console.warn(error); state.revisionError = error.message || 'Не удалось загрузить ревизии из Google Sheets.'; state.revisionRecords = getLocalRevisionRecords(); }
  finally { state.revisionLoading = false; refreshControl(); }
}
function sendPayloadToSheets(payload){ const withAuth={...payload, authToken:getAuthToken()}; const body = new URLSearchParams({ payload: JSON.stringify(withAuth) }); return fetch(GOOGLE_SCRIPT_URL, { method: 'POST', mode: 'no-cors', body }); }
function renderRecordDetails(record){ const tasks=record.tasks||[]; return `<details class="control-details"><summary>Показать заполненный чек-лист</summary><ul>${tasks.map(t=>`<li class="${t.checked?'done':'not-done'}"><span>${t.checked?'✓':'—'}</span>${esc(t.text)}</li>`).join('')}</ul></details>`; }
function recordDoneTotal(record){ const total=(record.tasks||[]).length || Number(record.total || 0); const done=(record.tasks||[]).filter(t=>t.checked).length || Number(record.completed || 0); return {done,total}; }
function renderControlRecordsTable(){
  const records=getControlRecords();
  if(state.controlLoading) return `<div class="empty-control"><h3>Загружаю данные чек-листов…</h3><p>Подключаюсь к Google Sheets.</p></div>`;
  if(!records.length) return `<div class="empty-control"><h3>Пока нет отправленных чек-листов</h3><p>После отправки любого чек-листа запись появится здесь. Данные берутся из общей Google Таблицы.</p>${state.controlError?`<p class="control-error">${esc(state.controlError)}</p>`:''}</div>`;
  return `<div class="control-table-wrap">${state.controlError?`<p class="control-error">${esc(state.controlError)} Показана локальная резервная копия.</p>`:''}<table class="control-table"><thead><tr><th>Дата и время</th><th>Сотрудник</th><th>Чек-лист</th><th>Выполнено</th><th>Детали</th></tr></thead><tbody>${records.map(r=>{const {done,total}=recordDoneTotal(r); return `<tr><td>${esc(formatDateTime(r.createdAt))}</td><td>${esc(r.employeeName||'')}</td><td>${esc(r.checklistTitle||'')}</td><td>${done}/${total}</td><td>${renderRecordDetails(r)}</td></tr>`;}).join('')}</tbody></table></div>`;
}
function renderRevisionRecordsTable(){
  const records=getRevisionRecords();
  if(state.revisionLoading) return `<div class="empty-control"><h3>Загружаю данные ревизий…</h3><p>Подключаюсь к Google Sheets.</p></div>`;
  if(!records.length) return `<div class="empty-control"><h3>Пока нет отправленных ревизий</h3><p>После отправки формы «Ревизия кофе» запись появится здесь и в листе «Ревизия Кофе».</p>${state.revisionError?`<p class="control-error">${esc(state.revisionError)}</p>`:''}</div>`;
  const sorted=mergeRevisionRecordsByDate(records).sort((a,b)=>String(a.dateKey||'').localeCompare(String(b.dateKey||'')));
  const cols=sorted.slice(-14);
  const rows=[
    ['Значение на весах (кг.)', r=>r.hopperWeight],
    ['Вскрыто пачек (шт.)', r=>r.openedPacks],
    ['Списания (кг.)', r=>r.writeOffs],
    ['Продажи в iiko', r=>r.iikoSales],
    ['Разница', r=>r.difference],
    ['Потери', r=>r.losses],
    ['Ответственный', r=>r.employeeName],
    ['Проверено', r=>r.checked],
    ['Чистый вес кофе в бункере', r=>r.cleanHopperWeight],
    ['Общий расход кофе', r=>r.totalCoffeeUsage],
    ['Дата и время заполнения', r=>formatDateTime(r.createdAt)]
  ];
  return `<div class="control-table-wrap">${state.revisionError?`<p class="control-error">${esc(state.revisionError)} Показана локальная резервная копия.</p>`:''}<table class="control-table revision-pivot"><thead><tr><th>Дата ревизии</th>${cols.map(r=>`<th>${esc(r.date || displayDateFromKey(r.dateKey) || formatDateOnly(r.createdAt))}</th>`).join('')}</tr></thead><tbody>${rows.map(([label,getter])=>`<tr><th>${esc(label)}</th>${cols.map(r=>{ const value=getter(r) || '—'; return `<td class="${revisionValueClass(label, value).trim()}">${esc(value)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function renderRevisionManualForm(){
  const today=new Date().toISOString().slice(0,10);
  return `<details class="revision-manual"><summary>Внести списания и продажи вручную</summary><form class="revision-form" id="revision-manual-form"><div class="form-grid"><label class="employee-field">Дата ревизии<input name="revisionDate" type="date" value="${today}" required></label><label class="employee-field">Списания, кг<input name="writeOffs" type="number" min="0" step="0.001" placeholder="Например, 0.180"></label><label class="employee-field">Продажи в iiko, кг<input name="iikoSales" type="number" min="0" step="0.001" placeholder="Например, 4.140"></label><label class="employee-field">Проверено<input name="checked" type="text" placeholder="Например, управляющий"></label></div><button class="submit-revision submit-revision-manual" type="submit">Сохранить данные</button><p class="submit-status revision-manual-status" aria-live="polite"></p></form></details>`;
}
function renderControl(){ return `<section class="top-panel ${state.activeTop==='control'?'active':''}" id="top-control"><div class="section-heading"><p>Журнал</p><h2>Контроль</h2></div><div class="subtabs control-subtabs"><button class="subtab ${state.activeControl==='checklists'?'active':''}" data-control-target="checklists" type="button">Чек-листы</button><button class="subtab ${state.activeControl==='revisions'?'active':''}" data-control-target="revisions" type="button">Ревизии</button></div><div class="control-folder ${state.activeControl==='checklists'?'active':''}" id="control-checklists"><div class="control-note"><p>Здесь отображаются только отправленные чек-листы со всех устройств. Ревизии в эту таблицу не попадают.</p><div class="doc-actions"><button type="button" class="refresh-control">Обновить данные</button><button type="button" class="download-control-csv">Скачать CSV</button></div></div><div id="control-records">${renderControlRecordsTable()}</div></div><div class="control-folder ${state.activeControl==='revisions'?'active':''}" id="control-revisions"><div class="control-note"><p>Здесь отображается ежедневная ревизия кофе. Данные сотрудника и ручные данные синхронизируются в одну колонку по дате ревизии.</p><div class="doc-actions"><button type="button" class="refresh-revisions">Обновить данные</button><button type="button" class="download-revisions-csv">Скачать CSV</button></div></div>${renderRevisionManualForm()}<div id="revision-records">${renderRevisionRecordsTable()}</div></div></section>`; }
function refreshControl(){ const el=document.querySelector('#control-records'); if(el) el.innerHTML=renderControlRecordsTable(); const rev=document.querySelector('#revision-records'); if(rev) rev.innerHTML=renderRevisionRecordsTable(); }
function setControlTab(target){ state.activeControl=target; document.querySelectorAll('[data-control-target]').forEach(btn=>btn.classList.toggle('active', btn.dataset.controlTarget===target)); document.querySelectorAll('.control-folder').forEach(folder=>folder.classList.toggle('active', folder.id===`control-${target}`)); if(target==='checklists') loadControlRecords(); if(target==='revisions') loadRevisionRecords(); }
async function submitChecklist(docId){
  const doc=(state.menu.checklists||[]).find(d=>d.id===docId);
  const card=Array.from(document.querySelectorAll('.doc-card')).find(el=>el.dataset.checklistId===docId);
  if(!doc||!card) return;
  const nameInput=card.querySelector('.employee-name'); const status=card.querySelector('.submit-status'); const employeeName=(nameInput?.value||'').trim();
  if(!employeeName){ if(status){status.textContent='Введите имя сотрудника перед отправкой.'; status.className='submit-status error';} nameInput?.focus(); return; }
  const inputs=Array.from(card.querySelectorAll('.task-checkbox'));
  const tasks=inputs.map(input=>({ text: input.dataset.task || input.closest('label')?.innerText?.trim() || 'Пункт чек-листа', checked: input.checked }));
  const record={ id:`${Date.now()}-${Math.random().toString(16).slice(2)}`, checklistId:doc.id, checklistTitle:doc.title, employeeName, createdAt:new Date().toISOString(), tasks };
  const payload={ payloadType:'checklist', targetSheet:'checklists', checklistId: doc.id, checklistType: doc.title, employeeName, items: tasks };
  if(status){status.textContent='Отправляю чек-лист…'; status.className='submit-status';}
  try { await sendPayloadToSheets(payload); saveLocalControlRecord(record); if(status){status.textContent=''; status.className='submit-status';} alert('Отлично! Чек-Лист отправлен'); inputs.forEach(input=>input.checked=false); if(nameInput) nameInput.value=''; }
  catch(error) { console.error(error); saveLocalControlRecord(record); if(status){status.textContent='Не удалось подтвердить отправку. Сохранена локальная копия, проверьте подключение.'; status.className='submit-status error';} alert('Чек-лист сохранен локально, но отправка в Google Sheets не подтверждена.'); }
}
async function submitCoffeeRevision(event){
  event.preventDefault();
  const form=event.currentTarget; const status=form.querySelector('.revision-status');
  const revisionDate=(form.elements.revisionDate.value||'').trim();
  const employeeName=(form.elements.employeeName.value||'').trim();
  const hopperWeight=(form.elements.hopperWeight.value||'').trim();
  const openedPacks=(form.elements.openedPacks.value||'').trim();
  if(!revisionDate || !employeeName || hopperWeight==='' || openedPacks===''){ if(status){status.textContent='Заполните дату, имя, вес бункера и количество вскрытых пачек.'; status.className='submit-status error';} return; }
  const dateKey=normalizeDateKey(revisionDate);
  const record={ id:`rev-${Date.now()}-${Math.random().toString(16).slice(2)}`, dateKey, date:displayDateFromKey(dateKey), employeeName, hopperWeight, openedPacks, createdAt:new Date().toISOString() };
  const payload={ payloadType:'coffeeRevision', targetSheet:'coffeeRevision', revisionDate: dateKey, employeeName, hopperWeight, openedPacks };
  if(status){status.textContent='Отправляю ревизию…'; status.className='submit-status';}
  try { await sendPayloadToSheets(payload); saveLocalRevisionRecord(record); setLocalRevisionRecords(mergeRevisionRecordsByDate(getLocalRevisionRecords())); if(status){status.textContent=''; status.className='submit-status';} alert('Отлично! Ревизия отправлена'); form.reset(); form.elements.revisionDate.value=new Date().toISOString().slice(0,10); }
  catch(error) { console.error(error); saveLocalRevisionRecord(record); if(status){status.textContent='Не удалось подтвердить отправку. Сохранена локальная копия, проверьте подключение.'; status.className='submit-status error';} alert('Ревизия сохранена локально, но отправка в Google Sheets не подтверждена.'); }
}
async function submitRevisionManual(event){
  event.preventDefault();
  const form=event.currentTarget; const status=form.querySelector('.revision-manual-status');
  const revisionDate=(form.elements.revisionDate.value||'').trim();
  const writeOffs=(form.elements.writeOffs.value||'').trim();
  const iikoSales=(form.elements.iikoSales.value||'').trim();
  const checked=(form.elements.checked.value||'').trim();
  if(!revisionDate){ if(status){status.textContent='Выберите дату.'; status.className='submit-status error';} return; }
  if(writeOffs==='' && iikoSales==='' && checked===''){ if(status){status.textContent='Заполните хотя бы списания, продажи или поле проверки.'; status.className='submit-status error';} return; }
  const payload={ payloadType:'coffeeRevisionManual', targetSheet:'coffeeRevision', revisionDate: normalizeDateKey(revisionDate), writeOffs, iikoSales, checked };
  if(status){status.textContent='Сохраняю данные…'; status.className='submit-status';}
  try { await sendPayloadToSheets(payload); if(status){status.textContent=''; status.className='submit-status';} alert('Отлично! Данные ревизии сохранены'); await loadRevisionRecords(); }
  catch(error) { console.error(error); if(status){status.textContent='Не удалось подтвердить отправку. Проверьте подключение.'; status.className='submit-status error';} alert('Данные не удалось отправить в Google Sheets.'); }
}
function exportControlCsv(){ const records=getControlRecords(); const rows=[['Дата и время','Сотрудник','Чек-лист','Выполнено','Всего','Пункты']]; records.forEach(r=>{ const {done,total}=recordDoneTotal(r); const tasks=(r.tasks||[]).map(t=>`${t.checked?'✓':'—'} ${t.text}`).join(' | '); rows.push([formatDateTime(r.createdAt), r.employeeName||'', r.checklistTitle||'', done, total, tasks]); }); downloadCsv('control_checklists.csv', rows); }
function exportRevisionCsv(){ const rows=[['Дата','Дата и время','Сотрудник','Вес бункера, кг','Вскрыто пачек, шт.','Списания, кг','Продажи iiko','Разница','Потери','Проверено']]; getRevisionRecords().forEach(r=>rows.push([r.date||displayDateFromKey(r.dateKey)||formatDateOnly(r.createdAt), formatDateTime(r.createdAt), r.employeeName||'', r.hopperWeight||'', r.openedPacks||'', r.writeOffs||'', r.iikoSales||'', r.difference||'', r.losses||'', r.checked||''])); downloadCsv('coffee_revisions.csv', rows); }
function downloadCsv(filename, rows){ const csv=rows.map(row=>row.map(cell=>`"${String(cell).replace(/"/g,'""')}"`).join(';')).join('\n'); const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }

function techSearch(card) { return [card.title, card.category, card.source, card.technology, card.output, ...(card.ingredients||[]).map(i=>`${i.name} ${i.amount}`)].join(' ').toLowerCase(); }
function renderTechCard(card) { return `<article class="tech-card" data-search="${esc(techSearch(card))}"><div class="tech-content"><div class="card-head"><h3>${esc(card.title)}</h3><span class="source-badge">${esc(card.source)}</span></div><div class="tech-meta"><span>${esc(card.category||'Без раздела')}</span>${card.output?`<span>Выход: ${esc(card.output)}</span>`:''}</div>${card.technology?`<p class="description">${esc(card.technology)}</p>`:''}<details class="tech-details"><summary>Ингредиенты</summary><div class="lesson-table-wrap"><table class="ingredient-table"><thead><tr><th>Ингредиент</th><th>Кол-во</th></tr></thead><tbody>${(card.ingredients||[]).map(i=>`<tr><td>${esc(i.name)}</td><td>${esc(i.amount||'')}</td></tr>`).join('')}</tbody></table></div></details></div></article>`; }
function renderTechDocument(doc) { const groups=categoryGroups(doc.cards||[]); return `<section class="tech-document"><div class="doc-card"><div class="doc-content"><div class="card-head"><h3>${esc(doc.title)}</h3><span class="source-badge">${(doc.cards||[]).length} карт</span></div><p class="description">${esc(doc.description||'')}</p><div class="doc-actions"><a class="download-link" href="${esc(doc.file)}" download>Скачать Excel</a><span class="secondary-link">${esc(doc.sourceFile)}</span></div></div></div>${groups.map(group=>`<section class="product-section" id="tech-${slugify(doc.id)}-${slugify(group.category)}"><div class="section-heading"><p>Категория</p><h2>${esc(group.category)}</h2></div><div class="tech-grid">${group.items.map(renderTechCard).join('')}</div></section>`).join('')}</section>`; }
function renderTechCards() { const docs=state.menu.techCards||[]; return `<section class="top-panel ${state.activeTop==='techcards'?'active':''}" id="top-techcards"><div class="section-heading"><p>Рабочие документы</p><h2>Тех. карты</h2></div><div class="toolbar"><div class="search-row"><input class="search" placeholder="Поиск по тех. картам, ингредиентам или технологии" type="search"><button class="clear-btn" type="button">Сбросить</button></div><nav class="nav">${docs.map(doc=>`<a class="nav-pill" href="#tech-${slugify(doc.id)}">${esc(doc.title)}<span>${(doc.cards||[]).length}</span></a>`).join('')}</nav></div><div class="tech-docs">${docs.map(doc=>`<div id="tech-${slugify(doc.id)}">${renderTechDocument(doc)}</div>`).join('')}</div><div class="empty-state">Ничего не найдено. Попробуйте изменить запрос.</div></section>`; }



function normalizeEmployee(row){ return { id: row.id || row.login || Math.random().toString(16).slice(2), name: row.name || row.employeeName || '', role: normalizeRole(row.role || ''), login: row.login || '', password: row.password || '' }; }
function dedupeEmployees(rows){
  const map=new Map();
  (rows||[]).forEach(row=>{
    const e=normalizeEmployee(row);
    const key=(e.login||'').trim().toLowerCase();
    if(!key) return;
    if(!map.has(key)) map.set(key,e);
  });
  return Array.from(map.values());
}
async function loadEmployees(){
  if(!isAdmin()) return;
  state.employeesLoading=true; state.employeesError=''; refreshEmployees();
  try { state.employees=dedupeEmployees(await fetchFromSheets('employees')); }
  catch(error){ console.warn(error); state.employeesError=error.message || 'Не удалось загрузить сотрудников.'; state.employees=state.employees || []; }
  finally { state.employeesLoading=false; refreshEmployees(); }
}
function canDeleteEmployee(e){
  if(!isAdmin()) return false;
  const login=(e.login||'').trim().toLowerCase();
  const current=(currentUser()?.login||'').trim().toLowerCase();
  if(login && login===current) return false;
  if(login===BUILTIN_ADMIN.login) return false;
  return Boolean(login);
}
function renderEmployeesTable(){
  if(!isAdmin()) return `<div class="empty-control"><h3>Нет доступа</h3><p>Раздел доступен только администратору.</p></div>`;
  if(state.employeesLoading) return `<div class="empty-control"><h3>Загружаю сотрудников…</h3><p>Подключаюсь к Google Sheets.</p></div>`;
  const rows=dedupeEmployees(state.employees || []);
  if(!rows.length) return `<div class="empty-control"><h3>Список пока пуст</h3><p>После обновления Google Apps Script здесь появится стартовый аккаунт администратора.</p>${state.employeesError?`<p class="employees-error">${esc(state.employeesError)}</p>`:''}</div>`;
  return `<div class="employee-table-wrap">${state.employeesError?`<p class="employees-error">${esc(state.employeesError)}</p>`:''}<table class="employee-table"><thead><tr><th>Имя</th><th>Роль</th><th>Логин</th><th>Пароль</th><th>Действие</th></tr></thead><tbody>${rows.map(e=>`<tr><td>${esc(e.name)}</td><td><span class="role-badge">${esc(roleLabel(e.role))}</span></td><td>${esc(e.login)}</td><td class="password-cell">${esc(e.password)}</td><td>${canDeleteEmployee(e)?`<button class="employee-delete" type="button" data-employee-delete="${esc(e.login)}">Удалить</button>`:`<span class="muted-action">—</span>`}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderEmployees(){
  if(!isAdmin()) return '';
  return `<section class="top-panel ${state.activeTop==='employees'?'active':''}" id="top-employees"><div class="section-heading"><p>Администрирование</p><h2>Сотрудники</h2></div><div class="employees-grid"><div class="employee-list-card"><div class="card-head"><h3>Список сотрудников</h3><span class="source-badge">аккаунты</span></div><p class="description">Это база аккаунтов сотрудников. Входы в систему здесь не фиксируются, каждый логин отображается один раз.</p><div id="employees-table">${renderEmployeesTable()}</div></div><div class="employee-form-card"><div class="card-head"><h3>Добавить нового сотрудника</h3><span class="source-badge">admin</span></div><form class="employee-form" id="employee-form"><label>Имя<input name="name" type="text" placeholder="Например, Анна" required></label><label>Роль<select name="role" required><option value="barista">Бариста</option><option value="waiter">Официант</option><option value="admin">Администратор</option></select></label><label>Логин<input name="login" type="text" placeholder="anna" required></label><label>Пароль<input name="password" type="text" placeholder="например 1234" required></label><button class="employee-submit" type="submit">Добавить сотрудника</button><p class="submit-status employee-status" aria-live="polite"></p></form></div></div></section>`;
}
function refreshEmployees(){ const el=document.querySelector('#employees-table'); if(el) el.innerHTML=renderEmployeesTable(); }
async function submitEmployeeForm(event){
  event.preventDefault();
  if(!isAdmin()) return alert('Добавлять сотрудников может только администратор.');
  const form=event.currentTarget; const status=form.querySelector('.employee-status');
  const employee={ name:(form.elements.name.value||'').trim(), role:normalizeRole(form.elements.role.value), login:(form.elements.login.value||'').trim(), password:(form.elements.password.value||'').trim() };
  if(!employee.name || !employee.login || !employee.password){ if(status){status.textContent='Заполните все поля.'; status.className='submit-status error';} return; }
  if(status){ status.textContent='Сохраняю сотрудника…'; status.className='submit-status'; }
  try { await sendPayloadToSheets({ payloadType:'employeeAdd', employee }); if(status){ status.textContent=''; } alert('Сотрудник добавлен'); form.reset(); await loadEmployees(); }
  catch(error){ console.error(error); if(status){ status.textContent='Не удалось отправить данные.'; status.className='submit-status error'; } }
}
async function deleteEmployee(login){
  if(!isAdmin()) return alert('Удалять сотрудников может только администратор.');
  const normalized=(login||'').trim();
  if(!normalized) return;
  if(normalized.toLowerCase()===BUILTIN_ADMIN.login) return alert('Стартовый аккаунт администратора удалить нельзя.');
  if(!confirm(`Удалить аккаунт «${normalized}»?`)) return;
  try { await sendPayloadToSheets({ payloadType:'employeeDelete', login: normalized }); alert('Аккаунт удален'); await loadEmployees(); }
  catch(error){ console.error(error); alert('Не удалось удалить аккаунт. Проверьте Google Apps Script.'); }
}

function renderApp(){
  if(!isAuthenticated()) return showLogin();
  document.body.classList.remove('login-mode');
  const {site}=state.menu;
  ensureAllowedTop();
  if(!(site.methodTabs||[]).some(t=>t.id===state.activeMethod) && (site.methodTabs||[]).length) state.activeMethod=site.methodTabs[0].id;
  document.title=`${site.title} — база сотрудников`;
  document.querySelector('.brand').textContent=site.title;
  document.querySelector('.kicker').textContent=site.subtitle;
  document.querySelector('.muted').textContent=site.description;
  const user=currentUser();
  const userPanel=document.querySelector('#user-panel');
  if(userPanel) userPanel.innerHTML=`<span class="user-chip">${esc(user.name)} · ${esc(roleLabel(user.role))}</span><button type="button" class="logout-btn">Выйти</button>`;
  const tabs=allowedMainTabs();
  document.querySelector('.main-tabs').innerHTML=tabs.map(tab=>`<button class="main-tab ${tab.id===state.activeTop?'active':''}" data-top-target="${esc(tab.id)}" type="button">${esc(tab.title)}</button>`).join('');
  document.querySelector('#panels').innerHTML=
    renderHome()+
    (hasAccess('method')?renderMethod():'')+
    (hasAccess('theory')?renderTheoryTopPanel():'')+
    (hasAccess('checklists')?renderChecklists():'')+
    (hasAccess('revisions')?renderRevisions():'')+
    (hasAccess('techcards')?renderTechCards():'')+
    (hasAccess('employees')?renderEmployees():'')+
    (hasAccess('control')?renderControl():'');
  bindEvents();
  if(state.activeTop==='employees' && !state.employees) loadEmployees();
  if(state.activeTop==='control'){ loadControlRecords(); loadRevisionRecords(); }
}
function setTop(target){
  if(!hasAccess(target)) target='home';
  state.activeTop=target;
  document.querySelectorAll('.main-tab').forEach(b=>b.classList.toggle('active',b.dataset.topTarget===target));
  document.querySelectorAll('.top-panel').forEach(panel=>panel.classList.toggle('active',panel.id===`top-${target}`));
  history.replaceState(null,'',`#${target}`);
  window.scrollTo({top:0,behavior:'smooth'});
  if(target==='control'){ loadControlRecords(); loadRevisionRecords(); }
  if(target==='employees') loadEmployees();
}
function bindSearch(panel, selector) { const input=panel?.querySelector('.search'); if(!input) return; const clear=panel.querySelector('.clear-btn'); const searchableCards=Array.from(panel.querySelectorAll(selector)); const empty=panel.querySelector('.empty-state'); const filter=()=>{ const q=(input.value||'').trim().toLowerCase(); let visible=0; searchableCards.forEach(card=>{const ok=!q||(card.dataset.search||card.textContent).toLowerCase().includes(q); card.classList.toggle('hidden',!ok); if(ok) visible+=1;}); if(empty) empty.classList.toggle('show', visible===0); }; input.addEventListener('input',filter); clear&&clear.addEventListener('click',()=>{input.value='';filter();input.focus();}); }
function bindEvents(){
  document.querySelectorAll('[data-top-target]').forEach(btn=>btn.addEventListener('click',()=>setTop(btn.dataset.topTarget)));
  document.querySelectorAll('[data-top-jump]').forEach(btn=>btn.addEventListener('click',()=>setTop(btn.dataset.topJump)));
  document.querySelector('.logout-btn')?.addEventListener('click',handleLogout);
  document.querySelectorAll('[data-method-target]').forEach(btn=>{ btn.addEventListener('click',()=>{state.activeMethod=btn.dataset.methodTarget; document.querySelectorAll('.subtab').forEach(b=>b.classList.toggle('active',b===btn)); document.querySelectorAll('#method-panels .tab-panel').forEach(panel=>panel.classList.toggle('active',panel.id===`panel-${state.activeMethod}`)); history.replaceState(null,'',`#method/${state.activeMethod}`);}); });
  document.querySelectorAll('[data-control-target]').forEach(btn=>btn.addEventListener('click',()=>setControlTab(btn.dataset.controlTarget)));
  document.querySelectorAll('#method-panels .tab-panel').forEach(panel=>bindSearch(panel,'.product-card, .lesson-card'));
  bindSearch(document.querySelector('#top-theory'),'.lesson-card');
  bindSearch(document.querySelector('#top-checklists'),'.doc-card');
  bindSearch(document.querySelector('#top-techcards'),'.tech-card');
  document.querySelectorAll('.submit-checklist').forEach(btn=>btn.addEventListener('click',()=>submitChecklist(btn.dataset.checklistId)));
  document.querySelector('#coffee-revision-form')?.addEventListener('submit',submitCoffeeRevision);
  document.querySelector('#revision-manual-form')?.addEventListener('submit',submitRevisionManual);
  document.querySelector('#employee-form')?.addEventListener('submit',submitEmployeeForm);
  document.querySelectorAll('[data-employee-delete]').forEach(btn=>btn.addEventListener('click',()=>deleteEmployee(btn.dataset.employeeDelete)));
  document.querySelector('.download-control-csv')?.addEventListener('click',exportControlCsv);
  document.querySelector('.refresh-control')?.addEventListener('click',loadControlRecords);
  document.querySelector('.download-revisions-csv')?.addEventListener('click',exportRevisionCsv);
  document.querySelector('.refresh-revisions')?.addEventListener('click',loadRevisionRecords);
}
function readEmbeddedMenu() { const el=document.getElementById('menu-data'); if(!el) return null; try {return JSON.parse(el.textContent);} catch(error){console.error('Не удалось прочитать встроенные данные', error); return null;} }
async function loadMenu() { const embedded=readEmbeddedMenu(); if(location.protocol==='file:' && embedded) return embedded; try { const res=await fetch('data/menu.json',{cache:'no-cache'}); if(!res.ok) throw new Error(`Не удалось загрузить data/menu.json: ${res.status}`); return await res.json(); } catch(error) { console.warn('Не удалось загрузить data/menu.json, использую встроенную копию данных', error); if(embedded) return embedded; throw error; } }
async function init(){
  try {
    state.menu=await loadMenu();
    state.auth=readSavedAuth();
    const hash=location.hash.replace('#','');
    if(hash.includes('/')) { const [top, method]=hash.split('/'); if((state.menu.site.mainTabs||[]).some(t=>t.id===top) || top==='employees') state.activeTop=top; if((state.menu.site.methodTabs||[]).some(t=>t.id===method)) state.activeMethod=method; }
    else if((state.menu.site.mainTabs||[]).some(t=>t.id===hash) || hash==='employees') { state.activeTop=hash; }
    renderApp();
  } catch(error) {
    document.querySelector('#panels').innerHTML=`<div class="error">Сайт загружен, но не удалось прочитать данные. Проверьте, что рядом с index.html есть папка <b>data</b> с файлом <b>menu.json</b>. Детали: ${esc(error.message)}</div>`; console.error(error);
  }
}

/* --- v12: задачи, ошибки, расписание, обновленная главная --- */
Object.assign(state, {
  activeControl: state.activeControl || 'checklists',
  tasks: null,
  taskLoading: false,
  taskError: '',
  errorReports: null,
  errorReportsLoading: false,
  errorReportsError: '',
  scheduleEvents: null,
  scheduleLoading: false,
  scheduleError: '',
  scheduleMonth: new Date().toISOString().slice(0,7)
});
ACCESS_BY_ROLE.admin = ['home','method','theory','checklists','revisions','techcards','schedule','reportError','employees','control'];
ACCESS_BY_ROLE.barista = ['home','method','theory','checklists','revisions','techcards','schedule','reportError'];
ACCESS_BY_ROLE.waiter = ['home','method','theory','schedule','reportError'];

const TASKS_STORAGE_KEY = 'sovremennikTasksV1';
const ERROR_REPORTS_STORAGE_KEY = 'sovremennikErrorReportsV1';
const SCHEDULE_STORAGE_KEY = 'sovremennikScheduleEventsV1';

function allMainTabs(){
  const base=(state.menu?.site?.mainTabs || []).slice();
  const needed=[
    {id:'schedule',title:'Расписание'},
    {id:'reportError',title:'Сообщить об ошибке'},
    {id:'employees',title:'Сотрудники'},
    {id:'control',title:'Контроль'}
  ];
  needed.forEach(tab=>{ if(!base.some(t=>t.id===tab.id)){ const before=base.findIndex(t=>t.id==='control'); base.splice(before>=0?before:base.length,0,tab); } });
  return base;
}

function getLocalArray(key){ try{return JSON.parse(localStorage.getItem(key)||'[]')||[]}catch(e){return[]} }
function setLocalArray(key, rows){ try{localStorage.setItem(key, JSON.stringify(rows||[]));}catch(e){} }
function getTasks(){ return Array.isArray(state.tasks) ? state.tasks : getLocalArray(TASKS_STORAGE_KEY); }
function getErrorReports(){ return Array.isArray(state.errorReports) ? state.errorReports : getLocalArray(ERROR_REPORTS_STORAGE_KEY); }
function getScheduleEvents(){ return Array.isArray(state.scheduleEvents) ? state.scheduleEvents : getLocalArray(SCHEDULE_STORAGE_KEY); }
function normalizeTaskRow(row){ return { id: row.id || `task-${Date.now()}-${Math.random().toString(16).slice(2)}`, createdAt: row.createdAt || new Date().toISOString(), authorName: row.authorName || row.author || '', assignee: row.assignee || row.to || '', title: row.title || '', description: row.description || '', deadline: normalizeDateKey(row.deadline || ''), status: row.status || 'Актуальная' }; }
function normalizeErrorRow(row){ return { id: row.id || `err-${Date.now()}-${Math.random().toString(16).slice(2)}`, createdAt: row.createdAt || new Date().toISOString(), date: row.date || '', time: row.time || '', employeeName: row.employeeName || row.authorName || '', text: row.text || row.message || '' }; }
function normalizeScheduleRow(row){ return { id: row.id || `event-${Date.now()}-${Math.random().toString(16).slice(2)}`, eventDate: normalizeDateKey(row.eventDate || row.date || ''), createdAt: row.createdAt || new Date().toISOString(), type: row.type || 'Мероприятие', title: row.title || '', description: row.description || '', employeeName: row.employeeName || row.authorName || '' }; }
async function loadTasks(){ state.taskLoading=true; state.taskError=''; refreshTasks(); try{ const rows=(await fetchFromSheets('tasks')).map(normalizeTaskRow); state.tasks=rows; setLocalArray(TASKS_STORAGE_KEY, rows); } catch(error){ console.warn(error); state.taskError=error.message||'Не удалось загрузить задачи.'; state.tasks=getLocalArray(TASKS_STORAGE_KEY); } finally{ state.taskLoading=false; refreshTasks(); } }
async function loadErrorReports(){ state.errorReportsLoading=true; state.errorReportsError=''; refreshControl(); try{ const rows=(await fetchFromSheets('errors')).map(normalizeErrorRow); state.errorReports=rows; setLocalArray(ERROR_REPORTS_STORAGE_KEY, rows); } catch(error){ console.warn(error); state.errorReportsError=error.message||'Не удалось загрузить ошибки.'; state.errorReports=getLocalArray(ERROR_REPORTS_STORAGE_KEY); } finally{ state.errorReportsLoading=false; refreshControl(); } }
async function loadScheduleEvents(){ state.scheduleLoading=true; state.scheduleError=''; refreshSchedule(); try{ const rows=(await fetchFromSheets('schedule')).map(normalizeScheduleRow); state.scheduleEvents=rows; setLocalArray(SCHEDULE_STORAGE_KEY, rows); } catch(error){ console.warn(error); state.scheduleError=error.message||'Не удалось загрузить расписание.'; state.scheduleEvents=getLocalArray(SCHEDULE_STORAGE_KEY); } finally{ state.scheduleLoading=false; refreshSchedule(); } }
function activeTasks(){ const today=new Date().toISOString().slice(0,10); return getTasks().filter(t=>(t.status||'').toLowerCase()!=='выполнена').sort((a,b)=>{ const ad=a.deadline||'9999-12-31', bd=b.deadline||'9999-12-31'; return ad.localeCompare(bd) || String(b.createdAt||'').localeCompare(String(a.createdAt||'')); }); }
function renderTaskItem(task){ return `<article class="task-item"><header><div><div class="task-title">${esc(task.title||'Задача')}</div><div class="task-meta"><span>Кому: ${esc(task.assignee||'не указано')}</span><span>Поставил: ${esc(task.authorName||'—')}</span>${task.deadline?`<span class="task-deadline">до ${esc(displayDateFromKey(task.deadline))}</span>`:'<span class="task-deadline">без срока</span>'}</div></div><span class="status-pill">${esc(task.status||'Актуальная')}</span></header>${task.description?`<p class="description">${esc(task.description)}</p>`:''}</article>`; }
function renderTasksList(){ if(state.taskLoading) return `<div class="task-empty">Загружаю задачи…</div>`; const tasks=activeTasks(); if(!tasks.length) return `<div class="task-empty">Актуальных задач пока нет.</div>`; return `<div class="task-list">${tasks.map(renderTaskItem).join('')}</div>`; }
function employeeOptionsDatalist(){ const rows=dedupeEmployees(state.employees || []); return `<datalist id="employees-datalist">${rows.map(e=>`<option value="${esc(e.name || e.login)}"></option>`).join('')}</datalist>`; }
function renderTaskModal(){ const user=currentUser(); return `<div class="task-modal" id="task-modal" aria-hidden="true"><div class="task-form-card"><div class="card-head"><h3>Поставить задачу</h3><button class="small-action secondary" type="button" data-close-task-modal>Закрыть</button></div><form id="task-form"><div class="form-grid"><label>Название задачи<input name="title" type="text" required placeholder="Например, проверить витрину"></label><label>Кому<input name="assignee" type="text" list="employees-datalist" required placeholder="Имя сотрудника"></label><label>Дедлайн<input name="deadline" type="date"></label><label>Поставил<input name="authorName" type="text" value="${esc(user?.name||'')}" required></label></div><label>Описание<textarea name="description" rows="4" placeholder="Что нужно сделать и на что обратить внимание"></textarea></label><div class="task-form-actions"><button class="small-action secondary" type="button" data-close-task-modal>Отмена</button><button class="small-action" type="submit">Поставить задачу</button></div><p class="submit-status task-status" aria-live="polite"></p>${employeeOptionsDatalist()}</form></div></div>`; }
function renderHome(){ return `<section class="top-panel ${state.activeTop==='home'?'active':''}" id="top-home"><div class="home-dashboard"><div class="home-tasks-card"><div class="home-tasks-head"><div><p class="section-kicker">Главная</p><h2>Актуальные задачи</h2><p class="description">Здесь отображаются задачи, поставленные сотрудниками друг другу.</p></div><button class="small-action" type="button" data-open-task-modal>Поставить задачу</button></div><div id="tasks-list">${renderTasksList()}</div></div><div class="quick-action-card"><h3>Быстрые действия</h3><p class="description">Основные разделы доступны в верхнем меню. На главной оставлены только задачи, чтобы экран не был перегружен.</p><div class="task-status-row"><button class="small-action secondary" type="button" data-top-jump="reportError">Сообщить об ошибке</button><button class="small-action secondary" type="button" data-top-jump="schedule">Открыть расписание</button></div></div></div>${renderTaskModal()}</section>`; }
function refreshTasks(){ const el=document.querySelector('#tasks-list'); if(el) el.innerHTML=renderTasksList(); }
function openTaskModal(){ const modal=document.querySelector('#task-modal'); if(modal){ modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); } if(isAdmin() && !state.employees) loadEmployees(); }
function closeTaskModal(){ const modal=document.querySelector('#task-modal'); if(modal){ modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); } }
async function submitTask(event){ event.preventDefault(); const form=event.currentTarget; const status=form.querySelector('.task-status'); const task={ id:`task-${Date.now()}-${Math.random().toString(16).slice(2)}`, title:(form.elements.title.value||'').trim(), description:(form.elements.description.value||'').trim(), assignee:(form.elements.assignee.value||'').trim(), deadline:normalizeDateKey(form.elements.deadline.value||''), authorName:(form.elements.authorName.value||currentUserName()||'').trim(), status:'Актуальная', createdAt:new Date().toISOString() }; if(!task.title || !task.assignee || !task.authorName){ if(status){status.textContent='Заполните название, кому назначена задача и автора.'; status.className='submit-status error';} return; } try{ await sendPayloadToSheets({payloadType:'taskAdd', ...task}); const rows=[task,...getLocalArray(TASKS_STORAGE_KEY)]; setLocalArray(TASKS_STORAGE_KEY, rows); state.tasks=rows; refreshTasks(); if(status) status.textContent=''; alert('Отлично! Задача поставлена'); form.reset(); form.elements.authorName.value=currentUserName()||''; closeTaskModal(); loadTasks(); } catch(error){ console.error(error); if(status){status.textContent='Не удалось отправить задачу.'; status.className='submit-status error';} } }

function renderReportError(){ return `<section class="top-panel ${state.activeTop==='reportError'?'active':''}" id="top-reportError"><div class="section-heading"><p>Обратная связь</p><h2>Сообщить об ошибке</h2></div><div class="report-layout"><div class="report-card"><p class="description">Напишите, что не работает или что нужно исправить в методичке, чек-листах, техкартах или сервисе.</p><form class="report-form" id="error-report-form"><label>Описание ошибки<textarea name="text" required placeholder="Например: в карточке Айс латте неверный состав…"></textarea></label><button class="small-action" type="submit">Отправить</button><p class="submit-status error-report-status" aria-live="polite"></p></form></div></div></section>`; }
async function submitErrorReport(event){ event.preventDefault(); const form=event.currentTarget; const status=form.querySelector('.error-report-status'); const text=(form.elements.text.value||'').trim(); if(!text){ if(status){status.textContent='Опишите ошибку.'; status.className='submit-status error';} return; } const record={ id:`err-${Date.now()}-${Math.random().toString(16).slice(2)}`, text, employeeName:currentUserName(), createdAt:new Date().toISOString() }; try{ await sendPayloadToSheets({payloadType:'errorReport', text, employeeName:currentUserName()}); const rows=[record,...getLocalArray(ERROR_REPORTS_STORAGE_KEY)]; setLocalArray(ERROR_REPORTS_STORAGE_KEY, rows); state.errorReports=rows; if(status) status.textContent=''; alert('Отлично! Сообщение отправлено'); form.reset(); } catch(error){ console.error(error); if(status){status.textContent='Не удалось отправить сообщение.'; status.className='submit-status error';} } }
function renderErrorReportsTable(){ const rows=getErrorReports(); if(state.errorReportsLoading) return `<div class="empty-control"><h3>Загружаю ошибки…</h3><p>Подключаюсь к Google Sheets.</p></div>`; if(!rows.length) return `<div class="empty-control"><h3>Ошибок пока нет</h3><p>Сообщения сотрудников появятся здесь.</p>${state.errorReportsError?`<p class="employees-error">${esc(state.errorReportsError)}</p>`:''}</div>`; return `<div class="employee-table-wrap"><table class="employee-table errors-table"><thead><tr><th>Дата и время</th><th>Сотрудник</th><th>Сообщение</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(formatDateTime(r.createdAt)||[r.date,r.time].filter(Boolean).join(' '))}</td><td>${esc(r.employeeName||'—')}</td><td class="error-text">${esc(r.text||'')}</td></tr>`).join('')}</tbody></table></div>`; }

function monthTitle(ym){ const d=new Date(`${ym}-01T00:00:00`); return d.toLocaleDateString('ru-RU',{month:'long',year:'numeric'}); }
function shiftMonth(delta){ const [y,m]=state.scheduleMonth.split('-').map(Number); const d=new Date(y, m-1+delta, 1); state.scheduleMonth=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; refreshSchedule(); }
function eventsForDate(dateKey){ return getScheduleEvents().filter(e=>normalizeDateKey(e.eventDate)===dateKey); }
function renderScheduleGrid(){ const [year,month]=state.scheduleMonth.split('-').map(Number); const first=new Date(year,month-1,1); const start=new Date(first); const day=(first.getDay()+6)%7; start.setDate(first.getDate()-day); const days=[]; for(let i=0;i<42;i++){ const d=new Date(start); d.setDate(start.getDate()+i); const key=d.toISOString().slice(0,10); const muted=d.getMonth()!==month-1; days.push({key,day:d.getDate(),muted,events:eventsForDate(key)}); } const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс']; return `<div class="schedule-grid">${weekdays.map(w=>`<div class="schedule-weekday">${w}</div>`).join('')}${days.map(day=>`<div class="schedule-day ${day.muted?'muted':''}"><div class="schedule-date">${day.day}</div><div class="schedule-events">${day.events.map(ev=>`<div class="schedule-event"><strong>${esc(ev.title||ev.type)}</strong><span>${esc(ev.type||'Мероприятие')}${ev.employeeName?` · ${esc(ev.employeeName)}`:''}</span>${ev.description?`<span>${esc(ev.description)}</span>`:''}</div>`).join('')}</div></div>`).join('')}</div>`; }
function renderSchedule(){ const today=new Date().toISOString().slice(0,10); return `<section class="top-panel ${state.activeTop==='schedule'?'active':''}" id="top-schedule"><div class="section-heading"><p>График</p><h2>Расписание</h2></div><div class="schedule-card"><div class="schedule-toolbar"><div class="schedule-month-nav"><button class="small-action secondary" type="button" data-schedule-prev>←</button><div class="schedule-month-title">${esc(monthTitle(state.scheduleMonth))}</div><button class="small-action secondary" type="button" data-schedule-next>→</button></div><button class="small-action" type="button" data-toggle-schedule-form>Добавить мероприятие</button></div><div id="schedule-grid-wrap">${renderScheduleGrid()}</div><details class="schedule-form-wrap" id="schedule-form-wrap"><summary>Форма добавления мероприятия</summary><form class="schedule-event-form" id="schedule-event-form"><div class="form-grid"><label>Дата<input name="eventDate" type="date" value="${today}" required></label><label>Тип<select name="type"><option>Мероприятие</option><option>Смена</option><option>Обучение</option><option>Собрание</option></select></label><label>Название<input name="title" type="text" required placeholder="Например, смена Анны"></label><label>Добавил<input name="employeeName" type="text" value="${esc(currentUserName())}" required></label></div><label>Описание<textarea name="description" rows="3" placeholder="Время, участники, детали"></textarea></label><button class="small-action" type="submit">Добавить</button><p class="submit-status schedule-status" aria-live="polite"></p></form></details>${state.scheduleError?`<p class="employees-error">${esc(state.scheduleError)}</p>`:''}</div></section>`; }
function refreshSchedule(){ const wrap=document.querySelector('#schedule-grid-wrap'); if(wrap) wrap.innerHTML=renderScheduleGrid(); const title=document.querySelector('.schedule-month-title'); if(title) title.textContent=monthTitle(state.scheduleMonth); }
async function submitScheduleEvent(event){ event.preventDefault(); const form=event.currentTarget; const status=form.querySelector('.schedule-status'); const record={ id:`event-${Date.now()}-${Math.random().toString(16).slice(2)}`, eventDate:normalizeDateKey(form.elements.eventDate.value), type:(form.elements.type.value||'Мероприятие').trim(), title:(form.elements.title.value||'').trim(), description:(form.elements.description.value||'').trim(), employeeName:(form.elements.employeeName.value||currentUserName()||'').trim(), createdAt:new Date().toISOString() }; if(!record.eventDate || !record.title){ if(status){status.textContent='Заполните дату и название.'; status.className='submit-status error';} return; } try{ await sendPayloadToSheets({payloadType:'scheduleAdd', ...record}); const rows=[record,...getLocalArray(SCHEDULE_STORAGE_KEY)]; setLocalArray(SCHEDULE_STORAGE_KEY, rows); state.scheduleEvents=rows; refreshSchedule(); if(status) status.textContent=''; alert('Отлично! Мероприятие добавлено'); form.reset(); form.elements.eventDate.value=new Date().toISOString().slice(0,10); form.elements.employeeName.value=currentUserName()||''; loadScheduleEvents(); }catch(error){ console.error(error); if(status){status.textContent='Не удалось добавить мероприятие.'; status.className='submit-status error';} } }

function renderControl(){ return `<section class="top-panel ${state.activeTop==='control'?'active':''}" id="top-control"><div class="section-heading"><p>Журнал</p><h2>Контроль</h2></div><div class="subtabs control-subtabs"><button class="subtab ${state.activeControl==='checklists'?'active':''}" data-control-target="checklists" type="button">Чек-листы</button><button class="subtab ${state.activeControl==='revisions'?'active':''}" data-control-target="revisions" type="button">Ревизии</button><button class="subtab ${state.activeControl==='errors'?'active':''}" data-control-target="errors" type="button">Ошибки</button></div><div class="control-folder ${state.activeControl==='checklists'?'active':''}" id="control-checklists"><div class="control-note"><p>Здесь отображаются только отправленные чек-листы со всех устройств.</p><div class="doc-actions"><button type="button" class="refresh-control">Обновить данные</button><button type="button" class="download-control-csv">Скачать CSV</button></div></div><div id="control-records">${renderControlRecordsTable()}</div></div><div class="control-folder ${state.activeControl==='revisions'?'active':''}" id="control-revisions"><div class="control-note"><p>Здесь отображается ежедневная ревизия кофе.</p><div class="doc-actions"><button type="button" class="refresh-revisions">Обновить данные</button><button type="button" class="download-revisions-csv">Скачать CSV</button></div></div>${renderRevisionManualForm()}<div id="revision-records">${renderRevisionRecordsTable()}</div></div><div class="control-folder ${state.activeControl==='errors'?'active':''}" id="control-errors"><div class="control-note"><p>Здесь отображаются сообщения сотрудников об ошибках.</p><div class="doc-actions"><button type="button" class="refresh-errors">Обновить данные</button></div></div><div id="error-records">${renderErrorReportsTable()}</div></div></section>`; }
function refreshControl(){ const el=document.querySelector('#control-records'); if(el) el.innerHTML=renderControlRecordsTable(); const rev=document.querySelector('#revision-records'); if(rev) rev.innerHTML=renderRevisionRecordsTable(); const err=document.querySelector('#error-records'); if(err) err.innerHTML=renderErrorReportsTable(); }
function setControlTab(target){ state.activeControl=target; document.querySelectorAll('[data-control-target]').forEach(btn=>btn.classList.toggle('active', btn.dataset.controlTarget===target)); document.querySelectorAll('.control-folder').forEach(folder=>folder.classList.toggle('active', folder.id===`control-${target}`)); if(target==='checklists') loadControlRecords(); if(target==='revisions') loadRevisionRecords(); if(target==='errors') loadErrorReports(); }

function renderApp(){
  if(!isAuthenticated()) return showLogin();
  document.body.classList.remove('login-mode');
  const {site}=state.menu;
  ensureAllowedTop();
  if(!(site.methodTabs||[]).some(t=>t.id===state.activeMethod) && (site.methodTabs||[]).length) state.activeMethod=site.methodTabs[0].id;
  document.title=`${site.title} — база сотрудников`;
  document.querySelector('.brand').textContent=site.title;
  document.querySelector('.kicker').textContent=site.subtitle;
  document.querySelector('.muted').textContent=site.description;
  const user=currentUser();
  const userPanel=document.querySelector('#user-panel');
  if(userPanel) userPanel.innerHTML=`<span class="user-chip">${esc(user.name)} · ${esc(roleLabel(user.role))}</span><button type="button" class="logout-btn">Выйти</button>`;
  const tabs=allowedMainTabs();
  document.querySelector('.main-tabs').innerHTML=tabs.map(tab=>`<button class="main-tab ${tab.id===state.activeTop?'active':''} ${tab.id==='employees'&&isAdmin()?'admin-visible':''}" data-top-target="${esc(tab.id)}" type="button">${esc(tab.title)}</button>`).join('');
  document.querySelector('#panels').innerHTML=
    renderHome()+
    (hasAccess('method')?renderMethod():'')+
    (hasAccess('theory')?renderTheoryTopPanel():'')+
    (hasAccess('checklists')?renderChecklists():'')+
    (hasAccess('revisions')?renderRevisions():'')+
    (hasAccess('techcards')?renderTechCards():'')+
    (hasAccess('schedule')?renderSchedule():'')+
    (hasAccess('reportError')?renderReportError():'')+
    (hasAccess('employees')?renderEmployees():'')+
    (hasAccess('control')?renderControl():'');
  bindEvents();
  if(!state.tasks) loadTasks();
  if(isAdmin() && !state.employees) loadEmployees();
  if(state.activeTop==='schedule' && !state.scheduleEvents) loadScheduleEvents();
  if(state.activeTop==='employees' && !state.employees) loadEmployees();
  if(state.activeTop==='control'){ loadControlRecords(); loadRevisionRecords(); if(state.activeControl==='errors') loadErrorReports(); }
}
function setTop(target){
  if(!hasAccess(target)) target='home';
  state.activeTop=target;
  document.querySelectorAll('.main-tab').forEach(b=>b.classList.toggle('active',b.dataset.topTarget===target));
  document.querySelectorAll('.top-panel').forEach(panel=>panel.classList.toggle('active',panel.id===`top-${target}`));
  history.replaceState(null,'',`#${target}`);
  window.scrollTo({top:0,behavior:'smooth'});
  if(target==='home'){ loadTasks(); if(!state.employees) loadEmployees(); }
  if(target==='schedule') loadScheduleEvents();
  if(target==='control'){ loadControlRecords(); loadRevisionRecords(); if(state.activeControl==='errors') loadErrorReports(); }
  if(target==='employees') loadEmployees();
}
function bindEvents(){
  document.querySelectorAll('[data-top-target]').forEach(btn=>btn.addEventListener('click',()=>setTop(btn.dataset.topTarget)));
  document.querySelectorAll('[data-top-jump]').forEach(btn=>btn.addEventListener('click',()=>setTop(btn.dataset.topJump)));
  document.querySelector('.logout-btn')?.addEventListener('click',handleLogout);
  document.querySelectorAll('[data-method-target]').forEach(btn=>{ btn.addEventListener('click',()=>{state.activeMethod=btn.dataset.methodTarget; document.querySelectorAll('.subtab').forEach(b=>b.classList.toggle('active',b===btn)); document.querySelectorAll('#method-panels .tab-panel').forEach(panel=>panel.classList.toggle('active',panel.id===`panel-${state.activeMethod}`)); history.replaceState(null,'',`#method/${state.activeMethod}`);}); });
  document.querySelectorAll('[data-control-target]').forEach(btn=>btn.addEventListener('click',()=>setControlTab(btn.dataset.controlTarget)));
  document.querySelectorAll('#method-panels .tab-panel').forEach(panel=>bindSearch(panel,'.product-card, .lesson-card'));
  bindSearch(document.querySelector('#top-theory'),'.lesson-card');
  bindSearch(document.querySelector('#top-checklists'),'.doc-card');
  bindSearch(document.querySelector('#top-techcards'),'.tech-card');
  document.querySelectorAll('.submit-checklist').forEach(btn=>btn.addEventListener('click',()=>submitChecklist(btn.dataset.checklistId)));
  document.querySelector('#coffee-revision-form')?.addEventListener('submit',submitCoffeeRevision);
  document.querySelector('#revision-manual-form')?.addEventListener('submit',submitRevisionManual);
  document.querySelector('#employee-form')?.addEventListener('submit',submitEmployeeForm);
  document.querySelectorAll('[data-employee-delete]').forEach(btn=>btn.addEventListener('click',()=>deleteEmployee(btn.dataset.employeeDelete)));
  document.querySelector('.download-control-csv')?.addEventListener('click',exportControlCsv);
  document.querySelector('.refresh-control')?.addEventListener('click',loadControlRecords);
  document.querySelector('.download-revisions-csv')?.addEventListener('click',exportRevisionCsv);
  document.querySelector('.refresh-revisions')?.addEventListener('click',loadRevisionRecords);
  document.querySelector('.refresh-errors')?.addEventListener('click',loadErrorReports);
  document.querySelector('[data-open-task-modal]')?.addEventListener('click',openTaskModal);
  document.querySelectorAll('[data-close-task-modal]').forEach(btn=>btn.addEventListener('click',closeTaskModal));
  document.querySelector('#task-form')?.addEventListener('submit',submitTask);
  document.querySelector('#error-report-form')?.addEventListener('submit',submitErrorReport);
  document.querySelector('[data-schedule-prev]')?.addEventListener('click',()=>shiftMonth(-1));
  document.querySelector('[data-schedule-next]')?.addEventListener('click',()=>shiftMonth(1));
  document.querySelector('[data-toggle-schedule-form]')?.addEventListener('click',()=>{ const d=document.querySelector('#schedule-form-wrap'); if(d) d.open=!d.open; });
  document.querySelector('#schedule-event-form')?.addEventListener('submit',submitScheduleEvent);
}

init();
