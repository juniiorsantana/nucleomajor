-- Rollback da 20261008100000 (avaliação do vendedor v2).
--
-- Gerado por recorte: o corpo de cada função volta EXATAMENTE ao da
-- migration de antes (camada de inteligência, atendimento score v1, linha do
-- tempo). A régua volta a ser o atendimento.v1 para todos; os modelos e as
-- réguas da v2 ficam aposentados, não apagados, e as análises feitas na v2
-- guardam a nota que tiveram (o relatório delas volta a sair no formato v1,
-- sem o diagnóstico da v2).

begin;

do $$
begin
  if to_regprocedure('private.fatos_do_vendedor(uuid, uuid, text, timestamptz)') is null then
    raise exception 'abortado: a 20261008100000 nao esta aplicada';
  end if;
end $$;

-- 1. A régua: v1 de novo como padrão; tudo da v2 aposentado.
update public.analysis_schemas set status = 'retired'
where definition ->> 'key' = 'atendimento.v2' and status = 'published';
update public.analysis_schemas set status = 'retired'
where organization_id is not null and definition ->> 'key' = 'atendimento.v1' and status = 'published';
update public.analysis_schemas set status = 'published', published_at = coalesce(published_at, now())
where id = (select s.id from public.analysis_schemas s
            where s.organization_id is null and s.definition ->> 'key' = 'atendimento.v1'
            order by s.version desc limit 1)
  and not exists (select 1 from public.analysis_schemas p where p.organization_id is null and p.status = 'published');
-- O modelo da v2 que nunca foi publicado fica como rascunho: rascunho não
-- vale para ninguém.

-- 2. As funções de antes.
create or replace function private.avaliar_conversa(
  target_organization uuid,
  target_connection uuid,
  telefone text,
  classificacao jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  fatos jsonb := private.fatos_da_conversa(target_organization, target_connection, telefone);
  esquema public.analysis_schemas%rowtype;
  notas jsonb := '{}'::jsonb;
begin
  select * into esquema
  from public.analysis_schemas s
  where s.status = 'published'
    and (s.organization_id = target_organization or s.organization_id is null)
  order by (s.organization_id is null), s.version desc
  limit 1;
  if found then
    notas := private.pontuar(esquema.definition, fatos, classificacao);
  end if;
  return jsonb_build_object(
    'facts', fatos,
    'scores', notas,
    'schemaVersion', coalesce(esquema.version, 0),
    'lead', (notas -> 'lead' ->> 'score')::integer,
    'service', (notas -> 'atendimento' ->> 'score')::integer
  );
end;
$$;

revoke all on function private.avaliar_conversa(uuid, uuid, text, jsonb) from public, anon, authenticated;

create or replace function private.playbook_efetivo(target_organization uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.published || jsonb_build_object('origem', 'empresa', 'version', p.published_version)
     from public.organization_playbooks p
     where p.organization_id = target_organization and p.published_version > 0),
    private.playbook_base_major()
  );
$$;

create or replace function private.playbook_para_o_jev(target_organization uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', coalesce((efetivo ->> 'version')::integer, 0),
    'origem', coalesce(efetivo ->> 'origem', 'base_major'),
    'segmento', coalesce(efetivo ->> 'segmento', ''),
    'regras', coalesce(efetivo -> 'regras', '[]'::jsonb),
    'oferta', coalesce((
      select jsonb_agg(jsonb_build_object('nome', item ->> 'nome', 'preco', coalesce(item ->> 'preco', '')))
      from jsonb_array_elements(coalesce(efetivo -> 'oferta', '[]'::jsonb)) item
    ), '[]'::jsonb),
    'clienteIdeal', coalesce(efetivo -> 'clienteIdeal', '{}'::jsonb),
    'objecoes', coalesce((
      select jsonb_agg(jsonb_build_object('chave', item ->> 'chave', 'nome', item ->> 'nome', 'resposta', coalesce(item ->> 'resposta', '')))
      from jsonb_array_elements(coalesce(efetivo -> 'objecoes', '[]'::jsonb)) item
    ), '[]'::jsonb),
    'proximosPassos', coalesce((
      select jsonb_agg(jsonb_build_object('chave', item ->> 'chave', 'nome', item ->> 'nome'))
      from jsonb_array_elements(coalesce(efetivo -> 'proximosPassos', '[]'::jsonb)) item
    ), '[]'::jsonb),
    'criterios', coalesce((
      select jsonb_agg(jsonb_build_object('chave', item ->> 'chave', 'pergunta', item ->> 'pergunta', 'sim', coalesce(item ->> 'sim', '')))
      from jsonb_array_elements(coalesce(efetivo -> 'criterios', '[]'::jsonb)) item
    ), '[]'::jsonb)
  )
  from (select private.playbook_efetivo(target_organization) as efetivo) x;
$$;

revoke all on function private.playbook_efetivo(uuid) from public, anon, authenticated;
revoke all on function private.playbook_para_o_jev(uuid) from public, anon, authenticated;

create or replace function private.relatorio_da_analise(analise public.conversation_analyses)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  familia jsonb := analise.scores -> 'atendimento';
  fatores jsonb;
  diagnostico jsonb := case when analise.result ->> 'schema_version' = 'analysis_report.v1' then analise.result end;
  motivos jsonb;
  criterios jsonb := '[]'::jsonb;
  dimensao jsonb;
  motivo jsonb;
  fator numeric;
  estado text;
  bandeiras jsonb;
  nota integer;
  rotulo text;
begin
  fatores := coalesce(familia -> 'stateFactors', '{"bom": 1.0, "atencao": 0.6, "ruim": 0.2, "critico": 0.0}'::jsonb);
  motivos := coalesce(diagnostico -> 'why_this_score', '[]'::jsonb);
  bandeiras := coalesce(diagnostico -> 'red_flags', '[]'::jsonb);

  for dimensao in select value from jsonb_array_elements(coalesce(familia -> 'dimensions', '[]'::jsonb)) loop
    fator := (dimensao ->> 'factor')::numeric;
    estado := case when fator is null then 'nao_avaliado'
      else coalesce((select f.key from jsonb_each_text(fatores) f where f.value::numeric = fator limit 1), 'avaliado') end;
    select m.value into motivo
    from jsonb_array_elements(motivos) m
    where m.value ->> 'criterion' = dimensao ->> 'key'
    limit 1;
    criterios := criterios || jsonb_build_object(
      'key', dimensao ->> 'key',
      'name', dimensao ->> 'name',
      'weight', dimensao -> 'weight',
      'status', estado,
      'state', dimensao -> 'criteria' -> 0 -> 'value',
      'score_factor', dimensao -> 'factor',
      'points_awarded', dimensao -> 'points',
      'reason', motivo ->> 'explanation',
      'evidence_message_ids', coalesce(motivo -> 'evidence_message_ids', '[]'::jsonb)
    );
    motivo := null;

    if dimensao ->> 'key' = 'next_step' and fator = 0
       and not exists (select 1 from jsonb_array_elements(bandeiras) b where b.value ->> 'code' = 'conversation_left_open') then
      bandeiras := bandeiras || jsonb_build_object(
        'code', 'conversation_left_open', 'severity', null, 'criterion', 'next_step', 'source', 'regra',
        'reason', 'Havia condição de avançar e a conversa ficou sem próxima ação definida.',
        'evidence_message_ids', '[]'::jsonb);
    end if;
    if dimensao ->> 'key' = 'follow_up' and dimensao -> 'criteria' -> 0 ->> 'value' = 'overdue'
       and not exists (select 1 from jsonb_array_elements(bandeiras) b where b.value ->> 'code' = 'overdue_follow_up') then
      bandeiras := bandeiras || jsonb_build_object(
        'code', 'overdue_follow_up', 'severity', null, 'criterion', 'follow_up', 'source', 'regra',
        'reason', 'Um follow-up combinado venceu e não foi feito.',
        'evidence_message_ids', '[]'::jsonb);
    end if;
  end loop;

  nota := (familia ->> 'score')::integer;
  rotulo := case
    when familia is null or nota is null then 'Ainda não avaliável'
    when (familia ->> 'evaluatedWeight')::numeric < (familia ->> 'maxWeight')::numeric then nota || '/100 até aqui'
    else nota || '/100'
  end;

  return jsonb_build_object(
    'schema_version', 'analysis.v1',
    'conversation_id', analise.connection_id::text || ':' || analise.contact_phone,
    'generated_at', analise.completed_at,
    'kind', analise.kind,
    'score_schema_version', analise.schema_version,
    'facts_version', analise.facts_version,
    'playbook_version', analise.playbook_version,
    'lead_score', to_jsonb(analise.lead_score),
    'atendimento_score', case when familia is null then null else jsonb_build_object(
      'score', to_jsonb(nota),
      'max_score', 100,
      'evaluated_weight', familia -> 'evaluatedWeight',
      'max_weight', familia -> 'maxWeight',
      'label', rotulo,
      'criteria', criterios
    ) end,
    'diagnosis', case when diagnostico is null then null else jsonb_build_object(
      'summary', diagnostico -> 'summary',
      'main_bottleneck', diagnostico -> 'main_bottleneck',
      'why_this_score', motivos,
      'what_to_do_now', coalesce(diagnostico -> 'what_to_do_now', '[]'::jsonb),
      'suggested_message', diagnostico -> 'suggested_message',
      'red_flags', bandeiras
    ) end,
    'red_flags', bandeiras
  );
end;
$$;

revoke all on function private.relatorio_da_analise(public.conversation_analyses) from public, anon, authenticated;

create or replace function private.linha_do_tempo_da_analise(analise public.conversation_analyses)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with fontes as (
    select analise.result -> 'main_bottleneck' -> 'evidence_message_ids' as lista
    union all
    select item.value -> 'evidence_message_ids'
    from jsonb_array_elements(coalesce(analise.result -> 'why_this_score', '[]'::jsonb)) item
    union all
    select item.value -> 'evidence_message_ids'
    from jsonb_array_elements(coalesce(analise.result -> 'what_to_do_now', '[]'::jsonb)) item
    union all
    select item.value -> 'evidence_message_ids'
    from jsonb_array_elements(coalesce(analise.result -> 'red_flags', '[]'::jsonb)) item
  ),
  citadas as (
    select distinct ids.value as id
    from fontes
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(fontes.lista) = 'array' then fontes.lista else '[]'::jsonb end
    ) ids
  ),
  janela as (
    select m.message_id, m.sent_at, m.is_from_me, m.author_kind, m.media_type, m.content
    from public.whatsapp_messages m
    where m.organization_id = analise.organization_id
      and m.connection_id = analise.connection_id
      and m.contact_phone = analise.contact_phone
      and m.sent_at <= analise.requested_at
    order by m.sent_at desc, m.message_id desc
    limit 80
  )
  select jsonb_build_object(
    'until', analise.requested_at,
    'messages', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', j.message_id,
        'at', j.sent_at,
        'fromMe', j.is_from_me,
        'author', j.author_kind,
        'media', j.media_type,
        'snippet', case when exists (select 1 from citadas c where c.id = j.message_id)
          then pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(j.content, '\s+', ' ', 'g')), 90) end
      ) order by j.sent_at, j.message_id
    ), '[]'::jsonb)
  )
  from janela j;
$$;

revoke all on function private.linha_do_tempo_da_analise(public.conversation_analyses) from public, anon, authenticated;

-- 3. O que a v2 criou.
drop function public.platform_analysis_schema_set(uuid, text, text);
drop function private.ligar_regua(uuid, text);
drop function private.trocar_regua_padrao(text);
drop function private.relatorio_do_vendedor(public.conversation_analyses);
drop function private.regua_da_empresa(uuid);
drop function private.fatos_do_vendedor(uuid, uuid, text, timestamptz);
drop function private.minutos_uteis(timestamptz, timestamptz, integer);

commit;
