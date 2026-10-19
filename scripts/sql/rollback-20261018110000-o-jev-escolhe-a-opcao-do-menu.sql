-- Desfaz 20261018110000 (o Jev escolhe a opção do menu, Etapa 9).
--
-- Volta nucleo_flow_answer ao corpo de 20260926160000 (sem decided_by),
-- flow_validate_question ao de 20260926120000, a lista e flow_locked_feature
-- aos de 20261018100000, e apaga o que nasceu aqui: a tabela ai_usage_events
-- (com o uso medido até então), a coluna last_decided_by e as funções novas.
--
-- Antes: desligar NUCLEO_FLOW_JEV nas conexões (ou voltar a release do
-- runtime). Um runtime da Etapa 9 com o classificador ligado contra o banco
-- desfeito só cai na escada de sempre (a consulta de permissão falha).
--
-- Não desfaz: o `iaQuandoNaoEntende` já gravado em fluxos. Ele fica no JSON e
-- é ignorado pelo banco e pelo runtime antigos.

begin;

drop function if exists public.ai_usage_summary(timestamptz, timestamptz);
drop function if exists public.nucleo_ai_usage_record(jsonb);
drop table if exists public.ai_usage_events;
drop function if exists public.nucleo_flow_ai_option_allowed(uuid, uuid);
drop function if exists public.nucleo_flow_answer(uuid, uuid, text, text, text, text);

-- 20260926160000
create or replace function public.nucleo_flow_answer(
  execution_id uuid, suspension_id uuid, requester_phone text, selected_output text, answer_value text default null
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
    revision=revision+1,updated_at=now(),
    reason=case when not expired then null
      when step->>'tipo'='aguardar' then 'wait_elapsed' else 'reply_timeout' end
  where id=run.id returning * into run;
  return private.flow_envelope(run);
end;
$$;


comment on function public.nucleo_flow_answer(uuid, uuid, text, text, text) is
  'Encerra a espera de um bloco perguntar/coletar/aguardar pela saida escolhida (uma opcao, padrao, nao_resolvido, respondeu ou sem_resposta) e guarda a resposta de coletar em variables. Chamada pelo runtime da VPS. Ver 20260926120000 e 20260926160000.';
revoke all on function public.nucleo_flow_answer(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.nucleo_flow_answer(uuid, uuid, text, text, text) to authenticated;

alter table public.chatbot_flow_executions drop column if exists last_decided_by;

-- 20260926120000
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

-- 20261018100000
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
  }
}
$lista$::jsonb;
$fn$;

comment on function private.flow_block_requirements() is
  'Lista unica bloco/regra/gatilho -> funcao do plano. Espelho de apps/emyleads/src/domain/funcoesDosBlocos.js (o teste do portal compara). Ver 20261018100000.';


create or replace function private.flow_locked_feature(target_organization uuid, spec jsonb) returns text
language plpgsql stable security definer set search_path = '' as $$
declare step jsonb; feature text;
begin
  for step in select jsonb_array_elements(case when jsonb_typeof(spec->'passos') = 'array' then spec->'passos' else '[]'::jsonb end) loop
    foreach feature in array private.flow_step_features(step) loop
      if not private.org_has_feature(target_organization, feature) then return feature; end if;
    end loop;
  end loop;
  foreach feature in array private.flow_start_features(spec) loop
    if not private.org_has_feature(target_organization, feature) then return feature; end if;
  end loop;
  return null;
end;
$$;


drop function if exists private.flow_step_adjustment_features(jsonb);
revoke all on function private.flow_validate_question(jsonb) from public, anon, authenticated;
revoke all on function private.flow_block_requirements() from public, anon, authenticated;
revoke all on function private.flow_locked_feature(uuid, jsonb) from public, anon, authenticated;

do $$
begin
  if to_regclass('public.ai_usage_events') is not null
     or to_regprocedure('public.nucleo_flow_answer(uuid, uuid, text, text, text, text)') is not null
     or to_regprocedure('public.nucleo_flow_answer(uuid, uuid, text, text, text)') is null
     or private.flow_block_requirements() ? 'ajustes'
     or exists (select 1 from information_schema.columns where table_schema = 'public'
                and table_name = 'chatbot_flow_executions' and column_name = 'last_decided_by') then
    raise exception 'conferencia: o rollback de 20261018110000 nao voltou tudo';
  end if;
end;
$$;

commit;
