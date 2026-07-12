const state = { menu: null, activeTop: 'home', activeMethod: 'bar', activeControl: 'checklists', controlRecords: null, revisionRecords: null, employees: null, employeesLoading: false, employeesError: '', rolePermissions: null, rolePermissionsLoading: false, rolePermissionsError: '', controlLoading: false, revisionLoading: false, controlError: '', revisionError: '', auth: null };
const CONTROL_STORAGE_KEY = 'sovremennikChecklistControlV2Clean';
const REVISION_STORAGE_KEY = 'sovremennikCoffeeRevisionV2Clean';
const AUTH_STORAGE_KEY = 'sovremennikAuthV2Clean';
const GOOGLE_SCRIPT_URL = ''; // legacy Google Apps Script disabled; Supabase is used below
const HOPPER_TARE_KG = 0.847;

const CLEAN_CACHE_VERSION = '2026-07-10-utf8-safe-v2';
function cleanupOldClientCache(){
  try {
    const versionKey = 'sovremennikClientCacheVersion';
    if (localStorage.getItem(versionKey) !== CLEAN_CACHE_VERSION) {
      [
        'sovremennikChecklistControlV1',
        'sovremennikCoffeeRevisionV1',
        'sovremennikTasksV1',
        'sovremennikErrorReportsV1',
        'sovremennikScheduleEventsV1',
        'sovremennikTaskAssigneesV1',
        'sovremennikAuthV1'
      ].forEach(key => localStorage.removeItem(key));
      localStorage.setItem(versionKey, CLEAN_CACHE_VERSION);
    }
  } catch (error) {
    console.warn('Cache cleanup skipped', error);
  }
}
cleanupOldClientCache();

// Стартовый администратор нужен, чтобы можно было войти сразу после публикации сайта.
// После обновления Supabase этот же аккаунт будет также создан в листе «Сотрудники».
const BUILTIN_ADMIN = { name: 'Григорий', role: 'admin', login: 'grigory', password: '0808' };
const BUILTIN_ADMIN_TOKEN = 'builtin-admin-grigory-0808-v2';
function isBuiltinAdminCredentials(login, password){
  return String(login || '').trim().toLowerCase() === BUILTIN_ADMIN.login && String(password || '').trim() === BUILTIN_ADMIN.password;
}
function builtinAdminAuth(){
  return { token: BUILTIN_ADMIN_TOKEN, user: { name: BUILTIN_ADMIN.name, role: BUILTIN_ADMIN.role, login: BUILTIN_ADMIN.login } };
}

const ROLE_LABELS = { admin: 'Администратор', manager: 'Руководитель', barista: 'Бариста', waiter: 'Официант', 'администратор': 'Администратор', 'руководитель': 'Руководитель', 'бариста': 'Бариста', 'официант': 'Официант' };
const ROLE_ALIASES = { 'администратор': 'admin', 'admin': 'admin', 'руководитель': 'manager', 'manager': 'manager', 'менеджер': 'manager', 'бариста': 'barista', 'barista': 'barista', 'официант': 'waiter', 'waiter': 'waiter' };
const ALL_SECTIONS = ['home','method','theory','checklists','revisions','techcards','schedule','reportError','employees','control'];
const EDITABLE_ROLES = ['manager','barista','waiter'];
const DEFAULT_ACCESS_BY_ROLE = {
  admin: ALL_SECTIONS,
  manager: ['home','method','theory','checklists','revisions','techcards','schedule','reportError','control'],
  barista: ['home','method','theory','checklists','revisions','techcards','schedule','reportError'],
  waiter: ['home','method','theory','schedule','reportError']
};
let ACCESS_BY_ROLE = DEFAULT_ACCESS_BY_ROLE;
function normalizeRole(role){ return ROLE_ALIASES[String(role || '').trim().toLowerCase()] || String(role || '').trim().toLowerCase(); }
function roleLabel(role){ const normalized=normalizeRole(role); return ROLE_LABELS[normalized] || ROLE_LABELS[role] || role || '—'; }
function currentUser(){ return state.auth?.user || null; }
function currentUserName(){ return currentUser()?.name || ''; }
function isAuthenticated(){ return Boolean(getAuthToken() && currentUser()); }
function isAdmin(){ return normalizeRole(currentUser()?.role) === 'admin'; }
function effectiveAccessByRole(){ return state.rolePermissions || DEFAULT_ACCESS_BY_ROLE; }
function hasAccess(target){ if(target==='home') return true; const role=normalizeRole(currentUser()?.role); if(role === 'admin') return true; return (effectiveAccessByRole()[role] || []).includes(target); }
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
  if(!GOOGLE_SCRIPT_URL) return Promise.reject(new Error('Не указана ссылка Supabase.'));
  return new Promise((resolve, reject)=>{
    const callbackName=`sovAuth_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const script=document.createElement('script');
    script.charset='UTF-8';
    const allParams={...params, callback: callbackName, _: Date.now()};
    const query=Object.entries(allParams).filter(([,v])=>v!==undefined && v!==null).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const sep=GOOGLE_SCRIPT_URL.includes('?')?'&':'?';
    const timer=setTimeout(()=>{ cleanup(); reject(new Error('Не удалось получить ответ от сервера.')); }, 12000);
    function cleanup(){ clearTimeout(timer); delete window[callbackName]; script.remove(); }
    window[callbackName]=(response)=>{ cleanup(); if(response && response.ok) resolve(response); else reject(new Error(response?.error || 'Сервер вернул ошибку.')); };
    script.onerror=()=>{ cleanup(); reject(new Error('Не удалось подключиться к Supabase.')); };
    script.src=`${GOOGLE_SCRIPT_URL}${sep}${query}`;
    document.body.appendChild(script);
  });
}

function esc(value) { return String(value ?? '').replace(/[&<>\"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[ch])); }
function slugify(text) { const map={'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'}; return String(text).toLowerCase().split('').map(ch=>map[ch]??ch).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
function kbjuText(kbju={}) { return `Ккал: ${kbju.calories || '____'} · Б: ${kbju.protein || '____'} · Ж: ${kbju.fat || '____'} · У: ${kbju.carbs || '____'}`; }
function itemSearchText(item) { return [item.title,item.category,item.price,item.volume,item.description,item.note,...(item.ingredients||[])].join(' ').toLowerCase(); }
function lessonSearchText(lesson) { const blockText=(lesson.blocks||[]).map(block=>{ if(block.text) return block.text; if(block.caption) return block.caption; if(block.items) return block.items.join(' '); if(block.cards) return block.cards.map(c=>`${c.title} ${c.text}`).join(' '); if(block.rows) return block.rows.flat().join(' '); return ''; }).join(' '); return [lesson.title,lesson.category,lesson.summary,lesson.level,lesson.duration,blockText].join(' ').toLowerCase(); }
function categoryGroups(items) { const map=new Map(); for(const item of items){const cat=item.category||'Без раздела'; if(!map.has(cat)) map.set(cat,[]); map.get(cat).push(item);} return Array.from(map.entries()).map(([category,items])=>({category,items})); }
function validChecklistTitles(){ return new Set((state.menu?.checklists||[]).map(doc=>doc.title)); }
function isRealChecklistRecord(record){ const titles=validChecklistTitles(); return titles.has(record.checklistTitle) && ((record.tasks||[]).length > 0 || Number(record.total||0) > 0); }

function renderDescription(item) { if(!item.description) return ''; if(item.descriptionCollapsed) return `<details class="description-block"><summary>Описание</summary><p>${esc(item.description)}</p></details>`; return `<p class="description">${esc(item.description)}</p>`; }
function renderFacts(item) { const facts=[]; if(item.volume) facts.push(['Объем',item.volume]); if(item.category && item.section!=='bar') facts.push(['Раздел',item.category]); facts.push(['Время приготовления',item.time||'__________']); return `<div class="facts">${facts.map(([l,v])=>`<div class="fact"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('')}</div>`; }
function renderIngredients(item) { const ingredients=item.ingredients&&item.ingredients.length?item.ingredients:['Состав уточнить']; return `<div class="ingredients"><h4>Состав</h4><ul>${ingredients.map(i=>`<li>${esc(i)}</li>`).join('')}</ul></div>`; }
function renderTags(item) { const tags=[...(item.tags||[])]; if(item.isArchive&&!tags.some(t=>t.toLowerCase().includes('архив'))) tags.push('архив'); if(!tags.length) return ''; return `<div class="tag-row">${tags.map(t=>`<span class="tag ${t.toLowerCase().includes('архив')?'archive':''}">${esc(t)}</span>`).join('')}</div>`; }
function renderNote(item) { if(!item.note) return ''; return `<details class="note"><summary>На заметку</summary><p>${esc(item.note)}</p></details>`; }

function renderLessonBlock(block) { if(block.type==='lead') return `<p class="lesson-lead">${esc(block.text)}</p>`; if(block.type==='cards') return `<section class="lesson-block"><h4>${esc(block.title||'')}</h4><div class="mini-card-grid">${(block.cards||[]).map(card=>`<div class="mini-card"><h5>${esc(card.title)}</h5><p>${esc(card.text)}</p></div>`).join('')}</div></section>`; if(block.type==='steps') return `<section class="lesson-block"><h4>${esc(block.title||'')}</h4><ol class="lesson-list">${(block.items||[]).map(i=>`<li>${esc(i)}</li>`).join('')}</ol></section>`; if(block.type==='checklist') return `<section class="lesson-block checklist"><h4>${esc(block.title||'')}</h4><ul class="lesson-checklist">${(block.items||[]).map(i=>`<li>${esc(i)}</li>`).join('')}</ul></section>`; if(block.type==='callout') return `<aside class="lesson-callout"><h4>${esc(block.title||'Важно')}</h4><p>${esc(block.text)}</p></aside>`; if(block.type==='table') return `<section class="lesson-block"><h4>${esc(block.title||'')}</h4><div class="lesson-table-wrap"><table class="lesson-table"><thead><tr>${(block.headers||[]).map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${(block.rows||[]).map(row=>`<tr>${row.map(cell=>`<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`; return ''; }
function renderLessonCard(lesson) { const blocks=(lesson.blocks||[]).map(renderLessonBlock).join(''); return `<article class="lesson-card" data-search="${esc(lessonSearchText(lesson))}" id="lesson-${esc(lesson.id)}"><div class="lesson-content"><div class="lesson-head"><div><p class="lesson-category">${esc(lesson.category||'Теория')}</p><h3>${esc(lesson.title)}</h3></div></div><p class="lesson-summary">${esc(lesson.summary||'')}</p><div class="facts lesson-facts"><div class="fact"><span>Время</span><b>${esc(lesson.duration||'уточнить')}</b></div><div class="fact"><span>Уровень</span><b>${esc(lesson.level||'для сотрудников')}</b></div></div><details class="lesson-details"><summary>Открыть обучение</summary><div class="lesson-body">${blocks}</div></details></div></article>`; }

function renderTheoryTopPanel() { const lessons=state.menu.lessons||[]; const groups=categoryGroups(lessons); const nav=groups.map(group=>`<a class="nav-pill" href="#theory-${slugify(group.category)}">${esc(group.category)}<span>${group.items.length}</span></a>`).join(''); const sections=groups.map(group=>`<section class="lesson-section" id="theory-${slugify(group.category)}"><div class="section-heading"><p>Обучение</p><h2>${esc(group.category)}</h2></div><div class="lesson-grid">${group.items.map(renderLessonCard).join('')}</div></section>`).join(''); return `<section class="top-panel ${state.activeTop==='theory'?'active':''}" id="top-theory"><div class="section-heading"><p>Раздел</p><h2>Теория</h2></div><div class="toolbar"><div class="search-row"><input class="search" placeholder="Поиск по темам обучения, кофе, эспрессо, молоку или латте-арту" type="search"><button class="clear-btn" type="button">Сбросить</button></div><nav class="nav">${nav}</nav></div><main>${sections}</main><div class="empty-state">Ничего не найдено. Попробуйте изменить запрос.</div></section>`; }
function renderMethodPanel(tab) { const allItems=state.menu.items.filter(item=>item.section===tab.id); const groups=categoryGroups(allItems); const nav=groups.map(group=>`<a class="nav-pill" href="#${tab.id}-${slugify(group.category)}">${esc(group.category)}<span>${group.items.length}</span></a>`).join(''); const sections=groups.map(group=>`<section class="product-section" id="${tab.id}-${slugify(group.category)}"><div class="section-heading"><p>Раздел</p><h2>${esc(group.category)}</h2></div><div class="cards-grid">${group.items.map(renderCard).join('')}</div></section>`).join(''); return `<section class="tab-panel ${tab.id===state.activeMethod?'active':''}" id="panel-${tab.id}"><div class="toolbar"><div class="search-row"><input class="search" placeholder="${esc(tab.searchPlaceholder||'Поиск')}" type="search"><button class="clear-btn" type="button">Сбросить</button></div><nav class="nav">${nav}</nav></div><main>${sections}</main><div class="empty-state">Ничего не найдено. Попробуйте изменить запрос.</div></section>`; }

function renderHomeCard(icon,title,text,target){ return `<article class="home-card"><div><div class="home-icon">${esc(icon)}</div><h2>${esc(title)}</h2><p>${esc(text)}</p></div><button type="button" data-top-jump="${esc(target)}">Открыть</button></article>`; }
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

async function loadControlRecords(){
  state.controlLoading = true; state.controlError = ''; refreshControl();
  try { const records = (await fetchFromSheets('checklists')).map(normalizeRemoteRecord).filter(isRealChecklistRecord); state.controlRecords = records; setLocalControlRecords(records); }
  catch(error) { console.warn(error); state.controlError = error.message || 'Не удалось загрузить данные из Supabase.'; state.controlRecords = getLocalControlRecords(); }
  finally { state.controlLoading = false; refreshControl(); }
}
async function loadRevisionRecords(){
  state.revisionLoading = true; state.revisionError = ''; refreshControl();
  try { const records = mergeRevisionRecordsByDate(await fetchFromSheets('coffeeRevision')); state.revisionRecords = records; setLocalRevisionRecords(records); }
  catch(error) { console.warn(error); state.revisionError = error.message || 'Не удалось загрузить ревизии из Supabase.'; state.revisionRecords = getLocalRevisionRecords(); }
  finally { state.revisionLoading = false; refreshControl(); }
}

function encodePayloadBase64(payload){
  const json = JSON.stringify(payload);
  if (window.TextEncoder) {
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    bytes.forEach(byte => binary += String.fromCharCode(byte));
    return btoa(binary);
  }
  return btoa(unescape(encodeURIComponent(json)));
}
function renderRecordDetails(record){ const tasks=record.tasks||[]; return `<details class="control-details"><summary>Показать заполненный чек-лист</summary><ul>${tasks.map(t=>`<li class="${t.checked?'done':'not-done'}"><span>${t.checked?'✓':'—'}</span>${esc(t.text)}</li>`).join('')}</ul></details>`; }
function recordDoneTotal(record){ const total=(record.tasks||[]).length || Number(record.total || 0); const done=(record.tasks||[]).filter(t=>t.checked).length || Number(record.completed || 0); return {done,total}; }
function renderControlRecordsTable(){
  const records=getControlRecords();
  if(state.controlLoading) return `<div class="empty-control"><h3>Загружаю данные чек-листов…</h3><p>Подключаюсь к Supabase.</p></div>`;
  if(!records.length) return `<div class="empty-control"><h3>Пока нет отправленных чек-листов</h3><p>После отправки любого чек-листа запись появится здесь. Данные берутся из общей Supabase.</p>${state.controlError?`<p class="control-error">${esc(state.controlError)}</p>`:''}</div>`;
  return `<div class="control-table-wrap">${state.controlError?`<p class="control-error">${esc(state.controlError)} Показана локальная резервная копия.</p>`:''}<table class="control-table"><thead><tr><th>Дата и время</th><th>Сотрудник</th><th>Чек-лист</th><th>Выполнено</th><th>Детали</th></tr></thead><tbody>${records.map(r=>{const {done,total}=recordDoneTotal(r); return `<tr><td>${esc(formatDateTime(r.createdAt))}</td><td>${esc(r.employeeName||'')}</td><td>${esc(r.checklistTitle||'')}</td><td>${done}/${total}</td><td>${renderRecordDetails(r)}</td></tr>`;}).join('')}</tbody></table></div>`;
}
function renderRevisionRecordsTable(){
  const records=getRevisionRecords();
  if(state.revisionLoading) return `<div class="empty-control"><h3>Загружаю данные ревизий…</h3><p>Подключаюсь к Supabase.</p></div>`;
  if(!records.length) return `<div class="empty-control"><h3>Пока нет отправленных ревизий</h3><p>После отправки формы «Ревизия кофе» запись появится здесь и в Supabase.</p>${state.revisionError?`<p class="control-error">${esc(state.revisionError)}</p>`:''}</div>`;
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
  catch(error) { console.error(error); saveLocalControlRecord(record); if(status){status.textContent='Не удалось подтвердить отправку. Сохранена локальная копия, проверьте подключение.'; status.className='submit-status error';} alert('Чек-лист сохранен локально, но отправка в Supabase не подтверждена.'); }
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
  catch(error) { console.error(error); saveLocalRevisionRecord(record); if(status){status.textContent='Не удалось подтвердить отправку. Сохранена локальная копия, проверьте подключение.'; status.className='submit-status error';} alert('Ревизия сохранена локально, но отправка в Supabase не подтверждена.'); }
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
  catch(error) { console.error(error); if(status){status.textContent='Не удалось подтвердить отправку. Проверьте подключение.'; status.className='submit-status error';} alert('Данные не удалось отправить в Supabase.'); }
}
function exportControlCsv(){ const records=getControlRecords(); const rows=[['Дата и время','Сотрудник','Чек-лист','Выполнено','Всего','Пункты']]; records.forEach(r=>{ const {done,total}=recordDoneTotal(r); const tasks=(r.tasks||[]).map(t=>`${t.checked?'✓':'—'} ${t.text}`).join(' | '); rows.push([formatDateTime(r.createdAt), r.employeeName||'', r.checklistTitle||'', done, total, tasks]); }); downloadCsv('control_checklists.csv', rows); }
function exportRevisionCsv(){ const rows=[['Дата','Дата и время','Сотрудник','Вес бункера, кг','Вскрыто пачек, шт.','Списания, кг','Продажи iiko','Разница','Потери','Проверено']]; getRevisionRecords().forEach(r=>rows.push([r.date||displayDateFromKey(r.dateKey)||formatDateOnly(r.createdAt), formatDateTime(r.createdAt), r.employeeName||'', r.hopperWeight||'', r.openedPacks||'', r.writeOffs||'', r.iikoSales||'', r.difference||'', r.losses||'', r.checked||''])); downloadCsv('coffee_revisions.csv', rows); }
function downloadCsv(filename, rows){ const csv=rows.map(row=>row.map(cell=>`"${String(cell).replace(/"/g,'""')}"`).join(';')).join('\n'); const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }

function techSearch(card) { return [card.title, card.category, card.source, card.technology, card.output, ...(card.ingredients||[]).map(i=>`${i.name} ${i.amount}`)].join(' ').toLowerCase(); }
function renderTechCard(card) { return `<article class="tech-card" data-search="${esc(techSearch(card))}"><div class="tech-content"><div class="card-head"><h3>${esc(card.title)}</h3><span class="source-badge">${esc(card.source)}</span></div><div class="tech-meta"><span>${esc(card.category||'Без раздела')}</span>${card.output?`<span>Выход: ${esc(card.output)}</span>`:''}</div>${card.technology?`<p class="description">${esc(card.technology)}</p>`:''}<details class="tech-details"><summary>Ингредиенты</summary><div class="lesson-table-wrap"><table class="ingredient-table"><thead><tr><th>Ингредиент</th><th>Кол-во</th></tr></thead><tbody>${(card.ingredients||[]).map(i=>`<tr><td>${esc(i.name)}</td><td>${esc(i.amount||'')}</td></tr>`).join('')}</tbody></table></div></details></div></article>`; }



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
  if(state.employeesLoading) return `<div class="empty-control"><h3>Загружаю сотрудников…</h3><p>Подключаюсь к Supabase.</p></div>`;
  const rows=dedupeEmployees(state.employees || []);
  if(!rows.length) return `<div class="empty-control"><h3>Список пока пуст</h3><p>После обновления Supabase здесь появится стартовый аккаунт администратора.</p>${state.employeesError?`<p class="employees-error">${esc(state.employeesError)}</p>`:''}</div>`;
  return `<div class="employee-table-wrap">${state.employeesError?`<p class="employees-error">${esc(state.employeesError)}</p>`:''}<table class="employee-table"><thead><tr><th>Имя</th><th>Роль</th><th>Логин</th><th>Пароль</th><th>Действие</th></tr></thead><tbody>${rows.map(e=>`<tr><td>${esc(e.name)}</td><td><span class="role-badge">${esc(roleLabel(e.role))}</span></td><td>${esc(e.login)}</td><td class="password-cell">${esc(e.password)}</td><td>${canDeleteEmployee(e)?`<button class="employee-delete" type="button" data-employee-delete="${esc(e.login)}">Удалить</button>`:`<span class="muted-action">—</span>`}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderEmployees(){
  if(!isAdmin()) return '';
  return `<section class="top-panel ${state.activeTop==='employees'?'active':''}" id="top-employees"><div class="section-heading"><p>Администрирование</p><h2>Сотрудники</h2></div><div class="employees-grid"><div class="employee-list-card"><div class="card-head"><h3>Список сотрудников</h3><span class="source-badge">аккаунты</span></div><p class="description">Это база аккаунтов сотрудников. Входы в систему здесь не фиксируются, каждый логин отображается один раз.</p><div id="employees-table">${renderEmployeesTable()}</div></div><div class="employee-form-card"><div class="card-head"><h3>Добавить нового сотрудника</h3><span class="source-badge">admin</span></div><form class="employee-form" id="employee-form"><label>Имя<input name="name" type="text" placeholder="Например, Анна" required></label><label>Роль<select name="role" required><option value="barista">Бариста</option><option value="waiter">Официант</option><option value="manager">Руководитель</option><option value="admin">Администратор</option></select></label><label>Логин<input name="login" type="text" placeholder="anna" required></label><label>Пароль<input name="password" type="text" placeholder="например 1234" required></label><button class="employee-submit" type="submit">Добавить сотрудника</button><p class="submit-status employee-status" aria-live="polite"></p></form></div></div>${renderRolePermissionsPanel()}</section>`;
}

function sectionLabel(sectionId){
  const tab = allMainTabs().find(t=>t.id===sectionId);
  return tab ? tab.title : sectionId;
}
function normalizePermissionsRows(rows){
  const permissions = JSON.parse(JSON.stringify(DEFAULT_ACCESS_BY_ROLE));
  (rows || []).forEach(row=>{
    const role = normalizeRole(row.role);
    if(role && Array.isArray(row.sections)) permissions[role] = row.sections.filter(Boolean);
  });
  permissions.admin = ALL_SECTIONS;
  return permissions;
}
function renderRolePermissionsPanel(){
  const permissions = effectiveAccessByRole();
  const sectionOptions = allMainTabs().filter(tab=>tab.id !== 'home');
  return `<div class="role-permissions-card"><div class="card-head"><h3>Права на просмотр разделов</h3><span class="source-badge">доступы</span></div><p class="description">Администратор может выбрать роль и отметить, какие разделы будут видны сотрудникам с этой ролью. Роль «Администратор» всегда видит все разделы.</p>${state.rolePermissionsError?`<p class="employees-error">${esc(state.rolePermissionsError)}</p>`:''}<form class="role-permissions-form" id="role-permissions-form"><label>Роль<select name="role">${EDITABLE_ROLES.map(role=>`<option value="${esc(role)}">${esc(roleLabel(role))}</option>`).join('')}</select></label><div class="permissions-grid">${sectionOptions.map(tab=>`<label class="permission-check"><input type="checkbox" name="sections" value="${esc(tab.id)}"> <span>${esc(tab.title)}</span></label>`).join('')}</div><button class="employee-submit" type="submit">Сохранить права</button><p class="submit-status permissions-status" aria-live="polite"></p></form></div>`;
}
function applyPermissionFormRole(role){
  const form = document.querySelector('#role-permissions-form');
  if(!form) return;
  const normalized = normalizeRole(role || form.elements.role.value);
  const sections = effectiveAccessByRole()[normalized] || [];
  form.querySelectorAll('input[name="sections"]').forEach(input=>{ input.checked = sections.includes(input.value); });
}
function refreshRolePermissions(){
  const oldRole = document.querySelector('#role-permissions-form select[name="role"]')?.value || 'manager';
  const card = document.querySelector('.role-permissions-card');
  if(card) card.outerHTML = renderRolePermissionsPanel();
  const select = document.querySelector('#role-permissions-form select[name="role"]');
  if(select){ select.value = oldRole; applyPermissionFormRole(select.value); }
  bindRolePermissionEvents();
}
function bindRolePermissionEvents(){
  const form = document.querySelector('#role-permissions-form');
  if(!form) return;
  const select = form.elements.role;
  if(select){ select.addEventListener('change', ()=>applyPermissionFormRole(select.value)); applyPermissionFormRole(select.value); }
  form.addEventListener('submit', submitRolePermissions);
}
async function loadRolePermissions(){
  state.rolePermissionsLoading = true;
  state.rolePermissionsError = '';
  try{
    const rows = await fetchFromSheets('rolePermissions');
    state.rolePermissions = normalizePermissionsRows(rows);
  }catch(error){
    console.warn(error);
    state.rolePermissionsError = error.message || 'Не удалось загрузить права. Используются стандартные настройки.';
    state.rolePermissions = state.rolePermissions || DEFAULT_ACCESS_BY_ROLE;
  }finally{
    state.rolePermissionsLoading = false;
    refreshRolePermissions();
    if(isAuthenticated()) renderApp();
  }
}
async function submitRolePermissions(event){
  event.preventDefault();
  if(!isAdmin()) return alert('Редактировать права может только администратор.');
  const form = event.currentTarget;
  const status = form.querySelector('.permissions-status');
  const role = normalizeRole(form.elements.role.value);
  const sections = Array.from(form.querySelectorAll('input[name="sections"]:checked')).map(i=>i.value);
  if(status){ status.textContent = 'Сохраняю права…'; status.className = 'submit-status'; }
  try{
    await sendPayloadToSheets({ payloadType:'rolePermissionsSave', role, sections });
    state.rolePermissions = { ...effectiveAccessByRole(), [role]: sections, admin: ALL_SECTIONS };
    if(status) status.textContent = '';
    alert('Права сохранены');
    renderApp();
  }catch(error){
    console.error(error);
    if(status){ status.textContent = 'Не удалось сохранить права.'; status.className = 'submit-status error'; }
  }
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
  catch(error){ console.error(error); alert('Не удалось удалить аккаунт. Проверьте Supabase.'); }
}

function bindSearch(panel, selector) { const input=panel?.querySelector('.search'); if(!input) return; const clear=panel.querySelector('.clear-btn'); const searchableCards=Array.from(panel.querySelectorAll(selector)); const empty=panel.querySelector('.empty-state'); const filter=()=>{ const q=(input.value||'').trim().toLowerCase(); let visible=0; searchableCards.forEach(card=>{const ok=!q||(card.dataset.search||card.textContent).toLowerCase().includes(q); card.classList.toggle('hidden',!ok); if(ok) visible+=1;}); if(empty) empty.classList.toggle('show', visible===0); }; input.addEventListener('input',filter); clear&&clear.addEventListener('click',()=>{input.value='';filter();input.focus();}); }
function readEmbeddedMenu() { const el=document.getElementById('menu-data'); if(!el) return null; try {return JSON.parse(el.textContent);} catch(error){console.error('Не удалось прочитать встроенные данные', error); return null;} }

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

const TASKS_STORAGE_KEY = 'sovremennikTasksV2Clean';
const ERROR_REPORTS_STORAGE_KEY = 'sovremennikErrorReportsV2Clean';
const SCHEDULE_STORAGE_KEY = 'sovremennikScheduleEventsV2Clean';
const TASK_ASSIGNEES_STORAGE_KEY = 'sovremennikTaskAssigneesV2Clean';

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
function getInitialScheduleEvents(){ return Array.isArray(state.menu?.scheduleEvents) ? state.menu.scheduleEvents : []; }
function mergeById(rows){
  const map=new Map();
  (rows||[]).forEach(row=>{ if(row && row.id) map.set(row.id, row); });
  return Array.from(map.values());
}
function getTaskAssignees(){
  const rows = Array.isArray(state.taskAssignees) ? state.taskAssignees : getLocalArray(TASK_ASSIGNEES_STORAGE_KEY);
  return rows && rows.length ? rows : dedupeEmployees(state.employees || []);
}
function normalizeTaskRow(row){ 
  return { 
    id: row.id || `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: row.createdAt || new Date().toISOString(),
    authorName: row.authorName || row.author || '',
    assignee: row.assignee || row.to || row.assigneeName || '',
    assigneeName: row.assigneeName || row.assignee || row.to || '',
    assigneeLogin: row.assigneeLogin || row.login || '',
    title: row.title || '',
    description: row.description || '',
    deadline: normalizeDateKey(row.deadline || ''),
    status: row.status || 'Актуальная',
    priority: row.priority || row.isVip || '',
    completedAt: row.completedAt || '',
    completedBy: row.completedBy || ''
  };
}
function normalizeErrorRow(row){ return { id: row.id || `err-${Date.now()}-${Math.random().toString(16).slice(2)}`, createdAt: row.createdAt || new Date().toISOString(), date: row.date || '', time: row.time || '', employeeName: row.employeeName || row.authorName || '', text: row.text || row.message || '' }; }
function normalizeScheduleRow(row){ return { id: row.id || `event-${Date.now()}-${Math.random().toString(16).slice(2)}`, eventDate: normalizeDateKey(row.eventDate || row.date || ''), createdAt: row.createdAt || new Date().toISOString(), type: row.type || 'Мероприятие', title: row.title || '', description: row.description || '', employeeName: row.employeeName || row.authorName || '' }; }
async function loadTasks(){ state.taskLoading=true; state.taskError=''; refreshTasks(); try{ const rows=(await fetchFromSheets('tasks')).map(normalizeTaskRow); state.tasks=rows; setLocalArray(TASKS_STORAGE_KEY, rows); } catch(error){ console.warn(error); state.taskError=error.message||'Не удалось загрузить задачи.'; state.tasks=getLocalArray(TASKS_STORAGE_KEY); } finally{ state.taskLoading=false; refreshTasks(); } }
async function loadTaskAssignees(){ 
  try{ 
    const rows=(await fetchFromSheets('employeeOptions')).map(normalizeEmployee);
    state.taskAssignees=dedupeEmployees(rows);
    setLocalArray(TASK_ASSIGNEES_STORAGE_KEY, state.taskAssignees);
  } catch(error){ 
    console.warn(error);
    if(state.employees) state.taskAssignees=dedupeEmployees(state.employees);
    else state.taskAssignees=getLocalArray(TASK_ASSIGNEES_STORAGE_KEY);
  }
  refreshTaskModalAssignees();
}
async function loadErrorReports(){ state.errorReportsLoading=true; state.errorReportsError=''; refreshControl(); try{ const rows=(await fetchFromSheets('errors')).map(normalizeErrorRow); state.errorReports=rows; setLocalArray(ERROR_REPORTS_STORAGE_KEY, rows); } catch(error){ console.warn(error); state.errorReportsError=error.message||'Не удалось загрузить ошибки.'; state.errorReports=getLocalArray(ERROR_REPORTS_STORAGE_KEY); } finally{ state.errorReportsLoading=false; refreshControl(); } }
async function loadScheduleEvents(){ state.scheduleLoading=true; state.scheduleError=''; refreshSchedule(); try{ const rows=(await fetchFromSheets('schedule')).map(normalizeScheduleRow); state.scheduleEvents=rows; setLocalArray(SCHEDULE_STORAGE_KEY, rows); } catch(error){ console.warn(error); state.scheduleError=error.message||'Не удалось загрузить расписание.'; state.scheduleEvents=getLocalArray(SCHEDULE_STORAGE_KEY); } finally{ state.scheduleLoading=false; refreshSchedule(); } }
function canSeeTask(task){
  if(isAdmin()) return true;
  const user=currentUser()||{};
  const userLogin=String(user.login||'').trim().toLowerCase();
  const userName=String(user.name||'').trim().toLowerCase();
  const assigneeLogin=String(task.assigneeLogin||'').trim().toLowerCase();
  const assigneeName=String(task.assigneeName||task.assignee||'').trim().toLowerCase();
  return (assigneeLogin && assigneeLogin===userLogin) || (assigneeName && assigneeName===userName);
}
function isVipTask(task){ const p=String(task.priority||'').toLowerCase(); return p==='vip' || p==='true' || p==='да' || p==='1'; }
function canCompleteTask(task){ return isAdmin() || canSeeTask(task); }
function activeTasks(){ 
  return getTasks()
    .map(normalizeTaskRow)
    .filter(t => (String(t.status||'').toLowerCase() !== 'выполнена' && String(t.status||'').toLowerCase() !== 'done' && String(t.status||'').toLowerCase() !== 'completed'))
    .filter(canSeeTask)
    .sort((a,b)=>{
      const vipDiff = (isVipTask(b)?1:0) - (isVipTask(a)?1:0);
      if(vipDiff) return vipDiff;
      const ad=taskDeadlineSortValue(a), bd=taskDeadlineSortValue(b);
      return ad.localeCompare(bd) || String(b.createdAt||'').localeCompare(String(a.createdAt||''));
    }); 
}

function parseTaskDeadline(task){
  const value = task.deadlineAt || task.dueAt || task.due_at || task.deadline || '';
  if(!value) return null;
  if(/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value + 'T23:59:00');
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}
function taskDeadlineLabel(task){
  const d = parseTaskDeadline(task);
  if(!d) return 'без срока';
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  if(diff < 0){
    if(abs < 24*60*60*1000) return `просрочено на ${Math.max(1, Math.ceil(abs/3600000))} ч`;
    return `просрочено на ${Math.max(1, Math.ceil(abs/86400000))} д`;
  }
  if(diff < 24*60*60*1000) return `осталось ${Math.max(1, Math.ceil(diff/3600000))} ч`;
  return `осталось ${Math.max(1, Math.ceil(diff/86400000))} д`;
}
function taskDeadlineSortValue(task){
  const d = parseTaskDeadline(task);
  return d ? d.toISOString() : '9999-12-31T23:59:59.999Z';
}
function displayTaskDeadline(task){
  const d = parseTaskDeadline(task);
  if(!d) return 'без срока';
  return d.toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function renderTasksList(){ 
  if(state.taskLoading) return `<div class="task-empty">Загружаю задачи…</div>`; 
  const tasks=activeTasks(); 
  if(!tasks.length) return `<div class="task-empty">Актуальных задач для вас пока нет.</div>${state.taskError?`<p class="employees-error">${esc(state.taskError)}</p>`:''}`; 
  return `<div class="task-list compact">${tasks.map(renderTaskItem).join('')}</div>${state.taskError?`<p class="employees-error">${esc(state.taskError)}</p>`:''}`; 
}
function employeeOptionsSelect(selected=''){ 
  const rows=dedupeEmployees(getTaskAssignees()).filter(e=>e.login && e.name);
  const options=rows.map(e=>`<option value="${esc(e.login)}" ${String(selected)===String(e.login)?'selected':''}>${esc(e.name)} · ${esc(roleLabel(e.role))}</option>`).join('');
  return `<select name="assigneeLogin" required><option value="">Выберите сотрудника</option>${options}</select>`;
}
function refreshTaskModalAssignees(){
  const wrap=document.querySelector('#task-assignee-select-wrap');
  if(wrap) wrap.innerHTML=employeeOptionsSelect();
}
function employeeOptionsDatalist(){ const rows=dedupeEmployees(state.employees || []); return `<datalist id="employees-datalist">${rows.map(e=>`<option value="${esc(e.name || e.login)}"></option>`).join('')}</datalist>`; }
function renderTaskModal(){ 
  const user=currentUser(); 
  return `<div class="task-modal" id="task-modal" aria-hidden="true"><div class="task-form-card"><div class="card-head"><h3>Поставить задачу</h3><button class="small-action secondary" type="button" data-close-task-modal>Закрыть</button></div><form id="task-form"><div class="form-grid"><label>Название задачи<input name="title" type="text" required placeholder="Например, проверить витрину"></label><label>Кому поставить задачу<span id="task-assignee-select-wrap">${employeeOptionsSelect()}</span></label><label>Дедлайн<input name="deadline" type="datetime-local"></label><label>Поставил<input name="authorName" type="text" value="${esc(user?.name||'')}" required></label></div><label>Описание<textarea name="description" rows="4" placeholder="Что нужно сделать и на что обратить внимание"></textarea></label><label class="vip-checkbox"><input name="isVip" type="checkbox"> <span>VIP-приоритет: сделать как можно скорее</span></label><div class="task-form-actions"><button class="small-action secondary" type="button" data-close-task-modal>Отмена</button><button class="small-action" type="submit">Поставить задачу</button></div><p class="submit-status task-status" aria-live="polite"></p></form></div></div>`; 
}
function openTaskModal(){ const modal=document.querySelector('#task-modal'); if(modal){ modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); } loadTaskAssignees(); }
function closeTaskModal(){ const modal=document.querySelector('#task-modal'); if(modal){ modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); } }
async function submitTask(event){ 
  event.preventDefault(); 
  const form=event.currentTarget; 
  const status=form.querySelector('.task-status'); 
  const assigneeLogin=(form.elements.assigneeLogin.value||'').trim();
  const assigneeRow=dedupeEmployees(getTaskAssignees()).find(e=>String(e.login||'')===assigneeLogin);
  const task={ 
    id:`task-${Date.now()}-${Math.random().toString(16).slice(2)}`, 
    title:(form.elements.title.value||'').trim(), 
    description:(form.elements.description.value||'').trim(), 
    assigneeLogin,
    assigneeName: assigneeRow?.name || '',
    assignee: assigneeRow?.name || assigneeLogin,
    deadlineAt:(form.elements.deadline.value||''),
    deadline:normalizeDateKey((form.elements.deadline.value||'').slice(0,10)), 
    authorName:(form.elements.authorName.value||currentUserName()||'').trim(), 
    status:'Актуальная', 
    priority: form.elements.isVip.checked ? 'VIP' : '',
    createdAt:new Date().toISOString() 
  }; 
  if(!task.title || !task.assigneeLogin || !task.authorName){ if(status){status.textContent='Заполните название, сотрудника и автора.'; status.className='submit-status error';} return; } 
  try{ 
    await sendPayloadToSheets({payloadType:'taskAdd', ...task}); 
    const rows=[task,...getLocalArray(TASKS_STORAGE_KEY)]; 
    setLocalArray(TASKS_STORAGE_KEY, rows); state.tasks=rows; refreshTasks(); 
    if(status) status.textContent=''; alert('Отлично! Задача поставлена'); 
    form.reset(); form.elements.authorName.value=currentUserName()||''; closeTaskModal(); loadTasks(); 
  } catch(error){ console.error(error); if(status){status.textContent='Не удалось отправить задачу.'; status.className='submit-status error';} } 
}
function renderReportError(){ return `<section class="top-panel ${state.activeTop==='reportError'?'active':''}" id="top-reportError"><div class="section-heading"><p>Обратная связь</p><h2>Сообщить об ошибке</h2></div><div class="report-layout"><div class="report-card"><p class="description">Напишите, что не работает или что нужно исправить в методичке, чек-листах, техкартах или сервисе.</p><form class="report-form" id="error-report-form"><label>Описание ошибки<textarea name="text" required placeholder="Например: в карточке Айс латте неверный состав…"></textarea></label><button class="small-action" type="submit">Отправить</button><p class="submit-status error-report-status" aria-live="polite"></p></form></div></div></section>`; }
async function submitErrorReport(event){ event.preventDefault(); const form=event.currentTarget; const status=form.querySelector('.error-report-status'); const text=(form.elements.text.value||'').trim(); if(!text){ if(status){status.textContent='Опишите ошибку.'; status.className='submit-status error';} return; } const record={ id:`err-${Date.now()}-${Math.random().toString(16).slice(2)}`, text, employeeName:currentUserName(), createdAt:new Date().toISOString() }; try{ await sendPayloadToSheets({payloadType:'errorReport', text, employeeName:currentUserName()}); const rows=[record,...getLocalArray(ERROR_REPORTS_STORAGE_KEY)]; setLocalArray(ERROR_REPORTS_STORAGE_KEY, rows); state.errorReports=rows; if(status) status.textContent=''; alert('Отлично! Сообщение отправлено'); form.reset(); } catch(error){ console.error(error); if(status){status.textContent='Не удалось отправить сообщение.'; status.className='submit-status error';} } }
function renderErrorReportsTable(){ const rows=getErrorReports(); if(state.errorReportsLoading) return `<div class="empty-control"><h3>Загружаю ошибки…</h3><p>Подключаюсь к Supabase.</p></div>`; if(!rows.length) return `<div class="empty-control"><h3>Ошибок пока нет</h3><p>Сообщения сотрудников появятся здесь.</p>${state.errorReportsError?`<p class="employees-error">${esc(state.errorReportsError)}</p>`:''}</div>`; return `<div class="employee-table-wrap"><table class="employee-table errors-table"><thead><tr><th>Дата и время</th><th>Сотрудник</th><th>Сообщение</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(formatDateTime(r.createdAt)||[r.date,r.time].filter(Boolean).join(' '))}</td><td>${esc(r.employeeName||'—')}</td><td class="error-text">${esc(r.text||'')}</td></tr>`).join('')}</tbody></table></div>`; }

function monthTitle(ym){ const d=new Date(`${ym}-01T00:00:00`); return d.toLocaleDateString('ru-RU',{month:'long',year:'numeric'}); }
function shiftMonth(delta){ const [y,m]=state.scheduleMonth.split('-').map(Number); const d=new Date(y, m-1+delta, 1); state.scheduleMonth=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; refreshSchedule(); }
function eventsForDate(dateKey){ return getScheduleEvents().filter(e=>normalizeDateKey(e.eventDate)===dateKey); }

function scheduleEventClass(ev){
  const type=String(ev?.type || '').toLowerCase();
  if(type.includes('смен')) return 'schedule-event schedule-event--shift';
  if(type.includes('собран')) return 'schedule-event schedule-event--meeting';
  if(type.includes('обуч')) return 'schedule-event schedule-event--training';
  return 'schedule-event schedule-event--event';
}
function renderScheduleGrid(){ const [year,month]=state.scheduleMonth.split('-').map(Number); const first=new Date(year,month-1,1); const start=new Date(first); const day=(first.getDay()+6)%7; start.setDate(first.getDate()-day); const days=[]; for(let i=0;i<42;i++){ const d=new Date(start); d.setDate(start.getDate()+i); const key=d.toISOString().slice(0,10); const muted=d.getMonth()!==month-1; days.push({key,day:d.getDate(),muted,events:eventsForDate(key)}); } const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс']; return `<div class="schedule-grid">${weekdays.map(w=>`<div class="schedule-weekday">${w}</div>`).join('')}${days.map(day=>`<div class="schedule-day ${day.muted?'muted':''}"><div class="schedule-date">${day.day}</div><div class="schedule-events">${day.events.map(ev=>`<div class="${scheduleEventClass(ev)}"><strong>${esc(ev.title||ev.type)}</strong><span>${esc(ev.type||'Мероприятие')}${ev.employeeName?` · ${esc(ev.employeeName)}`:''}</span>${ev.description?`<span>${esc(ev.description)}</span>`:''}</div>`).join('')}</div></div>`).join('')}</div>`; }
function renderSchedule(){ const today=new Date().toISOString().slice(0,10); return `<section class="top-panel ${state.activeTop==='schedule'?'active':''}" id="top-schedule"><div class="section-heading"><p>График</p><h2>Расписание</h2></div><div class="schedule-card"><div class="schedule-toolbar"><div class="schedule-month-nav"><button class="small-action secondary" type="button" data-schedule-prev>←</button><div class="schedule-month-title">${esc(monthTitle(state.scheduleMonth))}</div><button class="small-action secondary" type="button" data-schedule-next>→</button></div><button class="small-action" type="button" data-toggle-schedule-form>Добавить мероприятие</button></div><div id="schedule-grid-wrap">${renderScheduleGrid()}</div><details class="schedule-form-wrap" id="schedule-form-wrap"><summary>Форма добавления мероприятия</summary><form class="schedule-event-form" id="schedule-event-form"><div class="form-grid"><label>Дата<input name="eventDate" type="date" value="${today}" required></label><label>Тип<select name="type"><option>Мероприятие</option><option>Смена</option><option>Обучение</option><option>Собрание</option></select></label><label>Название<input name="title" type="text" required placeholder="Например, смена Анны"></label><label>Добавил<input name="employeeName" type="text" value="${esc(currentUserName())}" required></label></div><label>Описание<textarea name="description" rows="3" placeholder="Время, участники, детали"></textarea></label><button class="small-action" type="submit">Добавить</button><p class="submit-status schedule-status" aria-live="polite"></p></form></details>${state.scheduleError?`<p class="employees-error">${esc(state.scheduleError)}</p>`:''}</div></section>`; }
function refreshSchedule(){ const wrap=document.querySelector('#schedule-grid-wrap'); if(wrap) wrap.innerHTML=renderScheduleGrid(); const title=document.querySelector('.schedule-month-title'); if(title) title.textContent=monthTitle(state.scheduleMonth); }
async function submitScheduleEvent(event){ event.preventDefault(); const form=event.currentTarget; const status=form.querySelector('.schedule-status'); const record={ id:`event-${Date.now()}-${Math.random().toString(16).slice(2)}`, eventDate:normalizeDateKey(form.elements.eventDate.value), type:(form.elements.type.value||'Мероприятие').trim(), title:(form.elements.title.value||'').trim(), description:(form.elements.description.value||'').trim(), employeeName:(form.elements.employeeName.value||currentUserName()||'').trim(), createdAt:new Date().toISOString() }; if(!record.eventDate || !record.title){ if(status){status.textContent='Заполните дату и название.'; status.className='submit-status error';} return; } try{ await sendPayloadToSheets({payloadType:'scheduleAdd', ...record}); const rows=[record,...getLocalArray(SCHEDULE_STORAGE_KEY)]; setLocalArray(SCHEDULE_STORAGE_KEY, rows); state.scheduleEvents=rows; refreshSchedule(); if(status) status.textContent=''; alert('Отлично! Мероприятие добавлено'); form.reset(); form.elements.eventDate.value=new Date().toISOString().slice(0,10); form.elements.employeeName.value=currentUserName()||''; loadScheduleEvents(); }catch(error){ console.error(error); if(status){status.textContent='Не удалось добавить мероприятие.'; status.className='submit-status error';} } }




/* --- Supabase backend override: replaces Supabase data layer --- */
const SOV_SUPA_CONFIG = window.SOVREMENNIK_SUPABASE || {};
const SUPABASE_URL = SOV_SUPA_CONFIG.url || 'https://tjibbzfdughhjenumzxo.supabase.co';
const SUPABASE_ANON_KEY = SOV_SUPA_CONFIG.anonKey || 'sb_publishable_S0QBmN0f6SYvaPXj_QFvzg_uQmdXSwJ';
const SUPABASE_EMPLOYEE_FUNCTION_URL = SOV_SUPA_CONFIG.employeeFunctionUrl || `${SUPABASE_URL}/functions/v1/admin-employees`;
const SUPABASE_LOGIN_DOMAIN = SOV_SUPA_CONFIG.loginDomain || 'sovremennik.local';
const SUPABASE_AUTH_STORAGE_KEY = 'sovremennikSupabaseAuthV1';
const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

function loginToEmail(login){ return `${String(login || '').trim().toLowerCase()}@${SUPABASE_LOGIN_DOMAIN}`; }
function mapProfile(profile){ return profile ? { id: profile.id, name: profile.name || '', role: normalizeRole(profile.role || ''), login: profile.login || '', password: '' } : null; }
async function getCurrentSession(){ const res = await supa.auth.getSession(); return res.data.session || null; }
async function getCurrentProfile(){ const session = await getCurrentSession(); if(!session?.user?.id) return null; const res = await supa.from('profiles').select('id, login, name, role, is_active').eq('id', session.user.id).single(); if(res.error) throw res.error; if(!res.data?.is_active) throw new Error('Аккаунт отключен.'); return mapProfile(res.data); }
function saveAuth(auth){ state.auth = auth; try { localStorage.setItem(SUPABASE_AUTH_STORAGE_KEY, JSON.stringify(auth)); } catch(e) {} }
function readSavedAuth(){ try { const saved = JSON.parse(localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY) || 'null'); return saved && saved.user ? saved : null; } catch(e) { return null; } }
async function restoreSupabaseSession(){ try { const profile = await getCurrentProfile(); if(profile) { const session = await getCurrentSession(); saveAuth({ token: session?.access_token || '', session, user: profile }); return true; } } catch(error) { console.warn('Supabase session restore failed', error); } return false; }
function getAuthToken(){ return state.auth?.token || state.auth?.session?.access_token || ''; }
function normalizeEmployee(row){ return { id: row.id || row.user_id || row.login || Math.random().toString(16).slice(2), name: row.name || row.employeeName || '', role: normalizeRole(row.role || ''), login: row.login || '', password: row.password || '' }; }

async function handleLogout(){ try { await supa.auth.signOut(); } catch(e) {} clearAuth(); state.controlRecords=null; state.revisionRecords=null; state.employees=null; showLogin(); }
function clearAuth(){ state.auth = null; try { localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY); } catch(e) {} }

async function listActiveProfiles(){ const res = await supa.from('profiles').select('id, name, role, login, is_active').eq('is_active', true).order('name', { ascending: true }); if(res.error) throw res.error; return (res.data || []).map(mapProfile); }
async function findEmployeeByLogin(login){ const rows = state.taskAssignees || state.employees || await listActiveProfiles(); const key = String(login || '').trim().toLowerCase(); return rows.find(e => String(e.login || '').toLowerCase() === key) || null; }
function mapChecklistRow(row){ return { id: row.id, checklistId: row.checklist_id || '', checklistTitle: row.checklist_title || '', employeeName: row.employee_name || '', createdAt: row.created_at, tasks: Array.isArray(row.items) ? row.items : [], completed: row.completed_count, total: row.total_count, percent: row.percent ? `${row.percent}%` : '' }; }
function mapCoffeeRow(row){ return { id:`coffee-${row.revision_date}`, dateKey: normalizeDateKey(row.revision_date), date: displayDateFromKey(normalizeDateKey(row.revision_date)), employeeName: row.employee_name || '', hopperWeight: row.hopper_weight ?? '', openedPacks: row.opened_packs ?? '', writeOffs: row.write_offs ?? '', iikoSales: row.iiko_sales ?? '', checked: row.checked || '', cleanHopperWeight: row.clean_hopper_weight ?? '', totalCoffeeUsage: row.total_coffee_usage ?? '', difference: row.difference ?? '', losses: row.losses_percent === null || row.losses_percent === undefined ? '' : `${row.losses_percent}%`, createdAt: row.created_at || row.updated_at || new Date().toISOString() }; }
function mapTaskRow(row, profiles){ const byId = profiles || new Map(); const assignee = byId.get(row.assignee_id) || {}; const creator = byId.get(row.creator_id) || {}; const deadlineAt = row.due_at || (row.due_date ? `${row.due_date}T23:59:00` : ''); return { id: row.id, createdAt: row.created_at, authorName: creator.name || '', assignee: assignee.name || '', assigneeName: assignee.name || '', assigneeLogin: assignee.login || '', title: row.title || '', description: row.description || '', deadlineAt, deadline: normalizeDateKey(row.due_date || (deadlineAt ? String(deadlineAt).slice(0,10) : '')), status: row.status === 'done' ? 'Выполнена' : 'Актуальная', priority: row.is_vip ? 'VIP' : '', completedAt: row.completed_at || '', completedBy: '' }; }
function mapErrorRow(row){ return { id: row.id, createdAt: row.created_at, employeeName: row.employee_name || '', text: row.message || '' }; }
function mapScheduleRow(row){ return { id: row.id, eventDate: normalizeDateKey(row.event_date), createdAt: row.created_at, type: row.event_type || 'Мероприятие', title: row.title || '', description: row.description || '', employeeName: row.employee_name || '' }; }

async function fetchFromSheets(view){
  if(view === 'employees' || view === 'employeeOptions') return await listActiveProfiles();
  if(view === 'rolePermissions') { const res = await supa.from('role_permissions').select('role, sections'); if(res.error) throw res.error; return res.data || []; }
  if(view === 'checklists') { const res = await supa.from('checklist_submissions').select('*').order('created_at', { ascending:false }); if(res.error) throw res.error; return (res.data || []).map(mapChecklistRow); }
  if(view === 'coffeeRevision') { const res = await supa.from('coffee_revision_report').select('*').order('revision_date', { ascending:true }); if(res.error) throw res.error; return (res.data || []).map(mapCoffeeRow); }
  if(view === 'errors') { const res = await supa.from('error_reports').select('*').order('created_at', { ascending:false }); if(res.error) throw res.error; return (res.data || []).map(mapErrorRow); }
  if(view === 'schedule') { const res = await supa.from('schedule_events').select('*').order('event_date', { ascending:true }); if(res.error) throw res.error; return (res.data || []).map(mapScheduleRow); }
  if(view === 'tasks') {
    const profiles = await listActiveProfiles(); const map = new Map(profiles.map(p=>[p.id,p]));
    const res = await supa.from('tasks').select('*').order('is_vip', { ascending:false }).order('due_at', { ascending:true, nullsFirst:false }).order('due_date', { ascending:true, nullsFirst:false }).order('created_at', { ascending:false });
    if(res.error) throw res.error; return (res.data || []).map(row => mapTaskRow(row, map));
  }
  return [];
}

async function callEmployeeFunction(body){
  const session = await getCurrentSession(); if(!session?.access_token) throw new Error('Нет активной сессии Supabase.');
  const res = await fetch(SUPABASE_EMPLOYEE_FUNCTION_URL, { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${session.access_token}` }, body: JSON.stringify(body) });
  const data = await res.json().catch(()=>({ok:false,error:'Не удалось прочитать ответ функции'}));
  if(!res.ok || !data.ok) throw new Error(data.error || 'Ошибка Edge Function.');
  return data;
}

async function callNotificationFunction(eventType, data = {}){
  try {
    const cfg = window.SOVREMENNIK_SUPABASE || {};
    const url = cfg.notifyFunctionUrl || `${SUPABASE_URL}/functions/v1/notify-event`;
    const session = await getCurrentSession();
    if(!url || !session?.access_token) return;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ event_type: eventType, data })
    });
    if(!res.ok) {
      const err = await res.text().catch(()=>res.statusText);
      console.warn('Push notify skipped:', err);
    }
  } catch(error) {
    console.warn('Push notify failed:', error);
  }
}
function safeNotifyEvent(eventType, data = {}){
  callNotificationFunction(eventType, data).catch(error => console.warn('Push notify failed:', error));
}


async function sendPayloadToSheets(payload){
  const user = currentUser();
  if(!user?.id) throw new Error('Нужно войти в аккаунт.');
  if(payload.payloadType === 'checklist') {
    const items = payload.items || [];
    const completed = items.filter(i=>i.checked).length;
    const total = items.length;
    const res = await supa.from('checklist_submissions').insert({ checklist_id: payload.checklistId || '', checklist_title: payload.checklistType || payload.checklistTitle || '', employee_id: user.id, employee_name: payload.employeeName || user.name, items, completed_count: completed, total_count: total, percent: total ? Math.round(completed / total * 100) : 0 }).select().single();
    if(res.error) throw res.error; safeNotifyEvent('checklist_submitted', { submission_id: res.data?.id, checklist_title: payload.checklistType || payload.checklistTitle || '', employee_name: payload.employeeName || user.name }); return res.data;
  }
  if(payload.payloadType === 'coffeeRevision' || payload.payloadType === 'coffeeRevisionManual') {
    const row = { revision_date: normalizeDateKey(payload.revisionDate), employee_id: user.id, employee_name: payload.employeeName || user.name };
    if(payload.hopperWeight !== undefined && payload.hopperWeight !== '') row.hopper_weight = Number(payload.hopperWeight);
    if(payload.openedPacks !== undefined && payload.openedPacks !== '') row.opened_packs = Number(payload.openedPacks);
    if(payload.writeOffs !== undefined && payload.writeOffs !== '') row.write_offs = Number(payload.writeOffs);
    if(payload.iikoSales !== undefined && payload.iikoSales !== '') row.iiko_sales = Number(payload.iikoSales);
    if(payload.checked !== undefined && payload.checked !== '') row.checked = payload.checked;
    const res = await supa.from('coffee_revisions').upsert(row, { onConflict:'revision_date' }).select().single(); if(res.error) throw res.error; safeNotifyEvent('revision_submitted', { revision_id: res.data?.id, revision_date: row.revision_date, employee_name: row.employee_name }); return res.data;
  }
  if(payload.payloadType === 'employeeAdd') { return await callEmployeeFunction({ action:'create', name: payload.employee.name, role: normalizeRole(payload.employee.role), login: payload.employee.login, password: payload.employee.password }); }
  if(payload.payloadType === 'employeeDelete') { const employee = await findEmployeeByLogin(payload.login); if(!employee?.id) throw new Error('Сотрудник не найден.'); return await callEmployeeFunction({ action:'delete', userId: employee.id }); }
  if(payload.payloadType === 'rolePermissionsSave') { const res = await supa.from('role_permissions').upsert({ role: normalizeRole(payload.role), sections: payload.sections || [], updated_by: user.id }, { onConflict:'role' }).select().single(); if(res.error) throw res.error; return res.data; }
  if(payload.payloadType === 'taskAdd') { const assignee = await findEmployeeByLogin(payload.assigneeLogin); if(!assignee?.id) throw new Error('Сотрудник для задачи не найден.'); const res = await supa.from('tasks').insert({ title: payload.title, description: payload.description || '', creator_id: user.id, assignee_id: assignee.id, is_vip: Boolean(String(payload.priority || '').toLowerCase()==='vip' || payload.isVip), due_date: payload.deadline || null, due_at: payload.deadlineAt ? new Date(payload.deadlineAt).toISOString() : null }).select().single(); if(res.error) throw res.error; safeNotifyEvent('task_assigned', { task_id: res.data?.id }); return res.data; }
  if(payload.payloadType === 'taskComplete') { const res = await supa.from('tasks').update({ status:'done', completed_at:new Date().toISOString() }).eq('id', payload.taskId).select('id,status,completed_at').maybeSingle(); if(res.error) throw res.error; if(!res.data) throw new Error('Задача уже завершена или нет доступа.'); safeNotifyEvent('task_completed', { task_id: payload.taskId }); return res.data; }
  if(payload.payloadType === 'errorReport') { const res = await supa.from('error_reports').insert({ employee_id: user.id, employee_name: payload.employeeName || user.name, message: payload.text || '' }).select().single(); if(res.error) throw res.error; safeNotifyEvent('error_report_submitted', { report_id: res.data?.id, employee_name: payload.employeeName || user.name }); return res.data; }
  if(payload.payloadType === 'scheduleAdd') { const res = await supa.from('schedule_events').insert({ event_date: normalizeDateKey(payload.eventDate), event_type: payload.type || 'Мероприятие', title: payload.title || '', description: payload.description || '', employee_name: payload.employeeName || user.name, source: 'manual', created_by: user.id }).select().single(); if(res.error) throw res.error; safeNotifyEvent('schedule_event_added', { event_id: res.data?.id, title: payload.title || '', event_date: normalizeDateKey(payload.eventDate) }); return res.data; }
  throw new Error('Неизвестный тип операции.');
}


/* --- End Supabase override --- */


/* --- v21 overrides: admin tools, task fixes, summaries, photos, refresh --- */
const MENU_PHOTO_OVERRIDES_KEY_V21 = 'sovremennikMenuPhotoOverridesV21';
const TECH_CARD_OVERRIDES_KEY_V21 = 'sovremennikTechCardOverridesV21';
let pendingPhotoTargetKeyV21 = '';

function isUuidLikeV21(value){
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}
function readStorageJsonV21(key, fallback){
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch(error){
    return fallback;
  }
}
function saveStorageJsonV21(key, value){
  try { localStorage.setItem(key, JSON.stringify(value)); } catch(error){}
}
function menuItemKeyV21(item){
  return [item.section || '', item.category || '', item.title || ''].join('::');
}
function getMenuPhotoOverridesV21(){ return readStorageJsonV21(MENU_PHOTO_OVERRIDES_KEY_V21, {}); }
function getTechCardOverridesV21(){ return readStorageJsonV21(TECH_CARD_OVERRIDES_KEY_V21, {}); }
function parseIngredientsTextV21(text){
  return String(text || '').split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{
    const parts = line.split(/\s*[|:;-]\s*/);
    if(parts.length >= 2) return { name: parts.shift().trim(), amount: parts.join(' - ').trim() };
    return { name: line, amount: '' };
  });
}
function ingredientsTextFromListV21(list){
  return (list || []).map(item => `${item.name || ''}: ${item.amount || ''}`.trim()).join('\n');
}
function applyPhotoOverrideToStateV21(itemKey, dataUrl){
  (state.menu?.items || []).forEach(item => {
    if(menuItemKeyV21(item) === itemKey) item.image = dataUrl;
  });
}
function applyTechOverrideToStateV21(cardKey, payload){
  (state.menu?.techCards || []).forEach(doc => {
    (doc.cards || []).forEach(card => {
      if(techCardKeyV21(card, doc) === cardKey){
        card.title = payload.title || card.title;
        card.category = payload.category || card.category;
        card.output = payload.output || '';
        card.technology = payload.technology || '';
        card.ingredients = Array.isArray(payload.ingredients) ? payload.ingredients : [];
      }
    });
  });
}
function openPhotoPickerV21(itemKey){
  if(!isAdmin()) return alert('Редактировать фото может только администратор.');
  pendingPhotoTargetKeyV21 = itemKey;
  ensurePhotoInputV21().click();
}

function renderTaskItem(task){
  const vip = isVipTask(task);
  const deadlineText = taskDeadlineLabel(task);
  const deadlineFull = displayTaskDeadline(task);
  const assignedTo = task.assigneeName || task.assignee || task.assigneeLogin || 'не указано';
  const isLocalOnly = !isUuidLikeV21(task.id);
  return `<article class="task-item task-compact ${vip?'vip':''}" data-task-id="${esc(task.id)}">
    <details class="task-details">
      <summary>
        <span class="task-main">
          <span class="task-title">${esc(task.title||'Задача')}</span>
          <span class="task-mini-meta">${vip?'<b class="vip-mark">VIP</b>':''}<span>${esc(deadlineFull)}</span><span>кому: ${esc(assignedTo)}</span>${isLocalOnly?'<span class="local-task-note">локально</span>':''}</span>
        </span>
        <span class="task-timer ${vip?'vip-timer':''}">${esc(deadlineText)}</span>
      </summary>
      ${task.description?`<p class="description">${esc(task.description)}</p>`:''}
      <div class="task-meta"><span>Поставил: ${esc(task.authorName||'—')}</span><span>Создано: ${esc(formatDateTime(task.createdAt))}</span></div>
      <div class="task-actions-row">
        ${canCompleteTask(task)?`<button class="small-action task-complete" type="button" data-task-complete="${esc(task.id)}">Завершить задачу</button>`:''}
        ${isAdmin()?`<button class="small-action ghost task-delete" type="button" data-task-delete="${esc(task.id)}">Удалить</button>`:''}
      </div>
    </details>
  </article>`;
}
function bindTaskCardEventsV21(){
  document.querySelectorAll('[data-task-complete]').forEach(btn => {
    btn.onclick = (event) => { event.preventDefault(); event.stopPropagation(); completeTask(btn.dataset.taskComplete, btn); };
  });
  document.querySelectorAll('[data-task-delete]').forEach(btn => {
    btn.onclick = (event) => { event.preventDefault(); event.stopPropagation(); deleteTaskV21(btn.dataset.taskDelete, btn); };
  });
}
function refreshTasks(){
  const el = document.querySelector('#tasks-list');
  if(el) el.innerHTML = renderTasksList();
  bindTaskCardEventsV21();
}
async function completeTask(taskId, button){
  const task = getTasks().find(t=>String(t.id)===String(taskId));
  if(!task) return;
  if(!confirm(`Завершить задачу «${task.title || 'Задача'}»?`)) return;
  if(button){ button.disabled = true; button.textContent = 'Завершаю…'; }
  try {
    if(isUuidLikeV21(taskId) && currentUser()?.id){
      const res = await supa.from('tasks').update({ status:'done', completed_at:new Date().toISOString() }).eq('id', taskId).select('id,status').maybeSingle();
      if(res.error) throw res.error;
    }
    const rows = getTasks().filter(t=>String(t.id)!==String(taskId));
    setLocalArray(TASKS_STORAGE_KEY, rows);
    state.tasks = rows;
    refreshTasks();
    if(isUuidLikeV21(taskId) && currentUser()?.id) await loadTasks();
  } catch(error){
    console.error(error);
    alert('Не удалось завершить задачу: ' + (error.message || 'проверьте доступ и подключение.'));
    if(button){ button.disabled = false; button.textContent = 'Завершить задачу'; }
  }
}
async function deleteTaskV21(taskId, button){
  if(!isAdmin()) return alert('Удалять задачи может только администратор.');
  const task = getTasks().find(t=>String(t.id)===String(taskId));
  if(!task) return;
  if(!confirm(`Удалить задачу «${task.title || 'Задача'}»?`)) return;
  if(button){ button.disabled = true; button.textContent = 'Удаляю…'; }
  try {
    if(isUuidLikeV21(taskId) && currentUser()?.id){
      const res = await supa.from('tasks').delete().eq('id', taskId);
      if(res.error) throw res.error;
    }
    const rows = getTasks().filter(t=>String(t.id)!==String(taskId));
    setLocalArray(TASKS_STORAGE_KEY, rows);
    state.tasks = rows;
    refreshTasks();
    if(isUuidLikeV21(taskId) && currentUser()?.id) await loadTasks();
  } catch(error){
    console.error(error);
    alert('Не удалось удалить задачу: ' + (error.message || 'проверьте доступ и подключение.'));
    if(button){ button.disabled = false; button.textContent = 'Удалить'; }
  }
}
function renderHome(){
  return `<section class="top-panel ${state.activeTop==='home'?'active':''}" id="top-home"><div class="home-dashboard single"><div class="home-tasks-card"><div class="home-tasks-head compact"><div><p class="section-kicker">Главная</p><h2>Актуальные задачи</h2><p class="description">Здесь отображаются только ваши задачи. Администратор видит задачи всех сотрудников.</p></div><div class="home-head-actions"><button class="small-action secondary compact-action" type="button" data-refresh-service>Обновить</button><button class="small-action compact-action" type="button" data-open-task-modal>Поставить задачу</button></div></div><div id="tasks-list">${renderTasksList()}</div></div></div>${renderTaskModal()}</section>`;
}

function daysBackFilterV21(rows, days, getDate){
  const now = Date.now();
  const ms = days * 24 * 60 * 60 * 1000;
  return (rows || []).filter(row => {
    const d = getDate(row);
    return d && !isNaN(d.getTime()) && (now - d.getTime()) <= ms;
  });
}
function avgV21(numbers){
  const valid = numbers.filter(v => Number.isFinite(v));
  if(!valid.length) return 0;
  return valid.reduce((sum, n) => sum + n, 0) / valid.length;
}
function parsePercentV21(value){
  const num = parseFloat(String(value || '').replace('%','').replace(',','.'));
  return Number.isFinite(num) ? num : null;
}
function summaryMetricCardV21(title, value, note=''){
  return `<div class="summary-metric"><span>${esc(title)}</span><b>${esc(value)}</b>${note?`<small>${esc(note)}</small>`:''}</div>`;
}
function renderTopEmployeesV21(rows){
  if(!rows.length) return '<p class="description">Данных пока нет.</p>';
  return `<div class="summary-table-wrap"><table class="employee-table summary-table"><thead><tr><th>Сотрудник</th><th>Кол-во</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.name)}</td><td>${esc(row.count)}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderControlSummaryV21(){
  const checklistRows = getControlRecords();
  const revisionRows = getRevisionRecords();
  const errorRows = getErrorReports();
  const checks7 = daysBackFilterV21(checklistRows, 7, r => new Date(r.createdAt || Date.now()));
  const checks30 = daysBackFilterV21(checklistRows, 30, r => new Date(r.createdAt || Date.now()));
  const rev7 = daysBackFilterV21(revisionRows, 7, r => new Date(`${r.dateKey || new Date().toISOString().slice(0,10)}T00:00:00`));
  const rev30 = daysBackFilterV21(revisionRows, 30, r => new Date(`${r.dateKey || new Date().toISOString().slice(0,10)}T00:00:00`));
  const errors30 = daysBackFilterV21(errorRows, 30, r => new Date(r.createdAt || Date.now()));
  const checkCompletion7 = avgV21(checks7.map(record => { const t = recordDoneTotal(record); return t.total ? (t.done / t.total) * 100 : null; }));
  const checkCompletion30 = avgV21(checks30.map(record => { const t = recordDoneTotal(record); return t.total ? (t.done / t.total) * 100 : null; }));
  const avgLoss7 = avgV21(rev7.map(r => parsePercentV21(r.losses)));
  const avgLoss30 = avgV21(rev30.map(r => parsePercentV21(r.losses)));
  const totalIiko7 = rev7.reduce((sum, row) => sum + Number(row.iikoSales || 0), 0);
  const totalIiko30 = rev30.reduce((sum, row) => sum + Number(row.iikoSales || 0), 0);
  const topChecklistEmployees = Object.values(checks30.reduce((acc, row) => {
    const key = row.employeeName || 'Не указан';
    acc[key] = acc[key] || { name:key, count:0 };
    acc[key].count += 1;
    return acc;
  }, {})).sort((a,b)=>b.count-a.count).slice(0,5);
  const topErrorEmployees = Object.values(errors30.reduce((acc, row) => {
    const key = row.employeeName || 'Не указан';
    acc[key] = acc[key] || { name:key, count:0 };
    acc[key].count += 1;
    return acc;
  }, {})).sort((a,b)=>b.count-a.count).slice(0,5);
  return `<div class="control-summary-grid">
    <section class="summary-card"><div class="card-head"><h3>Чек-листы</h3><button class="small-action secondary" type="button" data-control-summary-refresh>Обновить</button></div><div class="summary-metrics">${summaryMetricCardV21('За 7 дней', `${checks7.length}`, 'отправок')}${summaryMetricCardV21('За 30 дней', `${checks30.length}`, 'отправок')}${summaryMetricCardV21('Среднее выполнение 7 дн.', `${Math.round(checkCompletion7)}%`)}${summaryMetricCardV21('Среднее выполнение 30 дн.', `${Math.round(checkCompletion30)}%`)}</div><h4>Кто чаще отправляет чек-листы</h4>${renderTopEmployeesV21(topChecklistEmployees)}</section>
    <section class="summary-card"><div class="card-head"><h3>Ревизии кофе</h3><span class="source-badge">отчет</span></div><div class="summary-metrics">${summaryMetricCardV21('Ревизий за 7 дней', `${rev7.length}`)}${summaryMetricCardV21('Ревизий за 30 дней', `${rev30.length}`)}${summaryMetricCardV21('Средние потери 7 дн.', `${avgLoss7.toFixed(1)}%`)}${summaryMetricCardV21('Средние потери 30 дн.', `${avgLoss30.toFixed(1)}%`)}${summaryMetricCardV21('Продажи iiko за 7 дн.', `${totalIiko7.toFixed(3)} кг`)}${summaryMetricCardV21('Продажи iiko за 30 дн.', `${totalIiko30.toFixed(3)} кг`)}</div><p class="description">Можно быстро посмотреть недельную и месячную картину по ревизиям кофе.</p></section>
    <section class="summary-card"><div class="card-head"><h3>Сообщения об ошибках</h3><span class="source-badge">обратная связь</span></div><div class="summary-metrics">${summaryMetricCardV21('За 30 дней', `${errors30.length}`, 'сообщений')}${summaryMetricCardV21('Всего', `${errorRows.length}`, 'сообщений')}</div><h4>Кто чаще сообщает об ошибках</h4>${renderTopEmployeesV21(topErrorEmployees)}</section>
  </div>`;
}
function setControlTab(target){
  state.activeControl = target;
  document.querySelectorAll('[data-control-target]').forEach(btn=>btn.classList.toggle('active', btn.dataset.controlTarget===target));
  document.querySelectorAll('.control-folder').forEach(folder=>folder.classList.toggle('active', folder.id===`control-${target}`));
  if(target==='summary'){ loadControlRecords(); loadRevisionRecords(); loadErrorReports(); }
  if(target==='checklists') loadControlRecords();
  if(target==='revisions') loadRevisionRecords();
  if(target==='errors') loadErrorReports();
}

function techDocOptionsV21(){
  return (state.menu?.techCards || []).map((doc, index) => `<option value="${index}">${esc(doc.title)}</option>`).join('');
}
function techCardOptionsV21(docIndex, selectedKey=''){
  const doc = (state.menu?.techCards || [])[Number(docIndex)] || { cards:[] };
  return (doc.cards || []).map(card => {
    const key = techCardKeyV21(card, doc);
    return `<option value="${esc(key)}" ${key===selectedKey?'selected':''}>${esc(card.title)}</option>`;
  }).join('');
}
function findTechCardByKeyV21(key){
  for(const doc of (state.menu?.techCards || [])){
    for(const card of (doc.cards || [])){
      if(techCardKeyV21(card, doc) === key) return { doc, card };
    }
  }
  return null;
}
function renderTechEditModalV21(){
  if(!isAdmin()) return '';
  const firstDocIndex = 0;
  const firstDoc = (state.menu?.techCards || [])[0] || { cards:[] };
  const firstCard = (firstDoc.cards || [])[0];
  const firstKey = firstCard ? techCardKeyV21(firstCard, firstDoc) : '';
  return `<div class="task-modal" id="tech-edit-modal" aria-hidden="true"><div class="task-form-card tech-edit-card"><div class="card-head"><h3>Редактировать тех. карты</h3><button class="small-action secondary" type="button" data-close-tech-modal>Закрыть</button></div><form id="tech-edit-form"><div class="form-grid"><label>Документ<select name="docIndex" id="tech-doc-select">${techDocOptionsV21()}</select></label><label>Тех. карта<select name="cardKey" id="tech-card-select">${techCardOptionsV21(firstDocIndex, firstKey)}</select></label><label>Название<input name="title" type="text" value="${esc(firstCard?.title || '')}"></label><label>Категория<input name="category" type="text" value="${esc(firstCard?.category || '')}"></label><label>Выход<input name="output" type="text" value="${esc(firstCard?.output || '')}"></label></div><label>Технология<textarea name="technology" rows="4">${esc(firstCard?.technology || '')}</textarea></label><label>Ингредиенты<textarea name="ingredients" rows="8" placeholder="Ингредиент: количество">${esc(ingredientsTextFromListV21(firstCard?.ingredients || []))}</textarea></label><div class="task-form-actions"><button class="small-action ghost" type="button" data-tech-reset>Сбросить изменения</button><button class="small-action secondary" type="button" data-close-tech-modal>Отмена</button><button class="small-action" type="submit">Сохранить</button></div><p class="submit-status tech-edit-status" aria-live="polite"></p></form></div></div>`;
}
function fillTechEditorFormV21(){
  const form = document.querySelector('#tech-edit-form');
  if(!form) return;
  const docIndex = Number(form.elements.docIndex.value || 0);
  const select = form.elements.cardKey;
  const currentSelected = select.value;
  select.innerHTML = techCardOptionsV21(docIndex, currentSelected);
  const pair = findTechCardByKeyV21(select.value) || findTechCardByKeyV21(select.options[0]?.value || '');
  if(!pair) return;
  form.elements.cardKey.value = techCardKeyV21(pair.card, pair.doc);
  form.elements.title.value = pair.card.title || '';
  form.elements.category.value = pair.card.category || '';
  form.elements.output.value = pair.card.output || '';
  form.elements.technology.value = pair.card.technology || '';
  form.elements.ingredients.value = ingredientsTextFromListV21(pair.card.ingredients || []);
}
function openTechEditModalV21(){
  const modal = document.querySelector('#tech-edit-modal');
  if(modal){ modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); }
  fillTechEditorFormV21();
}
function closeTechEditModalV21(){
  const modal = document.querySelector('#tech-edit-modal');
  if(modal){ modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); }
}
function renderTechDocument(doc) {
  const groups = categoryGroups(doc.cards || []);
  return `<section class="tech-document"><div class="doc-card"><div class="doc-content"><div class="card-head"><h3>${esc(doc.title)}</h3><span class="source-badge">${(doc.cards||[]).length} карт</span></div><p class="description">${esc(doc.description||'')}</p><div class="doc-actions"><a class="download-link" href="${esc(doc.file)}" download>Скачать Excel</a><span class="secondary-link">${esc(doc.sourceFile)}</span></div></div></div>${groups.map(group=>`<section class="product-section" id="tech-${slugify(doc.id)}-${slugify(group.category)}"><div class="section-heading"><p>Категория</p><h2>${esc(group.category)}</h2></div><div class="tech-grid">${group.items.map(card=>renderTechCard(card)).join('')}</div></section>`).join('')}</section>`;
}
function bindPhotoAdminEventsV21(){
  document.querySelectorAll('[data-photo-edit]').forEach(btn => {
    btn.onclick = () => openPhotoPickerV21(btn.dataset.photoEdit);
  });
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
  document.querySelector('.main-tabs').innerHTML=tabs.map(tab=>`<button class="main-tab ${tab.id===state.activeTop?'active':''} ${tab.id==='employees'&&hasAccess('employees')?'admin-visible':''}" data-top-target="${esc(tab.id)}" type="button">${esc(tab.title)}</button>`).join('');
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
  if(!state.taskAssignees) loadTaskAssignees();
  if(!state.rolePermissions && !state.rolePermissionsLoading) loadRolePermissions();
  if(isAdmin() && !state.employees) loadEmployees();
  if(state.activeTop==='schedule' && !state.scheduleEvents) loadScheduleEvents();
  if(state.activeTop==='employees' && !state.employees) loadEmployees();
  if(state.activeTop==='control'){
    loadControlRecords();
    loadRevisionRecords();
    if(state.activeControl==='errors' || state.activeControl==='summary') loadErrorReports();
  }
}
function setTop(target){
  if(!hasAccess(target)) target='home';
  state.activeTop=target;
  document.querySelectorAll('.main-tab').forEach(b=>b.classList.toggle('active',b.dataset.topTarget===target));
  document.querySelectorAll('.top-panel').forEach(panel=>panel.classList.toggle('active',panel.id===`top-${target}`));
  history.replaceState(null,'',`#${target}`);
  window.scrollTo({top:0,behavior:'smooth'});
  if(target==='home'){ loadTasks(); if(!state.taskAssignees) loadTaskAssignees(); }
  if(target==='schedule') loadScheduleEvents();
  if(target==='control'){
    loadControlRecords();
    loadRevisionRecords();
    if(state.activeControl==='errors' || state.activeControl==='summary') loadErrorReports();
  }
  if(target==='employees'){ loadEmployees(); if(!state.rolePermissions && !state.rolePermissionsLoading) loadRolePermissions(); }
}
/* --- end v21 overrides --- */

/* --- v22 overrides: sync tech card edits and menu photos through Supabase --- */
async function fetchRemoteContentOverridesV22(){
  const empty = { photoOverrides: {}, techOverrides: {} };
  try {
    if(typeof supa === 'undefined') return empty;
    const session = await getCurrentSession().catch(()=>null);
    if(!session?.user?.id) return empty;
    const [photoRes, techRes] = await Promise.all([
      supa.from('menu_item_overrides').select('item_key,image_url,storage_path,updated_at'),
      supa.from('tech_card_overrides').select('card_key,title,category,output,technology,ingredients,updated_at')
    ]);
    if(photoRes.error) throw photoRes.error;
    if(techRes.error) throw techRes.error;
    const photoOverrides = {};
    (photoRes.data || []).forEach(row => { if(row.item_key && row.image_url) photoOverrides[row.item_key] = row.image_url; });
    const techOverrides = {};
    (techRes.data || []).forEach(row => {
      if(row.card_key){
        techOverrides[row.card_key] = {
          title: row.title || '',
          category: row.category || '',
          output: row.output || '',
          technology: row.technology || '',
          ingredients: Array.isArray(row.ingredients) ? row.ingredients : []
        };
      }
    });
    return { photoOverrides, techOverrides };
  } catch(error){
    console.warn('Remote content overrides skipped. Run STEP_6_CONTENT_SYNC_TECHCARDS_PHOTOS.sql if this is the first setup.', error);
    return empty;
  }
}
async function loadMenu() {
  const embedded = readEmbeddedMenu();
  let base;
  if(location.protocol === 'file:' && embedded){
    base = embedded;
  } else {
    try {
      const res = await fetch('data/menu.json', { cache:'no-cache' });
      if(!res.ok) throw new Error(`Не удалось загрузить data/menu.json: ${res.status}`);
      base = await res.json();
    } catch(error) {
      console.warn('Не удалось загрузить data/menu.json, использую встроенную копию данных', error);
      if(!embedded) throw error;
      base = embedded;
    }
  }
  let merged = applyLocalContentOverridesV21(base);
  const remote = await fetchRemoteContentOverridesV22();
  merged = applyRemoteContentOverridesV22(merged, remote);
  return merged;
}
function photoUploadPathV22(itemKey){
  const slug = slugify(String(itemKey || 'menu-photo')).slice(0, 90) || 'menu-photo';
  return `menu/${slug}-${Date.now()}.jpg`;
}
async function compressImageFileV22(file){
  if(!file.type || !file.type.startsWith('image/')) throw new Error('Выберите файл изображения.');
  const dataUrl = await new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject)=>{
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось обработать изображение.'));
    image.src = dataUrl;
  });
  const maxSide = 1400;
  const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * ratio));
  const height = Math.max(1, Math.round(img.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  return await new Promise((resolve, reject)=>{
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Не удалось сжать изображение.')), 'image/jpeg', 0.82);
  });
}
async function savePhotoToSupabaseV22(itemKey, file){
  if(!isAdmin()) throw new Error('Фото может добавлять только администратор.');
  const user = currentUser();
  if(!user?.id) throw new Error('Нужно войти в аккаунт администратора.');
  const blob = await compressImageFileV22(file);
  const path = photoUploadPathV22(itemKey);
  const upload = await supa.storage.from('menu-photos').upload(path, blob, { contentType:'image/jpeg', cacheControl:'3600', upsert:true });
  if(upload.error) throw upload.error;
  const publicUrl = supa.storage.from('menu-photos').getPublicUrl(upload.data.path).data.publicUrl;
  const row = { item_key:itemKey, image_url:publicUrl, storage_path:upload.data.path, updated_by:user.id };
  const res = await supa.from('menu_item_overrides').upsert(row, { onConflict:'item_key' }).select().single();
  if(res.error) throw res.error;
  const local = getMenuPhotoOverridesV21();
  local[itemKey] = publicUrl;
  saveStorageJsonV21(MENU_PHOTO_OVERRIDES_KEY_V21, local);
  return publicUrl;
}
function ensurePhotoInputV21(){
  let input = document.getElementById('admin-photo-input-v21');
  if(input) return input;
  input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.id = 'admin-photo-input-v21';
  input.hidden = true;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if(!file || !pendingPhotoTargetKeyV21) return;
    const itemKey = pendingPhotoTargetKeyV21;
    pendingPhotoTargetKeyV21 = '';
    try {
      const url = await savePhotoToSupabaseV22(itemKey, file);
      applyPhotoOverrideToStateV21(itemKey, url);
      input.value = '';
      alert('Фото сохранено в Supabase и будет видно всем сотрудникам.');
      state.menu = await loadMenu();
      renderApp();
      setTop('method');
    } catch(error){
      console.error(error);
      input.value = '';
      alert('Не удалось сохранить фото в Supabase: ' + (error.message || 'проверьте SQL STEP_6 и права администратора.'));
    }
  });
  document.body.appendChild(input);
  return input;
}
async function saveTechOverrideToSupabaseV22(cardKey, payload){
  if(!isAdmin()) throw new Error('Редактировать тех. карты может только администратор.');
  const user = currentUser();
  if(!user?.id) throw new Error('Нужно войти в аккаунт администратора.');
  const row = {
    card_key: cardKey,
    title: payload.title || '',
    category: payload.category || '',
    output: payload.output || '',
    technology: payload.technology || '',
    ingredients: Array.isArray(payload.ingredients) ? payload.ingredients : [],
    updated_by: user.id
  };
  const res = await supa.from('tech_card_overrides').upsert(row, { onConflict:'card_key' }).select().single();
  if(res.error) throw res.error;
  const local = getTechCardOverridesV21();
  local[cardKey] = payload;
  saveStorageJsonV21(TECH_CARD_OVERRIDES_KEY_V21, local);
  return res.data;
}
async function submitTechEditV21(event){
  event.preventDefault();
  if(!isAdmin()) return alert('Редактировать тех. карты может только администратор.');
  const form = event.currentTarget;
  const status = form.querySelector('.tech-edit-status');
  const payload = {
    title: (form.elements.title.value || '').trim(),
    category: (form.elements.category.value || '').trim(),
    output: (form.elements.output.value || '').trim(),
    technology: (form.elements.technology.value || '').trim(),
    ingredients: parseIngredientsTextV21(form.elements.ingredients.value)
  };
  const key = form.elements.cardKey.value;
  if(!key || !payload.title){
    if(status){ status.textContent = 'Нужно выбрать тех. карту и указать название.'; status.className='submit-status error'; }
    return;
  }
  try{
    if(status){ status.textContent = 'Сохраняю в Supabase…'; status.className = 'submit-status'; }
    await saveTechOverrideToSupabaseV22(key, payload);
    applyTechOverrideToStateV21(key, payload);
    if(status){ status.textContent = ''; }
    alert('Тех. карта сохранена в Supabase и будет видна всем сотрудникам.');
    state.menu = await loadMenu();
    renderApp();
    setTop('techcards');
    openTechEditModalV21();
  } catch(error){
    console.error(error);
    if(status){ status.textContent = 'Не удалось сохранить в Supabase.'; status.className = 'submit-status error'; }
    alert('Не удалось сохранить тех. карту: ' + (error.message || 'проверьте SQL STEP_6 и права администратора.'));
  }
}
async function resetTechOverrideV21(){
  const form = document.querySelector('#tech-edit-form');
  if(!form) return;
  const key = form.elements.cardKey.value;
  if(!key) return;
  if(!confirm('Сбросить изменения для этой тех. карты у всех сотрудников?')) return;
  try{
    const res = await supa.from('tech_card_overrides').delete().eq('card_key', key);
    if(res.error) throw res.error;
    const overrides = getTechCardOverridesV21();
    delete overrides[key];
    saveStorageJsonV21(TECH_CARD_OVERRIDES_KEY_V21, overrides);
    state.menu = await loadMenu();
    alert('Изменения сброшены.');
    renderApp();
    setTop('techcards');
    openTechEditModalV21();
  } catch(error){
    console.error(error);
    alert('Не удалось сбросить изменения: ' + (error.message || 'проверьте Supabase.'));
  }
}
async function handleLogin(event){
  event.preventDefault();
  const form = event.currentTarget;
  const errorEl = document.querySelector('#login-error');
  const login = (form.elements.login.value || '').trim().toLowerCase();
  const password = (form.elements.password.value || '').trim();
  if(errorEl) errorEl.textContent = 'Проверяю данные…';
  try {
    const email = loginToEmail(login);
    const result = await supa.auth.signInWithPassword({ email, password });
    if(result.error) throw result.error;
    const profile = await getCurrentProfile();
    saveAuth({ token: result.data.session?.access_token || '', session: result.data.session, user: profile });
    state.menu = await loadMenu();
    state.activeTop = 'home';
    renderApp();
  } catch(error) {
    if(errorEl) errorEl.textContent = 'Не удалось войти: ' + (error.message || 'проверьте логин и пароль.');
  }
}
async function init(){
  try {
    state.auth = readSavedAuth();
    await restoreSupabaseSession();
    state.menu = await loadMenu();
    const hash = location.hash.replace('#','');
    if(hash.includes('/')) {
      const [top, method] = hash.split('/');
      if((state.menu.site.mainTabs||[]).some(t=>t.id===top) || top==='employees') state.activeTop=top;
      if((state.menu.site.methodTabs||[]).some(t=>t.id===method)) state.activeMethod=method;
    } else if((state.menu.site.mainTabs||[]).some(t=>t.id===hash) || hash==='employees') {
      state.activeTop=hash;
    }
    renderApp();
  } catch(error) {
    document.querySelector('#panels').innerHTML = `<div class="error">Сайт загружен, но не удалось подключиться к Supabase или прочитать данные. Детали: ${esc(error.message)}</div>`;
    console.error(error);
  }
}
/* --- end v22 overrides --- */

/* --- v23 overrides: icon, photos, reports, tech-card creation, schedule dedupe --- */
function techCardKeyV21(card, doc){
  return card?.__cardKey || [doc?.sourceFile || card?.sourceFile || doc?.title || '', card?.title || ''].join('::');
}
function normalizeTextV23(value){ return String(value ?? '').trim().toLowerCase(); }
function scheduleEventFingerprintV23(row){
  return [
    normalizeDateKey(row?.eventDate || row?.date || ''),
    normalizeTextV23(row?.type),
    normalizeTextV23(row?.title),
    normalizeTextV23(row?.employeeName || row?.authorName),
    normalizeTextV23(row?.description)
  ].join('|');
}
function getScheduleEvents(){
  const dynamic = Array.isArray(state.scheduleEvents) ? state.scheduleEvents : getLocalArray(SCHEDULE_STORAGE_KEY);
  const merged = [...(getInitialScheduleEvents() || []), ...(dynamic || [])];
  const map = new Map();
  merged.forEach(row => {
    if(!row) return;
    const fp = scheduleEventFingerprintV23(row);
    const idKey = row.id ? `id:${row.id}` : '';
    const key = idKey || fp;
    if(!key) return;
    if(!map.has(key)) { map.set(key, row); return; }
    const prev = map.get(key) || {};
    map.set(key, { ...prev, ...row, id: prev.id || row.id || '' });
  });
  const fpSeen = new Set();
  const deduped = [];
  Array.from(map.values()).forEach(row => {
    const fp = scheduleEventFingerprintV23(row);
    if(fpSeen.has(fp)) return;
    fpSeen.add(fp);
    deduped.push(row);
  });
  return deduped.sort((a,b)=>{
    const ad = String(a?.eventDate || '');
    const bd = String(b?.eventDate || '');
    if(ad !== bd) return ad.localeCompare(bd);
    return `${a?.type||''} ${a?.title||''}`.localeCompare(`${b?.type||''} ${b?.title||''}`, 'ru');
  });
}
function renderPhoto(item) {
  if(item.image) {
    return `<button class="photo-frame has-image expandable" type="button" data-photo-toggle aria-expanded="false"><img src="${esc(item.image)}" alt="${esc(item.title)}" loading="lazy"><span class="photo-expand-hint">Нажмите, чтобы развернуть фото</span></button>`;
  }
  return `<div class="photo-frame"><div><div class="photo-icon">+</div><div class="photo-text">место для фото</div></div></div>`;
}
function renderCard(item) {
  const itemKey = menuItemKeyV21(item);
  const adminPhotoButton = isAdmin() ? `<button class="mini-admin-btn" type="button" data-photo-edit="${esc(itemKey)}">${item.image ? 'Изменить фото' : 'Добавить фото'}</button>` : '';
  return `<article class="product-card" data-search="${esc(itemSearchText(item))}">${renderPhoto(item)}<div class="card-body">${renderTags(item)}<div class="card-head"><h3>${esc(item.title)}</h3>${item.price?`<span class="price-badge">${esc(item.price)}</span>`:''}</div>${renderDescription(item)}${renderFacts(item)}<div class="nutrition"><h4>КБЖУ</h4><p>${esc(kbjuText(item.kbju))}</p></div>${renderIngredients(item)}${renderNote(item)}${adminPhotoButton?`<div class="admin-card-actions">${adminPhotoButton}</div>`:''}</div></article>`;
}
function bindPhotoToggleEventsV23(){
  document.querySelectorAll('[data-photo-toggle]').forEach(btn => {
    btn.onclick = (event) => {
      event.preventDefault();
      const card = btn.closest('.product-card');
      if(!card) return;
      const expanded = card.classList.toggle('photo-expanded');
      btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      const hint = btn.querySelector('.photo-expand-hint');
      if(hint) hint.textContent = expanded ? 'Нажмите, чтобы свернуть фото' : 'Нажмите, чтобы развернуть фото';
    };
  });
}
function customTechDocIdFromKeyV23(key){
  const parts = String(key || '').split('::');
  return parts[0] === 'custom' ? parts[1] || '' : '';
}
function applyContentOverridesV23(menu, photoOverrides, techOverrides){
  const cloned = JSON.parse(JSON.stringify(menu || {}));
  const docMatches = (doc, docId) => {
    const wanted = slugify(docId || '');
    return [doc?.id, doc?.title, doc?.sourceFile].some(value => slugify(value || '') === wanted);
  };
  (cloned.items || []).forEach(item => {
    const key = menuItemKeyV21(item);
    if(photoOverrides && photoOverrides[key]) item.image = photoOverrides[key];
  });
  const seen = new Set();
  (cloned.techCards || []).forEach(doc => {
    (doc.cards || []).forEach(card => {
      const key = techCardKeyV21(card, doc);
      card.__cardKey = key;
      seen.add(key);
      const override = techOverrides ? techOverrides[key] : null;
      if(override){
        card.title = override.title || card.title;
        card.category = override.category || card.category;
        card.output = override.output || '';
        card.technology = override.technology || '';
        card.ingredients = Array.isArray(override.ingredients) ? override.ingredients : (card.ingredients || []);
      }
    });
  });
  Object.entries(techOverrides || {}).forEach(([key, override]) => {
    if(seen.has(key)) return;
    const docId = customTechDocIdFromKeyV23(key);
    if(!docId) return;
    const doc = (cloned.techCards || []).find(item => docMatches(item, docId));
    if(!doc) return;
    doc.cards = doc.cards || [];
    doc.cards.unshift({
      __cardKey: key,
      title: override.title || 'Новая тех. карта',
      category: override.category || 'Без раздела',
      output: override.output || '',
      technology: override.technology || '',
      ingredients: Array.isArray(override.ingredients) ? override.ingredients : [],
      source: 'Добавлено в сервисе',
      sourceFile: doc.sourceFile || doc.title || ''
    });
  });
  return cloned;
}
function applyLocalContentOverridesV21(menu){
  return applyContentOverridesV23(menu, getMenuPhotoOverridesV21(), getTechCardOverridesV21());
}
function applyRemoteContentOverridesV22(menu, remote){
  return applyContentOverridesV23(menu, remote?.photoOverrides || {}, remote?.techOverrides || {});
}
function techDocByIndexV23(index){
  return (state.menu?.techCards || [])[Number(index)] || null;
}
function renderTechCreateModalV23(){
  if(!isAdmin()) return '';
  const docs = state.menu?.techCards || [];
  const firstDocIndex = 0;
  return `<div class="task-modal" id="tech-create-modal" aria-hidden="true"><div class="task-form-card tech-edit-card"><div class="card-head"><h3>Добавить новую тех. карту</h3><button class="small-action secondary" type="button" data-close-tech-create>Закрыть</button></div><form id="tech-create-form"><div class="form-grid"><label>Документ<select name="docIndex">${docs.map((doc,index)=>`<option value="${index}">${esc(doc.title)}</option>`).join('')}</select></label><label>Название<input name="title" type="text" required placeholder="Название тех. карты"></label><label>Категория<input name="category" type="text" placeholder="Например, Лимонады"></label><label>Выход<input name="output" type="text" placeholder="Например, 250 мл"></label></div><label>Технология<textarea name="technology" rows="4" placeholder="Опишите технологию приготовления"></textarea></label><label>Ингредиенты<textarea name="ingredients" rows="8" placeholder="Ингредиент: количество"></textarea></label><div class="task-form-actions"><button class="small-action secondary" type="button" data-close-tech-create>Отмена</button><button class="small-action" type="submit">Добавить</button></div><p class="submit-status tech-create-status" aria-live="polite"></p></form></div></div>`;
}
function openTechCreateModalV23(){
  const modal = document.querySelector('#tech-create-modal');
  if(modal){ modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); }
}
function closeTechCreateModalV23(){
  const modal = document.querySelector('#tech-create-modal');
  if(modal){ modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); }
}
function createTechCardKeyV23(doc, title){
  const docId = slugify(doc?.id || doc?.title || doc?.sourceFile || 'tech-doc');
  const titleSlug = slugify(title || 'new-card').slice(0, 60) || 'new-card';
  return `custom::${docId}::${Date.now()}-${titleSlug}`;
}
async function submitTechCreateV23(event){
  event.preventDefault();
  if(!isAdmin()) return alert('Добавлять тех. карты может только администратор.');
  const form = event.currentTarget;
  const status = form.querySelector('.tech-create-status');
  const doc = techDocByIndexV23(form.elements.docIndex.value);
  const payload = {
    title: (form.elements.title.value || '').trim(),
    category: (form.elements.category.value || '').trim(),
    output: (form.elements.output.value || '').trim(),
    technology: (form.elements.technology.value || '').trim(),
    ingredients: parseIngredientsTextV21(form.elements.ingredients.value)
  };
  if(!doc || !payload.title){
    if(status){ status.textContent = 'Выберите документ и укажите название тех. карты.'; status.className = 'submit-status error'; }
    return;
  }
  const key = createTechCardKeyV23(doc, payload.title);
  try{
    if(status){ status.textContent = 'Сохраняю в Supabase…'; status.className = 'submit-status'; }
    await saveTechOverrideToSupabaseV22(key, payload);
    const local = getTechCardOverridesV21();
    local[key] = payload;
    saveStorageJsonV21(TECH_CARD_OVERRIDES_KEY_V21, local);
    state.menu = await loadMenu();
    closeTechCreateModalV23();
    renderApp();
    setTop('techcards');
    alert('Новая тех. карта добавлена.');
  } catch(error){
    console.error(error);
    if(status){ status.textContent = 'Не удалось сохранить тех. карту.'; status.className = 'submit-status error'; }
    alert('Не удалось добавить тех. карту: ' + (error.message || 'проверьте подключение к Supabase.'));
  }
}
function renderTechCards() {
  const docs = state.menu.techCards || [];
  return `<section class="top-panel ${state.activeTop==='techcards'?'active':''}" id="top-techcards"><div class="section-heading"><p>Рабочие документы</p><h2>Тех. карты</h2></div><div class="toolbar"><div class="search-row"><input class="search" placeholder="Поиск по тех. картам, ингредиентам или технологии" type="search"><button class="clear-btn" type="button">Сбросить</button></div><div class="toolbar-inline-actions"><nav class="nav">${docs.map(doc=>`<a class="nav-pill" href="#tech-${slugify(doc.id)}">${esc(doc.title)}<span>${(doc.cards||[]).length}</span></a>`).join('')}</nav>${isAdmin()?`<button class="small-action secondary" type="button" data-open-tech-create>Добавить тех. карту</button><button class="small-action" type="button" data-open-tech-edit>Редактировать тех. карты</button>`:''}</div></div><div class="tech-docs">${docs.map(doc=>`<div id="tech-${slugify(doc.id)}">${renderTechDocument(doc)}</div>`).join('')}</div><div class="empty-state">Ничего не найдено. Попробуйте изменить запрос.</div>${renderTechEditModalV21()}${renderTechCreateModalV23()}</section>`;
}
function bindTechEditorEventsV21(){
  document.querySelector('[data-open-tech-edit]')?.addEventListener('click', openTechEditModalV21);
  document.querySelectorAll('[data-close-tech-modal]').forEach(btn => btn.addEventListener('click', closeTechEditModalV21));
  document.querySelector('#tech-edit-form')?.addEventListener('submit', submitTechEditV21);
  document.querySelector('#tech-doc-select')?.addEventListener('change', fillTechEditorFormV21);
  document.querySelector('#tech-card-select')?.addEventListener('change', fillTechEditorFormV21);
  document.querySelector('[data-tech-reset]')?.addEventListener('click', resetTechOverrideV21);
  document.querySelector('[data-open-tech-create]')?.addEventListener('click', openTechCreateModalV23);
  document.querySelectorAll('[data-close-tech-create]').forEach(btn => btn.addEventListener('click', closeTechCreateModalV23));
  document.querySelector('#tech-create-form')?.addEventListener('submit', submitTechCreateV23);
}
function getManualReportFilterV23(){
  if(!state.manualReportFilter){
    state.manualReportFilter = { source:'all', dateFrom:'', dateTo:'', employee:'' };
  }
  return state.manualReportFilter;
}
function dateKeyFromDateTimeV23(value){
  if(!value) return '';
  try { return new Date(value).toISOString().slice(0,10); } catch(error){ return ''; }
}
function passesDateFilterV23(dateKey, filters){
  if(filters.dateFrom && String(dateKey || '') < filters.dateFrom) return false;
  if(filters.dateTo && String(dateKey || '') > filters.dateTo) return false;
  return true;
}
function buildManualReportRowsV23(filters = getManualReportFilterV23()){
  const employeeNeedle = normalizeTextV23(filters.employee);
  const rows = [];
  const pushIfMatch = (row) => {
    if(employeeNeedle && !normalizeTextV23(row.employee).includes(employeeNeedle)) return;
    if(!passesDateFilterV23(row.dateKey, filters)) return;
    rows.push(row);
  };
  if(filters.source === 'all' || filters.source === 'checklists'){
    getControlRecords().forEach(record => {
      const totals = recordDoneTotal(record);
      pushIfMatch({
        source: 'Чек-листы',
        dateKey: dateKeyFromDateTimeV23(record.createdAt),
        dateTime: formatDateTime(record.createdAt),
        employee: record.employeeName || '—',
        name: record.checklistTitle || 'Чек-лист',
        details: (record.tasks || []).map(task => `${task.checked ? '✓' : '—'} ${task.text}`).join(' | '),
        status: `${totals.done}/${totals.total}`,
        value: totals.total ? `${Math.round((totals.done / totals.total) * 100)}%` : '—'
      });
    });
  }
  if(filters.source === 'all' || filters.source === 'revisions'){
    getRevisionRecords().forEach(record => {
      pushIfMatch({
        source: 'Ревизии',
        dateKey: record.dateKey || dateKeyFromDateTimeV23(record.createdAt),
        dateTime: formatDateTime(record.createdAt),
        employee: record.employeeName || '—',
        name: 'Ревизия кофе',
        details: `Бункер: ${record.hopperWeight || '—'} кг · Вскрыто: ${record.openedPacks || '—'} · Продажи: ${record.iikoSales || '—'} кг · Списания: ${record.writeOffs || '—'} кг`,
        status: record.checked || '—',
        value: `Потери: ${record.losses || '—'}`
      });
    });
  }
  if(filters.source === 'all' || filters.source === 'errors'){
    getErrorReports().forEach(record => {
      pushIfMatch({
        source: 'Ошибки',
        dateKey: dateKeyFromDateTimeV23(record.createdAt),
        dateTime: formatDateTime(record.createdAt),
        employee: record.employeeName || '—',
        name: 'Сообщение об ошибке',
        details: record.text || '',
        status: '—',
        value: '—'
      });
    });
  }
  return rows.sort((a,b)=> `${b.dateKey || ''} ${b.dateTime || ''}`.localeCompare(`${a.dateKey || ''} ${a.dateTime || ''}`, 'ru'));
}
function renderManualReportTableV23(){
  const rows = buildManualReportRowsV23();
  if(!rows.length) return `<div class="empty-control"><h3>Данных пока нет</h3><p>Выберите параметры и сформируйте отчет.</p></div>`;
  return `<div class="employee-table-wrap"><table class="employee-table report-export-table"><thead><tr><th>Источник</th><th>Дата</th><th>Дата и время</th><th>Сотрудник</th><th>Название</th><th>Детали</th><th>Статус</th><th>Значение</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.source)}</td><td>${esc(displayDateFromKey(row.dateKey) || row.dateKey || '—')}</td><td>${esc(row.dateTime || '—')}</td><td>${esc(row.employee || '—')}</td><td>${esc(row.name || '—')}</td><td>${esc(row.details || '—')}</td><td>${esc(row.status || '—')}</td><td>${esc(row.value || '—')}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderManualReportBuilderV23(){
  const filters = getManualReportFilterV23();
  return `<section class="summary-card report-builder-card"><div class="card-head"><h3>Ручной отчет</h3><span class="source-badge">конструктор</span></div><form class="report-builder-form" id="report-builder-form"><div class="form-grid"><label>Источник<select name="source"><option value="all" ${filters.source==='all'?'selected':''}>Все разделы</option><option value="checklists" ${filters.source==='checklists'?'selected':''}>Чек-листы</option><option value="revisions" ${filters.source==='revisions'?'selected':''}>Ревизии</option><option value="errors" ${filters.source==='errors'?'selected':''}>Ошибки</option></select></label><label>Сотрудник<input type="text" name="employee" value="${esc(filters.employee)}" placeholder="Имя сотрудника"></label><label>Дата от<input type="date" name="dateFrom" value="${esc(filters.dateFrom)}"></label><label>Дата до<input type="date" name="dateTo" value="${esc(filters.dateTo)}"></label></div><div class="task-form-actions"><button class="small-action secondary" type="button" data-report-reset>Сбросить</button><button class="small-action" type="submit">Сформировать отчет</button><button class="small-action secondary" type="button" data-report-export>Скачать Excel</button></div></form><div id="manual-report-table">${renderManualReportTableV23()}</div></section>`;
}
function bindControlSummaryEventsV23(){
  document.querySelector('#report-builder-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    state.manualReportFilter = {
      source: form.elements.source.value || 'all',
      dateFrom: form.elements.dateFrom.value || '',
      dateTo: form.elements.dateTo.value || '',
      employee: (form.elements.employee.value || '').trim()
    };
    const table = document.querySelector('#manual-report-table');
    if(table) table.innerHTML = renderManualReportTableV23();
  });
  document.querySelector('[data-report-reset]')?.addEventListener('click', () => {
    state.manualReportFilter = { source:'all', dateFrom:'', dateTo:'', employee:'' };
    refreshControl();
  });
  document.querySelector('[data-report-export]')?.addEventListener('click', exportManualReportV23);
}
function renderControl(){
  return `<section class="top-panel ${state.activeTop==='control'?'active':''}" id="top-control"><div class="section-heading"><p>Журнал</p><h2>Контроль</h2></div><div class="subtabs control-subtabs"><button class="subtab ${state.activeControl==='summary'?'active':''}" data-control-target="summary" type="button">Сводка</button><button class="subtab ${state.activeControl==='checklists'?'active':''}" data-control-target="checklists" type="button">Чек-листы</button><button class="subtab ${state.activeControl==='revisions'?'active':''}" data-control-target="revisions" type="button">Ревизии</button><button class="subtab ${state.activeControl==='errors'?'active':''}" data-control-target="errors" type="button">Ошибки</button></div><div class="control-folder ${state.activeControl==='summary'?'active':''}" id="control-summary"><div class="control-note"><p>Сводка автоматически собирает данные из раздела «Контроль». Ниже можно вручную сформировать отчет по нужным параметрам и выгрузить его в Excel.</p></div><div id="control-summary-wrap">${renderControlSummaryV21()}${renderManualReportBuilderV23()}</div></div><div class="control-folder ${state.activeControl==='checklists'?'active':''}" id="control-checklists"><div class="control-note"><p>Здесь отображаются только отправленные чек-листы со всех устройств.</p><div class="doc-actions"><button type="button" class="refresh-control">Обновить данные</button><button type="button" class="download-control-csv">Скачать CSV</button></div></div><div id="control-records">${renderControlRecordsTable()}</div></div><div class="control-folder ${state.activeControl==='revisions'?'active':''}" id="control-revisions"><div class="control-note"><p>Здесь отображается ежедневная ревизия кофе.</p><div class="doc-actions"><button type="button" class="refresh-revisions">Обновить данные</button><button type="button" class="download-revisions-csv">Скачать CSV</button></div></div>${renderRevisionManualForm()}<div id="revision-records">${renderRevisionRecordsTable()}</div></div><div class="control-folder ${state.activeControl==='errors'?'active':''}" id="control-errors"><div class="control-note"><p>Здесь отображаются сообщения сотрудников об ошибках.</p><div class="doc-actions"><button type="button" class="refresh-errors">Обновить данные</button></div></div><div id="error-records">${renderErrorReportsTable()}</div></div></section>`;
}
function refreshControl(){
  const summary = document.querySelector('#control-summary-wrap');
  if(summary) summary.innerHTML = renderControlSummaryV21() + renderManualReportBuilderV23();
  const el = document.querySelector('#control-records'); if(el) el.innerHTML = renderControlRecordsTable();
  const rev = document.querySelector('#revision-records'); if(rev) rev.innerHTML = renderRevisionRecordsTable();
  const err = document.querySelector('#error-records'); if(err) err.innerHTML = renderErrorReportsTable();
  bindControlSummaryEventsV23();
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
  bindRolePermissionEvents();
  document.querySelectorAll('[data-employee-delete]').forEach(btn=>btn.addEventListener('click',()=>deleteEmployee(btn.dataset.employeeDelete)));
  document.querySelector('.download-control-csv')?.addEventListener('click',exportControlCsv);
  document.querySelector('.refresh-control')?.addEventListener('click',loadControlRecords);
  document.querySelector('.download-revisions-csv')?.addEventListener('click',exportRevisionCsv);
  document.querySelector('.refresh-revisions')?.addEventListener('click',loadRevisionRecords);
  document.querySelector('.refresh-errors')?.addEventListener('click',loadErrorReports);
  document.querySelector('[data-control-summary-refresh]')?.addEventListener('click',()=>{ loadControlRecords(); loadRevisionRecords(); loadErrorReports(); });
  bindControlSummaryEventsV23();
  document.querySelector('[data-open-task-modal]')?.addEventListener('click',openTaskModal);
  document.querySelectorAll('[data-close-task-modal]').forEach(btn=>btn.addEventListener('click',closeTaskModal));
  document.querySelector('#task-form')?.addEventListener('submit',submitTask);
  bindTaskCardEventsV21();
  document.querySelector('#error-report-form')?.addEventListener('submit',submitErrorReport);
  document.querySelector('[data-schedule-prev]')?.addEventListener('click',()=>shiftMonth(-1));
  document.querySelector('[data-schedule-next]')?.addEventListener('click',()=>shiftMonth(1));
  document.querySelector('[data-toggle-schedule-form]')?.addEventListener('click',()=>{ const d=document.querySelector('#schedule-form-wrap'); if(d) d.open=!d.open; });
  document.querySelector('#schedule-event-form')?.addEventListener('submit',submitScheduleEvent);
  document.querySelector('[data-refresh-service]')?.addEventListener('click',()=>location.reload());
  bindPhotoAdminEventsV21();
  bindPhotoToggleEventsV23();
  bindTechEditorEventsV21();
}
/* --- end v23 overrides --- */
function exportManualReportV23(){
  const rows = buildManualReportRowsV23();
  const head = ['Источник','Дата','Дата и время','Сотрудник','Название','Детали','Статус','Значение'];
  const body = rows.map(row => [row.source, displayDateFromKey(row.dateKey) || row.dateKey || '', row.dateTime || '', row.employee || '', row.name || '', row.details || '', row.status || '', row.value || '']);
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>${head.map(item=>`<th>${esc(item)}</th>`).join('')}</tr></thead><tbody>${body.map(cols=>`<tr>${cols.map(cell=>`<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
  const blob = new Blob(['\ufeff', html], { type:'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'control_manual_report.xls';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Start application after all final overrides are registered.
init();
