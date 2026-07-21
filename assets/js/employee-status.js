/* Safe activation and role controls for employee accounts. */
(function(){
  if(
    typeof normalizeEmployee !== 'function'
    || typeof fetchFromSheets !== 'function'
    || typeof renderEmployeesTable !== 'function'
    || typeof callEmployeeFunction !== 'function'
  ) return;

  const baseNormalizeEmployee = normalizeEmployee;
  const baseFetchFromSheets = fetchFromSheets;
  const ROLE_OPTIONS = ['admin', 'manager', 'barista', 'waiter'];

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

  function findEmployee(userId, login){
    return dedupeEmployees(state.employees || []).find(row => {
      if(userId && String(row.id || '') === userId) return true;
      return String(row.login || '').trim().toLowerCase() === String(login || '').trim().toLowerCase();
    });
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

  function roleControl(employee, current){
    if(current) return `<span class="role-badge">${esc(roleLabel(employee.role))}</span><span class="employee-role-note">Текущий аккаунт</span>`;
    const options = ROLE_OPTIONS.map(role => `<option value="${esc(role)}" ${normalizeRole(employee.role) === role ? 'selected' : ''}>${esc(roleLabel(role))}</option>`).join('');
    return `<select class="employee-role-select" data-employee-role data-employee-id="${esc(employee.id)}" data-employee-login="${esc(employee.login)}" data-original-role="${esc(normalizeRole(employee.role))}" aria-label="Роль сотрудника ${esc(employee.name)}">${options}</select>`;
  }

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
      return `<tr><td>${esc(employee.name)}</td><td>${roleControl(employee, current)}</td><td>${esc(employee.login)}</td><td>${status}</td><td>${action}</td></tr>`;
    }).join('');

    return `<div class="employee-table-wrap">${state.employeesError?`<p class="employees-error">${esc(state.employeesError)}</p>`:''}<table class="employee-table"><thead><tr><th>Имя</th><th>Роль</th><th>Логин</th><th>Статус</th><th>Действие</th></tr></thead><tbody>${body}</tbody></table></div>`;
  };

  async function changeEmployeeStatus(button){
    if(!isAdmin()) throw new Error('Изменять статус сотрудников может только администратор.');

    const login = String(button.dataset.employeeStatus || '').trim();
    const userId = String(button.dataset.employeeId || '').trim();
    const isActive = button.dataset.nextActive === 'true';
    const employee = findEmployee(userId, login);

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

  async function changeEmployeeRole(select){
    if(!isAdmin()) throw new Error('Менять роли сотрудников может только администратор.');
    const userId = String(select.dataset.employeeId || '').trim();
    const login = String(select.dataset.employeeLogin || '').trim();
    const originalRole = normalizeRole(select.dataset.originalRole || '');
    const nextRole = normalizeRole(select.value || '');
    const employee = findEmployee(userId, login);

    if(!employee) throw new Error('Сотрудник не найден. Обновите список.');
    if(isCurrentEmployee(employee)) throw new Error('Нельзя менять роль собственного текущего аккаунта.');
    if(nextRole === originalRole) return;
    if(!ROLE_OPTIONS.includes(nextRole)) throw new Error('Выбрана неизвестная роль.');

    const confirmed = confirm(`Изменить роль сотрудника «${employee.name || login}» с «${roleLabel(originalRole)}» на «${roleLabel(nextRole)}»?`);
    if(!confirmed){ select.value = originalRole; return; }

    select.disabled = true;
    try {
      await callEmployeeFunction({
        action: 'set_role',
        userId: employee.id || userId,
        login: employee.login || login,
        role: nextRole
      });
      state.employees = (state.employees || []).map(row => {
        const sameId = employee.id && String(row.id || '') === String(employee.id);
        const sameLogin = String(row.login || '').trim().toLowerCase() === String(employee.login || login).trim().toLowerCase();
        return sameId || sameLogin ? { ...row, role: nextRole } : row;
      });
      select.dataset.originalRole = nextRole;
      state.taskAssignees = null;
      if(typeof loadTaskAssignees === 'function') await loadTaskAssignees();
      if(typeof loadEmployees === 'function') await loadEmployees();
      alert(`Роль сотрудника изменена на «${roleLabel(nextRole)}». Новые права применятся после обновления приложения или повторного входа сотрудника.`);
    } catch(error){
      console.error(error);
      select.value = originalRole;
      alert(`Не удалось изменить роль: ${error.message || 'проверьте Edge Function admin-employees.'}`);
    } finally {
      select.disabled = false;
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

  document.addEventListener('change', event => {
    const select = event.target.closest('[data-employee-role]');
    if(!select) return;
    changeEmployeeRole(select).catch(error => {
      console.error(error);
      select.value = select.dataset.originalRole || select.value;
      alert(error.message || 'Не удалось изменить роль сотрудника.');
    });
  });

  if(typeof isAdmin === 'function' && isAdmin() && typeof loadEmployees === 'function'){
    loadEmployees().catch(error => console.warn('Employee status list refresh failed', error));
  } else if(typeof state !== 'undefined' && state.employees && typeof refreshEmployees === 'function'){
    refreshEmployees();
  }
})();
