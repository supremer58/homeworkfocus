-- Listening now works with a real audio track again: the teacher uploads
-- one audio file (from their computer/phone, no URL typing) and gives it a
-- title; students just listen and type their translation. Run this once in
-- the Supabase SQL editor, in addition to the two migrations from before.

alter table app_settings add column if not exists listening_track_title text;
alter table app_settings add column if not exists listening_track_url text;

-- Storage bucket to hold the uploaded audio files, plus policies so the
-- app (using the public anon key) can upload to it and students can play
-- from it. "public" here just means anyone with the exact file link can
-- read it — same trust model as the rest of this app.
insert into storage.buckets (id, name, public)
values ('audio', 'audio', true)
on conflict (id) do nothing;

create policy "Public read access on audio"
  on storage.objects for select
  using (bucket_id = 'audio');

create policy "Public upload access on audio"
  on storage.objects for insert
  with check (bucket_id = 'audio');
