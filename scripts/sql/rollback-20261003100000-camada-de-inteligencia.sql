-- ROLLBACK de 20261003100000_camada_de_inteligencia.sql.
--
-- Não é migration: fica fora de supabase/migrations de propósito. Só rodar
-- pelo SQL Editor se for preciso desfazer a camada de inteligência. Volta o
-- banco exatamente ao estado de 20261002100000:
--   * a visão, o gatilho, o motor, os fatos e a tabela de esquemas somem;
--   * as colunas novas de leituras e análises somem (perde-se só o que a
--     camada gravou: fatos, notas, versões);
--   * o pedido de análise volta ao corpo de 20261002100000 (copiado abaixo,
--     sem mudança). As análises e leituras em si ficam intactas.
-- Depois dele, a release da VPS pode continuar a mesma: o analista novo só
-- deixa de receber fatos e notas.

begin;

do $$
begin
  if to_regclass('public.analysis_schemas') is null then
    raise exception 'abortado: a camada de inteligencia nao esta aplicada';
  end if;
end $$;

drop view if exists public.conversation_intelligence;
drop trigger if exists conversation_insight_runs_fatos on public.conversation_insight_runs;
drop function if exists private.leitura_ganha_fatos();

create or replace function public.conversation_analysis_request(
  target_organization uuid,
  target_connection uuid,
  target_chat text,
  analysis_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  chat text := pg_catalog.regexp_replace(coalesce(target_chat, ''), '[^0-9-]', '', 'g');
  tipo text := lower(trim(coalesce(analysis_kind, '')));
  conexao uuid := target_connection;
  conversa public.whatsapp_conversations%rowtype;
  saldo jsonb;
  em_andamento public.conversation_analyses%rowtype;
  contato uuid;
  agente uuid;
  perfil public.assistant_profiles%rowtype;
  mensagens jsonb;
  leitura jsonb;
  nova uuid;
  comando uuid;
begin
  if auth.uid() is null or not private.can_manage_org(target_organization) then
    raise exception 'organization management required';
  end if;
  if tipo not in ('comercial', 'atendimento') then
    raise exception 'analysis kind must be comercial or atendimento';
  end if;
  if conexao is null then
    conexao := private.conexao_da_organizacao(target_organization);
  end if;

  select * into conversa
  from public.whatsapp_conversations c
  where c.organization_id = target_organization
    and c.connection_id = conexao
    and c.contact_phone = chat;
  if not found then
    raise exception 'conversation is not mirrored for this connection';
  end if;
  if conversa.chat_kind <> 'direto' then
    raise exception 'group conversations cannot be analyzed';
  end if;

  -- Um pedido por vez por empresa daqui até o fim da transação: dois cliques
  -- rápidos não gastam dois créditos nem passam do limite.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('analise:' || target_organization::text));

  -- Já há uma análise desta conversa em andamento: devolve a mesma.
  select * into em_andamento
  from public.conversation_analyses a
  where a.connection_id = conexao
    and a.contact_phone = chat
    and a.status in ('pending', 'running')
    and a.requested_at > now() - interval '15 minutes'
  order by a.requested_at desc
  limit 1;
  if found then
    return jsonb_build_object(
      'analysisId', em_andamento.id,
      'status', em_andamento.status,
      'reused', true,
      'credits', private.creditos_de_analise(target_organization)
    );
  end if;

  saldo := private.creditos_de_analise(target_organization);
  if saldo ->> 'limit' is not null and (saldo ->> 'left')::integer <= 0 then
    raise exception 'no analysis credits left';
  end if;

  -- Rascunhos com mais de 7 dias perdem o conteúdo, mas continuam contando no
  -- ciclo: apagar a linha devolveria um crédito que foi usado.
  update public.conversation_analyses a
  set status = 'expired', result = '{}'::jsonb
  where a.organization_id = target_organization
    and a.status = 'done'
    and a.saved_at is null
    and a.completed_at < now() - interval '7 days';
  delete from public.conversation_analyses a
  where a.organization_id = target_organization
    and a.saved_at is null
    and a.requested_at < now() - interval '120 days';

  select c.id into contato
  from public.contacts c
  where c.organization_id = target_organization
    and c.deleted_at is null
    and length(pg_catalog.regexp_replace(c.phone, '[^0-9]', '', 'g')) >= 8
    and pg_catalog.right(pg_catalog.regexp_replace(c.phone, '[^0-9]', '', 'g'), 8) = pg_catalog.right(chat, 8)
  order by c.created_at
  limit 1;

  agente := private.agente_da_conversa(target_organization, conexao, chat);
  select * into perfil from public.assistant_profiles p where p.id = agente and p.organization_id = target_organization;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'sentAt', ultima.sent_at,
      'fromMe', ultima.is_from_me,
      'authorKind', ultima.author_kind,
      'mediaType', ultima.media_type,
      'content', pg_catalog.left(ultima.content, 1500)
    ) order by ultima.sent_at, ultima.message_id
  ), '[]'::jsonb)
  into mensagens
  from (
    select m.sent_at, m.message_id, m.is_from_me, m.author_kind, m.media_type, m.content
    from public.whatsapp_messages m
    where m.connection_id = conexao and m.contact_phone = chat
    order by m.sent_at desc, m.message_id desc
    limit 80
  ) ultima;
  if pg_catalog.jsonb_array_length(mensagens) = 0 then
    raise exception 'conversation has no messages';
  end if;

  select r.summary into leitura
  from public.conversation_insight_runs r
  where r.connection_id = conexao and r.contact_phone = chat and r.is_latest
  limit 1;

  insert into public.conversation_analyses (
    organization_id, connection_id, contact_phone, contact_id, kind, requested_by, cycle_start
  ) values (
    target_organization, conexao, chat, contato, tipo, auth.uid(), (saldo ->> 'cycleStart')::timestamptz
  )
  returning id into nova;

  insert into public.connection_runtime_commands (
    organization_id, connection_id, command_type, private_payload, created_by, idempotency_key, expires_at
  ) values (
    target_organization,
    conexao,
    'conversation_analyze',
    jsonb_build_object(
      'analysisId', nova,
      'kind', tipo,
      'messages', mensagens,
      'reading', coalesce(leitura, '{}'::jsonb),
      'playbook', (select p.published from public.organization_playbooks p where p.organization_id = target_organization and p.published_version > 0),
      'agent', case when perfil.id is null then null else jsonb_build_object('name', perfil.display_name, 'tone', perfil.tone) end,
      'stages', coalesce((select jsonb_agg(s.name order by s.position) from public.stages s where s.organization_id = target_organization and s.deleted_at is null), '[]'::jsonb),
      'tags', coalesce((select jsonb_agg(t.name order by t.name) from public.tags t where t.organization_id = target_organization and t.deleted_at is null), '[]'::jsonb),
      'hasContact', contato is not null
    ),
    auth.uid(),
    encode(extensions.digest(gen_random_uuid()::text || clock_timestamp()::text, 'sha256'), 'hex'),
    now() + interval '15 minutes'
  )
  returning id into comando;

  update public.conversation_analyses set command_id = comando where id = nova;

  return jsonb_build_object(
    'analysisId', nova,
    'status', 'pending',
    'reused', false,
    'credits', private.creditos_de_analise(target_organization)
  );
end;
$$;


alter table public.conversation_analyses
  drop column if exists facts,
  drop column if exists facts_version,
  drop column if exists classification,
  drop column if exists reading_id,
  drop column if exists scores,
  drop column if exists schema_version,
  drop column if exists playbook_version,
  drop column if exists lead_score,
  drop column if exists service_score;

alter table public.conversation_insight_runs
  drop column if exists facts,
  drop column if exists facts_version,
  drop column if exists scores,
  drop column if exists schema_version,
  drop column if exists lead_score,
  drop column if exists service_score;

drop function if exists private.avaliar_conversa(uuid, uuid, text, jsonb);
drop function if exists private.pontuar(jsonb, jsonb, jsonb);
drop function if exists private.regra_atendida(jsonb, jsonb, jsonb);
drop function if exists private.fatos_da_conversa(uuid, uuid, text, timestamptz);
drop table if exists public.analysis_schemas;

do $$
begin
  if to_regclass('public.analysis_schemas') is not null
     or to_regclass('public.conversation_intelligence') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public'
                and table_name in ('conversation_insight_runs', 'conversation_analyses') and column_name = 'facts') then
    raise exception 'conferencia do rollback: sobrou algo da camada';
  end if;
end $$;

commit;
