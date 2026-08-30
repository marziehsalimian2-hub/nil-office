-- =====================================================================
-- NIL Office — 0005_storage.sql
-- Private file bucket + policies. Files are never publicly reachable;
-- the app serves them through short-lived signed URLs.
-- =====================================================================

-- Private bucket (public = false). File size cap enforced at 25 MB;
-- allowed MIME types restrict uploads to office/documents/images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'nil-files',
  'nil-files',
  false,
  26214400,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Only active users may read/write objects in this bucket. Because the
-- bucket is private, there are no anonymous public URLs; retrieval always
-- goes through an authorised signed URL request.
drop policy if exists p_storage_read on storage.objects;
create policy p_storage_read on storage.objects
  for select using (bucket_id = 'nil-files' and public.is_active_user());

drop policy if exists p_storage_insert on storage.objects;
create policy p_storage_insert on storage.objects
  for insert with check (bucket_id = 'nil-files' and public.is_active_user());

drop policy if exists p_storage_update on storage.objects;
create policy p_storage_update on storage.objects
  for update using (bucket_id = 'nil-files' and public.is_active_user());

drop policy if exists p_storage_delete on storage.objects;
create policy p_storage_delete on storage.objects
  for delete using (bucket_id = 'nil-files' and public.is_active_user());
