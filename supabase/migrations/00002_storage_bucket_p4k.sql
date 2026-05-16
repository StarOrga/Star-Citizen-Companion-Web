-- Create p4k-uploads bucket + per-user-folder RLS policies
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('p4k-uploads', 'p4k-uploads', false, 314572800, array['application/octet-stream', 'application/zip', 'application/x-zip-compressed'])
on conflict (id) do nothing;

create policy "p4k_owner_upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'p4k-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "p4k_owner_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'p4k-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "p4k_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'p4k-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
