-- Prova COMPORTAMENTAL das regras da FASE C (agente padrão explícito).
--
-- NUNCA rode isto em produção. O script insere perfis de mentira para provar
-- que as constraints rejeitam o que devem rejeitar. Ele termina em ROLLBACK,
-- mas mesmo assim: gatilhos de auditoria disparam, sequências avançam, e um
-- erro de digitação num `commit` transformaria um teste em dado sujo. Use um
-- Postgres descartável (`supabase start`, ou uma cópia restaurada).
--
-- Os testes estruturais em test/agent-default-migration.test.mjs provam que a
-- migration DECLARA as regras certas. Este script prova que o Postgres as
-- APLICA. São coisas diferentes, e a segunda só dá para verificar com banco.
--
-- Rodar depois de aplicar 20260904190000_agente_padrao_explicito.sql.

begin;

do $$
declare
  org uuid;
  ator uuid;
  modelo uuid;
  perfil_extra uuid;
begin
  select organization_id into org from public.assistant_profiles limit 1;
  if org is null then
    raise exception 'este banco nao tem nenhum assistant_profile; nada a provar';
  end if;
  select created_by into ator from public.assistant_profiles where organization_id = org limit 1;
  select template_id into modelo from public.assistant_profiles where organization_id = org limit 1;

  -- ---------------------------------------------------------------------
  -- I: a unique antiga ainda impede um segundo agente da mesma audience.
  -- ---------------------------------------------------------------------
  begin
    insert into public.assistant_profiles (organization_id, template_id, audience, display_name, created_by, updated_by)
    values (org, modelo, 'customer', 'Segundo agente de cliente', ator, ator);
    raise exception 'FALHOU: a unique (organization_id, audience) deixou criar um segundo agente de customer';
  exception when unique_violation then
    raise notice 'ok I: dois agentes da mesma audience continuam impossiveis';
  end;

  -- ---------------------------------------------------------------------
  -- K: slug repetido na mesma organizacao e rejeitado.
  -- ---------------------------------------------------------------------
  -- Como a unique antiga ja bloqueia audience repetida, para isolar o slug
  -- usamos a audience que sobrou, com o slug da outra.
  begin
    insert into public.assistant_profiles (organization_id, template_id, audience, display_name, slug, created_by, updated_by)
    select org, modelo,
           case when p.audience = 'customer' then 'internal' else 'customer' end,
           'Colisao de slug', p.slug, ator, ator
    from public.assistant_profiles p
    where p.organization_id = org
    limit 1;
    raise exception 'FALHOU: dois perfis da mesma organizacao aceitaram o mesmo slug';
  exception when unique_violation then
    raise notice 'ok K: slug repetido na mesma organizacao e rejeitado';
  end;

  -- ---------------------------------------------------------------------
  -- F: agente novo nasce is_default = false.
  -- ---------------------------------------------------------------------
  -- Precisa de uma organizacao sem perfil daquela audience; como a unique
  -- antiga impede, provamos pelo default declarado da coluna em vez de por
  -- insert. Ver test/agent-default-migration.test.mjs contrato F.
  if (
    select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'assistant_profiles' and column_name = 'is_default'
  ) is distinct from 'false' then
    raise exception 'FALHOU: is_default nao nasce false';
  end if;
  raise notice 'ok F: is_default nasce false';

  -- ---------------------------------------------------------------------
  -- D: dois padroes na mesma organizacao + audience sao rejeitados.
  -- ---------------------------------------------------------------------
  -- A unique antiga impediria o insert antes do indice parcial agir, entao
  -- provamos o indice do jeito que ele sera exercitado na FASE E: soltando
  -- a unique antiga DENTRO desta transacao, que termina em rollback.
  alter table public.assistant_profiles drop constraint assistant_profiles_organization_id_audience_key;

  insert into public.assistant_profiles (organization_id, template_id, audience, display_name, slug, created_by, updated_by, is_default)
  values (org, modelo, 'customer', 'Agente sem padrao', 'agente-sem-padrao', ator, ator, false)
  returning id into perfil_extra;
  raise notice 'ok E/pre: um segundo agente de customer nao-padrao convive com o padrao';

  begin
    update public.assistant_profiles set is_default = true where id = perfil_extra;
    raise exception 'FALHOU: o indice parcial deixou existir dois agentes padrao na mesma audience';
  exception when unique_violation then
    raise notice 'ok D: so um agente padrao por organizacao + audience';
  end;

  -- ---------------------------------------------------------------------
  -- E: padrao de customer e padrao de internal convivem.
  -- ---------------------------------------------------------------------
  if (
    select count(*) from public.assistant_profiles
    where organization_id = org and is_default
  ) <> 2 then
    raise exception 'FALHOU: esperava um padrao de internal e um de customer convivendo';
  end if;
  raise notice 'ok E: padrao de customer e padrao de internal convivem';

  raise notice 'todas as provas comportamentais passaram; desfazendo tudo';
end $$;

rollback;
