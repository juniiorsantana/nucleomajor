-- Cada bloco e cada regra do fluxo dependem do plano (Etapa 10 do construtor).
--
-- Até aqui a liberação era grossa: `fluxos_ramificados` liga o formato com
-- caminhos inteiro, e dentro dele qualquer bloco valia. O bloco "Transferir
-- para a IA" num plano sem IA só não chamava o Claude porque o runtime da VPS
-- consultava o porteiro na hora (`chatbotOnly`, 20260926100000).
--
-- Agora cada tipo de bloco, de regra e de gatilho declara a função de que
-- precisa, numa LISTA ÚNICA: `apps/emyleads/src/domain/funcoesDosBlocos.js`.
-- `private.flow_block_requirements()` é a cópia dela no banco, e o teste
-- `funcoesDosBlocos.test.js` falha se as duas divergirem. `transferir:ia` exige
-- `ai_customer`; todo o resto, só `chatbots`.
--
-- A trava vale em três lugares:
--
--   * EDITOR (portal desta entrega): bloco não liberado aparece com cadeado e o
--     motivo, e não entra no mapa;
--   * AO SALVAR: `private.flow_validate(spec, organizacao)` recusa o fluxo v3
--     que usa bloco não liberado, e o gatilho
--     `chatbot_definitions_plan_guard` aplica a mesma recusa a quem grava ou
--     reativa um fluxo v3 (`flow feature unavailable: <funcao>`). A conferência
--     de estrutura continua só no início da conversa, como sempre: o gatilho
--     não passa a recusar rascunhos;
--   * AO RODAR: a empresa que perdeu a função depois de salvar não trava a
--     conversa. `nucleo_flow_claim` não entrega o passo trancado: se ele tem
--     saída Falha, a execução segue por ela; se não tem, é cancelada. Nos dois
--     casos com `reason = plan_feature_missing`, o evento `flow.step_blocked`
--     no histórico do contato e nenhuma mensagem ao contato. O envelope do claim
--     passa a trazer `requer` (as funções do passo entregue) e, quando
--     desviou, `bloqueado`; o runtime registra o motivo no log e nunca chama o
--     Claude num plano sem IA. `nucleo_flow_start` recusa começar fluxo para
--     empresa sem a função do gatilho e das regras de entrada (o runtime já
--     entrega essa conversa à equipe, sem falar com o contato).
--
-- Fluxo v2 (formato sem caminhos) não muda: segue no executor antigo até a
-- Etapa 11. Nenhuma função nova entra no catálogo; a conferência no fim exige
-- que toda função da lista já exista lá, porque função nova nasce desligada
-- para todos (20260924100000) e seria um cadeado para todo mundo.
--
-- Compatível com o runtime de hoje (release `fluxos-aguardar` e posteriores):
-- o claim desviado devolve `status` diferente de `executing`, que o executor
-- atual já trata como "nada a fazer agora", e a volta seguinte do laço pega o
-- passo da Falha. Por isso a ordem é: esta migration, a release da VPS, o
-- portal.
--
-- As funções do motor são as de 20260926160000 (claim) e 20260926110000
-- (start) com as trocas marcadas por comentário "Etapa 10"; a trava abaixo
-- confere que é essa a versão em produção.
--
-- Aplicar pelo SQL Editor, depois de 20261017100000. Prova:
-- scripts/sql/prova-cada-bloco-depende-do-plano.mjs. Desfazer:
-- scripts/sql/rollback-20261018100000-cada-bloco-depende-do-plano.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1/6. Guardas.
-- ---------------------------------------------------------------------------
do $$
declare reservar text; comecar text; validar text;
begin
  if to_regprocedure('private.org_has_feature(uuid, text)') is null
     or to_regclass('public.platform_features') is null then
    raise exception 'abortado: aplicar 20260924100000 antes';
  end if;
  if to_regprocedure('private.flow_validate(jsonb, uuid)') is not null then
    raise exception 'abortado: private.flow_validate(jsonb, uuid) ja existe; esta migration ja foi aplicada';
  end if;
  select pg_catalog.replace(p.prosrc, chr(13), '') into reservar from pg_catalog.pg_proc p
    where p.oid = 'public.nucleo_flow_claim(uuid, bigint)'::regprocedure;
  select pg_catalog.replace(p.prosrc, chr(13), '') into comecar from pg_catalog.pg_proc p
    where p.oid = 'public.nucleo_flow_start(text, text, uuid, bigint, uuid, bigint)'::regprocedure;
  select pg_catalog.replace(p.prosrc, chr(13), '') into validar from pg_catalog.pg_proc p
    where p.oid = 'private.flow_validate(jsonb)'::regprocedure;
  if reservar is null or comecar is null or validar is null
    or reservar not like '%''perguntar'',''coletar'',''aguardar'')%' or reservar like '%plan_feature_missing%'
    or comecar not like '%flow_contact_for%' or comecar like '%flow feature unavailable%'
    or validar not like '%flow waits exceeded%' then
    raise exception 'abortado: o motor de fluxo em producao nao e o de 20260926160000/20260926110000; conferir antes de reescrever';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2/6. A lista única, e o que ela diz de um passo e de um fluxo.
-- ---------------------------------------------------------------------------

-- Espelho EXATO de FUNCOES_DOS_BLOCOS em apps/emyleads/src/domain/funcoesDosBlocos.js.
-- O teste do portal lê o texto entre os marcadores $lista$ e compara.
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

-- Os tipos de regra de uma expressão, na ordem em que aparecem.
create or replace function private.flow_expression_rules(expression jsonb, depth integer default 0) returns text[]
language plpgsql immutable set search_path = '' as $$
declare child jsonb; found text[] := array[]::text[];
begin
  if depth > 8 or expression is null then return found; end if;
  if jsonb_typeof(expression) = 'array' then
    for child in select jsonb_array_elements(expression) loop
      found := found || private.flow_expression_rules(child, depth + 1);
    end loop;
  elsif jsonb_typeof(expression) = 'object' and expression ? 'operador' then
    found := private.flow_expression_rules(expression->'itens', depth + 1);
  elsif jsonb_typeof(expression) = 'object' and expression->>'tipo' is not null then
    found := array[expression->>'tipo'];
  end if;
  return found;
end;
$$;

-- As funções de que um passo precisa: a do bloco e, numa condição, as das regras.
create or replace function private.flow_step_features(step jsonb) returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  lista jsonb := private.flow_block_requirements();
  chave text;
  rule text;
  found text[];
begin
  chave := case when step->>'tipo' = 'transferir'
    then 'transferir:' || case when step->>'destino' = 'ia' then 'ia' else 'humano' end
    else coalesce(step->>'tipo', '') end;
  found := array_remove(array[lista->'blocos'->>chave], null);
  if step->>'tipo' = 'condicao' then
    foreach rule in array private.flow_expression_rules(step->'expressao') loop
      if lista->'regras'->>rule is not null and not (lista->'regras'->>rule = any(found)) then
        found := found || (lista->'regras'->>rule);
      end if;
    end loop;
  end if;
  return found;
end;
$$;

-- As funções de que o COMEÇO do fluxo precisa: gatilho e regras de entrada.
create or replace function private.flow_start_features(spec jsonb) returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  lista jsonb := private.flow_block_requirements();
  rule text;
  found text[];
begin
  found := array_remove(array[lista->'gatilhos'->>coalesce(spec#>>'{gatilho,tipo}', 'mensagem')], null);
  foreach rule in array private.flow_expression_rules(spec->'condicoes') loop
    if lista->'regras'->>rule is not null and not (lista->'regras'->>rule = any(found)) then
      found := found || (lista->'regras'->>rule);
    end if;
  end loop;
  return found;
end;
$$;

-- A primeira função que o fluxo usa e a empresa não tem, ou null. Mesma ordem
-- do editor (`bloqueioDoFluxo`): os blocos primeiro, depois gatilho e regras.
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

-- ---------------------------------------------------------------------------
-- 3/6. Ao salvar: a validação com a empresa, e o gatilho da tabela.
-- ---------------------------------------------------------------------------
create or replace function private.flow_validate(spec jsonb, target_organization uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare locked text;
begin
  perform private.flow_validate(spec);
  locked := private.flow_locked_feature(target_organization, spec);
  if locked is not null then raise exception 'flow feature unavailable: %', locked; end if;
end;
$$;

comment on function private.flow_validate(jsonb, uuid) is
  'private.flow_validate(spec) mais o plano: recusa o fluxo que usa bloco, regra ou gatilho cuja funcao a empresa nao tem (flow feature unavailable: <funcao>). Ver 20261018100000.';

create or replace function private.flow_definition_plan_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare locked text;
begin
  -- Só o formato com caminhos; o v2 fica como está até a Etapa 11. Só quando
  -- o desenho muda ou o fluxo volta a ficar ativo: renomear, desligar ou
  -- apagar um fluxo antigo nunca é impedido.
  if new.definition#>>'{canvas,versao}' is distinct from '3' or new.deleted_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.definition is not distinct from old.definition
     and not (new.active and not old.active) then
    return new;
  end if;
  locked := private.flow_locked_feature(new.organization_id, new.definition);
  if locked is not null then
    raise exception 'flow feature unavailable: %', locked using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists chatbot_definitions_plan_guard on public.chatbot_definitions;
create trigger chatbot_definitions_plan_guard
before insert or update on public.chatbot_definitions
for each row execute function private.flow_definition_plan_guard();

-- ---------------------------------------------------------------------------
-- 4/6. Ao rodar: o claim não entrega passo trancado.
-- (corpo de 20260926160000 com as trocas marcadas "Etapa 10")
-- ---------------------------------------------------------------------------
create or replace function public.nucleo_flow_claim(execution_id uuid, expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  conn uuid:=private.flow_connection(); org uuid:=private.robot_organization();
  run public.chatbot_flow_executions%rowtype; step jsonb;
  needed text[]; locked text; feature text; exit_name text;
begin
  select * into run from public.chatbot_flow_executions f where f.id=execution_id
    and f.organization_id=org and f.connection_id=conn for update;
  if not found then raise exception 'flow execution unavailable'; end if;
  if run.revision is distinct from expected_revision then raise exception 'flow revision changed'; end if;
  step:=private.flow_step(run.definition_snapshot,run.cursor_node_id);
  if run.status='executing' and run.claim_expires_at<=now() then
    if step->>'tipo'='enviar_mensagem' then
      update public.chatbot_flow_executions set status='needs_review',reason='delivery_unknown',updated_at=now()
      where id=run.id returning * into run;
      return private.flow_envelope(run);
    end if;
  elsif run.status<>'ready' then raise exception 'flow execution not ready';
  end if;
  if exists(select 1 from public.conversation_intelligence_contexts c where c.organization_id=org
    and c.contact_id=run.contact_id and c.channel='whatsapp' and c.state='handed_off') then
    update public.chatbot_flow_executions set status='cancelled',reason='human_takeover',updated_at=now()
    where id=run.id returning * into run;
    return private.flow_envelope(run);
  end if;
  -- Etapa 10: a empresa perdeu a função de que este passo precisa. O passo não
  -- é entregue ao runtime (nada sai para o contato, o Claude não é chamado):
  -- segue pela Falha se o bloco tiver uma, senão a execução termina aqui.
  needed:=private.flow_step_features(step);
  if cardinality(needed)=0 then needed:=array['?']; end if;
  foreach feature in array needed loop
    if feature='?' or not private.org_has_feature(org,feature) then locked:=feature; exit; end if;
  end loop;
  if locked is not null then
    exit_name:=case when exists(select 1 from jsonb_array_elements(run.definition_snapshot#>'{canvas,conexoes}') e
      where e->>'source'=run.cursor_node_id and e->>'saida'='falha') then 'falha' end;
    if exit_name is not null then
      update public.chatbot_flow_executions set
        cursor_node_id=private.flow_target(run.definition_snapshot,run.cursor_node_id,'falha'),
        status='ready',reason='plan_feature_missing',claim_token=null,claim_expires_at=null,
        suspension_id=null,suspension_expires_at=null,revision=revision+1,updated_at=now()
      where id=run.id returning * into run;
    else
      update public.chatbot_flow_executions set status='cancelled',reason='plan_feature_missing',
        claim_token=null,claim_expires_at=null,revision=revision+1,updated_at=now()
      where id=run.id returning * into run;
    end if;
    insert into public.contact_events (organization_id, contact_id, event_type, entity_type, entity_id, source, payload)
    values (org, run.contact_id, 'flow.step_blocked', 'chatbot', run.chatbot_id, 'chatbot',
      jsonb_build_object('executionId', run.id, 'nodeId', step->>'id', 'requer', locked,
        'saida', coalesce(exit_name, 'encerrou'), 'reason', 'plan_feature_missing'));
    return private.flow_envelope(run)||jsonb_build_object('bloqueado',jsonb_build_object(
      'nodeId',step->>'id','requer',locked,'saida',exit_name));
  end if;
  update public.chatbot_flow_executions set status='executing',claim_token=gen_random_uuid(),
    claim_expires_at=now()+interval '90 seconds',revision=revision+1,updated_at=now(),
    suspension_id=case when (step->>'tipo'='transferir' and step->>'destino'='ia') or step->>'tipo' in ('perguntar','coletar','aguardar')
      then coalesce(suspension_id,gen_random_uuid()) else suspension_id end
  where id=run.id returning * into run;
  -- Etapa 10: `requer` diz ao runtime de que funções o passo entregue depende.
  return private.flow_envelope(run)||jsonb_build_object('step',step,'requer',to_jsonb(needed),
    'contact',(public.nucleo_chatbot_runtime_context(run.requester_phone))->'contact');
end;
$$;

-- ---------------------------------------------------------------------------
-- 5/6. Ao começar: sem a função do gatilho e das regras de entrada, não começa.
-- (corpo de 20260926110000 com a troca marcada "Etapa 10")
-- ---------------------------------------------------------------------------
create or replace function public.nucleo_flow_start(
  requester_phone text, external_message text, selected_chatbot uuid,
  expected_version bigint, conversation_session uuid, conversation_epoch bigint default 0
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  org uuid:=private.robot_organization(); conn uuid:=private.flow_connection();
  safe_phone text:=regexp_replace(coalesce(requester_phone,''),'[^0-9]','','g');
  bot public.chatbot_definitions%rowtype; run public.chatbot_flow_executions%rowtype;
  contact uuid; feature text;
begin
  if length(safe_phone) not between 10 and 15 or conversation_session is null or conversation_epoch is null or conversation_epoch<0
    or length(trim(coalesce(external_message,''))) not between 1 and 500 then
    raise exception 'flow identity invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text||':'||conn::text||':'||safe_phone,0));
  select * into run from public.chatbot_flow_executions f where f.organization_id=org
    and f.connection_id=conn and f.external_message_id=external_message;
  if found then
    if run.requester_phone<>safe_phone or run.chatbot_id<>selected_chatbot
      or run.conversation_session_id<>conversation_session or run.conversation_epoch<>conversation_epoch then raise exception 'flow identity mismatch'; end if;
    return private.flow_envelope(run);
  end if;
  if exists(select 1 from public.chatbot_flow_executions f where f.organization_id=org
    and f.connection_id=conn and f.requester_phone=safe_phone
    and f.status in ('ready','executing','suspended','needs_review')) then
    raise exception 'flow conversation already running';
  end if;
  select * into bot from public.chatbot_definitions b where b.id=selected_chatbot
    and b.organization_id=org and b.active and b.deleted_at is null and b.version=expected_version for share;
  if not found then raise exception 'flow definition changed'; end if;
  perform private.flow_validate(bot.definition);
  -- Etapa 10: o começo (gatilho e regras de entrada) precisa da função. Os
  -- passos trancados não impedem o começo: o claim os desvia pela Falha.
  foreach feature in array private.flow_start_features(bot.definition) loop
    if not private.org_has_feature(org, feature) then
      raise exception 'flow feature unavailable: %', feature;
    end if;
  end loop;
  -- Acha pelo telefone exato ou pelas duas formas do nono dígito; se não houver,
  -- cria com o evento `contact.created` (20260926110000).
  contact:=private.flow_contact_for(org, safe_phone, true);
  if contact is null then raise exception 'flow contact unavailable'; end if;
  if exists(select 1 from public.conversation_intelligence_contexts c where c.organization_id=org
    and c.contact_id=contact and c.channel='whatsapp' and c.state='handed_off') then
    raise exception 'flow conversation with human';
  end if;
  insert into public.chatbot_flow_executions(organization_id,connection_id,contact_id,chatbot_id,
    chatbot_version,definition_snapshot,requester_phone,conversation_session_id,conversation_epoch,external_message_id,cursor_node_id)
  values(org,conn,contact,bot.id,bot.version,bot.definition,safe_phone,conversation_session,nucleo_flow_start.conversation_epoch,external_message,
    private.flow_target(bot.definition,'condicoes','padrao')) returning * into run;
  return private.flow_envelope(run);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6/6. Quem pode chamar o quê, e a conferência.
-- ---------------------------------------------------------------------------
-- Funções internas: ninguém de fora. (20261017100000 dá EXECUTE a
-- authenticated por padrão em `private`; aqui ele é retirado de propósito.)
revoke all on function private.flow_block_requirements() from public, anon, authenticated;
revoke all on function private.flow_expression_rules(jsonb, integer) from public, anon, authenticated;
revoke all on function private.flow_step_features(jsonb) from public, anon, authenticated;
revoke all on function private.flow_start_features(jsonb) from public, anon, authenticated;
revoke all on function private.flow_locked_feature(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.flow_validate(jsonb, uuid) from public, anon, authenticated;
revoke all on function private.flow_definition_plan_guard() from public, anon, authenticated;

do $$
declare
  lista jsonb := private.flow_block_requirements();
  desconhecidas text;
  presos integer;
  spec jsonb := '{
    "condicoes": [{"tipo": "primeira_conversa"}],
    "passos": [
      {"id": "cond", "tipo": "condicao", "expressao": {"operador": "e", "itens": [{"tipo": "dia_da_semana", "dias": [1], "fuso": "America/Sao_Paulo"}]}},
      {"id": "ia", "tipo": "transferir", "destino": "ia", "alvoIa": "reception", "objetivoIa": "Entender"},
      {"id": "fim", "tipo": "encerrar"},
      {"id": "gente", "tipo": "transferir", "destino": "humano"}
    ],
    "canvas": {"versao": 3, "nos": [], "conexoes": [
      {"source": "entrada", "saida": "padrao", "target": "condicoes"},
      {"source": "condicoes", "saida": "padrao", "target": "cond"},
      {"source": "cond", "saida": "sim", "target": "ia"},
      {"source": "cond", "saida": "nao", "target": "gente"},
      {"source": "ia", "saida": "sucesso", "target": "fim"},
      {"source": "ia", "saida": "falha", "target": "gente"}
    ]}
  }';
begin
  -- Toda função citada pela lista já existe no catálogo.
  select string_agg(distinct v.value, ', ') into desconhecidas
  from jsonb_each(lista) grupo, jsonb_each_text(grupo.value) v
  where not exists (select 1 from public.platform_features f where f.key = v.value and f.kind = 'feature');
  if desconhecidas is not null then
    raise exception 'conferencia: a lista cita funcao fora do catalogo: %', desconhecidas;
  end if;
  if private.flow_step_features('{"tipo":"transferir","destino":"ia"}') <> array['ai_customer']
     or private.flow_step_features('{"tipo":"transferir","destino":"humano"}') <> array['chatbots']
     or private.flow_step_features('{"tipo":"desconhecido"}') <> array[]::text[]
     or private.flow_start_features(spec) <> array['chatbots'] then
    raise exception 'conferencia: a lista nao diz o que devia';
  end if;
  perform private.flow_validate(spec);
  if has_function_privilege('authenticated', 'private.flow_validate(jsonb, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.flow_locked_feature(uuid, jsonb)', 'EXECUTE') then
    raise exception 'conferencia: permissao errada nas funcoes internas do plano';
  end if;
  -- Quantos fluxos v3 ATIVOS já usam bloco que a empresa não tem: não são
  -- tocados (o gatilho só vale para gravação nova); ao rodar, o passo sai pela
  -- Falha, como o runtime de hoje já fazia com a IA.
  select count(*) into presos from public.chatbot_definitions b
  where b.deleted_at is null and b.active and b.definition#>>'{canvas,versao}' = '3'
    and private.flow_locked_feature(b.organization_id, b.definition) is not null;
  raise notice 'fluxos v3 ativos com bloco trancado (seguem pela Falha ao rodar): %', presos;
end;
$$;

commit;
