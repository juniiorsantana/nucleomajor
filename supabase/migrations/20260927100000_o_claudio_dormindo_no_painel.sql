-- O Cláudio dormindo, no painel da plataforma.
--
-- Em 27/09/2026 o login do Claude na VPS venceu e ninguém da administração
-- soube: a equipe recebia "não consegui concluir com segurança" no WhatsApp e
-- o painel não dizia nada. O runtime já mandava `model_status` e
-- `last_model_error_code` no heartbeat (20260828183000), mas só o portal de
-- cada empresa lia, na tela Conexões.
--
--   * `platform_model_alerts()`: as conexões cujo agente está parado pelo
--     modelo — sem login (`model_auth_unavailable`), sem cota
--     (`quota_exhausted`) ou falhando por outro motivo — de todas as empresas.
--
-- Só entra conexão com heartbeat dos últimos 5 minutos: runtime calado não
-- tem estado de modelo confiável, e o painel já mostra o último sinal da VPS
-- em Empresas. O alerta some sozinho na primeira resposta bem-sucedida, que
-- o runtime grava como `available`.
--
-- Função nova, nenhuma existente é reescrita.

begin;

do $$
begin
  if to_regprocedure('private.is_platform_admin()') is null then
    raise exception 'abortado: private.is_platform_admin() nao existe';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'connection_runtime_status'
      and column_name = 'last_model_error_code'
  ) then
    raise exception 'abortado: aplicar 20260828183000 antes';
  end if;
  if to_regprocedure('public.platform_model_alerts()') is not null then
    raise exception 'abortado: platform_model_alerts ja existe; esta migration ja foi aplicada';
  end if;
end $$;

create function public.platform_model_alerts()
returns table (
  connection_id uuid,
  connection_name text,
  organization_id uuid,
  organization_name text,
  model_status text,
  error_code text,
  last_model_success_at timestamptz,
  heartbeat_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_platform_admin() then
    raise exception 'platform administrator permission required';
  end if;
  return query
  select runtime.connection_id, connection.name, runtime.organization_id, organization.name,
         runtime.model_status, runtime.last_model_error_code,
         runtime.last_model_success_at, runtime.heartbeat_at
  from public.connection_runtime_status runtime
  left join public.whatsapp_connections connection on connection.id = runtime.connection_id
  left join public.organizations organization on organization.id = runtime.organization_id
  where runtime.model_status in ('unavailable', 'quota_exhausted')
    and runtime.heartbeat_at > now() - interval '5 minutes'
    and (connection.id is null or (connection.status <> 'revoked' and connection.revoked_at is null))
  -- Login vencido primeiro: é o único que não passa sozinho.
  order by (runtime.last_model_error_code = 'model_auth_unavailable') desc,
           runtime.heartbeat_at desc
  limit 100;
end;
$$;

revoke all on function public.platform_model_alerts() from public, anon;
grant execute on function public.platform_model_alerts() to authenticated;

do $$
begin
  if not has_function_privilege('authenticated', 'public.platform_model_alerts()', 'execute') then
    raise exception 'conferencia: authenticated precisa executar platform_model_alerts';
  end if;
  if has_function_privilege('anon', 'public.platform_model_alerts()', 'execute') then
    raise exception 'conferencia: anon nao pode executar platform_model_alerts';
  end if;
end $$;

commit;
