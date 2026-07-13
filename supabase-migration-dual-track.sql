-- Adds independent reading/listening assignment tracking, so both are
-- always usable at once instead of only one type being "active" per student.

alter table app_settings add column if not exists current_reading_assignment_id text;
alter table app_settings add column if not exists current_listening_assignment_id text;

-- Migrate the existing single default over to the reading slot (it was a
-- translation-type assignment), so nothing breaks for students already using it.
update app_settings
  set current_reading_assignment_id = current_assignment_id
  where current_assignment_id is not null and current_reading_assignment_id is null;

alter table students add column if not exists reading_assignment_id text;
alter table students add column if not exists listening_assignment_id text;

update students
  set reading_assignment_id = assignment_id
  where assignment_id is not null and reading_assignment_id is null;
