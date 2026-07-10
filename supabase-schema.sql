-- HomeworkFocus — Supabase schema
-- Run this once in your Supabase project's SQL Editor (Dashboard → SQL Editor → New query → paste → Run)

create table app_settings (
  id int primary key default 1,
  pin text not null default '1234',
  current_assignment_id text,
  constraint single_row check (id = 1)
);
insert into app_settings (id, pin) values (1, '1234');

create table assignments (
  id text primary key,
  type text not null default 'translation',
  title text not null default '',
  content text default '',
  target_minutes int default 15,
  require_min_time boolean default false
);
insert into assignments (id, type, title, content, target_minutes, require_min_time) values
  ('sample', 'translation', 'Sample: Translate this paragraph',
   'The weather today is sunny with a light breeze. Many people are walking in the park, enjoying the fresh air and warm sunshine.',
   15, false);
update app_settings set current_assignment_id = 'sample' where id = 1;

create table students (
  id text primary key,
  name text not null,
  active_ms bigint not null default 0,
  assignment_id text references assignments(id),
  completed boolean not null default false,
  last_seen timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  is_active boolean not null default false,
  paused boolean not null default false,
  reset_token int not null default 0,
  reading_answer_text text not null default '',
  listening_answer_text text not null default '',
  has_played_audio boolean not null default false,
  idle_since timestamptz
);

-- No foreign key to students — student ids are ephemeral (regenerated each
-- join), and messages should be free to persist/be deleted independently
-- of whether the student row that sent them still exists.
create table messages (
  id bigserial primary key,
  student_id text,
  from_role text not null,
  from_name text,
  text text not null,
  ts timestamptz not null default now()
);

create table history (
  id bigserial primary key,
  date date not null default current_date,
  student_id text,
  name text,
  assignment_title text,
  active_ms bigint,
  completed boolean,
  reading_answer_text text,
  listening_answer_text text
);

alter table app_settings enable row level security;
alter table assignments enable row level security;
alter table students enable row level security;
alter table messages enable row level security;
alter table history enable row level security;

create policy "public read" on app_settings for select using (true);
create policy "public write" on app_settings for update using (true);

create policy "public read" on assignments for select using (true);
create policy "public write" on assignments for insert with check (true);
create policy "public update" on assignments for update using (true);

create policy "public read" on students for select using (true);
create policy "public write" on students for insert with check (true);
create policy "public update" on students for update using (true);
create policy "public delete" on students for delete using (true);

create policy "public read" on messages for select using (true);
create policy "public write" on messages for insert with check (true);
create policy "public delete" on messages for delete using (true);

create policy "public read" on history for select using (true);
create policy "public write" on history for insert with check (true);

alter publication supabase_realtime add table students, messages, assignments, app_settings;
