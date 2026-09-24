-- O aviso de realtime do portal só nasce quando a linha muda de verdade.
--
-- Achado em 23/09/2026, conferindo por que o projeto passou do limite do plano
-- gratuito do Supabase (0,5 GB): o banco tinha 872 MB e 822 MB eram de
-- `public.portal_realtime_events` — 4,2 milhões de linhas, 1,17 milhão nas
-- últimas 24 horas, quase todas do tópico `conversas`.
--
-- A causa: a sincronia do espelho de conversas (a cada 15 s, por conexão)
-- regrava cada conversa do lote com `on conflict do update ... updated_at =
-- now()`, mudou algo ou não. Eram 339 conversas e 12,1 milhões de updates. O
-- gatilho `whatsapp_conversations_portal_realtime` é `for each row` e não
-- olhava o que mudou: cada update sem mudança virava uma linha nesta tabela e
-- uma mensagem de Realtime para cada portal aberto, que por sua vez recarregava
-- as conversas (egress).
--
-- O portal só escuta INSERT desta tabela, ao vivo
-- (`apps/emyleads/src/web/gatewayProvider.js`); nunca lê o histórico. Por isso:
--
--   1. `private.portal_realtime_notify` (corpo de 20260911050000) ganha uma
--      única troca: num UPDATE em que a linha só mudou em `updated_at`, não
--      grava aviso nem faz faxina. Vale para os nove gatilhos que usam a
--      função; nenhum deles tem mudança que more só em `updated_at`. Tabela
--      versionada (`touch_versioned_record` sobe `version`) continua avisando
--      em toda regravação — é mudança de verdade, e são raras.
--   2. A faxina guarda 1 dia em vez de 7. É sinal efêmero; ninguém lê o velho.
--      O `skip locked` + `limit` de 20260911050000 continua igual.
--   3. A tabela é esvaziada uma vez, para o espaço voltar ao Supabase (um
--      `delete` não devolve espaço; `truncate` devolve na hora). O pior efeito
--      é um portal aberto agora perder um aviso — e ele se acerta no próximo.
--
-- Fica de fora: a sincronia continua regravando a conversa (o update sem
-- mudança é HOT e barato numa tabela de 339 linhas). O que custava era o aviso.
-- Os heartbeats de `connection_runtime_status` mudam `heartbeat_at` de verdade
-- e continuam avisando (~83 mil por dia).

-- Aborta se a função em produção não for a de 20260911050000: trocar um corpo
-- que mudou por fora apagaria a mudança sem ninguém ver.
do $$
declare corpo text;
begin
  select pg_catalog.replace(p.prosrc, chr(13), '') into corpo
  from pg_catalog.pg_proc p
  where p.oid = 'private.portal_realtime_notify()'::regprocedure;
  if corpo is null
    or corpo not like '%for update skip locked%'
    or corpo not like '%interval ''7 days''%'
    or corpo not like '%limit 200%' then
    raise exception 'abortado: private.portal_realtime_notify nao e a de 20260911050000; conferir antes de reescrever';
  end if;
end;
$$;

create or replace function private.portal_realtime_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Update que não muda nada além de `updated_at` não é notícia: a sincronia
  -- das conversas regrava o lote inteiro a cada 15 s.
  if tg_op = 'UPDATE'
    and (pg_catalog.to_jsonb(new) - 'updated_at') = (pg_catalog.to_jsonb(old) - 'updated_at') then
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
  'Grava o aviso de realtime do portal. Ignora update que so muda updated_at; faxina de 1 dia com skip locked. Ver 20260911050000 e 20260926140000.';

-- Uma vez: devolve o espaço dos avisos que ninguém vai ler.
truncate table public.portal_realtime_events;
