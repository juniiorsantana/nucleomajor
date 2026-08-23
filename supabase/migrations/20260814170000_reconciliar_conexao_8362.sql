-- Reconciliação da conexão de WhatsApp final 8362.
--
-- Esta linha não cria nada: ela alcança um runtime que já está no ar desde
-- 14/08/2026 13:39, sob a unit whatsapp-bridge@8ee1e6d0….
-- Os IDs abaixo são os que o processo já carrega; o plano de controle é que
-- está chegando depois.
--
-- Sobre os dois hashes, que não são intercambiáveis:
--   verified_phone_hash  = sha256(connection_id || ':' || dígitos)
--   verified_account_ref = sha256('emyleads:whatsapp-account:' || dígitos)
-- O primeiro é salgado por conexão e serve à conferência do runtime. O segundo
-- é global, e é o que faz o índice único impedir a mesma identidade ativa em
-- duas organizações. Ver ADR-001.

begin;

do $reconciliar$
declare
  alvo constant uuid := '338e44ca-36ab-437c-b8ac-aa7c60fee64a';
  conexao constant uuid := '8ee1e6d0-a9d0-4041-b6ea-878716a34a71';
begin
  -- Guarda de ambiente: sem esta organização, não há o que reconciliar.
  if not exists (select 1 from public.organizations where id = alvo) then
    raise notice 'organizacao % ausente; nada a reconciliar neste banco', alvo;
    return;
  end if;

  insert into public.whatsapp_connections (
    id, organization_id, name,
    expected_phone_hash, expected_phone_last4,
    verified_account_ref, verified_phone_hash, verified_phone_last4,
    status, automation_status, verified_at, last_activity_at
  ) values (
    conexao, alvo, 'WhatsApp principal (8362)',
    '9db74f11233b242a8b63e5d4a53ce3e0aba60c55df74f09fa7ac0e561810f95f', '8362',
    '5f6333693bebf30017471794d79b7c70477fef3c36dcf82a1cf078749c0bbcb3', '9db74f11233b242a8b63e5d4a53ce3e0aba60c55df74f09fa7ac0e561810f95f', '8362',
    'connected', 'paused', now(), now()
  )
  on conflict (id) do nothing;

  insert into public.whatsapp_device_sessions (
    organization_id, connection_id, kind,
    runtime_instance_id, session_ref, status, last_seen_at
  )
  select alvo, conexao, 'bridge',
         'whatsapp-bridge@8ee1e6d0-a9d0-4041-b6ea-878716a34a71',
         'wsl://junin/whatsapp-bridge/store',
         'active', now()
  where not exists (
    select 1 from public.whatsapp_device_sessions
    where connection_id = conexao and kind = 'bridge' and status = 'active'
  );

  insert into public.connection_events (
    organization_id, connection_id, event_type, severity, metadata
  )
  select alvo, conexao, 'connection.migrated', 'info',
         jsonb_build_object(
           'fase', 4,
           'origem', 'whatsapp-bridge.service (singleton)',
           'destino', 'whatsapp-bridge@<connection_id>.service',
           'store_movido', false,
           'qr_gerado', false
         )
  where not exists (
    select 1 from public.connection_events
    where connection_id = conexao and event_type = 'connection.migrated'
  );

  raise notice 'conexao % reconciliada', conexao;
end
$reconciliar$;

commit;
