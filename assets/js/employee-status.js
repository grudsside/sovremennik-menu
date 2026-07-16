/* Safe activation controls for employee accounts. */
(function(){
  if(
    typeof normalizeEmployee !== 'function'
    || typeof fetchFromSheets !== 'function'
    || typeof renderEmployeesTable !== 'function'
    || typeof callEmployeeFunction !== 'function'
  ) return;

  const baseNormalizeEmployee = normalizeEmployee;
  const baseFetchFromSheets = fetchFromSheets;

  function employeeIsActive(employee){
    return employee?.isActive !== false;
  }

  function isCurrentEmployee(employee){
    const current = typeof currentUser === 'function' ? (currentUser() || {}) : {};
    const employeeId = String(employee?.id || '').trim();
    const currentId = String(current.id || '').trim();
    if(employeeId && currentId && employeeId === currentId) return true;
    const employeeLogin = String(employee?.login || '').trim().toLowerCase();
    const currentLogin = String(current.login || '').trim().toLowerCase();
    return Boolean(employeeLogin && currentLogin && employeeLogin === currentLogin);
  }

  normalizeEmployee = function(row){
    const employee = baseNormalizeEmployee(row);
    const rawActive = row?.isActive ?? row?.is_active;
    return {
      ...employee,
      isActive: rawActive === undefined ? true : Boolean(rawActive)
    };
  };

  fetchFromSheets = async function(view){
    if(view !== 'employees') return await baseFetchFromSheets(view);
    if(typeof isAdmin !== 'function' || !isAdmin()) return [];
    const res = await supa
      .from('profiles')
      .select('id, name, role, login, is_active')
      .order('is_active', { ascending: false })
      .order('name', { ascending: true });
    if(res.error) throw res.error;
    return (res.data || []).map(row => normalizeEmployee(row));
  };

  renderEmployeesTable = function(){
    if(!isAdmin()) return '<div class="empty-control"><h3>Нет доступа</h3><p>Раздел доступен только администратору.</p></div>';
    if(state.employeesLoading) return '<div class="empty-control"><h3>Загружаю сотрудников…</h3><p>Подключаюсь к Supabase.</p></div>';

    const rows = dedupeEmployees(state.employees || []);
    if(!rows.length){
      return `<div class="empty-control"><h3>Список пока пуст</h3><p>После обновления Supabase здесь появится стартовый аккаунт администратора.</p>${state.employeesError?`<p class="employees-error">${esc(state.employeesError)}</p>`:''}</div>`;
    }

    const body = rows.map(employee => {
      const active = employeeIsActive(employee);
      const current = isCurrentEmployee(employee);
      const status = active
        ? '<span class="source-badge">Активен</span>'
        : '<span class="muted-action">Отключён</span>';
      const action = current
        ? '<span class="muted-action">Текущий аккаунт</span>'
        : `<button class="employee-delete" type="button" data-employee-status="${esc(employee.login)}" data-employee-id="${esc(employee.id)}" data-next-active="${active?'false':'true'}">${active?'Деактивировать':'Активировать'}</button>`;
      return `<tr><td>${esc(employee.name)}</td><td><span class="role-badge">${esc(roleLabel(employee.role))}</span></td><td>${esc(employee.login)}</td><td>${status}</td><td>${action}</td></tr>`;
    }).join('');

    return `<div class="employee-table-wrap">${state.employeesError?`<p class="employees-error">${esc(state.employeesError)}</p>`:''}<table class="employee-table"><thead><tr><th>Имя</th><th>Роль</th><th>Логин</th><th>Статус</th><th>Действие</th></tr></thead><tbody>${body}</tbody></table></div>`;
  };

  async function changeEmployeeStatus(button){
    if(!isAdmin()) throw new Error('Изменять статус сотрудников может только администратор.');

    const login = String(button.dataset.employeeStatus || '').trim();
    const userId = String(button.dataset.employeeId || '').trim();
    const isActive = button.dataset.nextActive === 'true';
    const employee = dedupeEmployees(state.employees || []).find(row => {
      if(userId && String(row.id || '') === userId) return true;
      return String(row.login || '').trim().toLowerCase() === login.toLowerCase();
    });

    if(!employee) throw new Error('Сотрудник не найден. Обновите список.');
    if(isCurrentEmployee(employee)) throw new Error('Нельзя отключить собственный текущий аккаунт.');

    const verb = isActive ? 'активировать' : 'деактивировать';
    if(!confirm(`${isActive?'Активировать':'Деактивировать'} аккаунт «${employee.name || login}»?`)) return;

    const initialText = button.textContent;
    button.disabled = true;
    button.textContent = isActive ? 'Активирую…' : 'Отключаю…';

    try {
      await callEmployeeFunction({
        action: 'set_active',
        userId: employee.id || userId,
        login: employee.login || login,
        isActive
      });

      state.employees = (state.employees || []).map(row => {
        const sameId = employee.id && String(row.id || '') === String(employee.id);
        const sameLogin = String(row.login || '').trim().toLowerCase() === String(employee.login || login).trim().toLowerCase();
        return sameId || sameLogin ? { ...row, isActive } : row;
      });
      refreshEmployees();

      state.taskAssignees = null;
      if(typeof loadTaskAssignees === 'function') await loadTaskAssignees();
      if(typeof loadEmployees === 'function') await loadEmployees();

      alert(`Аккаунт ${isActive?'активирован':'деактивирован'}.`);
    } catch(error){
      console.error(error);
      alert(`Не удалось ${verb} аккаунт: ${error.message || 'проверьте Edge Function admin-employees.'}`);
      button.disabled = false;
      button.textContent = initialText;
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-employee-status]');
    if(!button) return;
    event.preventDefault();
    event.stopPropagation();
    changeEmployeeStatus(button).catch(error => {
      console.error(error);
      alert(error.message || 'Не удалось изменить статус сотрудника.');
    });
  });

  if(typeof state !== 'undefined' && state.employees && typeof refreshEmployees === 'function'){
    refreshEmployees();
  }
})();
