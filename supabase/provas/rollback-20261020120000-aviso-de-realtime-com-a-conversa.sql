-- Desfaz 20261020120000_aviso_de_realtime_com_a_conversa.sql. Colar no SQL Editor.
--
-- Volta `private.portal_realtime_notify` ao corpo de 20260926150000 (copiado
-- abaixo, letra por letra) e tira `entity_key` de `portal_realtime_events`.
-- O portal novo continua funcionando: sem a chave no aviso, relê a lista como
-- hoje. Aborta se a função em produção não for a desta migration nem a de antes.

begin;

do $$
declare
  assinatura text;
begin
  select pg_catalog.md5(pg_catalog.replace(p.prosrc, chr(13), '')) into assinatura
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('private.portal_realtime_notify()');
  if assinatura is null or assinatura not in ('2fc7ef197dcf315e45f8be57ef388d94', '0657def6aa8b59bf17853baa21268cf8') then
    raise exception 'abortado: private.portal_realtime_notify não é a de 20261020120000 nem a de 20260926150000 (md5 %)', assinatura;
  end if;
end;
$$;

-- Primeiro a função (ela grava a coluna), depois a coluna.
create or replace function private.portal_realtime_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Update que não muda nada além de `updated_at` não é notícia: a sincronia
  -- das conversas regrava o lote inteiro a cada 15 s. Nem o `last_used_at` da
  -- credencial do robô, que a busca de comandos grava a cada 2 s.
  if tg_op = 'UPDATE'
    and (pg_catalog.to_jsonb(new) - 'updated_at' - 'last_used_at')
      = (pg_catalog.to_jsonb(old) - 'updated_at' - 'last_used_at') then
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.portal_realtime_events (organization_id, topic, entity_id)
    values (
      old.organization_id,
      tg_argv[0],
      coalesce(
        nullif(to_jsonb(old)->>'id', '')::uuid,
        nullif(to_jsonb(old)->>'connection_id', '')::uuid
      )
    );
  else
    insert into public.portal_realtime_events (organization_id, topic, entity_id)
    values (
      new.organization_id,
      tg_argv[0],
      coalesce(
        nullif(to_jsonb(new)->>'id', '')::uuid,
        nullif(to_jsonb(new)->>'connection_id', '')::uuid
      )
    );
  end if;

  -- A tabela e um sinal efemero, nao historico de auditoria: o portal so
  -- escuta INSERT ao vivo. Um dia basta.
  --
  -- E a limpeza dela nao pode derrubar quem escreveu: `skip locked` faz esta
  -- transacao nunca esperar por linha velha que outra ja tenha em maos, e o
  -- teto impede que uma faxina atrasada segure a escrita de quem a disparou.
  -- O que sobrar sai no proximo evento -- e ha um evento a cada escrita.
  delete from public.portal_realtime_events evento
  using (
    select velho.id
    from public.portal_realtime_events velho
    where velho.created_at < now() - interval '1 day'
    order by velho.created_at, velho.id
    for update skip locked
    limit 200
  ) alvo
  where evento.id = alvo.id;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

comment on function private.portal_realtime_notify() is
  'Grava o aviso de realtime do portal. Ignora update que so muda updated_at ou last_used_at; faxina de 1 dia com skip locked. Ver 20260911050000, 20260926140000 e 20260926150000.';

alter table public.portal_realtime_events
  drop constraint if exists portal_realtime_events_entity_key_check;
alter table public.portal_realtime_events
  drop column if exists entity_key;

commit;
