begin;

/*
 * O runtime pode conhecer o nome do grupo em uma varredura e não recebê-lo na
 * seguinte. Um lote incompleto não é uma ordem para apagar a identidade que já
 * foi confirmada; o gatilho protege essa garantia para qualquer atualização da
 * linha, sem reescrever a RPC de sincronização inteira.
 */
create or replace function private.preservar_nome_grupo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.chat_kind = 'grupo'
    and pg_catalog.btrim(pg_catalog.coalesce(new.contact_name, '')) = '' then
    new.contact_name := old.contact_name;
  end if;
  return new;
end;
$$;

revoke all on function private.preservar_nome_grupo() from public;
revoke all on function private.preservar_nome_grupo() from anon;
revoke all on function private.preservar_nome_grupo() from authenticated;

drop trigger if exists whatsapp_conversations_preservar_nome_grupo
  on public.whatsapp_conversations;
create trigger whatsapp_conversations_preservar_nome_grupo
before update of contact_name, chat_kind
on public.whatsapp_conversations
for each row execute function private.preservar_nome_grupo();

commit;
