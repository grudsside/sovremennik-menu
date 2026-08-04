-- Shared checklist draft grants, RLS, Storage access and Realtime publication.
begin;

revoke all on table public.checklist_shared_drafts from public, anon, authenticated;
revoke all on table public.checklist_shared_draft_items from public, anon, authenticated;
revoke all on table public.checklist_shared_draft_photos from public, anon, authenticated;
grant select on table public.checklist_shared_drafts to authenticated;
grant select on table public.checklist_shared_draft_items to authenticated;
grant select on table public.checklist_shared_draft_photos to authenticated;

revoke execute on function public.open_checklist_shared_draft(text,text,text,date,jsonb) from public, anon;
revoke execute on function public.patch_checklist_shared_draft(uuid,text,jsonb) from public, anon;
revoke execute on function public.attach_checklist_shared_draft_photo(uuid,uuid,text,text,text,text,integer,integer) from public, anon;
revoke execute on function public.remove_checklist_shared_draft_photo(uuid,uuid) from public, anon;
revoke execute on function public.finalize_checklist_shared_draft(uuid,text) from public, anon;
grant execute on function public.open_checklist_shared_draft(text,text,text,date,jsonb) to authenticated, service_role;
grant execute on function public.patch_checklist_shared_draft(uuid,text,jsonb) to authenticated, service_role;
grant execute on function public.attach_checklist_shared_draft_photo(uuid,uuid,text,text,text,text,integer,integer) to authenticated, service_role;
grant execute on function public.remove_checklist_shared_draft_photo(uuid,uuid) to authenticated, service_role;
grant execute on function public.finalize_checklist_shared_draft(uuid,text) to authenticated, service_role;

drop policy if exists "checklist_shared_drafts_select_accessible" on public.checklist_shared_drafts;
create policy "checklist_shared_drafts_select_accessible"
on public.checklist_shared_drafts
for select
to authenticated
using (public.can_access_checklist_shared_department(department));

drop policy if exists "checklist_shared_draft_items_select_accessible" on public.checklist_shared_draft_items;
create policy "checklist_shared_draft_items_select_accessible"
on public.checklist_shared_draft_items
for select
to authenticated
using (exists (
  select 1 from public.checklist_shared_drafts draft
  where draft.id = draft_id
    and public.can_access_checklist_shared_department(draft.department)
));

drop policy if exists "checklist_shared_draft_photos_select_accessible" on public.checklist_shared_draft_photos;
create policy "checklist_shared_draft_photos_select_accessible"
on public.checklist_shared_draft_photos
for select
to authenticated
using (
  deleted_at is null
  and exists (
    select 1 from public.checklist_shared_drafts draft
    where draft.id = draft_id
      and public.can_access_checklist_shared_department(draft.department)
  )
);

-- Existing upload policy still enforces the uploader's UUID as the first path segment.
-- This additional read policy lets another permitted device view the shared draft photo.
drop policy if exists "checklist_shared_photo_storage_select_accessible" on storage.objects;
create policy "checklist_shared_photo_storage_select_accessible"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'checklist-photo-reports'
  and exists (
    select 1
    from public.checklist_shared_draft_photos photo
    join public.checklist_shared_drafts draft on draft.id = photo.draft_id
    where photo.deleted_at is null
      and (photo.storage_path = name or photo.thumbnail_path = name)
      and public.can_access_checklist_shared_department(draft.department)
  )
);

-- Realtime publication is idempotent across local, preview and production projects.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.checklist_shared_drafts;
    exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.checklist_shared_draft_items;
    exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.checklist_shared_draft_photos;
    exception when duplicate_object then null; end;
  end if;
end
$$;

commit;
