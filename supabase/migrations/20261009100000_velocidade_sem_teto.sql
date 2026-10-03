-- A velocidade da avaliação do vendedor v2 com o tempo de verdade.
--
-- Achado no primeiro teste real (03/10/2026): fatos_do_vendedor contava os
-- minutos de horário comercial só até 241 (o teto), e o relatório mostrava
-- "primeira resposta em 241 min" para quem demorou um dia. O teto servia para
-- parar a conta cedo; a conta já termina sozinha (no máximo 400 dias de
-- laço), então ele sai. O estado não muda: até 15 bom, até 60 atenção, até
-- 240 ruim, acima disso crítico.
--
-- Mesmo corpo de 20261008100000, só sem o teto. Nada é recalculado: análises
-- já feitas guardam os fatos que tiveram.

begin;

do $$
begin
  if to_regprocedure('private.fatos_do_vendedor(uuid, uuid, text, timestamptz)') is null then
    raise exception 'abortado: aplicar 20261008100000 (avaliacao do vendedor v2) antes';
  end if;
end $$;

create or replace function private.fatos_do_vendedor(
  target_organization uuid,
  target_connection uuid,
  telefone text,
  ate timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  limite timestamptz := coalesce(ate, now());
  m record;
  tipo text;
  da_ia integer := 0;
  da_equipe integer := 0;
  com_autor integer := 0;
  por_autor jsonb := '{}'::jsonb;
  nomes jsonb := '{}'::jsonb;
  autor uuid;
  nome text;
  vendedor jsonb;
  primeira_em timestamptz;
  primeira_do_contato boolean;
  resposta_em timestamptz;
  minutos integer;
  estado text;
begin
  -- Uma passada só pela janela, em ordem: contagens por lado e por autor, a
  -- primeira mensagem e a primeira resposta depois dela.
  for m in
    select ultimas.*
    from (
      select msg.sent_at, msg.message_id, msg.is_from_me, coalesce(msg.author_kind, '') as author_kind,
             msg.author_id, pg_catalog.btrim(coalesce(msg.author_name, '')) as author_name
      from public.whatsapp_messages msg
      where msg.organization_id = target_organization
        and msg.connection_id = target_connection
        and msg.contact_phone = telefone
        and msg.sent_at <= limite
      order by msg.sent_at desc, msg.message_id desc
      limit 2000
    ) ultimas
    order by ultimas.sent_at, ultimas.message_id
  loop
    if primeira_em is null then
      primeira_em := m.sent_at;
      primeira_do_contato := not m.is_from_me;
    end if;
    if not m.is_from_me or m.author_kind = 'bot' then
      continue;
    end if;
    if resposta_em is null and primeira_do_contato then
      resposta_em := m.sent_at;
    end if;
    if m.author_kind = 'ia' then
      da_ia := da_ia + 1;
    else
      da_equipe := da_equipe + 1;
      if m.author_id is not null then
        com_autor := com_autor + 1;
        tipo := m.author_id::text;
        por_autor := por_autor || jsonb_build_object(tipo, coalesce((por_autor ->> tipo)::integer, 0) + 1);
        if m.author_name <> '' then
          nomes := nomes || jsonb_build_object(tipo, m.author_name);
        end if;
      end if;
    end if;
  end loop;

  if da_ia + da_equipe = 0 then
    vendedor := null;
  elsif da_ia > da_equipe then
    vendedor := jsonb_build_object('kind', 'ia', 'authorId', null, 'label', 'IA');
  elsif com_autor * 2 >= da_equipe then
    select a.key::uuid into autor
    from jsonb_each_text(por_autor) a
    order by a.value::integer desc, a.key
    limit 1;
    nome := nomes ->> autor::text;
    if coalesce(nome, '') = '' then
      select p.full_name into nome from public.profiles p where p.id = autor;
    end if;
    vendedor := jsonb_build_object('kind', 'pessoa', 'authorId', autor,
      'label', coalesce(nullif(pg_catalog.btrim(nome), ''), 'Equipe'));
  else
    vendedor := jsonb_build_object('kind', 'equipe', 'authorId', null, 'label', 'Equipe · pelo celular');
  end if;

  if primeira_em is null or not primeira_do_contato then
    estado := 'nao_avaliado';
  else
    minutos := private.minutos_uteis(primeira_em, coalesce(resposta_em, limite));
    estado := case
      when resposta_em is null and minutos <= 240 then 'nao_avaliado'
      when minutos <= 15 then 'bom'
      when minutos <= 60 then 'atencao'
      when minutos <= 240 then 'ruim'
      else 'critico'
    end;
  end if;

  return jsonb_build_object(
    'seller', vendedor,
    'speed', jsonb_build_object(
      'state', estado,
      'startedAt', primeira_em,
      'firstResponseAt', resposta_em,
      'firstResponseBusinessMinutes', case when resposta_em is not null then minutos end,
      'waitingBusinessMinutes', case when primeira_do_contato and resposta_em is null then minutos end,
      'rule', jsonb_build_object('days', 'seg-sab', 'opens', '08:00', 'closes', '20:00',
        'timezone', 'America/Sao_Paulo', 'limits', jsonb_build_array(15, 60, 240))
    )
  );
end;
$$;

revoke all on function private.fatos_do_vendedor(uuid, uuid, text, timestamptz) from public, anon, authenticated;

do $$
begin
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef('private.fatos_do_vendedor(uuid, uuid, text, timestamptz)'::regprocedure), 'limite), 241)') > 0 then
    raise exception 'conferencia: o teto de 241 minutos continua na conta';
  end if;
  if has_function_privilege('authenticated', 'private.fatos_do_vendedor(uuid, uuid, text, timestamptz)', 'execute') then
    raise exception 'conferencia: permissao a mais';
  end if;
end $$;

commit;
