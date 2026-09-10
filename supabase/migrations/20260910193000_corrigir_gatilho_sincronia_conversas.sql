begin;

-- COALESCE é uma expressão SQL, não uma função do schema pg_catalog.
-- A chamada qualificada abortava todo lote que atualizava um grupo.
create or replace function private.preservar_nome_grupo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.chat_kind = 'grupo'
    and pg_catalog.btrim(coalesce(new.contact_name, '')) = '' then
    new.contact_name := old.contact_name;
  end if;
  return new;
end;
$$;

revoke all on function private.preservar_nome_grupo() from public;
revoke all on function private.preservar_nome_grupo() from anon;
revoke all on function private.preservar_nome_grupo() from authenticated;

commit;
