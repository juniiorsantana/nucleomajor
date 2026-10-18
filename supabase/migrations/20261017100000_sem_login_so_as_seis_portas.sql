-- Sem login, só as seis portas. E a área `private` ganha a segunda tranca.
--
-- O QUE A CONFERÊNCIA DE PRODUÇÃO MOSTROU (17/10/2026)
--
-- * 96 funções do schema `public` aceitavam chamada de `anon` (quem não fez
--   login, só com a chave publicável que vai no site). A causa é a mesma da
--   20260905200000: o `ALTER DEFAULT PRIVILEGES` do Supabase concede EXECUTE a
--   `anon` em toda função nova de `public`, e o padrão do Postgres concede a
--   PUBLIC. Nenhuma das conferidas era explorável — elas falham fechado em
--   `can_manage_org`/`is_robot`/token —, mas cada uma era uma tranca só.
-- * `anon` não tem USAGE no schema `private` (bom). `authenticated` tem, porque
--   as policies usam `private.is_org_member` e companhia. Com isso, funções
--   internas `security definer` como `private.provision_intelligence(org, ator)`
--   ficavam executáveis por qualquer usuário logado; só não eram alcançáveis
--   porque o PostgREST não expõe `private`. Configuração, não permissão.
--
-- O QUE MUDA
--
-- 1. `anon` perde EXECUTE em todas as funções de `public`, menos nas seis que
--    o servidor chama sem sessão de usuário (`publicRpc` em src/server.mjs,
--    src/metaLeads.mjs e src/whatsappCloud.mjs). As seis conferem o token de
--    intake por dentro e seguem como estão.
-- 2. Em `private`, `anon` e PUBLIC saem de tudo. `authenticated` perde as
--    funções internas que nenhuma policy nem nenhum código de invocador usa
--    (lista `internas`); mantém as que as policies precisam.
-- 3. Funções criadas daqui para frente nascem sem `anon` e sem PUBLIC.
--    `authenticated` continua recebendo EXECUTE em `public` (default do
--    Supabase) e em `private` (default concedido abaixo), então nada muda para
--    quem escreve migration: uma porta nova sem login precisa de
--    `grant execute ... to anon` explícito, como as seis já têm.
--
-- O QUE NÃO MUDA
--
-- * `authenticated` e `service_role` mantêm exatamente o EXECUTE que tinham em
--   `public` (a migration concede nominalmente antes de tirar PUBLIC, e confere
--   no fim). O portal e o runtime da VPS entram sempre com sessão
--   (`authenticated`), então não sentem nada.
-- * Nenhum corpo de função, nenhuma tabela, nenhuma policy.
--
-- GUARDAS: aborta sem mudar nada se uma das seis portas sumir ou mudar de
-- assinatura, se sobrar porta aberta além das seis, se `authenticated` ou
-- `service_role` perderem algo fora da lista `internas`, ou se a função de
-- prova criada no fim nascer aberta para `anon`.
--
-- DESFAZER: 04 - Entregas/2026-10-17_seguranca-3-desfazer_claude.sql.

begin;

create temp table seguranca_antes on commit drop as
select p.oid,
       n.nspname as esquema,
       p.proname as nome,
       has_function_privilege('authenticated', p.oid, 'execute') as autenticado,
       has_function_privilege('service_role', p.oid, 'execute') as servico
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
  and p.prokind in ('f', 'p')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');

create temp table seguranca_internas_poupadas (nome text) on commit drop;

do $$
declare
  portas constant text[] := array[
    'nucleo_site_lead_receive(text, jsonb)',
    'nucleo_billing_asaas_receive(text, jsonb, text)',
    'nucleo_billing_activation_delivered(text, uuid, boolean)',
    'nucleo_connection_change_notices_claim(text, integer)',
    'nucleo_connection_change_notice_done(text, uuid, integer, integer)',
    'nucleo_whatsapp_cloud_receive(text, jsonb)'
  ];
  -- Funções internas que nenhum usuário logado precisa chamar direto: só
  -- outras funções `security definer` as chamam, e essas rodam como o dono.
  internas constant text[] := array[
    'enqueue_assignment_notice', 'enqueue_calendar_reminders', 'intelligence_payload',
    'is_notification_worker', 'is_platform_admin', 'notification_worker_connection',
    'notification_worker_organization', 'provision_intelligence',
    'rebuild_member_calendar_reminders', 'seed_calendar_categories'
  ];
  achadas integer;
  f record;
  assinatura text;
begin
  -- Guarda: as seis portas existem com essa assinatura e são security definer.
  select count(*) into achadas
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.proname || '(' || oidvectortypes(p.proargtypes) || ')' = any(portas);
  if achadas <> array_length(portas, 1) then
    raise exception 'abortado: esperava as % portas sem login, achei % (nada foi gravado)',
      array_length(portas, 1), achadas;
  end if;

  -- Uma interna só sai de `authenticated` se nada que roda como invocador a
  -- chama: função sem security definer, policy, default de coluna ou check.
  -- As que aparecerem ficam como estão e são listadas no fim.
  insert into seguranca_internas_poupadas
  select alvo from unnest(internas) alvo
  where exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where not p.prosecdef and n.nspname not in ('pg_catalog', 'information_schema')
        and p.prosrc ~* ('private\.' || alvo || '\s*\(')
    )
    or exists (
      select 1 from pg_policies pol
      where coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '') ~* ('private\.' || alvo || '\s*\(')
    )
    or exists (
      select 1 from pg_attrdef d
      where pg_get_expr(d.adbin, d.adrelid) ~* ('private\.' || alvo || '\s*\(')
    )
    or exists (
      select 1 from pg_constraint c
      where c.contype = 'c' and pg_get_constraintdef(c.oid) ~* ('private\.' || alvo || '\s*\(')
    );

  for f in
    select a.oid, a.esquema, a.nome, a.autenticado, a.servico from seguranca_antes a
  loop
    assinatura := f.oid::regprocedure::text;

    if f.esquema = 'private'
       and f.nome = any(internas)
       and f.nome not in (select nome from seguranca_internas_poupadas) then
      execute format('revoke execute on function %s from public, anon, authenticated', assinatura);
      continue;
    end if;

    -- Quem tinha por PUBLIC passa a ter nominalmente, antes de PUBLIC sair.
    if f.autenticado then
      execute format('grant execute on function %s to authenticated', assinatura);
    end if;
    if f.servico then
      execute format('grant execute on function %s to service_role', assinatura);
    end if;

    if f.esquema = 'public'
       and (select p.proname || '(' || oidvectortypes(p.proargtypes) || ')' from pg_proc p where p.oid = f.oid) = any(portas) then
      execute format('grant execute on function %s to anon', assinatura);
    else
      execute format('revoke execute on function %s from public, anon', assinatura);
    end if;
  end loop;
end $$;

revoke all on schema private from anon;

-- As funções de amanhã: sem PUBLIC e sem anon; authenticated segue recebendo.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema private grant execute on functions to authenticated;

-- Prova: uma função nova nasce fechada para anon e aberta para authenticated.
create function public.seguranca_prova_default() returns integer language sql as 'select 1';
create function private.seguranca_prova_default() returns integer language sql as 'select 1';

do $$
declare
  abertas text;
  perdas text;
  poupadas text;
  total_abertas integer;
begin
  select count(*), string_agg(p.proname, ', ' order by p.proname) into total_abertas, abertas
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and has_function_privilege('anon', p.oid, 'execute');
  if total_abertas <> 6 then
    raise exception 'abortado: sobraram % funções abertas sem login: % (nada foi gravado)', total_abertas, abertas;
  end if;

  select string_agg(a.esquema || '.' || a.nome, ', ') into perdas
  from seguranca_antes a
  where (a.autenticado and not has_function_privilege('authenticated', a.oid, 'execute')
         and not (a.esquema = 'private' and a.nome in (
           'enqueue_assignment_notice', 'enqueue_calendar_reminders', 'intelligence_payload',
           'is_notification_worker', 'is_platform_admin', 'notification_worker_connection',
           'notification_worker_organization', 'provision_intelligence',
           'rebuild_member_calendar_reminders', 'seed_calendar_categories')))
     or (a.servico and not has_function_privilege('service_role', a.oid, 'execute')
         and a.esquema = 'public');
  if perdas is not null then
    raise exception 'abortado: o portal perderia acesso a: % (nada foi gravado)', perdas;
  end if;

  if has_function_privilege('anon', 'public.seguranca_prova_default()', 'execute')
     or has_function_privilege('anon', 'private.seguranca_prova_default()', 'execute')
     or not has_function_privilege('authenticated', 'public.seguranca_prova_default()', 'execute')
     or not has_function_privilege('authenticated', 'private.seguranca_prova_default()', 'execute') then
    raise exception 'abortado: o padrão para funções novas não ficou como esperado (nada foi gravado)';
  end if;

  if has_schema_privilege('anon', 'private', 'usage') then
    raise exception 'abortado: anon ainda entra em private (nada foi gravado)';
  end if;

  select coalesce(string_agg(nome, ', '), 'nenhuma') into poupadas from seguranca_internas_poupadas;
  raise notice 'sem login: % (as seis portas); internas poupadas: %', abertas, poupadas;
end $$;

drop function public.seguranca_prova_default();
drop function private.seguranca_prova_default();

commit;
