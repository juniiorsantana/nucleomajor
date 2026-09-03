-- Reproduz, em leitura, a falha que o runtime registra como
-- `intelligence.resolve_failed` / `error_code=unavailable`.
--
-- O runtime nao consegue dizer mais do que isso: operator_verification.py:406
-- descarta o corpo da resposta quando o HTTP e >= 400 e loga uma frase fixa.
-- O texto real do Postgres nunca sai do banco.
--
-- Este script vai busca-lo. Ele nao consegue chamar
-- `nucleo_intelligence_context_resolve_v2` diretamente, porque ela deriva a
-- organizacao de `auth.uid()` e o SQL Editor nao e o robo. Entao ele chama a
-- funcao interna que faz o trabalho, com os mesmos argumentos que a v2
-- passaria, e captura a excecao.
--
-- `should_persist` vai FALSE: nenhum contexto e criado, nenhuma linha muda.
-- Somente leitura.

do $$
declare
  organizacao uuid;
  hash_ficticio text := repeat('a', 64);   -- conversa nova, nao casa com nenhuma existente
  definicao text;
  resultado jsonb;
  skill_spec jsonb;
begin
  select profile.organization_id into organizacao
  from public.assistant_profiles profile
  where profile.audience = 'customer'
  limit 1;
  if organizacao is null then
    raise notice 'ETAPA 0: nenhum perfil de cliente; nada a reproduzir';
    return;
  end if;
  raise notice 'ETAPA 0: organizacao %', organizacao;

  -- 1. A migration de 30/08 pegou? Se a funcao no banco nao cita as duas
  -- ferramentas, ela nao foi substituida, e o resto do diagnostico muda.
  select pg_get_functiondef(p.oid) into definicao
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'nucleo_intelligence_context_resolve_v2';

  if definicao is null then
    raise notice 'ETAPA 1: FALHA - a funcao v2 nao existe nesta base';
  elsif strpos(definicao, 'calendar.request.prepare') > 0
    and strpos(definicao, 'calendar.request.submit') > 0 then
    raise notice 'ETAPA 1: ok - a v2 no banco aceita calendar.request.*';
  else
    raise notice 'ETAPA 1: FALHA - a v2 no banco NAO aceita calendar.request.*; '
      'a migration de 30/08 nao chegou a substituir a funcao';
  end if;

  -- 2. O nucleo do trabalho, com o texto real da excecao quando houver.
  begin
    resultado := private.intelligence_payload(
      organizacao, 'customer', 'whatsapp', hash_ficticio, 'oi', '{}'::jsonb, false
    );
    raise notice 'ETAPA 2: ok - o contexto resolveu';
    raise notice 'ETAPA 2: audiencia=% campanha=% skill=%',
      resultado ->> 'audiencia',
      coalesce(resultado #>> '{campanha,nome}', '(nenhuma)'),
      coalesce(resultado #>> '{skillAtivo,slug}', '(nenhuma)');

    -- 3. A validacao que a v2 faz DEPOIS de receber o payload. Se a etapa 2
    -- passa e o runtime falha, a causa esta aqui.
    skill_spec := resultado #> '{skillAtivo,spec}';
    if skill_spec is null or jsonb_typeof(skill_spec) = 'null' then
      raise notice 'ETAPA 3: nenhuma skill ativa; a v2 nao valida nada e devolve o payload';
    else
      raise notice 'ETAPA 3: skill=% instrucoes=% chars ferramentas=%',
        coalesce(resultado #>> '{skillAtivo,slug}', '?'),
        length(coalesce(skill_spec ->> 'instructionsMarkdown', '')),
        coalesce((skill_spec -> 'allowedTools')::text, '(ausente)');
      if length(coalesce(skill_spec ->> 'instructionsMarkdown', '')) not between 80 and 20000
        and nullif(trim(skill_spec ->> 'instructionsMarkdown'), '') is not null then
        raise notice 'ETAPA 3: FALHA - instrucoes fora do tamanho aceito pela v2';
      end if;
      if definicao is not null and exists (
        select 1
        from jsonb_array_elements_text(
          case when jsonb_typeof(skill_spec -> 'allowedTools') = 'array'
            then skill_spec -> 'allowedTools' else '[]'::jsonb end
        ) item
        where strpos(definicao, '''' || item || '''') = 0
      ) then
        raise notice 'ETAPA 3: FALHA - a skill declara ferramenta que a v2 nao aceita';
      end if;
    end if;

  exception when others then
    raise notice 'ETAPA 2: FALHA - % (SQLSTATE %)', SQLERRM, SQLSTATE;
  end;
end;
$$;
