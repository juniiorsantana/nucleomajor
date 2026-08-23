-- A migração deve conservar as datas do IndexedDB. O provider sempre envia
-- updated_at; o banco só completa o valor quando uma operação não informa um.
create or replace function private.touch_versioned_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = coalesce(new.updated_at, now());
  new.version = old.version + 1;
  if auth.uid() is not null then new.updated_by = auth.uid(); end if;
  return new;
end;
$$;
