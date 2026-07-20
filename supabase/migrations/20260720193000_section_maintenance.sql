-- Centralized maintenance mode for application sections.
create table if not exists public.section_maintenance (
  section_id text primary key,
  is_closed boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint section_maintenance_section_id_check check (
    section_id in ('tasks','method','theory','checklists','revisions','techcards','schedule','reportError','control')
  )
);

alter table public.section_maintenance enable row level security;

revoke all on table public.section_maintenance from anon;
revoke insert, update, delete on table public.section_maintenance from authenticated;
grant select on table public.section_maintenance to authenticated;

DROP POLICY IF EXISTS "authenticated users read section maintenance" ON public.section_maintenance;
CREATE POLICY "authenticated users read section maintenance"
ON public.section_maintenance
FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

insert into public.section_maintenance (section_id, is_closed)
values
  ('tasks', false),
  ('method', false),
  ('theory', false),
  ('checklists', false),
  ('revisions', false),
  ('techcards', false),
  ('schedule', false),
  ('reportError', false),
  ('control', false)
on conflict (section_id) do nothing;
