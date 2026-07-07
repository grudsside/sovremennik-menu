const state = { menu: null, activeTab: 'bar' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
}

function slugify(text) {
  const map = {'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'};
  return String(text).toLowerCase().split('').map(ch => map[ch] ?? ch).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function kbjuText(kbju = {}) {
  return `Ккал: ${kbju.calories || '____'} · Б: ${kbju.protein || '____'} · Ж: ${kbju.fat || '____'} · У: ${kbju.carbs || '____'}`;
}

function itemSearchText(item) {
  return [item.title, item.category, item.price, item.volume, item.description, item.note, ...(item.ingredients || [])].join(' ').toLowerCase();
}

function categoryGroups(items) {
  const map = new Map();
  for (const item of items) {
    const cat = item.category || 'Без раздела';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(item);
  }
  return Array.from(map.entries()).map(([category, items]) => ({ category, items }));
}

function renderPhoto(item) {
  if (item.image) {
    return `<div class="photo-frame has-image"><img src="${esc(item.image)}" alt="${esc(item.title)}" loading="lazy"></div>`;
  }
  return `<div class="photo-frame" aria-label="Место для фото"><div class="photo-icon">+</div><div class="photo-text">место для фото</div></div>`;
}

function renderDescription(item) {
  if (!item.description) return '';
  if (item.descriptionCollapsed) {
    return `<details class="description-block"><summary>Описание</summary><p>${esc(item.description)}</p></details>`;
  }
  return `<p class="description">${esc(item.description)}</p>`;
}

function renderFacts(item) {
  const facts = [];
  if (item.volume) facts.push(['Объем', item.volume]);
  if (item.category && item.section !== 'bar') facts.push(['Раздел', item.category]);
  facts.push(['Время приготовления', item.time || '__________']);
  return `<div class="facts">${facts.map(([label, value]) => `<div class="fact"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('')}</div>`;
}

function renderIngredients(item) {
  const ingredients = item.ingredients && item.ingredients.length ? item.ingredients : ['Состав уточнить'];
  return `<div class="ingredients"><h4>Состав</h4><ul>${ingredients.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`;
}

function renderTags(item) {
  const tags = [...(item.tags || [])];
  if (item.isArchive && !tags.some(t => t.toLowerCase().includes('архив'))) tags.push('архив');
  if (!tags.length) return '';
  return `<div class="tag-row">${tags.map(t => `<span class="tag ${t.toLowerCase().includes('архив') ? 'archive' : ''}">${esc(t)}</span>`).join('')}</div>`;
}

function renderNote(item) {
  if (!item.note) return '';
  return `<details class="note"><summary>На заметку</summary><p>${esc(item.note)}</p></details>`;
}

function renderCard(item) {
  return `<article class="product-card" data-search="${esc(itemSearchText(item))}">
    ${renderPhoto(item)}
    <div class="card-body">
      ${renderTags(item)}
      <div class="card-head"><h3>${esc(item.title)}</h3>${item.price ? `<span class="price-badge">${esc(item.price)}</span>` : ''}</div>
      ${renderDescription(item)}
      ${renderFacts(item)}
      <div class="nutrition"><h4>КБЖУ</h4><p>${esc(kbjuText(item.kbju))}</p></div>
      ${renderIngredients(item)}
      ${renderNote(item)}
    </div>
  </article>`;
}

function renderPanel(tab) {
  const allItems = state.menu.items.filter(item => item.section === tab.id);
  const groups = categoryGroups(allItems);
  const nav = groups.map(group => `<a class="nav-pill" href="#${tab.id}-${slugify(group.category)}">${esc(group.category)}<span>${group.items.length}</span></a>`).join('');
  const sections = groups.map(group => `<section class="product-section" id="${tab.id}-${slugify(group.category)}"><div class="section-heading"><p>Раздел</p><h2>${esc(group.category)}</h2></div><div class="cards-grid">${group.items.map(renderCard).join('')}</div></section>`).join('');
  return `<section class="tab-panel ${tab.id === state.activeTab ? 'active' : ''}" id="panel-${tab.id}">
    <div class="toolbar" aria-label="Навигация: ${esc(tab.title)}">
      <div class="search-row"><input class="search" placeholder="${esc(tab.searchPlaceholder || 'Поиск')}" type="search"><button class="clear-btn" type="button">Сбросить</button></div>
      <nav class="nav">${nav}</nav>
    </div>
    <main>${sections}</main>
    <div class="empty-state">Ничего не найдено. Попробуйте изменить запрос.</div>
  </section>`;
}

function renderApp() {
  const { site } = state.menu;
  document.title = `${site.title} — методичка`;
  document.querySelector('.brand').textContent = site.title;
  document.querySelector('.kicker').textContent = site.subtitle;
  document.querySelector('.muted').textContent = site.description;
  document.querySelector('.main-tabs').innerHTML = site.tabs.map(tab => `<button class="main-tab ${tab.id === state.activeTab ? 'active' : ''}" data-tab-target="${esc(tab.id)}" type="button">${esc(tab.title)}</button>`).join('');
  document.querySelector('#panels').innerHTML = site.tabs.map(renderPanel).join('');
  bindEvents();
}

function bindEvents() {
  document.querySelectorAll('.main-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tabTarget;
      document.querySelectorAll('.main-tab').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `panel-${state.activeTab}`));
      history.replaceState(null, '', `#${state.activeTab}`);
    });
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    const input = panel.querySelector('.search');
    const clear = panel.querySelector('.clear-btn');
    const cards = Array.from(panel.querySelectorAll('.product-card'));
    const empty = panel.querySelector('.empty-state');
    const filter = () => {
      const q = (input.value || '').trim().toLowerCase();
      let visible = 0;
      cards.forEach(card => {
        const ok = !q || (card.dataset.search || card.textContent).toLowerCase().includes(q);
        card.classList.toggle('hidden', !ok);
        if (ok) visible += 1;
      });
      empty.classList.toggle('show', visible === 0);
    };
    input.addEventListener('input', filter);
    clear.addEventListener('click', () => { input.value = ''; filter(); input.focus(); });
  });
}

function readEmbeddedMenu() {
  const el = document.getElementById('menu-data');
  if (!el) return null;
  try {
    return JSON.parse(el.textContent);
  } catch (error) {
    console.error('Не удалось прочитать встроенные данные menu-data', error);
    return null;
  }
}

async function loadMenu() {
  const embedded = readEmbeddedMenu();
  // При открытии файла напрямую с компьютера браузер часто блокирует fetch к data/menu.json.
  // Поэтому для локального просмотра используем встроенную копию данных.
  if (location.protocol === 'file:' && embedded) return embedded;

  try {
    const res = await fetch('data/menu.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Не удалось загрузить data/menu.json: ${res.status}`);
    return await res.json();
  } catch (error) {
    console.warn('Не удалось загрузить data/menu.json, использую встроенную копию данных', error);
    if (embedded) return embedded;
    throw error;
  }
}

async function init() {
  try {
    state.menu = await loadMenu();
    const hash = location.hash.replace('#', '');
    if (state.menu.site.tabs.some(t => t.id === hash)) state.activeTab = hash;
    renderApp();
  } catch (error) {
    document.querySelector('#panels').innerHTML = `<div class="error">Сайт загружен, но не удалось прочитать данные меню. Проверьте, что рядом с index.html есть папка <b>data</b> с файлом <b>menu.json</b>, либо загрузите всю папку сайта на GitHub Pages. Детали: ${esc(error.message)}</div>`;
    console.error(error);
  }
}

init();