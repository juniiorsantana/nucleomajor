-- Fluxos com caminhos: condição por dia da semana e por horário.
--
-- Duas regras novas dentro de uma condição (e das Condições de entrada):
--   {"tipo":"dia_da_semana","dias":[1,2,3,4,5],"fuso":"America/Sao_Paulo"}
--   {"tipo":"janela_de_horario","inicio":"08:00","fim":"18:00","fuso":"America/Sao_Paulo"}
-- Domingo = 0. `fim` menor que `inicio` é janela que vira a noite; iguais é
-- recusado.
--
-- O fuso mora na regra, numa lista fechada com os fusos do Brasil. O mesmo
-- fluxo é avaliado no navegador e na VPS (UTC): ler o fuso do ambiente daria
-- respostas diferentes para "são 8h?". Lista fechada porque esta função é
-- imutável e não pode consultar o catálogo de fusos.
--
-- Quem AVALIA a regra é o executor da VPS (`chatbot_runtime._condition_matches`)
-- e o portal (`domain/regras.js`). O banco só confere o formato, aqui, antes
-- de uma conversa começar o fluxo. Por isso só esta função muda; o resto da
-- execução durável (20260907010000) fica como está.
--
-- A regra só pode ser usada depois que a release da VPS que a avalia estiver
-- no ar: o editor só a oferece no formato com caminhos, que só a Major tem.
--
-- Aplicar pelo SQL Editor. Conferir com scripts/sql/validar-fluxos-com-dia-e-horario.sql.

begin;

create or replace function private.flow_validate_expression(expression jsonb, depth integer default 0) returns void
language plpgsql immutable set search_path = '' as $$
declare children jsonb; child jsonb; kind text; identifier text;
begin
  if depth > 8 or expression is null then raise exception 'flow condition invalid'; end if;
  if jsonb_typeof(expression)='array' then children:=expression;
  elsif jsonb_typeof(expression)='object' and expression ? 'operador' then
    if expression->>'operador' is null or expression->>'operador' not in ('e','ou') then
      raise exception 'flow condition invalid';
    end if;
    children:=expression->'itens';
    if jsonb_typeof(children) is distinct from 'array' then raise exception 'flow condition invalid'; end if;
  elsif jsonb_typeof(expression)='object' then
    kind:=expression->>'tipo';
    if kind is null or kind not in ('tem_etiqueta','estagio_atual','primeira_conversa','tarefa_atrasada','sem_interacao_ha',
      'dia_da_semana','janela_de_horario') then
      raise exception 'flow condition invalid';
    end if;
    if kind in ('tem_etiqueta','estagio_atual') then
      identifier:=expression->>case when kind='tem_etiqueta' then 'etiquetaId' else 'stageId' end;
      if identifier is null or identifier !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'flow condition invalid';
      end if;
    end if;
    if kind='sem_interacao_ha' and (jsonb_typeof(expression->'dias') is distinct from 'number'
      or coalesce(expression->>'dias','') !~ '^[0-9]{1,9}$') then raise exception 'flow condition invalid'; end if;
    if kind in ('dia_da_semana','janela_de_horario') and coalesce(expression->>'fuso','') not in (
      'America/Sao_Paulo','America/Bahia','America/Fortaleza','America/Recife','America/Maceio','America/Belem',
      'America/Araguaina','America/Santarem','America/Manaus','America/Cuiaba','America/Campo_Grande',
      'America/Porto_Velho','America/Boa_Vista','America/Rio_Branco','America/Eirunepe','America/Noronha') then
      raise exception 'flow condition invalid';
    end if;
    if kind='dia_da_semana' and (jsonb_typeof(expression->'dias') is distinct from 'array'
      or jsonb_array_length(expression->'dias') not between 1 and 7
      or exists(select 1 from jsonb_array_elements(expression->'dias') d
        where jsonb_typeof(d) is distinct from 'number' or d::text !~ '^[0-6]$')
      or (select count(distinct d::text) from jsonb_array_elements(expression->'dias') d)
        <> jsonb_array_length(expression->'dias')) then
      raise exception 'flow condition invalid';
    end if;
    if kind='janela_de_horario' and (coalesce(expression->>'inicio','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or coalesce(expression->>'fim','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or expression->>'inicio'=expression->>'fim') then
      raise exception 'flow condition invalid';
    end if;
    return;
  else raise exception 'flow condition invalid';
  end if;
  if jsonb_array_length(children) not between 1 and 100 then raise exception 'flow condition invalid'; end if;
  for child in select jsonb_array_elements(children) loop
    perform private.flow_validate_expression(child,depth+1);
  end loop;
end;
$$;

commit;
