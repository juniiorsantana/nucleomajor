-- O fuso da organização (Etapa 4 do construtor, variante segura).
--
-- Decisão do dono (18/10/2026): cada regra de "Dias da semana" e "Horário"
-- continua guardando o PRÓPRIO `fuso`, obrigatório, como hoje
-- (20260925110000). O que muda é só o PADRÃO do editor: a regra nova nasce com
-- o fuso da empresa, e não mais com `America/Sao_Paulo` fixo no código.
-- Nenhum fluxo gravado muda de sentido e a VPS não lê esta coluna.
--
-- A coluna:
--
--   * `organizations.timezone`, padrão `America/Sao_Paulo` (toda empresa que já
--     existe fica nele, que é o padrão que o editor usava);
--   * aceita só os fusos de `FUSOS_DO_BRASIL` (`apps/emyleads/src/domain/regras.js`),
--     a mesma lista fechada que `private.flow_validate` confere nas regras. O
--     teste `fusoDaOrganizacao.test.js` falha se a lista daqui divergir da do
--     portal (marcadores `fusos:inicio`/`fusos:fim`).
--
-- Quem edita: o dono ou um administrador, pela policy `organizations_update`
-- que já existe (`private.can_manage_org`), em Minha conta › Organização. Nenhuma
-- função nova, nenhum grant novo: a escrita é o mesmo `update` que renomeia a
-- empresa, e o check abaixo recusa fuso fora da lista.
--
-- Idempotente: pode ser colada de novo sem efeito. Aplicar pelo SQL Editor;
-- ensaio trocando o `commit;` final por `rollback;`. Não depende de nenhuma
-- migration do batalhão de fluxos (só de 20260812130000). Prova:
-- scripts/sql/prova-fuso-da-organizacao.mjs. Desfazer:
-- scripts/sql/rollback-20261018130000-fuso-da-organizacao.sql.

begin;

alter table public.organizations
  add column if not exists timezone text not null default 'America/Sao_Paulo';

alter table public.organizations drop constraint if exists organizations_timezone_do_brasil;
alter table public.organizations add constraint organizations_timezone_do_brasil check (timezone in (
  -- fusos:inicio
  'America/Sao_Paulo',
  'America/Bahia',
  'America/Fortaleza',
  'America/Recife',
  'America/Maceio',
  'America/Belem',
  'America/Araguaina',
  'America/Santarem',
  'America/Manaus',
  'America/Cuiaba',
  'America/Campo_Grande',
  'America/Porto_Velho',
  'America/Boa_Vista',
  'America/Rio_Branco',
  'America/Eirunepe',
  'America/Noronha'
  -- fusos:fim
));

comment on column public.organizations.timezone is
  'Fuso da empresa (lista fechada FUSOS_DO_BRASIL). Só o padrão do editor de fluxos: cada regra de dia/horário guarda o próprio fuso.';

-- Conferência: falha aqui, e nada fica gravado, se o efeito não for o esperado.
do $$
declare
  sem_fuso bigint;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'timezone'
      and is_nullable = 'NO' and column_default like '''America/Sao_Paulo''%'
  ) then
    raise exception 'conferência: organizations.timezone não ficou como esperado';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_timezone_do_brasil'
                 and conrelid = 'public.organizations'::regclass) then
    raise exception 'conferência: falta o check organizations_timezone_do_brasil';
  end if;
  select count(*) into sem_fuso from public.organizations where timezone is null;
  if sem_fuso > 0 then
    raise exception 'conferência: % empresas sem fuso', sem_fuso;
  end if;
  raise notice 'fuso da organização: % empresas, todas em %', (select count(*) from public.organizations),
    (select string_agg(distinct timezone, ', ') from public.organizations);
end $$;

commit;
