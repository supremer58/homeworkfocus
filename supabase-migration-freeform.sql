-- Students now choose their own topic/title for each track instead of
-- working from a teacher-assigned passage or audio file. Run this once in
-- the Supabase SQL editor. Old assignment-related columns/tables are left
-- in place (unused) rather than dropped, so nothing else breaks.

alter table students add column if not exists reading_title text;
alter table students add column if not exists listening_title text;
