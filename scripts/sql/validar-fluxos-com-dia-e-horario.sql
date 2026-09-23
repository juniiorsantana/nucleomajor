-- Somente leitura. Rodar no SQL Editor depois de
-- 20260925110000_fluxos_com_dia_e_horario.sql.
--
-- `tudo_confere` precisa ser true. Depois desta migration, a conferência da
-- FASE 3 (validar-fluxos-execucao.sql) passa a acusar `hash_confere: false`
-- SÓ em flow_validate_expression — é a troca esperada, conferida aqui.
with esperado(function_name, body_hash) as (
  values ('flow_validate_expression', 'd4802306251edd07201fee25f9f6a07f')
), funcao as (
  select
    md5(replace(p.prosrc, chr(13), '')) as hash_corpo,
    coalesce(md5(replace(p.prosrc, chr(13), '')) = e.body_hash, false) as hash_confere,
    coalesce(not p.prosecdef, false) as sem_definer,
    coalesce(p.provolatile = 'i', false) as imutavel,
    coalesce(p.proconfig @> array['search_path=""'], false) as search_path_confere,
    coalesce(not has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_confere,
    coalesce(not has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_confere
  from esperado e
  left join pg_namespace n on n.nspname = 'private'
  left join pg_proc p on p.pronamespace = n.oid and p.proname = e.function_name
)
select jsonb_pretty(to_jsonb(funcao) || jsonb_build_object(
  'tudo_confere', hash_confere and sem_definer and imutavel and search_path_confere
    and anon_confere and authenticated_confere
)) as resultado
from funcao;

-- As duas regras novas precisam passar sem erro. Se a migration não estiver
-- aplicada, esta linha falha com "flow condition invalid".
select private.flow_validate_expression(
  '{"operador":"e","itens":[{"tipo":"dia_da_semana","dias":[1,2,3,4,5],"fuso":"America/Sao_Paulo"},{"tipo":"janela_de_horario","inicio":"08:00","fim":"18:00","fuso":"America/Sao_Paulo"}]}'::jsonb
) as regras_novas_aceitas;
