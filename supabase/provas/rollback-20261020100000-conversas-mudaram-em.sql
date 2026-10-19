-- Desfaz 20261020100000_conversas_mudaram_em.sql. Colar no SQL Editor.
--
-- Desfazer antes a 20261020110000 (a lista lê `changed_at`). Tira os três
-- gatilhos, a função deles, os índices e as colunas `changed_at` das conversas,
-- das mensagens e dos contatos. O portal novo cai no caminho de hoje (42703).

begin;

do $$
begin
  if pg_catalog.to_regprocedure('public.nucleo_conversation_list(uuid, timestamptz, integer)') is not null then
    raise exception 'abortado: desfazer antes 20261020110000 (rollback-20261020110000-lista-de-conversas-com-contato.sql)';
  end if;
end;
$$;

drop trigger if exists whatsapp_conversations_zz_mudou_em on public.whatsapp_conversations;
drop trigger if exists whatsapp_messages_zz_mudou_em on public.whatsapp_messages;
drop trigger if exists contacts_zz_mudou_em on public.contacts;
drop function if exists private.marcar_mudou_em();

drop index if exists public.whatsapp_conversations_changed_idx;
drop index if exists public.whatsapp_messages_changed_idx;
drop index if exists public.contacts_changed_idx;

alter table public.whatsapp_conversations drop column if exists changed_at;
alter table public.whatsapp_messages drop column if exists changed_at;
alter table public.contacts drop column if exists changed_at;

commit;
