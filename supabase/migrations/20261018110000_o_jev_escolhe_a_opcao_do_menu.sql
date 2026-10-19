-- O Jev escolhe a opção do menu quando a escada não entende (Etapa 9 do construtor).
--
-- O bloco "Pedir para escolher" entende a resposta por número, texto, palavra e
-- sinônimo (runtime, `flow_answers.interpretar`). Agora a empresa com IA pode
-- marcar na pergunta "Usar IA quando não entender" (`iaQuandoNaoEntende: true`).
-- Quando a escada não decide, o runtime pergunta ao Jev qual opção o contato
-- quis dizer. Estudo, números e riscos:
-- `16 - Trabalho em Conjunto/nucleomajor/04 - Entregas/2026-10-18_estudo-jev-no-menu_major2.md`.
--
-- O que muda aqui:
--
--   * A PERGUNTA: `private.flow_validate_question` aceita `iaQuandoNaoEntende`
--     só como booleano e só no "Pedir para escolher". A lista única
--     (`private.flow_block_requirements`, espelho de
--     `apps/emyleads/src/domain/funcoesDosBlocos.js`) ganha o grupo `ajustes`:
--     `perguntar:iaQuandoNaoEntende` exige `ai_customer`. `flow_locked_feature`
--     confere os ajustes. Por isso salvar um fluxo v3 com a opção marcada sem a
--     função é recusado (PF010, como os blocos). AO RODAR, o ajuste não tranca o
--     bloco: o claim lê só `blocos` e `regras` (20261018100000), e a pergunta de
--     uma empresa que perdeu a IA segue com a escada de sempre.
--   * QUEM PODE: `nucleo_flow_ai_option_allowed(execution, suspension)` diz ao
--     robô se pode chamar o Jev: a pergunta suspensa tem a opção marcada e a
--     empresa tem `ai_customer`. O runtime não guarda cópia do plano.
--   * A RESPOSTA: `nucleo_flow_answer` ganha `decided_by` (`regra`, o padrão, ou
--     `ia`), gravado em `chatbot_flow_executions.last_decided_by` para a
--     métrica. `ia` só vale numa pergunta com a opção marcada, numa empresa com
--     `ai_customer` e com uma opção real (nunca `nao_resolvido`). O corpo é o de
--     20260926160000 com as trocas marcadas "Etapa 9". A guarda confere o corpo
--     em produção pelo md5: se outra migration já o mudou (Major 0), esta
--     aborta, e o `decided_by` é integrado por cima da versão nova.
--   * O USO: `ai_usage_events`, uma linha por chamada de IA do robô (tokens,
--     custo, latência, decisão). Nunca o texto. Escrita só por
--     `nucleo_ai_usage_record`; a empresa lê pela RLS e por
--     `ai_usage_summary(desde, ate)`. Sem cobrança: os créditos de IA da landing
--     (1.000 no Atendimento, 2.000 no Completo) ficam para quando o dono decidir
--     quanto cada chamada vale.
--
-- Compatível com o runtime de hoje: ele não manda `decided_by` (o padrão é
-- `regra`) e não chama as funções novas. O runtime da Etapa 9 só chama o Jev
-- com `NUCLEO_FLOW_JEV=1` e o sim de `nucleo_flow_ai_option_allowed`; com banco
-- antigo, a consulta falha e ele segue a escada.
--
-- Aplicar pelo SQL Editor, DEPOIS de 20261018100000. Prova:
-- scripts/sql/prova-o-jev-escolhe-a-opcao-do-menu.mjs. Desfazer:
-- scripts/sql/rollback-20261018110000-o-jev-escolhe-a-opcao-do-menu.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1/7. Guardas.
-- ---------------------------------------------------------------------------
do $$
declare responder text; pergunta text; trancada text;
begin
  if to_regprocedure('private.flow_validate(jsonb, uuid)') is null
     or to_regprocedure('private.flow_locked_feature(uuid, jsonb)') is null then
    raise exception 'abortado: aplicar 20261018100000 (cada bloco depende do plano) antes';
  end if;
  if to_regclass('public.ai_usage_events') is not null
     or to_regprocedure('public.nucleo_flow_answer(uuid, uuid, text, text, text, text)') is not null then
    raise exception 'abortado: ai_usage_events ou nucleo_flow_answer com decided_by ja existe; esta migration ja foi aplicada';
  end if;
  select pg_catalog.replace(p.prosrc, chr(13), '') into responder from pg_catalog.pg_proc p
    where p.oid = 'public.nucleo_flow_answer(uuid, uuid, text, text, text)'::regprocedure;
  select pg_catalog.replace(p.prosrc, chr(13), '') into pergunta from pg_catalog.pg_proc p
    where p.oid = 'private.flow_validate_question(jsonb)'::regprocedure;
  select pg_catalog.replace(p.prosrc, chr(13), '') into trancada from pg_catalog.pg_proc p
    where p.oid = 'private.flow_locked_feature(uuid, jsonb)'::regprocedure;
  -- O corpo de 20260926160000, exatamente. Outro corpo (a robustez do Major 0,
  -- por exemplo) não pode ser sobrescrito por este: integrar à mão.
  if responder is null or pg_catalog.md5(responder) <> 'bf40e08dcd940386837b4ecc67608f52' then
    raise exception 'abortado: nucleo_flow_answer em producao nao e a de 20260926160000; integrar decided_by por cima da versao nova';
  end if;
  if pergunta is null or pergunta not like '%flow question invalid%' or pergunta like '%iaQuandoNaoEntende%'
     or trancada is null or trancada like '%ajustes%' then
    raise exception 'abortado: flow_validate_question/flow_locked_feature nao sao as de 20260926120000/20261018100000';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2/7. A pergunta aceita a opção, e a lista diz que ela exige IA.
-- ---------------------------------------------------------------------------

-- Corpo de 20260926120000 com a troca marcada "Etapa 9".
create or replace function private.flow_validate_question(step jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare item jsonb; ids text[] := array[]::text[]; synonym jsonb;
begin
  if length(trim(coalesce(step->>'texto',''))) not between 1 and 4000 then
    raise exception 'flow question invalid';
  end if;
  if step ? 'prazoHoras' and (
    jsonb_typeof(step->'prazoHoras') is distinct from 'number'
    or coalesce(step->>'prazoHoras','') !~ '^[0-9]{1,3}$'
    or (step->>'prazoHoras')::int not between 1 and 168
  ) then raise exception 'flow question invalid'; end if;
  -- Etapa 9: "Usar IA quando não entender", só no escolher e só booleano.
  if step ? 'iaQuandoNaoEntende' and (
    step->>'tipo' is distinct from 'perguntar'
    or jsonb_typeof(step->'iaQuandoNaoEntende') is distinct from 'boolean'
  ) then raise exception 'flow question invalid'; end if;

  if step->>'tipo' = 'coletar' then
    if coalesce(step->>'variavel','') !~ '^[a-z][a-z0-9_]{0,39}$' then
      raise exception 'flow question invalid';
    end if;
    return;
  end if;

  if step ? 'tentativas' and (
    jsonb_typeof(step->'tentativas') is distinct from 'number'
    or coalesce(step->>'tentativas','') !~ '^[0-9]$'
    or (step->>'tentativas')::int not between 1 and 5
  ) then raise exception 'flow question invalid'; end if;
  if jsonb_typeof(step->'opcoes') is distinct from 'array'
     or jsonb_array_length(step->'opcoes') not between 1 and 10 then
    raise exception 'flow question invalid';
  end if;
  for item in select jsonb_array_elements(step->'opcoes') loop
    if jsonb_typeof(item) is distinct from 'object'
       or coalesce(item->>'id','') !~ '^[a-z0-9_-]{1,40}$'
       or item->>'id' in ('nao_resolvido','padrao')
       or item->>'id' = any(ids)
       or length(trim(coalesce(item->>'rotulo',''))) not between 1 and 100 then
      raise exception 'flow question invalid';
    end if;
    ids := array_append(ids, item->>'id');
    if item ? 'sinonimos' then
      if jsonb_typeof(item->'sinonimos') is distinct from 'array'
         or jsonb_array_length(item->'sinonimos') > 20 then
        raise exception 'flow question invalid';
      end if;
      for synonym in select jsonb_array_elements(item->'sinonimos') loop
        if jsonb_typeof(synonym) is distinct from 'string'
           or length(trim(synonym #>> '{}')) not between 1 and 60 then
          raise exception 'flow question invalid';
        end if;
      end loop;
    end if;
  end loop;
end;
$$;

-- Espelho EXATO de FUNCOES_DOS_BLOCOS em apps/emyleads/src/domain/funcoesDosBlocos.js.
-- O teste do portal lê o texto entre os marcadores $lista$ e compara.
-- Etapa 9: + o grupo `ajustes` (opção de um bloco que depende do plano).
create or replace function private.flow_block_requirements() returns jsonb
language sql immutable set search_path = '' as $fn$
  select $lista$
{
  "blocos": {
    "enviar_mensagem": "chatbots",
    "editar_etiquetas": "chatbots",
    "condicao": "chatbots",
    "encerrar": "chatbots",
    "perguntar": "chatbots",
    "coletar": "chatbots",
    "aguardar": "chatbots",
    "transferir:humano": "chatbots",
    "transferir:ia": "ai_customer"
  },
  "regras": {
    "tem_etiqueta": "chatbots",
    "estagio_atual": "chatbots",
    "primeira_conversa": "chatbots",
    "tarefa_atrasada": "chatbots",
    "sem_interacao_ha": "chatbots",
    "dia_da_semana": "chatbots",
    "janela_de_horario": "chatbots"
  },
  "gatilhos": {
    "mensagem": "chatbots",
    "palavra": "chatbots",
    "manual": "chatbots",
    "etiqueta": "chatbots",
    "etapa": "chatbots",
    "campanha": "chatbots"
  },
  "ajustes": {
    "perguntar:iaQuandoNaoEntende": "ai_customer"
  }
}
$lista$::jsonb;
$fn$;

comment on function private.flow_block_requirements() is
  'Lista unica bloco/regra/gatilho/ajuste -> funcao do plano. Espelho de apps/emyleads/src/domain/funcoesDosBlocos.js (o teste do portal compara). Ver 20261018100000 e 20261018110000.';

-- As funções dos ajustes ligados num passo ("<tipo>:<campo>" com o campo true).
-- Só ao salvar: ao rodar, o passo sem a função funciona sem o ajuste.
create or replace function private.flow_step_adjustment_features(step jsonb) returns text[]
language plpgsql immutable set search_path = '' as $$
declare ajuste record; found text[] := array[]::text[];
begin
  for ajuste in select key, value from jsonb_each_text(private.flow_block_requirements()->'ajustes') loop
    if split_part(ajuste.key, ':', 1) = coalesce(step->>'tipo', '')
       and jsonb_typeof(step->split_part(ajuste.key, ':', 2)) = 'boolean'
       and (step->>split_part(ajuste.key, ':', 2))::boolean
       and not (ajuste.value = any(found)) then
      found := found || ajuste.value;
    end if;
  end loop;
  return found;
end;
$$;

-- Corpo de 20261018100000 com a troca marcada "Etapa 9".
create or replace function private.flow_locked_feature(target_organization uuid, spec jsonb) returns text
language plpgsql stable security definer set search_path = '' as $$
declare step jsonb; feature text;
begin
  for step in select jsonb_array_elements(case when jsonb_typeof(spec->'passos') = 'array' then spec->'passos' else '[]'::jsonb end) loop
    foreach feature in array private.flow_step_features(step) loop
      if not private.org_has_feature(target_organization, feature) then return feature; end if;
    end loop;
    -- Etapa 9: os ajustes do passo (ex.: a IA na pergunta).
    foreach feature in array private.flow_step_adjustment_features(step) loop
      if not private.org_has_feature(target_organization, feature) then return feature; end if;
    end loop;
  end loop;
  foreach feature in array private.flow_start_features(spec) loop
    if not private.org_has_feature(target_organization, feature) then return feature; end if;
  end loop;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3/7. Quem respondeu: a regra ou a IA.
-- ---------------------------------------------------------------------------
alter table public.chatbot_flow_executions
  add column last_decided_by text check (last_decided_by is null or last_decided_by in ('regra', 'ia'));

comment on column public.chatbot_flow_executions.last_decided_by is
  'Quem escolheu a ultima saida de uma pergunta: regra (a escada do runtime) ou ia (o Jev). Ver 20261018110000.';

-- ---------------------------------------------------------------------------
-- 4/7. O robô pergunta se pode chamar o Jev.
-- ---------------------------------------------------------------------------
create or replace function public.nucleo_flow_ai_option_allowed(execution_id uuid, suspension_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  conn uuid:=private.flow_connection(); org uuid:=private.robot_organization();
  run public.chatbot_flow_executions%rowtype; step jsonb;
begin
  select * into run from public.chatbot_flow_executions f
  where f.id=nucleo_flow_ai_option_allowed.execution_id and f.organization_id=org and f.connection_id=conn;
  if not found or run.status<>'suspended' or run.suspension_id is distinct from nucleo_flow_ai_option_allowed.suspension_id
     or run.suspension_expires_at<=now() then
    return jsonb_build_object('allowed', false, 'reason', 'suspension_unavailable');
  end if;
  step:=private.flow_step(run.definition_snapshot,run.cursor_node_id);
  if step->>'tipo' is distinct from 'perguntar' or jsonb_typeof(step->'iaQuandoNaoEntende') is distinct from 'boolean'
     or not (step->>'iaQuandoNaoEntende')::boolean then
    return jsonb_build_object('allowed', false, 'reason', 'option_off');
  end if;
  if not private.org_has_feature(org, 'ai_customer') then
    return jsonb_build_object('allowed', false, 'reason', 'plan_feature_missing');
  end if;
  return jsonb_build_object('allowed', true);
end;
$$;

comment on function public.nucleo_flow_ai_option_allowed(uuid, uuid) is
  'O robo pode chamar o Jev para esta pergunta? Sim quando a pergunta suspensa tem iaQuandoNaoEntende e a empresa tem ai_customer. Ver 20261018110000.';

-- ---------------------------------------------------------------------------
-- 5/7. A resposta diz quem decidiu.
-- (corpo de 20260926160000 com as trocas marcadas "Etapa 9")
-- ---------------------------------------------------------------------------
drop function public.nucleo_flow_answer(uuid, uuid, text, text, text);

create function public.nucleo_flow_answer(
  execution_id uuid, suspension_id uuid, requester_phone text, selected_output text, answer_value text default null,
  decided_by text default 'regra'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  conn uuid:=private.flow_connection(); org uuid:=private.robot_organization();
  run public.chatbot_flow_executions%rowtype; step jsonb; valid text[]; next_node text; vars jsonb;
  expired boolean;
begin
  select * into run from public.chatbot_flow_executions f where f.id=execution_id
    and f.organization_id=org and f.connection_id=conn for update;
  if not found or run.requester_phone<>regexp_replace(coalesce(requester_phone,''),'[^0-9]','','g') then
    raise exception 'flow execution unavailable';
  end if;
  -- A mesma resposta duas vezes (reenvio depois de uma confirmação perdida)
  -- devolve o estado atual em vez de andar duas casas.
  if suspension_id is not null and run.last_suspension_id=suspension_id and run.last_outcome=selected_output then
    return private.flow_envelope(run);
  end if;
  if run.status<>'suspended' or suspension_id is null or run.suspension_id is distinct from suspension_id then
    raise exception 'flow suspension invalid';
  end if;
  step:=private.flow_step(run.definition_snapshot,run.cursor_node_id);
  if coalesce(step->>'tipo','') not in ('perguntar','coletar','aguardar') then raise exception 'flow suspension invalid'; end if;
  valid:=case step->>'tipo'
    when 'perguntar' then array(select o->>'id' from jsonb_array_elements(step->'opcoes') o)||array['nao_resolvido']
    when 'aguardar' then array['respondeu','sem_resposta']
    else array['padrao','nao_resolvido'] end;
  if selected_output is null or not (selected_output=any(valid)) then raise exception 'flow output invalid'; end if;
  -- Etapa 9: a IA só escolhe uma opção de verdade, numa pergunta marcada
  -- "Usar IA quando não entender", de uma empresa com IA.
  if decided_by is null or decided_by not in ('regra','ia') then raise exception 'flow decided_by invalid'; end if;
  if decided_by='ia' and (
    step->>'tipo' is distinct from 'perguntar' or selected_output='nao_resolvido'
    or jsonb_typeof(step->'iaQuandoNaoEntende') is distinct from 'boolean'
    or not (step->>'iaQuandoNaoEntende')::boolean
    or not private.org_has_feature(org, 'ai_customer')
  ) then raise exception 'flow decided_by invalid'; end if;
  -- Depois do prazo, a única saída é desistir. Na espera (Etapa 8) vale o
  -- contrário também: `sem_resposta` antes do prazo seria cobrar cedo.
  expired:=run.suspension_expires_at<=now();
  if step->>'tipo'='aguardar' then
    if expired and selected_output<>'sem_resposta' then raise exception 'flow suspension expired'; end if;
    if not expired and selected_output='sem_resposta' then raise exception 'flow suspension not expired'; end if;
  elsif expired and selected_output<>'nao_resolvido' then raise exception 'flow suspension expired'; end if;
  if exists(select 1 from public.conversation_intelligence_contexts c where c.organization_id=org
    and c.contact_id=run.contact_id and c.channel='whatsapp' and c.state='handed_off') then
    update public.chatbot_flow_executions set status='cancelled',reason='human_takeover',revision=revision+1,updated_at=now()
    where id=run.id returning * into run;
    return private.flow_envelope(run);
  end if;
  -- Uma cobrança muito atrasada (a VPS ficou fora do ar) não sai: o fluxo
  -- fecha como perdido e o histórico do contato registra (Etapa 8).
  if step->>'tipo'='aguardar' and selected_output='sem_resposta'
     and run.suspension_expires_at<now()-interval '6 hours' then
    update public.chatbot_flow_executions set status='cancelled',reason='wait_missed',
      last_suspension_id=run.suspension_id,last_outcome=selected_output,
      suspension_id=null,suspension_expires_at=null,revision=revision+1,updated_at=now()
    where id=run.id returning * into run;
    insert into public.contact_events (organization_id, contact_id, event_type, entity_type, entity_id, source, payload)
    values (org, run.contact_id, 'flow.expired', 'chatbot', run.chatbot_id, 'chatbot',
      jsonb_build_object('executionId', run.id, 'nodeId', step->>'id', 'reason', 'wait_missed'));
    return private.flow_envelope(run);
  end if;
  vars:=coalesce(run.variables,'{}'::jsonb);
  if step->>'tipo'='coletar' and selected_output='padrao' then
    if length(trim(coalesce(answer_value,''))) not between 1 and 1000 then raise exception 'flow answer invalid'; end if;
    vars:=vars||jsonb_build_object(step->>'variavel',trim(answer_value));
  end if;
  next_node:=private.flow_target(run.definition_snapshot,run.cursor_node_id,selected_output);
  update public.chatbot_flow_executions set cursor_node_id=next_node,status='ready',
    last_suspension_id=run.suspension_id,last_outcome=selected_output,
    suspension_id=null,suspension_expires_at=null,attempts=0,variables=vars,
    -- Etapa 9: quem decidiu, só numa pergunta (a espera e o digitar não escolhem).
    last_decided_by=case when step->>'tipo'='perguntar' then decided_by end,
    revision=revision+1,updated_at=now(),
    reason=case when not expired then null
      when step->>'tipo'='aguardar' then 'wait_elapsed' else 'reply_timeout' end
  where id=run.id returning * into run;
  return private.flow_envelope(run);
end;
$$;

comment on function public.nucleo_flow_answer(uuid, uuid, text, text, text, text) is
  'Encerra a espera de um bloco perguntar/coletar/aguardar pela saida escolhida (uma opcao, padrao, nao_resolvido, respondeu ou sem_resposta) e guarda a resposta de coletar em variables. decided_by diz quem escolheu (regra ou ia; ia so com iaQuandoNaoEntende e ai_customer). Chamada pelo runtime da VPS. Ver 20260926120000, 20260926160000 e 20261018110000.';

-- ---------------------------------------------------------------------------
-- 6/7. O uso de IA do robô, para os créditos.
-- ---------------------------------------------------------------------------
create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null,
  execution_id uuid references public.chatbot_flow_executions(id) on delete set null,
  node_id text not null default '' check (length(node_id) <= 80),
  kind text not null check (kind in ('flow_option')),
  model text not null default '' check (length(model) <= 80),
  input_tokens integer not null default 0 check (input_tokens between 0 and 1000000),
  output_tokens integer not null default 0 check (output_tokens between 0 and 1000000),
  cost_usd numeric(12, 8) not null default 0 check (cost_usd >= 0 and cost_usd < 10),
  latency_ms integer not null default 0 check (latency_ms between 0 and 600000),
  -- decidiu: a IA escolheu a opção; nenhuma/incerta: a escada seguiu;
  -- falhou: o Jev respondeu algo que não se usa.
  decision text not null check (decision in ('decidiu', 'nenhuma', 'incerta', 'falhou')),
  confidence numeric(5, 4) check (confidence is null or confidence between 0 and 1),
  created_at timestamptz not null default now(),
  foreign key (connection_id, organization_id)
    references public.whatsapp_connections(id, organization_id) on delete cascade
);

comment on table public.ai_usage_events is
  'Uma chamada de IA feita pelo robo da VPS (hoje: o Jev escolhendo a opcao do menu). Tokens, custo, latencia e decisao; nunca texto. Base dos creditos de IA, ainda sem cobranca. Escrita so por nucleo_ai_usage_record. Ver 20261018110000.';

create index ai_usage_events_org_created on public.ai_usage_events (organization_id, created_at desc);
create index ai_usage_events_execution on public.ai_usage_events (execution_id) where execution_id is not null;

alter table public.ai_usage_events enable row level security;
revoke all on public.ai_usage_events from public, anon, authenticated;
grant select on public.ai_usage_events to authenticated;

create policy ai_usage_events_select
on public.ai_usage_events for select to authenticated
using (private.is_org_member(organization_id));

create or replace function public.nucleo_ai_usage_record(record_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  conn uuid:=private.flow_connection(); org uuid:=private.robot_organization();
  execucao uuid; novo uuid; chance numeric;
begin
  if jsonb_typeof(record_payload) is distinct from 'object' then raise exception 'ai usage invalid'; end if;
  begin
    execucao := nullif(record_payload->>'executionId', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'ai usage invalid';
  end;
  if execucao is null or not exists (
    select 1 from public.chatbot_flow_executions f
    where f.id=execucao and f.organization_id=org and f.connection_id=conn
  ) then raise exception 'ai usage execution unavailable'; end if;
  if coalesce(record_payload->>'kind', '') <> 'flow_option'
     or coalesce(record_payload->>'decision', '') not in ('decidiu', 'nenhuma', 'incerta', 'falhou') then
    raise exception 'ai usage invalid';
  end if;
  chance := case when jsonb_typeof(record_payload->'confidence') = 'number'
    then least(1, greatest(0, (record_payload->>'confidence')::numeric)) end;
  insert into public.ai_usage_events (organization_id, connection_id, execution_id, node_id, kind, model,
    input_tokens, output_tokens, cost_usd, latency_ms, decision, confidence)
  values (org, conn, execucao, left(coalesce(record_payload->>'nodeId', ''), 80), 'flow_option',
    left(coalesce(record_payload->>'model', ''), 80),
    case when jsonb_typeof(record_payload->'inputTokens') = 'number'
      then least(1000000, greatest(0, (record_payload->>'inputTokens')::numeric))::integer else 0 end,
    case when jsonb_typeof(record_payload->'outputTokens') = 'number'
      then least(1000000, greatest(0, (record_payload->>'outputTokens')::numeric))::integer else 0 end,
    case when jsonb_typeof(record_payload->'costUsd') = 'number'
      then least(9.99999999, greatest(0, (record_payload->>'costUsd')::numeric)) else 0 end,
    case when jsonb_typeof(record_payload->'latencyMs') = 'number'
      then least(600000, greatest(0, (record_payload->>'latencyMs')::numeric))::integer else 0 end,
    record_payload->>'decision', chance)
  returning id into novo;
  return jsonb_build_object('recorded', true, 'id', novo);
end;
$$;

comment on function public.nucleo_ai_usage_record(jsonb) is
  'O robo da VPS registra uma chamada de IA (executionId, nodeId, kind, model, inputTokens, outputTokens, costUsd, latencyMs, decision, confidence). Ver 20261018110000.';

-- O uso da empresa num período, por tipo. Pela RLS de quem chama.
create or replace function public.ai_usage_summary(
  since timestamptz default now() - interval '30 days', until timestamptz default now()
) returns table (organization_id uuid, kind text, calls bigint, decided bigint,
  input_tokens bigint, output_tokens bigint, cost_usd numeric)
language sql stable security invoker set search_path = '' as $$
  select e.organization_id, e.kind, count(*), count(*) filter (where e.decision = 'decidiu'),
    coalesce(sum(e.input_tokens), 0), coalesce(sum(e.output_tokens), 0), coalesce(sum(e.cost_usd), 0)
  from public.ai_usage_events e
  where e.created_at >= since and e.created_at < until
  group by e.organization_id, e.kind;
$$;

comment on function public.ai_usage_summary(timestamptz, timestamptz) is
  'Uso de IA por empresa e tipo no periodo (chamadas, decididas, tokens, custo), so das empresas de quem chama (RLS). Ver 20261018110000.';

-- ---------------------------------------------------------------------------
-- 7/7. Quem pode chamar o quê, e a conferência.
-- ---------------------------------------------------------------------------
revoke all on function private.flow_step_adjustment_features(jsonb) from public, anon, authenticated;
revoke all on function private.flow_validate_question(jsonb) from public, anon, authenticated;
revoke all on function private.flow_block_requirements() from public, anon, authenticated;
revoke all on function private.flow_locked_feature(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.nucleo_flow_answer(uuid, uuid, text, text, text, text) from public, anon;
revoke all on function public.nucleo_flow_ai_option_allowed(uuid, uuid) from public, anon;
revoke all on function public.nucleo_ai_usage_record(jsonb) from public, anon;
revoke all on function public.ai_usage_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.nucleo_flow_answer(uuid, uuid, text, text, text, text) to authenticated;
grant execute on function public.nucleo_flow_ai_option_allowed(uuid, uuid) to authenticated;
grant execute on function public.nucleo_ai_usage_record(jsonb) to authenticated;
grant execute on function public.ai_usage_summary(timestamptz, timestamptz) to authenticated;

do $$
declare
  lista jsonb := private.flow_block_requirements();
  desconhecidas text;
  marcados integer;
  com_ia jsonb := '{"id":"m","tipo":"perguntar","texto":"Oi","opcoes":[{"id":"a","rotulo":"A"}],"iaQuandoNaoEntende":true}';
begin
  select string_agg(distinct v.value, ', ') into desconhecidas
  from jsonb_each(lista) grupo, jsonb_each_text(grupo.value) v
  where not exists (select 1 from public.platform_features f where f.key = v.value and f.kind = 'feature');
  if desconhecidas is not null then
    raise exception 'conferencia: a lista cita funcao fora do catalogo: %', desconhecidas;
  end if;
  perform private.flow_validate_question(com_ia);
  if private.flow_step_adjustment_features(com_ia) <> array['ai_customer']
     or private.flow_step_adjustment_features(com_ia || '{"iaQuandoNaoEntende":false}') <> array[]::text[]
     or private.flow_step_features(com_ia) <> array['chatbots'] then
    raise exception 'conferencia: o ajuste da IA na pergunta nao diz o que devia';
  end if;
  if to_regprocedure('public.nucleo_flow_answer(uuid, uuid, text, text, text)') is not null then
    raise exception 'conferencia: a nucleo_flow_answer antiga ficou';
  end if;
  if has_function_privilege('anon', 'public.nucleo_flow_answer(uuid, uuid, text, text, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.nucleo_ai_usage_record(jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.nucleo_flow_ai_option_allowed(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.flow_step_adjustment_features(jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.flow_locked_feature(uuid, jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.nucleo_flow_answer(uuid, uuid, text, text, text, text)', 'EXECUTE')
     or has_table_privilege('authenticated', 'public.ai_usage_events', 'INSERT') then
    raise exception 'conferencia: permissao errada';
  end if;
  -- Nenhum fluxo de hoje tem a opção (ela nasce aqui); conta por garantia.
  select count(*) into marcados from public.chatbot_definitions b, jsonb_array_elements(
    case when jsonb_typeof(b.definition->'passos') = 'array' then b.definition->'passos' else '[]'::jsonb end) p
  where b.deleted_at is null and p ? 'iaQuandoNaoEntende';
  raise notice 'passos com iaQuandoNaoEntende antes desta migration: %', marcados;
end;
$$;

commit;
