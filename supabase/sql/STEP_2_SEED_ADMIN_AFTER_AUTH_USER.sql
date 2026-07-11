-- First admin profile seed.
-- 1) In Supabase Dashboard create Auth user manually:
--    Email: grigory@sovremennik.local
--    Password: 0808
--    Auto-confirm user: enabled
-- 2) Then run this SQL.

insert into public.profiles (id, login, name, role, is_active)
select id, 'grigory', 'Григорий', 'admin', true
from auth.users
where email = 'grigory@sovremennik.local'
on conflict (id) do update set
  login = excluded.login,
  name = excluded.name,
  role = excluded.role,
  is_active = true,
  updated_at = now();
