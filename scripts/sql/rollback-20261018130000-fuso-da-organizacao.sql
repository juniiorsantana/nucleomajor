-- Desfaz 20261018130000_fuso_da_organizacao.sql. Colar no SQL Editor.
--
-- Perde o fuso que cada empresa escolheu (não há outro lugar que o guarde).
-- As regras dos fluxos não mudam: cada uma guarda o próprio fuso.
-- O portal novo continua abrindo sem a coluna: lê `timezone` como ausente e
-- volta ao padrão America/Sao_Paulo; só o salvar do fuso passa a falhar.

begin;

alter table public.organizations drop constraint if exists organizations_timezone_do_brasil;
alter table public.organizations drop column if exists timezone;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'organizations' and column_name = 'timezone') then
    raise exception 'conferência: organizations.timezone continua lá';
  end if;
end $$;

commit;
