-- `nucleo_operator_context` devolve vazio quando o remetente nao e operador,
-- em vez de levantar excecao.
--
-- Ela e a funcao que responde "quem e este telefone". Duas famílias de
-- chamadores a usam, com necessidades opostas:
--
--   1. As RPCs de operador (agenda, tarefas, conhecimento interno, fase G).
--      Para elas, nao ser operador e uma recusa. TODAS as vinte e duas ja
--      fazem `if not found then raise exception ...` logo apos a chamada -
--      conferido uma a uma. Elas continuam falhando fechado sem depender da
--      excecao daqui.
--
--   2. Os resolvedores de contexto da fase H
--      (`nucleo_intelligence_context_resolve` e a `_v2`). Para eles, nao ser
--      operador e a resposta NORMAL: significa que quem escreveu e um
--      CLIENTE. O codigo diz isso explicitamente:
--
--        select * into operator_row from public.nucleo_operator_context(...);
--        if found and operator_row.organization_id = robot_org then
--          resolved_audience := 'internal';
--        end if;
--
--      O `if found` nunca foi alcancado. A excecao aborta a RPC inteira antes,
--      e o PostgREST devolve 400.
--
-- Consequencia: TODO turno de cliente falhava na resolucao de contexto, desde
-- que a fase H existe. O runtime registrava `intelligence.resolve_failed` com
-- `error_code=unavailable`, respondia "Nosso atendimento esta temporariamente
-- indisponivel" e transferia para a fila humana. O turno de operador nunca
-- falhou, porque para ele a funcao devolve linha.
--
-- Nunca tinha aparecido porque dois outros defeitos, mais externos, barravam o
-- cliente antes de chegar aqui: o Bridge nao entregava mensagem de quem nao
-- fosse operador, e a validacao de ferramentas da v2 recusava a skill de
-- solicitacao de agenda. Corrigidos os dois, este apareceu.
--
-- A outra excecao da funcao permanece: credencial de robo inativa continua
-- levantando. Aquilo e falha de infraestrutura, nao resposta sobre a pessoa.
--
-- Esta migration reaplica a funcao de 20260822010000 alterando SOMENTE esse
-- ramo.

begin;

-- Falha alto se o que esta no banco nao for o que este repositorio espera:
-- melhor parar do que descartar em silencio a alteracao de outra pessoa.
do $verificacao$
declare
  definicao text;
begin
  select pg_get_functiondef(p.oid) into definicao
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'nucleo_operator_context';

  if definicao is null then
    raise exception 'nucleo_operator_context nao existe nesta base';
  end if;
  if strpos(definicao, 'robot credential is inactive') = 0 then
    raise exception
      'a funcao no banco nao tem a guarda de credencial esperada; reveja antes de aplicar';
  end if;
  if strpos(definicao, 'sender is not a verified operator') = 0 then
    raise notice 'a funcao ja nao levanta para nao-operador; esta migration e no-op efetivo';
  end if;
end;
$verificacao$;

create or replace function public.nucleo_operator_context(requester_phone text)
returns table (
  organization_id uuid,
  organization_name text,
  connection_id uuid,
  connection_name text,
  operator_id uuid,
  user_id uuid,
  operator_name text,
  operator_role public.organization_role,
  responsibility text,
  team jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid;
  phone_hash_value text := private.whatsapp_operator_phone_hash(requester_phone);
  current_operator public.whatsapp_connection_operators%rowtype;
begin
  if robot_org is null then
    raise exception 'robot credential is inactive or connection was revoked';
  end if;
  select credential.connection_id into robot_connection
  from public.connection_robot_credentials credential
  where credential.auth_user_id = auth.uid()
    and credential.organization_id = robot_org
    and credential.status = 'active'
    and credential.revoked_at is null
  limit 1;

  select op.* into current_operator
  from public.whatsapp_connection_operators op
  where op.organization_id = robot_org
    and op.connection_id = robot_connection
    and op.phone_hash = phone_hash_value
    and op.status = 'active';
  if not found then
    -- Zero linhas, e nao excecao. Ver o cabecalho desta migration: quem exige
    -- operador ja tem seu proprio `if not found then raise`, e quem trata
    -- operador como opcional depende de conseguir observar a ausencia.
    return;
  end if;

  update public.connection_robot_credentials credential
  set last_used_at = now()
  where credential.connection_id = robot_connection
    and credential.auth_user_id = auth.uid();

  return query
  select
    organization.id,
    organization.name,
    connection.id,
    connection.name,
    current_operator.id,
    member.user_id,
    profile.full_name,
    member.role,
    coalesce(member.responsibility, ''),
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', team_member.user_id,
        'nome', team_profile.full_name,
        'papel', team_member.role,
        'responsabilidade', coalesce(team_member.responsibility, '')
      ) order by coalesce(team_profile.full_name, ''), team_member.user_id), '[]'::jsonb)
      from public.organization_members team_member
      left join public.profiles team_profile on team_profile.id = team_member.user_id
      where team_member.organization_id = organization.id
        and team_member.status = 'active'
    )
  from public.organizations organization
  join public.whatsapp_connections connection
    on connection.id = robot_connection
   and connection.organization_id = organization.id
  join public.organization_members member
    on member.organization_id = organization.id
   and member.user_id = current_operator.user_id
   and member.status = 'active'
  left join public.profiles profile on profile.id = member.user_id
  where organization.id = robot_org;
end;
$$;

revoke all on function public.nucleo_operator_context(text) from public;
grant execute on function public.nucleo_operator_context(text) to authenticated;

-- Prova na mesma transacao: o ramo do nao-operador nao pode mais levantar, e a
-- guarda de credencial tem de continuar de pe.
do $prova$
declare
  definicao text := (
    select pg_get_functiondef(p.oid)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_operator_context'
  );
begin
  if strpos(definicao, 'sender is not a verified operator') > 0 then
    raise exception 'a excecao de nao-operador continua na funcao';
  end if;
  if strpos(definicao, 'robot credential is inactive') = 0 then
    raise exception 'a guarda de credencial de robo foi perdida';
  end if;
end;
$prova$;

commit;
