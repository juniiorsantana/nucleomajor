-- Empresa nova nasce com as habilidades que a Major tem.
--
-- `private.provision_intelligence` (20260905000000) cria os dois agentes
-- padrão de uma empresa nova, mas com os vínculos de antes da agenda externa:
-- o agente de clientes nasce com `pre-qualificacao`, `vendas`, `suporte` e
-- `agenda`, e sem `recepcao` nem `solicitacao-agenda`; o interno nasce só com
-- `agenda`, sem `tarefas`. As empresas daquela época receberam o resto por
-- inserts únicos (20260827130000) e pela sincronização da agenda
-- (20260827190000), que nenhum gatilho chama. Numa empresa nova, o dono só
-- chegava ao conjunto certo passando pelo modo Piloto.
--
-- Sem `recepcao`, o roteador `_v3` recusa todo turno de cliente
-- ("published reception skill is required for customer routing") e o cliente
-- final recebe "atendimento temporariamente indisponível". Com os planos de IA
-- à venda, isso deixa de ser teórico.
--
-- COMO: um gatilho novo, `organizations_provision_intelligence_vinculos`,
-- depois do que já existe (o Postgres dispara gatilhos do mesmo momento em
-- ordem alfabética; este nome vem depois). `private.provision_intelligence`
-- não é tocada — o hash dela, registrado em STATUS.md, continua valendo.
--
-- O conjunto é o mesmo que o Piloto e a sincronização montam, com as mesmas
-- prioridades:
--   interno  agenda 10, tarefas 20
--   clientes recepcao 10, pre-qualificacao 20, vendas 30, suporte 40,
--            solicitacao-agenda 50 — e sem agenda (a de clientes é a
--            solicitacao-agenda, que passa pela aprovação da equipe).
-- Habilidade não publicada é pulada, como na sincronização.
--
-- SÓ EMPRESA NOVA. Não há backfill: a Major e qualquer empresa que já existe
-- ficam exatamente como estão.
--
-- Não chama `intelligence_scheduling_bindings_sync`: ela exige gestão da
-- organização, e dentro do gatilho o dono ainda não é membro
-- (`create_organization` insere a empresa antes do membro).

begin;

-- ---------------------------------------------------------------------------
-- 1/3. Guardas.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('private.provision_intelligence(uuid, uuid)') is null then
    raise exception 'abortado: private.provision_intelligence nao existe';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'organizations_provision_intelligence'
      and tgrelid = 'public.organizations'::regclass
  ) then
    raise exception 'abortado: o gatilho organizations_provision_intelligence nao existe';
  end if;
  if to_regprocedure('private.provision_intelligence_vinculos(uuid, uuid)') is not null then
    raise exception 'abortado: private.provision_intelligence_vinculos ja existe; esta migration ja foi aplicada';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/3. Os vínculos.
-- ---------------------------------------------------------------------------
create function private.provision_intelligence_vinculos(target_organization uuid, actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  internal_profile uuid;
  customer_profile uuid;
begin
  select profile.id into internal_profile
  from public.assistant_profiles profile
  where profile.organization_id = target_organization
    and profile.audience = 'internal' and profile.is_default;
  select profile.id into customer_profile
  from public.assistant_profiles profile
  where profile.organization_id = target_organization
    and profile.audience = 'customer' and profile.is_default;

  if internal_profile is not null then
    insert into public.assistant_profile_skills (
      organization_id, profile_id, skill_id, enabled, priority, updated_by
    )
    select target_organization, internal_profile, skill.id, true, desejado.prioridade, actor
    from (values ('agenda', 10), ('tarefas', 20)) as desejado(slug, prioridade)
    join public.skill_definitions skill
      on skill.owner_type = 'platform'
     and skill.slug = desejado.slug
     and skill.status = 'published'
    on conflict (profile_id, skill_id) do update
      set enabled = true, priority = excluded.priority, updated_at = now();
  end if;

  if customer_profile is not null then
    delete from public.assistant_profile_skills binding
    using public.skill_definitions skill
    where binding.profile_id = customer_profile
      and binding.skill_id = skill.id
      and skill.owner_type = 'platform'
      and skill.slug = 'agenda';

    insert into public.assistant_profile_skills (
      organization_id, profile_id, skill_id, enabled, priority, updated_by
    )
    select target_organization, customer_profile, skill.id, true, desejado.prioridade, actor
    from (values
      ('recepcao', 10), ('pre-qualificacao', 20), ('vendas', 30),
      ('suporte', 40), ('solicitacao-agenda', 50)
    ) as desejado(slug, prioridade)
    join public.skill_definitions skill
      on skill.owner_type = 'platform'
     and skill.slug = desejado.slug
     and skill.status = 'published'
    on conflict (profile_id, skill_id) do update
      set enabled = true, priority = excluded.priority, updated_at = now();
  end if;
end;
$$;

create function private.provision_intelligence_vinculos_after_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.provision_intelligence_vinculos(new.id, new.created_by);
  return new;
end;
$$;

drop trigger if exists organizations_provision_intelligence_vinculos on public.organizations;
create trigger organizations_provision_intelligence_vinculos
after insert on public.organizations
for each row execute function private.provision_intelligence_vinculos_after_organization();

revoke all on function private.provision_intelligence_vinculos(uuid, uuid) from public, anon, authenticated;
revoke all on function private.provision_intelligence_vinculos_after_organization() from public, anon, authenticated;

comment on function private.provision_intelligence_vinculos(uuid, uuid) is
  'Da ao agente interno padrao agenda e tarefas, e ao de clientes recepcao, pre-qualificacao, vendas, suporte e solicitacao-agenda (sem agenda), com as prioridades do Piloto. So para empresa nova, pelo gatilho organizations_provision_intelligence_vinculos. Ver 20260921110000.';

-- ---------------------------------------------------------------------------
-- 3/3. Asserções.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'organizations_provision_intelligence_vinculos'
      and tgrelid = 'public.organizations'::regclass
      and not tgisinternal
  ) then
    raise exception 'conferencia: o gatilho novo precisa existir';
  end if;
  -- A ordem importa: o novo lê os agentes que o antigo acabou de criar.
  if 'organizations_provision_intelligence' >= 'organizations_provision_intelligence_vinculos' then
    raise exception 'conferencia: o gatilho novo precisa disparar depois do antigo';
  end if;
  if has_function_privilege('authenticated', 'private.provision_intelligence_vinculos(uuid, uuid)', 'execute') then
    raise exception 'conferencia: authenticated nao pode chamar provision_intelligence_vinculos';
  end if;
end $$;

commit;
