-- A transcrição dos áudios, gravada na própria mensagem.
--
-- Até aqui um áudio chegava ao espelho com `content` vazio, e quem lê a
-- conversa pelo banco (o Agente Analista, o Jev, a linha do tempo do
-- relatório) via só "[áudio]". A VPS já transcrevia, mas só para o atendente
-- responder, e jogava o texto fora. Medido em 02/10/2026 na Adriani: 22% do que
-- a empresa manda é áudio, e nenhum tinha texto — a análise julgava o
-- atendimento sem ouvir um quinto dele.
--
-- Decisões do dono (02/10/2026): só conversa direta (grupo não); o áudio novo
-- é transcrito quando chega; o antigo, só quando alguém pede a análise daquela
-- conversa; a transcrição aparece no portal embaixo do áudio.
--
-- Por que no `content`, e não numa coluna à parte: o analista e o Jev já
-- montam "[áudio] <texto>" quando a mensagem tem texto. Gravando ali, eles, a
-- linha do tempo e qualquer leitura futura passam a ouvir o áudio sem mudar uma
-- linha. `transcribed_at` diz que aquele texto é transcrição automática (e não
-- legenda digitada), para o portal marcar e para ninguém transcrever de novo.
-- Transcrição vazia (áudio sem fala) grava só a marca: o áudio fica com
-- `content` vazio e não volta para a fila.
--
-- A regra continua estreita: o `content` de uma mensagem não muda. A exceção é
-- esta RPC, só do robô da própria conexão, só sobre áudio de conversa direta,
-- só onde `content` está vazio e ainda não houve transcrição. A sincronia
-- (`nucleo_conversation_sync_*`) já não reescreve `content` no `on conflict`,
-- então a transcrição sobrevive aos reenvios.

begin;

-- ---------------------------------------------------------------------------
-- 1/4. Guardas.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.whatsapp_messages') is null
     or to_regclass('public.whatsapp_conversations') is null
     or to_regclass('public.connection_robot_credentials') is null
     or to_regprocedure('private.robot_organization()') is null then
    raise exception 'abortado: o espelho de conversas ou a credencial do robô não existem';
  end if;
  if to_regprocedure('public.nucleo_message_transcript_record(jsonb)') is not null then
    raise exception 'abortado: nucleo_message_transcript_record já existe';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/4. A marca.
-- ---------------------------------------------------------------------------
alter table public.whatsapp_messages
  add column if not exists transcribed_at timestamptz;

comment on column public.whatsapp_messages.transcribed_at is
  'Quando a VPS transcreveu este áudio. Preenchida: o content é transcrição automática (vazio = áudio sem fala). Nula: content é o que veio do WhatsApp.';

-- ---------------------------------------------------------------------------
-- 3/4. A gravação, pelo robô.
-- ---------------------------------------------------------------------------
-- Entrada: {"items": [{"id": "<message_id>", "text": "<transcrição>"}]}, até
-- 50 itens e 8000 caracteres por texto (o mesmo teto do `content` na
-- sincronia). Item que não casa é ignorado, não recusado: a mensagem pode ter
-- sido podada, ser de grupo, já ter texto ou já ter sido transcrita — nenhum
-- desses é erro de quem manda.
create function public.nucleo_message_transcript_record(transcript_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid;
  itens jsonb := coalesce(transcript_payload -> 'items', '[]'::jsonb);
  gravadas integer := 0;
begin
  if robot_org is null then
    raise exception 'robot credential is inactive or connection was revoked';
  end if;
  if jsonb_typeof(transcript_payload) <> 'object'
    or jsonb_typeof(itens) <> 'array'
    or pg_catalog.octet_length(transcript_payload::text) > 262144 then
    raise exception 'transcript payload is invalid';
  end if;
  if pg_catalog.jsonb_array_length(itens) > 50 then
    raise exception 'transcript batch is too large';
  end if;

  select credential.connection_id into robot_connection
  from public.connection_robot_credentials credential
  join public.whatsapp_connections connection
    on connection.id = credential.connection_id
   and connection.organization_id = credential.organization_id
  where credential.auth_user_id = auth.uid()
    and credential.organization_id = robot_org
    and credential.status = 'active'
    and credential.revoked_at is null
    and connection.status <> 'revoked'
    and connection.revoked_at is null
  limit 1;
  if robot_connection is null then
    raise exception 'robot connection is inactive or revoked';
  end if;

  with entrada as (
    select distinct on (left(trim(coalesce(item ->> 'id', '')), 128))
      left(trim(coalesce(item ->> 'id', '')), 128) as message_id,
      left(trim(coalesce(item ->> 'text', '')), 8000) as texto
    from pg_catalog.jsonb_array_elements(itens) as item
    where jsonb_typeof(item) = 'object'
  ), gravada as (
    update public.whatsapp_messages mensagem
    set content = entrada.texto,
        transcribed_at = now()
    from entrada
    where entrada.message_id <> ''
      and mensagem.connection_id = robot_connection
      and mensagem.organization_id = robot_org
      and mensagem.message_id = entrada.message_id
      and lower(mensagem.media_type) in ('audio', 'ptt')
      and mensagem.content = ''
      and mensagem.transcribed_at is null
      and exists (
        select 1
        from public.whatsapp_conversations conversa
        where conversa.connection_id = mensagem.connection_id
          and conversa.contact_phone = mensagem.contact_phone
          and conversa.chat_kind = 'direto'
      )
    returning 1
  )
  select pg_catalog.count(*)::integer into gravadas from gravada;

  return jsonb_build_object('recorded', gravadas);
end;
$$;

revoke all on function public.nucleo_message_transcript_record(jsonb) from public, anon, authenticated;
grant execute on function public.nucleo_message_transcript_record(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4/4. Conferência.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'whatsapp_messages'
      and column_name = 'transcribed_at' and data_type = 'timestamp with time zone'
  ) then
    raise exception 'conferencia: whatsapp_messages.transcribed_at não ficou';
  end if;
  if has_function_privilege('anon', 'public.nucleo_message_transcript_record(jsonb)', 'execute') then
    raise exception 'conferencia: anon grava transcrição';
  end if;
  if not has_function_privilege('authenticated', 'public.nucleo_message_transcript_record(jsonb)', 'execute') then
    raise exception 'conferencia: o robô não alcança a gravação da transcrição';
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = 'public.nucleo_message_transcript_record(jsonb)'::regprocedure) then
    raise exception 'conferencia: a gravação da transcrição não é security definer';
  end if;
end $$;

commit;
