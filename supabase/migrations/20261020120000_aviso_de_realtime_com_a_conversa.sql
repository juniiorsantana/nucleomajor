-- O aviso de realtime das conversas diz QUAL conversa mudou.
--
-- Hoje o aviso do tópico `conversas` leva só a conexão (`entity_id` =
-- `connection_id`, porque `whatsapp_conversations` não tem `id`), e o portal,
-- sem saber qual conversa foi, relê a lista inteira. Com a chave da conversa o
-- portal recarrega só aquela (plano da escala das Conversas, 19/10/2026).
--
--   1. `portal_realtime_events.entity_key text`: nulo nos outros tópicos; no
--      tópico `conversas`, o `contact_phone` da linha (a conversa é a conexão,
--      que já vai em `entity_id`, mais este identificador). A publicação
--      `supabase_realtime` não tem lista de colunas para esta tabela
--      (conferido em 19/10/2026), então a coluna nova vai no evento sem mexer
--      nela.
--   2. `private.portal_realtime_notify`: o corpo de 20260926150000 (o que está
--      em produção, md5 conferido em 19/10/2026) com uma troca só: grava
--      `entity_key`. A regra de não avisar update que só mexe em `updated_at`
--      ou `last_used_at`, o `entity_id` e a faxina ficam iguais, e por isso os
--      nove gatilhos que usam a função continuam gerando os mesmos eventos.
--
-- O plano mandava guardar pelo corpo de 20260926140000; o que está em
-- produção é o de 20260926150000 (o de 140000 com `last_used_at`), e é dele a
-- guarda. Quando a conversa troca de identificador (LID que vira telefone), o
-- aviso leva o novo; a linha velha some do portal na releitura completa.
--
-- Ensaio no SQL Editor: colar inteira trocando o `commit;` final por
--   do $$ begin raise exception 'ensaio ok'; end $$;
-- Prova: supabase/provas/prova-escala-banco.mjs. Conferência:
-- supabase/provas/conferir-escala-banco.sql. Desfazer:
-- supabase/provas/rollback-20261020120000-aviso-de-realtime-com-a-conversa.sql.

begin;

-- Aborta se a função em produção não for a de 20260926150000 (nem esta mesma,
-- colada de novo). CRLF normalizado: o SQL Editor no Windows grava \r.
do $$
declare
  assinatura text;
begin
  select pg_catalog.md5(pg_catalog.replace(p.prosrc, chr(13), '')) into assinatura
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('private.portal_realtime_notify()');
  if assinatura is null
    or assinatura not in (
      '0657def6aa8b59bf17853baa21268cf8', -- 20260926150000
      '2fc7ef197dcf315e45f8be57ef388d94' -- esta migration
    ) then
    raise exception 'abortado: private.portal_realtime_notify não é a de 20260926150000 (md5 %); conferir antes de reescrever', assinatura;
  end if;
end;
$$;

alter table public.portal_realtime_events
  add column if not exists entity_key text;

alter table public.portal_realtime_events
  drop constraint if exists portal_realtime_events_entity_key_check;
alter table public.portal_realtime_events
  add constraint portal_realtime_events_entity_key_check
  check (entity_key is null or pg_catalog.length(entity_key) <= 64);

comment on column public.portal_realtime_events.entity_key is
  'No tópico conversas, o contact_phone da conversa (a conexão vai em entity_id). Nulo nos outros. Ver 20261020120000.';

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

  -- No tópico `conversas`, `entity_key` diz qual conversa da conexão mudou.
  if tg_op = 'DELETE' then
    insert into public.portal_realtime_events (organization_id, topic, entity_id, entity_key)
    values (
      old.organization_id,
      tg_argv[0],
      coalesce(
        nullif(to_jsonb(old)->>'id', '')::uuid,
        nullif(to_jsonb(old)->>'connection_id', '')::uuid
      ),
      case when tg_argv[0] = 'conversas' then to_jsonb(old)->>'contact_phone' end
    );
  else
    insert into public.portal_realtime_events (organization_id, topic, entity_id, entity_key)
    values (
      new.organization_id,
      tg_argv[0],
      coalesce(
        nullif(to_jsonb(new)->>'id', '')::uuid,
        nullif(to_jsonb(new)->>'connection_id', '')::uuid
      ),
      case when tg_argv[0] = 'conversas' then to_jsonb(new)->>'contact_phone' end
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
  'Grava o aviso de realtime do portal (com entity_key = contact_phone no tópico conversas). Ignora update que so muda updated_at ou last_used_at; faxina de 1 dia com skip locked. Ver 20260911050000, 20260926140000, 20260926150000 e 20261020120000.';

-- Confere: os nove gatilhos continuam apontando para a função.
do $$
declare
  gatilhos integer;
begin
  select pg_catalog.count(*) into gatilhos
  from pg_catalog.pg_trigger t
  where t.tgfoid = 'private.portal_realtime_notify()'::regprocedure and not t.tgisinternal
    and t.tgrelid in (select c.oid from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace);
  if gatilhos <> 9 then
    raise exception 'abortado: esperava 9 gatilhos de realtime, achei %', gatilhos;
  end if;
end;
$$;

commit;
