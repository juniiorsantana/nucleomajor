begin;

alter table public.whatsapp_conversations
  add column if not exists contact_photo_url text;

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_contact_photo_url;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_contact_photo_url
  check (
    contact_photo_url is null
    or (length(contact_photo_url) <= 2048 and contact_photo_url ~ '^https://')
  );

-- Mantém a RPC vigente intacta e adiciona somente o enriquecimento da foto.
-- O runtime pode enviar `photoUrl` gradualmente; lotes antigos continuam válidos.
alter function public.nucleo_conversation_sync(jsonb)
  rename to nucleo_conversation_sync_without_photos;

revoke all on function public.nucleo_conversation_sync_without_photos(jsonb) from public;

create function public.nucleo_conversation_sync(sync_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resultado jsonb;
  robot_org uuid := private.robot_organization();
  robot_connection uuid;
begin
  resultado := public.nucleo_conversation_sync_without_photos(sync_payload);

  select credential.connection_id into robot_connection
  from public.connection_robot_credentials credential
  where credential.auth_user_id = auth.uid()
    and credential.organization_id = robot_org
    and credential.status = 'active'
    and credential.revoked_at is null
  limit 1;

  with fotos as (
    select distinct on (phone)
      pg_catalog.regexp_replace(item ->> 'phone', '[^0-9-]', '', 'g') as phone,
      nullif(left(trim(item ->> 'photoUrl'), 2048), '') as photo_url
    from pg_catalog.jsonb_array_elements(coalesce(sync_payload -> 'conversations', '[]'::jsonb)) item
    where item ? 'photoUrl'
      and trim(item ->> 'photoUrl') ~ '^https://'
    order by phone
  )
  update public.whatsapp_conversations conversation
  set contact_photo_url = fotos.photo_url,
      updated_at = now()
  from fotos
  where conversation.organization_id = robot_org
    and conversation.connection_id = robot_connection
    and conversation.contact_phone = fotos.phone;

  return resultado;
end;
$$;

revoke all on function public.nucleo_conversation_sync(jsonb) from public;
grant execute on function public.nucleo_conversation_sync(jsonb) to authenticated;

commit;
