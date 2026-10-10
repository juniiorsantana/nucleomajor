-- Conferência da migration 20261012100000 (a troca voluntária de número),
-- depois de aplicada pelo SQL Editor. Só leitura. Cada linha diz o que conferiu
-- e se passou; tudo precisa voltar `true`.
select item, ok
from (values
  ('tabela de pedidos existe',
    to_regclass('public.whatsapp_connection_change_requests') is not null),
  ('tabela de identidades existe',
    to_regclass('public.whatsapp_connection_identities') is not null),
  ('tabela de liberações existe',
    to_regclass('private.connection_change_policies') is not null),
  ('tabela do token do aviso existe',
    to_regclass('private.connection_change_notifier') is not null),
  ('RLS ligada nas quatro tabelas',
    (select bool_and(c.relrowsecurity) from pg_class c
      where c.oid in ('public.whatsapp_connection_change_requests'::regclass,
                      'public.whatsapp_connection_identities'::regclass,
                      'private.connection_change_policies'::regclass,
                      'private.connection_change_notifier'::regclass))),
  ('nenhuma leitura direta por anon ou authenticated',
    not exists (
      select 1 from information_schema.role_table_grants g
      where g.grantee in ('anon', 'authenticated')
        and (g.table_schema, g.table_name) in (
          ('public', 'whatsapp_connection_change_requests'),
          ('public', 'whatsapp_connection_identities'),
          ('private', 'connection_change_policies'),
          ('private', 'connection_change_notifier')))),
  ('as oito RPCs existem, security definer e search_path vazio',
    (select count(*) = 8 and bool_and(p.prosecdef)
            and bool_and(coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%')
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('nucleo_connection_change_start', 'nucleo_connection_change_resend',
                          'nucleo_connection_change_confirm', 'nucleo_connection_change_cancel',
                          'nucleo_connection_change_retry', 'nucleo_connection_change_status',
                          'nucleo_connection_change_notices_claim', 'nucleo_connection_change_notice_done'))),
  ('ninguém liberado: zero liberações',
    (select count(*) = 0 from private.connection_change_policies)),
  ('o padrão é desligado',
    private.connection_change_default_mode() = 'off'),
  ('a Major está desligada até a liberação',
    private.connection_change_mode('8ee1e6d0-a9d0-4041-b6ea-878716a34a71') = 'off'),
  ('um período inicial por conexão viva com número esperado',
    (select count(*) from public.whatsapp_connection_identities where generation = 0 and reason = 'initial')
      = (select count(*) from public.whatsapp_connections
          where expected_phone_last4 is not null and status <> 'revoked' and revoked_at is null)),
  ('a Major tem o período inicial do final 8362',
    exists (select 1 from public.whatsapp_connection_identities
             where connection_id = '8ee1e6d0-a9d0-4041-b6ea-878716a34a71'
               and generation = 0 and phone_last4 = '8362' and active_until is null)),
  ('os três comandos novos estão no check da fila',
    (select pg_get_constraintdef(c.oid) like '%connection_confirmation_send%'
            and pg_get_constraintdef(c.oid) like '%connection_logout%'
            and pg_get_constraintdef(c.oid) like '%connection_identity_replace%'
       from pg_constraint c
      where c.conname = 'connection_runtime_commands_command_type_check')),
  ('os comandos antigos continuam no check da fila',
    (select pg_get_constraintdef(c.oid) like '%connection_pair_start%'
            and pg_get_constraintdef(c.oid) like '%conversation_send%'
       from pg_constraint c
      where c.conname = 'connection_runtime_commands_command_type_check')),
  ('os quatro gatilhos existem',
    (select count(*) = 4 from pg_trigger t
      where not t.tgisinternal
        and t.tgname in ('connection_change_policies_audit', 'connection_runtime_commands_change_track',
                         'connection_runtime_status_session_back_insert',
                         'connection_runtime_status_session_back_update'))),
  ('a geração e a sessão liberada estão nas conexões, zeradas',
    (select count(*) = 0 from public.whatsapp_connections
      where control_generation <> 0 or session_released_at is not null)),
  ('nenhum token de aviso gravado ainda',
    (select count(*) = 0 from private.connection_change_notifier))
) as conferencia(item, ok);
