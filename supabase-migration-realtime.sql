-- Enables Supabase Realtime (instant updates instead of polling) for the
-- tables the app watches live. Safe to run even if already enabled.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'students'
  ) then
    alter publication supabase_realtime add table students;
  end if;
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;
