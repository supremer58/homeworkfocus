-- Multi-class support: each class has its own name + PIN. Students who
-- join with a given PIN land in the matching class automatically. The
-- teacher's dashboard gets a dropdown to switch between classes.
-- Run this once in the Supabase SQL editor.

create table if not exists classes (
  id text primary key,
  name text not null,
  pin text not null unique,
  created_at timestamptz not null default now()
);

alter table classes enable row level security;
create policy "public read on classes" on classes for select using (true);
create policy "public insert on classes" on classes for insert with check (true);
create policy "public update on classes" on classes for update using (true);
create policy "public delete on classes" on classes for delete using (true);

alter table students add column if not exists class_id text references classes(id) on delete set null;
alter table messages add column if not exists class_id text references classes(id) on delete set null;
alter table history add column if not exists class_id text references classes(id) on delete set null;

-- Backfill: turn your existing single class (the PIN you were already
-- using) into "My Class", and attach all existing students, messages,
-- and history rows to it, so nothing already in progress is lost.
insert into classes (id, name, pin)
select 'default-class', 'My Class', pin from app_settings where id = 1
on conflict (id) do nothing;

update students set class_id = 'default-class' where class_id is null;
update messages set class_id = 'default-class' where class_id is null;
update history set class_id = 'default-class' where class_id is null;
