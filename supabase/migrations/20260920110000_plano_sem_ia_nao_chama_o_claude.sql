-- O plano sem IA nunca chega ao Claude.
--
-- O plano Base (20260920100000) não tem a feature `assistant`. A trava
-- principal é na VPS: a conexão de um cliente Base nasce com o assistente
-- desligado na política do Bridge, e nenhuma mensagem é entregue ao runtime.
-- Esta migration é a segunda camada, no banco, para o dia em que alguém ligar
-- o Bridge por engano — e é a única que também cobre empresa com assinatura
-- bloqueada, cujo plano ainda tem IA.
--
-- COMO, SEM REESCREVER NADA: as quatro funções abaixo são grandes, vivas, e
-- já foram reescritas várias vezes em produção. Copiar o corpo delas para cá
-- arriscaria apagar uma mudança que só existe lá. Em vez disso, cada uma é
-- MOVIDA intacta para o schema `private`, com o MESMO nome, e no lugar dela
-- nasce uma função fina, com o mesmo nome e a mesma assinatura, que confere o
-- plano e delega. O corpo vivo não muda uma vírgula.
--
-- Mesmo nome, e não um sufixo, de propósito: o corpo vivo da `_v2` qualifica
-- os próprios parâmetros pelo nome da função
-- (`nucleo_intelligence_context_resolve_v2.conversation_key_hash`). Renomear
-- quebraria esse rótulo; trocar só o schema, não.
--
--   * `nucleo_customer_assistant_access`: o portão que o gateway da VPS
--     consulta antes de enfileirar mensagem de cliente. Sem IA, responde
--     `allowed: false` (`plan_without_assistant`) e o runtime ignora a
--     mensagem calado — o mesmo caminho do rollout `off`.
--   * `nucleo_intelligence_context_resolve_v2` e `_v3`: o contrato que o
--     runtime resolve antes de CADA turno de modelo, de cliente ou de
--     operador. Sem IA, levantam `plan without assistant` e o runtime falha
--     de forma segura, sem chamar o Claude. O roteador da FASE 13 roda dentro
--     deles (`private.intelligence_payload`), então fica coberto também.
--   * `customer_assistant_rollout_update`: o botão "Liberação e marca". Sem
--     IA, `pilot` e `active` são recusados; `off` continua valendo.
--
-- A Major está no plano `full`, ativa: para ela as funções finas só delegam.
--
-- Uma migration futura que fizer `create or replace` numa dessas funções
-- públicas substitui a função fina, não a viva — e perde a trava. Quem for
-- mexer no corpo vivo mexe em `private.<mesmo nome>`.

begin;

-- ---------------------------------------------------------------------------
-- 1/3. Guardas.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'org_has_feature'
  ) then
    raise exception 'abortado: private.org_has_feature nao existe; aplicar 20260920100000 antes';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in (
      'nucleo_customer_assistant_access', 'nucleo_intelligence_context_resolve_v2',
      'nucleo_intelligence_context_resolve_v3', 'customer_assistant_rollout_update'
    )
  ) then
    raise exception 'abortado: as funcoes vivas ja estao em private; esta migration ja foi aplicada';
  end if;
  if to_regprocedure('public.nucleo_customer_assistant_access(text)') is null
     or to_regprocedure('public.nucleo_intelligence_context_resolve_v2(text, text, text, jsonb)') is null
     or to_regprocedure('public.nucleo_intelligence_context_resolve_v3(text, text, text, jsonb)') is null
     or to_regprocedure('public.customer_assistant_rollout_update(uuid, text, uuid[])') is null then
    raise exception 'abortado: uma das quatro funcoes vivas nao existe com a assinatura esperada';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/3. As vivas vão para `private`, intactas.
-- ---------------------------------------------------------------------------
alter function public.nucleo_customer_assistant_access(text)
  set schema private;
alter function public.nucleo_intelligence_context_resolve_v2(text, text, text, jsonb)
  set schema private;
alter function public.nucleo_intelligence_context_resolve_v3(text, text, text, jsonb)
  set schema private;
alter function public.customer_assistant_rollout_update(uuid, text, uuid[])
  set schema private;

revoke all on function private.nucleo_customer_assistant_access(text) from public, anon, authenticated;
revoke all on function private.nucleo_intelligence_context_resolve_v2(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.nucleo_intelligence_context_resolve_v3(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.customer_assistant_rollout_update(uuid, text, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3/3. As funções finas, com o nome e a assinatura de sempre.
-- ---------------------------------------------------------------------------
create function public.nucleo_customer_assistant_access(requester_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
begin
  -- Sem credencial de robô, a viva levanta como sempre levantou.
  if robot_org is not null and not private.org_has_feature(robot_org, 'assistant') then
    return jsonb_build_object(
      'schemaVersion', 'customer-rollout-1', 'allowed', false,
      'mode', 'off', 'reason', 'plan_without_assistant'
    );
  end if;
  return private.nucleo_customer_assistant_access(requester_phone);
end;
$$;

create function public.nucleo_intelligence_context_resolve_v2(
  conversation_key_hash text,
  requester_phone text default '',
  incoming_text text default '',
  source_data jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
begin
  if robot_org is not null and not private.org_has_feature(robot_org, 'assistant') then
    raise exception 'plan without assistant';
  end if;
  return private.nucleo_intelligence_context_resolve_v2(
    conversation_key_hash, requester_phone, incoming_text, source_data
  );
end;
$$;

create function public.nucleo_intelligence_context_resolve_v3(
  conversation_key_hash text,
  requester_phone text default '',
  incoming_text text default '',
  source_data jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
begin
  if robot_org is not null and not private.org_has_feature(robot_org, 'assistant') then
    raise exception 'plan without assistant';
  end if;
  return private.nucleo_intelligence_context_resolve_v3(
    conversation_key_hash, requester_phone, incoming_text, source_data
  );
end;
$$;

create function public.customer_assistant_rollout_update(
  target_profile uuid,
  rollout_mode text,
  selected_contacts uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  empresa uuid;
begin
  if lower(trim(coalesce(rollout_mode, ''))) in ('pilot', 'active') then
    select profile.organization_id into empresa
    from public.assistant_profiles profile
    where profile.id = target_profile;
    if empresa is not null and not private.org_has_feature(empresa, 'assistant') then
      raise exception 'plan without assistant';
    end if;
  end if;
  return private.customer_assistant_rollout_update(target_profile, rollout_mode, selected_contacts);
end;
$$;

comment on function public.nucleo_customer_assistant_access(text) is
  'Confere se o plano da empresa do robo tem IA (feature assistant) e delega a private.nucleo_customer_assistant_access. Sem IA: allowed false, reason plan_without_assistant. Ver 20260920110000.';
comment on function public.nucleo_intelligence_context_resolve_v2(text, text, text, jsonb) is
  'Confere se o plano da empresa do robo tem IA e delega a private.nucleo_intelligence_context_resolve_v2. Sem IA levanta plan without assistant. Ver 20260920110000.';
comment on function public.nucleo_intelligence_context_resolve_v3(text, text, text, jsonb) is
  'Confere se o plano da empresa do robo tem IA e delega a private.nucleo_intelligence_context_resolve_v3. Sem IA levanta plan without assistant. Ver 20260920110000.';
comment on function public.customer_assistant_rollout_update(uuid, text, uuid[]) is
  'Recusa pilot e active quando o plano da empresa nao tem IA; off sempre vale. Delega a private.customer_assistant_rollout_update. Ver 20260920110000.';

revoke all on function public.nucleo_customer_assistant_access(text) from public, anon;
revoke all on function public.nucleo_intelligence_context_resolve_v2(text, text, text, jsonb) from public, anon;
revoke all on function public.nucleo_intelligence_context_resolve_v3(text, text, text, jsonb) from public, anon;
revoke all on function public.customer_assistant_rollout_update(uuid, text, uuid[]) from public, anon;
grant execute on function public.nucleo_customer_assistant_access(text) to authenticated;
grant execute on function public.nucleo_intelligence_context_resolve_v2(text, text, text, jsonb) to authenticated;
grant execute on function public.nucleo_intelligence_context_resolve_v3(text, text, text, jsonb) to authenticated;
grant execute on function public.customer_assistant_rollout_update(uuid, text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Asserções.
-- ---------------------------------------------------------------------------
do $$
declare
  assinatura text;
begin
  foreach assinatura in array array[
    'public.nucleo_customer_assistant_access(text)',
    'public.nucleo_intelligence_context_resolve_v2(text, text, text, jsonb)',
    'public.nucleo_intelligence_context_resolve_v3(text, text, text, jsonb)',
    'public.customer_assistant_rollout_update(uuid, text, uuid[])'
  ] loop
    if not has_function_privilege('authenticated', assinatura, 'execute') then
      raise exception 'conferencia: authenticated precisa executar %', assinatura;
    end if;
    if has_function_privilege('anon', assinatura, 'execute') then
      raise exception 'conferencia: anon nao pode executar %', assinatura;
    end if;
    if position('org_has_feature' in (select p.prosrc from pg_proc p where p.oid = to_regprocedure(assinatura))) = 0 then
      raise exception 'conferencia: % precisa conferir o plano', assinatura;
    end if;
  end loop;
  foreach assinatura in array array[
    'private.nucleo_customer_assistant_access(text)',
    'private.nucleo_intelligence_context_resolve_v2(text, text, text, jsonb)',
    'private.nucleo_intelligence_context_resolve_v3(text, text, text, jsonb)',
    'private.customer_assistant_rollout_update(uuid, text, uuid[])'
  ] loop
    if to_regprocedure(assinatura) is null then
      raise exception 'conferencia: % sumiu', assinatura;
    end if;
    if has_function_privilege('authenticated', assinatura, 'execute')
       or has_function_privilege('anon', assinatura, 'execute') then
      raise exception 'conferencia: % nao pode ser chamada direto', assinatura;
    end if;
  end loop;
end $$;

commit;
