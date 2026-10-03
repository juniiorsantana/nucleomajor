-- Avaliação do vendedor v2: a nota única do atendimento, que critica o
-- trabalho do vendedor.
--
-- Plano aprovado pelo dono em 03/10/2026 (doc "Plano — Avaliação do vendedor
-- v2"). Substitui o Atendimento Score v1 (20261004100000) para quem for ligado,
-- sem estrutura paralela: o mesmo motor (private.pontuar), a mesma análise do
-- botão, o mesmo Jev. O que muda:
--
--   * atendimento.v2: 9 pontos tirados de livros de vendas, pesos somando 100
--     (avanço 16, diagnóstico 14, objeção 12, conduz 12, fechamento 12,
--     follow-up 10, velocidade 8, escuta 8, promessas 8);
--   * fatos versão 3: quem é o vendedor da conversa (pessoa, IA ou "Equipe ·
--     pelo celular" quando as mensagens não dizem quem escreveu) e a
--     velocidade da primeira resposta, em minutos de horário comercial;
--   * o relatório analysis.v2: faixa (vendeu bem, atende mas não fecha,
--     atrapalhou a venda), cobertura, veredito, o que fez bem, o que custou a
--     venda e, por ponto, a crítica e o que um vendedor top teria feito;
--   * a v2 vira o padrão de todos os clientes (decisão do dono, 03/10/2026),
--     mas NÃO nesta migration: aqui ela nasce como modelo (rascunho da
--     plataforma) e nada muda para ninguém. A troca é um comando à parte,
--     `select private.trocar_regua_padrao('atendimento.v2');`, rodado depois
--     que a VPS estiver com o runtime que faz as perguntas da v2. Antes disso,
--     as análises sairiam na v2 sem as respostas do Jev;
--   * uma empresa pode ficar numa régua diferente do padrão
--     (private.ligar_regua ou, pelo painel, platform_analysis_schema_set):
--     é o caminho para voltar uma empresa para a v1 sem voltar todo mundo.
--
-- Ordem de publicação: esta migration; o merge do portal (que lê v1 e v2);
-- a release da VPS; a troca do padrão.
--
-- Histórico: nada é recalculado. Análises antigas continuam abrindo com a
-- régua que usaram.

begin;

-- ---------------------------------------------------------------------------
-- 1/9. Guardas.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.analysis_schemas where definition ->> 'key' = 'atendimento.v2') then
    raise exception 'abortado: atendimento.v2 ja existe; esta migration ja foi aplicada';
  end if;
  if not exists (select 1 from public.analysis_schemas where organization_id is null
                 and status = 'published' and definition ->> 'key' = 'atendimento.v1') then
    raise exception 'abortado: aplicar 20261004100000 (atendimento score v1) antes';
  end if;
  if to_regprocedure('private.linha_do_tempo_da_analise(public.conversation_analyses)') is null then
    raise exception 'abortado: aplicar 20261005100000 (linha do tempo) antes';
  end if;
  if to_regprocedure('private.platform_audit(uuid, text, text, jsonb, jsonb, text)') is null then
    raise exception 'abortado: private.platform_audit nao existe';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/9. Minutos de horário comercial.
-- ---------------------------------------------------------------------------
-- Régua aprovada em 03/10/2026: segunda a sábado, das 8h às 20h, horário de
-- Brasília, até a empresa definir a dela. Noite, domingo e o que fica fora
-- disso não contam contra o vendedor. `teto` encerra a conta cedo: para dizer
-- "acima de 4 horas" não é preciso somar um mês.
create function private.minutos_uteis(inicio timestamptz, fim timestamptz, teto integer default 100000)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  fuso constant text := 'America/Sao_Paulo';
  dia date;
  ultimo date;
  abre timestamptz;
  fecha timestamptz;
  total numeric := 0;
begin
  if inicio is null or fim is null or fim <= inicio then
    return 0;
  end if;
  if fim - inicio > interval '400 days' then
    return teto;
  end if;
  dia := (inicio at time zone fuso)::date;
  ultimo := (fim at time zone fuso)::date;
  while dia <= ultimo loop
    if extract(isodow from dia) between 1 and 6 then
      abre := (dia + time '08:00') at time zone fuso;
      fecha := (dia + time '20:00') at time zone fuso;
      if least(fim, fecha) > greatest(inicio, abre) then
        total := total + extract(epoch from least(fim, fecha) - greatest(inicio, abre)) / 60;
        if total >= teto then
          return teto;
        end if;
      end if;
    end if;
    dia := dia + 1;
  end loop;
  return floor(total)::integer;
end;
$$;

revoke all on function private.minutos_uteis(timestamptz, timestamptz, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3/9. Fatos do vendedor: quem atendeu e a velocidade.
-- ---------------------------------------------------------------------------
-- A mesma janela dos fatos (as últimas 2000 mensagens até `ate`).
--
-- Quem atendeu (`seller`): o lado da empresa que mais escreveu, sem contar
-- mensagem automática (bot). IA escreveu mais: o vendedor é a IA. Equipe
-- escreveu mais: a pessoa que mais escreveu, quando a maioria das mensagens
-- da equipe diz quem escreveu (enviadas pelo portal); senão, o vendedor geral
-- "Equipe · pelo celular" (enviadas direto do WhatsApp, sem autor).
--
-- Velocidade (`speed`): da primeira mensagem do contato até a primeira
-- resposta da empresa (IA ou equipe; bot não conta), em minutos de horário
-- comercial. Até 15 bom, até 60 atenção, até 240 ruim, acima disso crítico.
-- Conversa que a empresa começou: não avaliado. Sem resposta ainda: só vira
-- crítico depois de 240 minutos úteis; antes disso, não avaliado.
create function private.fatos_do_vendedor(
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
    minutos := private.minutos_uteis(primeira_em, coalesce(resposta_em, limite), 241);
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

-- Fatos e notas, com os fatos do vendedor por cima (versão 3). Mesmo contrato
-- de 20261003100000. Se os fatos do vendedor falharem, seguem os da versão 2.
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
  if fatos <> '{}'::jsonb then
    begin
      fatos := fatos || private.fatos_do_vendedor(target_organization, target_connection, telefone,
        (fatos ->> 'until')::timestamptz) || jsonb_build_object('version', 3);
    exception when others then
      null;
    end;
  end if;
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

-- ---------------------------------------------------------------------------
-- 4/9. A régua em vigor viaja com o playbook.
-- ---------------------------------------------------------------------------
-- O runtime precisa saber qual régua vale para montar as perguntas do Jev e o
-- pedido ao Claude. Ela vai como `regua` no playbook efetivo (pedido de
-- análise) e no playbook do Jev (leitura automática), sem mexer no contrato
-- de nenhuma das duas filas.
create function private.regua_da_empresa(target_organization uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select s.definition ->> 'key'
    from public.analysis_schemas s
    where s.status = 'published'
      and (s.organization_id = target_organization or s.organization_id is null)
    order by (s.organization_id is null), s.version desc
    limit 1
  ), 'atendimento.v1');
$$;

revoke all on function private.regua_da_empresa(uuid) from public, anon, authenticated;

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
  ) || jsonb_build_object('regua', private.regua_da_empresa(target_organization));
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
    'regua', coalesce(efetivo ->> 'regua', 'atendimento.v1'),
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

-- ---------------------------------------------------------------------------
-- 5/9. atendimento.v2, como modelo da plataforma.
-- ---------------------------------------------------------------------------
-- Rascunho com organization_id nulo: não vale para ninguém até a troca do
-- padrão (seção 6). Os estados do Jev usam a confiança mínima de sempre (0,6).
-- Velocidade vem dos fatos (speed.state), não do Jev.
insert into public.analysis_schemas (organization_id, version, status, definition, notes)
values (
  null,
  2,
  'draft',
  jsonb_build_object(
    'key', 'atendimento.v2',
    'scoreType', 'atendimento',
    'notEvaluatedBehavior', 'exclude_from_denominator',
    'bands', '[{"key": "vendeu_bem", "min": 75, "label": "Vendeu bem"}, {"key": "nao_fecha", "min": 50, "label": "Atende, mas não fecha"}, {"key": "atrapalhou", "min": 0, "label": "Atrapalhou a venda"}]'::jsonb,
    'minCoverage', 50,
    'scores', jsonb_build_object(
      'atendimento', jsonb_build_object(
        'stateFactors', '{"bom": 1.0, "atencao": 0.6, "ruim": 0.2, "critico": 0.0}'::jsonb,
        'dimensions', jsonb_build_array(
          jsonb_build_object('key', 'advance', 'name', 'Avanço com data', 'weight', 16, 'source', 'jev',
            'reference', 'SPIN Selling · Rackham',
            'criteria', jsonb_build_array(jsonb_build_object('key', 'advance',
              'when', jsonb_build_object('source', 'classification', 'path', 'vnd_advance', 'minConfidence', 0.6),
              'factors', '{"fechou": 1.0, "compromisso_com_data": 1.0, "propos_com_data": 1.0, "desqualificado_com_motivo": 1.0, "compromisso_sem_data": 0.6, "continuacao": 0.0, "ainda_cedo": null}'::jsonb))),
          jsonb_build_object('key', 'diagnosis', 'name', 'Diagnóstico', 'weight', 14, 'source', 'jev+playbook',
            'reference', 'SPIN Selling · Gap Selling',
            'criteria', jsonb_build_array(jsonb_build_object('key', 'diagnosis',
              'when', jsonb_build_object('source', 'classification', 'path', 'vnd_diagnosis', 'minConfidence', 0.6),
              'factors', '{"bom": 1.0, "atencao": 0.6, "ruim": 0.2, "critico": 0.0, "nao_avaliado": null}'::jsonb))),
          jsonb_build_object('key', 'objection', 'name', 'Trata objeção', 'weight', 12, 'source', 'jev+playbook',
            'reference', 'Never Split the Difference · Voss',
            'criteria', jsonb_build_array(jsonb_build_object('key', 'objection',
              'when', jsonb_build_object('source', 'classification', 'path', 'vnd_objection', 'minConfidence', 0.6),
              'factors', '{"bom": 1.0, "atencao": 0.6, "ruim": 0.2, "critico": 0.0, "nao_avaliado": null}'::jsonb))),
          jsonb_build_object('key', 'leads', 'name', 'Ensina e conduz', 'weight', 12, 'source', 'jev',
            'reference', 'The Challenger Sale',
            'criteria', jsonb_build_array(jsonb_build_object('key', 'leads',
              'when', jsonb_build_object('source', 'classification', 'path', 'vnd_leads', 'minConfidence', 0.6),
              'factors', '{"bom": 1.0, "atencao": 0.6, "ruim": 0.2, "critico": 0.0, "nao_avaliado": null}'::jsonb))),
          jsonb_build_object('key', 'close', 'name', 'Pede o fechamento', 'weight', 12, 'source', 'jev',
            'reference', 'Secrets of Closing the Sale · Ziglar',
            'criteria', jsonb_build_array(jsonb_build_object('key', 'close',
              'when', jsonb_build_object('source', 'classification', 'path', 'vnd_close', 'minConfidence', 0.6),
              'factors', '{"bom": 1.0, "atencao": 0.6, "ruim": 0.2, "critico": 0.0, "nao_avaliado": null}'::jsonb))),
          jsonb_build_object('key', 'follow_up', 'name', 'Follow-up', 'weight', 10, 'source', 'jev',
            'reference', 'Fanatical Prospecting · Blount',
            'criteria', jsonb_build_array(jsonb_build_object('key', 'follow_up',
              'when', jsonb_build_object('source', 'classification', 'path', 'vnd_follow_up', 'minConfidence', 0.6),
              'factors', '{"bom": 1.0, "atencao": 0.6, "ruim": 0.2, "critico": 0.0, "nao_avaliado": null}'::jsonb))),
          jsonb_build_object('key', 'speed', 'name', 'Velocidade', 'weight', 8, 'source', 'facts',
            'reference', 'Harvard Business Review, 2011',
            'criteria', jsonb_build_array(jsonb_build_object('key', 'speed',
              'when', jsonb_build_object('source', 'fact', 'path', 'speed.state'),
              'factors', '{"bom": 1.0, "atencao": 0.6, "ruim": 0.2, "critico": 0.0, "nao_avaliado": null}'::jsonb))),
          jsonb_build_object('key', 'empathy', 'name', 'Escuta e empatia', 'weight', 8, 'source', 'jev',
            'reference', 'Never Split the Difference · Voss',
            'criteria', jsonb_build_array(jsonb_build_object('key', 'empathy',
              'when', jsonb_build_object('source', 'classification', 'path', 'vnd_empathy', 'minConfidence', 0.6),
              'factors', '{"bom": 1.0, "atencao": 0.6, "ruim": 0.2, "critico": 0.0, "nao_avaliado": null}'::jsonb))),
          jsonb_build_object('key', 'promises', 'name', 'Cumpre o que promete', 'weight', 8, 'source', 'jev',
            'reference', 'Influence · Cialdini',
            'criteria', jsonb_build_array(jsonb_build_object('key', 'promises',
              'when', jsonb_build_object('source', 'classification', 'path', 'vnd_promises', 'minConfidence', 0.6),
              'factors', '{"cumpriu": 1.0, "cumpriu_com_atraso": 0.6, "vencida_sem_entrega": 0.2, "ainda_no_prazo": null, "sem_promessa": null}'::jsonb)))
        )
      )
    )
  ),
  'Avaliacao do vendedor v2 (plano de 03/10/2026). Vira o padrao com private.trocar_regua_padrao.'
);

-- ---------------------------------------------------------------------------
-- 6/9. Trocar o padrão e mudar a régua de uma empresa.
-- ---------------------------------------------------------------------------
-- O padrão da plataforma: publica o modelo da chave e aposenta o padrão de
-- antes (que continua guardado, como modelo). Empresas com régua própria não
-- mudam. Rodar de novo não faz nada.
create function private.trocar_regua_padrao(chave text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  modelo public.analysis_schemas%rowtype;
begin
  select * into modelo
  from public.analysis_schemas s
  where s.organization_id is null and s.definition ->> 'key' = chave
  order by s.version desc
  limit 1;
  if not found then
    raise exception 'unknown analysis schema';
  end if;
  if modelo.status <> 'published' then
    update public.analysis_schemas s
    set status = 'retired'
    where s.organization_id is null and s.status = 'published';
    update public.analysis_schemas s
    set status = 'published', published_at = now()
    where s.id = modelo.id;
  end if;
  return private.regua_da_empresa(null);
end;
$$;

revoke all on function private.trocar_regua_padrao(text) from public, anon, authenticated;

-- Uma empresa: a chave do padrão em vigor tira a régua própria dela (volta
-- para o padrão); outra chave copia aquele modelo para ela e o publica.
-- Ligar de novo a mesma versão reaproveita a linha antiga.
create function private.ligar_regua(target_organization uuid, chave text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  modelo public.analysis_schemas%rowtype;
begin
  if not exists (select 1 from public.organizations o where o.id = target_organization) then
    raise exception 'organization not found';
  end if;

  update public.analysis_schemas s
  set status = 'retired'
  where s.organization_id = target_organization and s.status = 'published';

  if chave is distinct from private.regua_da_empresa(null) then
    select * into modelo
    from public.analysis_schemas s
    where s.organization_id is null and s.definition ->> 'key' = chave
    order by s.version desc
    limit 1;
    if not found then
      raise exception 'unknown analysis schema';
    end if;
    if exists (select 1 from public.analysis_schemas s
               where s.organization_id = target_organization and s.version = modelo.version) then
      update public.analysis_schemas s
      set status = 'published', definition = modelo.definition, published_at = now()
      where s.organization_id = target_organization and s.version = modelo.version;
    else
      insert into public.analysis_schemas (organization_id, version, status, definition, notes, published_at)
      values (target_organization, modelo.version, 'published', modelo.definition, modelo.notes, now());
    end if;
  end if;

  return jsonb_build_object('organizationId', target_organization, 'schema', private.regua_da_empresa(target_organization));
end;
$$;

revoke all on function private.ligar_regua(uuid, text) from public, anon, authenticated;

-- O mesmo, pelo painel da plataforma: só administrador, com histórico.
create function public.platform_analysis_schema_set(target_organization uuid, schema_key text, note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  antes text;
  depois jsonb;
begin
  if auth.uid() is null or not private.is_platform_admin() then
    raise exception 'platform administrator permission required';
  end if;
  if schema_key not in ('atendimento.v1', 'atendimento.v2') then
    raise exception 'unknown analysis schema';
  end if;
  antes := private.regua_da_empresa(target_organization);
  depois := private.ligar_regua(target_organization, schema_key);
  perform private.platform_audit(
    target_organization, 'analysis_schema.set', schema_key,
    jsonb_build_object('schema', antes), depois, note
  );
  return depois;
end;
$$;

revoke all on function public.platform_analysis_schema_set(uuid, text, text) from public, anon, authenticated;
grant execute on function public.platform_analysis_schema_set(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7/9. O relatório analysis.v2.
-- ---------------------------------------------------------------------------
-- Junta a nota do motor e o diagnóstico do Claude (analysis_report.v2). Por
-- ponto: o estado, os pontos, a crítica e "o que um vendedor top teria
-- feito", ambos do diagnóstico. Faixa e cobertura saem daqui, nunca da IA.
create function private.relatorio_do_vendedor(analise public.conversation_analyses)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  familia jsonb := analise.scores -> 'atendimento';
  fatores jsonb;
  diagnostico jsonb := case when analise.result ->> 'schema_version' = 'analysis_report.v2' then analise.result end;
  motivos jsonb;
  criterios jsonb := '[]'::jsonb;
  dimensao jsonb;
  motivo jsonb;
  fator numeric;
  estado text;
  bandeiras jsonb;
  nota integer;
  avaliado numeric;
  maximo numeric;
  cobertura integer;
  faixa text;
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
      'critique', motivo ->> 'explanation',
      'better', motivo ->> 'better',
      'evidence_message_ids', coalesce(motivo -> 'evidence_message_ids', '[]'::jsonb)
    );
    motivo := null;

    if dimensao ->> 'key' = 'advance' and dimensao -> 'criteria' -> 0 ->> 'value' = 'continuacao'
       and not exists (select 1 from jsonb_array_elements(bandeiras) b where b.value ->> 'code' = 'conversation_left_open') then
      bandeiras := bandeiras || jsonb_build_object(
        'code', 'conversation_left_open', 'severity', null, 'criterion', 'advance', 'source', 'regra',
        'reason', 'A conversa terminou sem nenhum compromisso do cliente com data.',
        'evidence_message_ids', '[]'::jsonb);
    end if;
    if dimensao ->> 'key' = 'promises' and dimensao -> 'criteria' -> 0 ->> 'value' = 'vencida_sem_entrega'
       and not exists (select 1 from jsonb_array_elements(bandeiras) b where b.value ->> 'code' = 'broken_promise') then
      bandeiras := bandeiras || jsonb_build_object(
        'code', 'broken_promise', 'severity', null, 'criterion', 'promises', 'source', 'regra',
        'reason', 'O vendedor prometeu algo ao cliente, o prazo passou e não entregou.',
        'evidence_message_ids', '[]'::jsonb);
    end if;
  end loop;

  nota := (familia ->> 'score')::integer;
  avaliado := coalesce((familia ->> 'evaluatedWeight')::numeric, 0);
  maximo := coalesce((familia ->> 'maxWeight')::numeric, 0);
  cobertura := case when maximo > 0 then round(100 * avaliado / maximo) end;
  faixa := case
    when nota is null then null
    when nota >= 75 then 'vendeu_bem'
    when nota >= 50 then 'nao_fecha'
    else 'atrapalhou'
  end;

  return jsonb_build_object(
    'schema_version', 'analysis.v2',
    'conversation_id', analise.connection_id::text || ':' || analise.contact_phone,
    'generated_at', analise.completed_at,
    'kind', analise.kind,
    'score_schema_version', analise.schema_version,
    'facts_version', analise.facts_version,
    'playbook_version', analise.playbook_version,
    'seller', analise.facts -> 'seller',
    'speed', analise.facts -> 'speed',
    'vendedor_score', case when familia is null then null else jsonb_build_object(
      'score', to_jsonb(nota),
      'max_score', 100,
      'evaluated_weight', familia -> 'evaluatedWeight',
      'max_weight', familia -> 'maxWeight',
      'coverage', cobertura,
      'conclusive', nota is not null and coalesce(cobertura, 0) >= 50,
      'band', faixa,
      'band_label', case faixa when 'vendeu_bem' then 'Vendeu bem' when 'nao_fecha' then 'Atende, mas não fecha'
        when 'atrapalhou' then 'Atrapalhou a venda' end,
      'criteria', criterios
    ) end,
    'diagnosis', case when diagnostico is null then null else jsonb_build_object(
      'summary', diagnostico -> 'summary',
      'verdict', diagnostico -> 'verdict',
      'did_well', coalesce(diagnostico -> 'did_well', '[]'::jsonb),
      'cost_the_sale', coalesce(diagnostico -> 'cost_the_sale', '[]'::jsonb),
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

revoke all on function private.relatorio_do_vendedor(public.conversation_analyses) from public, anon, authenticated;

-- O relatório de sempre escolhe o formato pela régua da análise: a v2 tem o
-- ponto "advance"; o resto segue no analysis.v1, com o corpo de 20261004100000
-- sem mudança nenhuma.
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
  if coalesce(familia -> 'dimensions', '[]'::jsonb) @> '[{"key": "advance"}]'::jsonb
     or analise.result ->> 'schema_version' = 'analysis_report.v2' then
    return private.relatorio_do_vendedor(analise);
  end if;

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

-- ---------------------------------------------------------------------------
-- 8/9. A linha do tempo também cita o que fez bem e o que custou a venda.
-- ---------------------------------------------------------------------------
-- Mesmo corpo de 20261005100000, com duas fontes de evidência a mais (da v2).
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
    union all
    select item.value -> 'evidence_message_ids'
    from jsonb_array_elements(coalesce(analise.result -> 'did_well', '[]'::jsonb)) item
    union all
    select item.value -> 'evidence_message_ids'
    from jsonb_array_elements(coalesce(analise.result -> 'cost_the_sale', '[]'::jsonb)) item
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

-- ---------------------------------------------------------------------------
-- 9/9. Conferência.
-- ---------------------------------------------------------------------------
do $$
declare
  modelo jsonb;
  notas jsonb;
  pesos numeric;
begin
  select definition into modelo from public.analysis_schemas
  where organization_id is null and status = 'draft' and definition ->> 'key' = 'atendimento.v2';
  if modelo is null then
    raise exception 'conferencia: atendimento.v2 nao entrou como modelo';
  end if;
  select sum((d ->> 'weight')::numeric) into pesos
  from jsonb_array_elements(modelo -> 'scores' -> 'atendimento' -> 'dimensions') d;
  if pesos <> 100 then
    raise exception 'conferencia: pesos do atendimento.v2 somam % e nao 100', pesos;
  end if;
  if not exists (select 1 from public.analysis_schemas where organization_id is null
                 and status = 'published' and definition ->> 'key' = 'atendimento.v1') then
    raise exception 'conferencia: o padrao deixou de ser o atendimento.v1';
  end if;

  -- O exemplo do canvas (Rodrigo Alves): avanço em continuação (0 de 16),
  -- diagnóstico atenção (8,4), objeção e conduz ruim (2,4 cada), fechamento
  -- sem sinal de compra (fora), follow-up ruim (2), velocidade, escuta e
  -- promessas bons (8 cada). 39,2 de 88 avaliados = 45.
  notas := private.pontuar(modelo, '{"speed": {"state": "bom"}}'::jsonb, '{
    "vnd_advance": {"a": "continuacao", "p": 0.8},
    "vnd_diagnosis": {"a": "atencao", "p": 0.7},
    "vnd_objection": {"a": "ruim", "p": 0.9},
    "vnd_leads": {"a": "ruim", "p": 0.7},
    "vnd_close": {"a": "nao_avaliado", "p": 0.9},
    "vnd_follow_up": {"a": "ruim", "p": 0.8},
    "vnd_empathy": {"a": "bom", "p": 0.8},
    "vnd_promises": {"a": "cumpriu", "p": 0.9}
  }'::jsonb);
  if (notas -> 'atendimento' ->> 'score')::integer is distinct from 45
     or (notas -> 'atendimento' ->> 'evaluatedWeight')::numeric <> 88
     or (notas -> 'atendimento' ->> 'points')::numeric <> 39.2 then
    raise exception 'conferencia: o motor nao deu 45 (39,2 de 88) no exemplo (%)', notas -> 'atendimento';
  end if;
  if private.minutos_uteis('2026-10-03 19:50-03', '2026-10-05 08:10-03') <> 20 then
    raise exception 'conferencia: minutos uteis de sabado 19h50 a segunda 8h10 deveriam ser 20';
  end if;
  if has_function_privilege('anon', 'public.platform_analysis_schema_set(uuid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'private.ligar_regua(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'private.fatos_do_vendedor(uuid, uuid, text, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'private.trocar_regua_padrao(text)', 'execute') then
    raise exception 'conferencia: permissao a mais';
  end if;
end $$;

commit;
