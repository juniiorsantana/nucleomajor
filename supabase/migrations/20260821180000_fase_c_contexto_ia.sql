    -- Fase C: a IA conhece a organização sob uma credencial de leitura por
    -- conexão. Nenhum token é guardado no banco; esta migration registra somente
    -- a identidade Auth do robô e o vínculo que as policies conferem.

    begin;

    alter table public.organization_members
      add column if not exists responsibility text not null default '';

    alter table public.organization_members
      add constraint organization_members_responsibility_length
      check (length(responsibility) <= 1000);

    create table public.connection_robot_credentials (
      connection_id uuid primary key,
      organization_id uuid not null,
      auth_user_id uuid not null unique references auth.users(id) on delete cascade,
      status text not null default 'active' check (status in ('active', 'revoked')),
      created_by uuid references public.profiles(id),
      created_at timestamptz not null default now(),
      last_used_at timestamptz,
      revoked_at timestamptz,
      foreign key (connection_id, organization_id)
        references public.whatsapp_connections(id, organization_id) on delete cascade,
      check (
        (status = 'active' and revoked_at is null)
        or (status = 'revoked' and revoked_at is not null)
      )
    );

    create index connection_robot_credentials_org_idx
      on public.connection_robot_credentials (organization_id, status);

    alter table public.connection_robot_credentials enable row level security;
    revoke all on public.connection_robot_credentials from anon;
    grant select on public.connection_robot_credentials to authenticated;

    create policy connection_robot_credentials_select
    on public.connection_robot_credentials for select to authenticated
    using (private.can_manage_org(organization_id));

    create or replace function private.is_robot()
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $$
      select coalesce(
        auth.jwt() -> 'app_metadata' ->> 'is_robot' = 'true'
        and nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id', '') is not null
        and nullif(auth.jwt() -> 'app_metadata' ->> 'connection_id', '') is not null,
        false
      );
    $$;

    create or replace function private.robot_organization()
    returns uuid
    language sql
    stable
    security definer
    set search_path = ''
    as $$
      select r.organization_id
      from public.connection_robot_credentials r
      join public.whatsapp_connections c
        on c.id = r.connection_id
       and c.organization_id = r.organization_id
      where private.is_robot()
        and r.auth_user_id = auth.uid()
        and r.status = 'active'
        and r.revoked_at is null
        and c.status <> 'revoked'
        and c.revoked_at is null
        and r.organization_id::text = auth.jwt() -> 'app_metadata' ->> 'organization_id'
        and r.connection_id::text = auth.jwt() -> 'app_metadata' ->> 'connection_id'
      limit 1;
    $$;

    create or replace function private.robot_can_access(target_organization uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $$
      select coalesce(private.robot_organization() = target_organization, false);
    $$;

    revoke all on function private.is_robot() from public;
    revoke all on function private.robot_organization() from public;
    revoke all on function private.robot_can_access(uuid) from public;
    grant execute on function private.is_robot() to authenticated;
    grant execute on function private.robot_organization() to authenticated;
    grant execute on function private.robot_can_access(uuid) to authenticated;

    -- Mesmo se uma identidade de robô for inserida por engano em
    -- organization_members, ela continua fora de todas as policies humanas.
    create or replace function private.is_org_member(target_organization uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $$
      select not private.is_robot() and exists (
        select 1 from public.organization_members m
        where m.organization_id = target_organization
          and m.user_id = auth.uid()
          and m.status = 'active'
      );
    $$;

    create or replace function private.org_role(target_organization uuid)
    returns public.organization_role
    language sql
    stable
    security definer
    set search_path = ''
    as $$
      select case when private.is_robot() then null else (
        select m.role from public.organization_members m
        where m.organization_id = target_organization
          and m.user_id = auth.uid()
          and m.status = 'active'
      ) end;
    $$;

    create or replace function private.can_manage_org(target_organization uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $$
      select not private.is_robot()
        and coalesce(private.org_role(target_organization) in ('owner', 'admin'), false);
    $$;

    -- O robô não lê nem o próprio perfil sintético. Informações do profissional
    -- selecionado chegam somente por nucleo_agent_context, já sanitizadas.
    drop policy if exists profiles_select on public.profiles;
    create policy profiles_select on public.profiles for select to authenticated
    using (
      not private.is_robot()
      and (
        id = auth.uid() or exists (
          select 1
          from public.organization_members mine
          join public.organization_members theirs using (organization_id)
          where mine.user_id = auth.uid() and mine.status = 'active'
            and theirs.user_id = profiles.id and theirs.status = 'active'
        )
      )
    );

    drop policy if exists profiles_update_self on public.profiles;
    create policy profiles_update_self on public.profiles for update to authenticated
    using (not private.is_robot() and id = auth.uid())
    with check (not private.is_robot() and id = auth.uid());

    -- Policies somente de SELECT. As policies humanas continuam existindo; como
    -- policies permissivas somam por OR, estas acrescentam apenas o caminho do
    -- robô validado sem ampliar escrita.
    create policy contacts_robot_select on public.contacts for select to authenticated
    using (private.robot_can_access(organization_id));
    create policy contact_tags_robot_select on public.contact_tags for select to authenticated
    using (private.robot_can_access(organization_id));
    create policy tags_robot_select on public.tags for select to authenticated
    using (private.robot_can_access(organization_id));
    create policy deals_robot_select on public.deals for select to authenticated
    using (private.robot_can_access(organization_id));
    create policy stages_robot_select on public.stages for select to authenticated
    using (private.robot_can_access(organization_id));
    create policy tasks_robot_select on public.tasks for select to authenticated
    using (private.robot_can_access(organization_id));
    create policy contact_events_robot_select on public.contact_events for select to authenticated
    using (private.robot_can_access(organization_id));

    -- Fecha as duas funções SECURITY DEFINER que aceitavam qualquer identidade
    -- autenticada. As demais funções de gestão já passam por can_manage_org, que
    -- agora recusa robôs explicitamente.
    create or replace function public.create_organization(organization_name text)
    returns uuid
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      organization_id uuid := extensions.gen_random_uuid();
      organization_slug text;
    begin
      if private.is_robot() then
        raise exception 'robot credentials cannot manage organizations';
      end if;
      if auth.uid() is null then raise exception 'authentication required'; end if;
      if length(trim(organization_name)) < 2 then raise exception 'invalid organization name'; end if;

      organization_slug := trim(both '-' from regexp_replace(lower(trim(organization_name)), '[^a-z0-9]+', '-', 'g'))
        || '-' || substr(organization_id::text, 1, 8);

      insert into public.organizations (id, name, slug, created_by)
      values (organization_id, trim(organization_name), organization_slug, auth.uid());
      insert into public.organization_members (organization_id, user_id, role)
      values (organization_id, auth.uid(), 'owner');

      insert into public.stages (organization_id, legacy_id, name, position, created_by, updated_by)
      values
        (organization_id, 'novo-lead', 'Novo lead', 0, auth.uid(), auth.uid()),
        (organization_id, 'contato', 'Contato', 1, auth.uid(), auth.uid()),
        (organization_id, 'qualificacao', 'Qualificação', 2, auth.uid(), auth.uid()),
        (organization_id, 'proposta', 'Proposta', 3, auth.uid(), auth.uid()),
        (organization_id, 'negociacao', 'Negociação', 4, auth.uid(), auth.uid()),
        (organization_id, 'fechado', 'Fechado', 5, auth.uid(), auth.uid());

      insert into public.tags (organization_id, legacy_id, name, color, created_by, updated_by)
      values
        (organization_id, 'cliente', 'Cliente', '#147A52', auth.uid(), auth.uid()),
        (organization_id, 'lead-quente', 'Lead quente', '#C0362C', auth.uid(), auth.uid()),
        (organization_id, 'indicacao', 'Indicação', '#0A7CD4', auth.uid(), auth.uid()),
        (organization_id, 'sem-interesse', 'Sem interesse', '#626B7A', auth.uid(), auth.uid());

      return organization_id;
    end;
    $$;

    create or replace function public.accept_organization_invite(target_token text)
    returns uuid
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      convite public.organization_invites%rowtype;
      email_atual text;
      confirmado timestamptz;
    begin
      if private.is_robot() then
        raise exception 'robot credentials cannot manage organizations';
      end if;
      if auth.uid() is null then raise exception 'authentication required'; end if;

      select lower(trim(u.email)), u.email_confirmed_at
        into email_atual, confirmado
      from auth.users u
      where u.id = auth.uid();

      select * into convite
      from public.organization_invites
      where token_hash = encode(extensions.digest(target_token, 'sha256'), 'hex')
        and accepted_at is null and expires_at > now()
      for update;
      if convite.id is null then raise exception 'invite invalid or expired'; end if;
      if email_atual is null or confirmado is null then
        raise exception 'a confirmed email is required to accept an invite';
      end if;
      if email_atual <> lower(trim(convite.email)) then
        raise exception 'invite issued for a different email';
      end if;

      insert into public.organization_members (organization_id, user_id, role)
      values (convite.organization_id, auth.uid(), convite.role)
      on conflict (organization_id, user_id) do update set status = 'active', role = excluded.role;
      update public.organization_invites set accepted_at = now() where id = convite.id;
      return convite.organization_id;
    end;
    $$;

    create or replace function public.update_member_responsibility(
      target_organization uuid,
      target_user uuid,
      new_responsibility text
    )
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $$
    begin
      if private.is_robot() then
        raise exception 'robot credentials cannot manage members';
      end if;
      if not private.can_manage_org(target_organization) then
        raise exception 'organization management required';
      end if;
      if length(trim(coalesce(new_responsibility, ''))) > 1000 then
        raise exception 'responsibility is too long';
      end if;

      update public.organization_members
      set responsibility = trim(coalesce(new_responsibility, ''))
      where organization_id = target_organization and user_id = target_user;
      if not found then raise exception 'member not found'; end if;
    end;
    $$;

    create or replace function public.revoke_connection_robot(target_connection uuid)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      target_organization uuid;
    begin
      if private.is_robot() then
        raise exception 'robot credentials cannot revoke credentials';
      end if;
      select organization_id into target_organization
      from public.connection_robot_credentials
      where connection_id = target_connection;
      if target_organization is null then raise exception 'robot credential not found'; end if;
      if not private.can_manage_org(target_organization) then
        raise exception 'organization management required';
      end if;

      update public.connection_robot_credentials
      set status = 'revoked', revoked_at = now()
      where connection_id = target_connection and status = 'active';
    end;
    $$;

    create or replace function public.nucleo_agent_context(selected_agent uuid default null)
    returns table (
      organization_id uuid,
      organization_name text,
      connection_id uuid,
      connection_name text,
      agent_id uuid,
      agent_name text,
      agent_role public.organization_role,
      responsibility text,
      team jsonb
    )
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      robot_org uuid := private.robot_organization();
      robot_connection uuid;
    begin
      if robot_org is null then
        raise exception 'robot credential is inactive or connection was revoked';
      end if;
      select r.connection_id into robot_connection
      from public.connection_robot_credentials r
      where r.auth_user_id = auth.uid() and r.organization_id = robot_org and r.status = 'active';

      if selected_agent is not null and not exists (
        select 1 from public.organization_members m
        where m.organization_id = robot_org and m.user_id = selected_agent and m.status = 'active'
      ) then
        raise exception 'selected agent is not an active member of this organization';
      end if;

      update public.connection_robot_credentials credential
      set last_used_at = now()
      where credential.connection_id = robot_connection
        and credential.auth_user_id = auth.uid();

      return query
      select
        o.id,
        o.name,
        c.id,
        c.name,
        m.user_id,
        p.full_name,
        m.role,
        coalesce(m.responsibility, ''),
        (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', member.user_id,
                'nome', profile.full_name,
                'papel', member.role,
                'responsabilidade', coalesce(member.responsibility, '')
              ) order by coalesce(profile.full_name, ''), member.user_id
            ),
            '[]'::jsonb
          )
          from public.organization_members member
          left join public.profiles profile on profile.id = member.user_id
          where member.organization_id = o.id and member.status = 'active'
        )
      from public.organizations o
      join public.whatsapp_connections c
        on c.id = robot_connection and c.organization_id = o.id
      left join public.organization_members m
        on m.organization_id = o.id and m.user_id = selected_agent and m.status = 'active'
      left join public.profiles p on p.id = m.user_id
      where o.id = robot_org;
    end;
    $$;

    create or replace function public.nucleo_calendar_list(
      selected_agent uuid,
      range_start timestamptz,
      range_end timestamptz
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      robot_org uuid := private.robot_organization();
      events_payload jsonb;
      tasks_payload jsonb;
    begin
      if robot_org is null then
        raise exception 'robot credential is inactive or connection was revoked';
      end if;
      if range_end <= range_start or range_end - range_start > interval '62 days' then
        raise exception 'calendar range must be positive and at most 62 days';
      end if;
      if selected_agent is not null and not exists (
        select 1 from public.organization_members m
        where m.organization_id = robot_org and m.user_id = selected_agent and m.status = 'active'
      ) then
        raise exception 'selected agent is not an active member of this organization';
      end if;

      select coalesce(jsonb_agg(item order by item ->> 'inicio'), '[]'::jsonb)
      into events_payload
      from (
        select jsonb_build_object(
          'id', e.id,
          'fonte', 'evento',
          'titulo', case
            when e.visibility = 'organization' or e.owner_id = selected_agent then e.title
            else 'Indisponível'
          end,
          'descricao', case
            when e.visibility = 'organization' or e.owner_id = selected_agent then e.description
            else ''
          end,
          'inicio', e.starts_at,
          'fim', e.ends_at,
          'diaInteiro', e.all_day,
          'tipo', e.kind,
          'visibilidade', e.visibility,
          'responsavelId', e.owner_id,
          'responsavelNome', p.full_name,
          'contatoId', e.contact_id
        ) as item
        from public.calendar_events e
        join public.profiles p on p.id = e.owner_id
        where e.organization_id = robot_org
          and e.deleted_at is null
          and e.status = 'scheduled'
          and e.starts_at < range_end
          and e.ends_at > range_start
      ) eventos;

      select coalesce(jsonb_agg(item order by item ->> 'inicio'), '[]'::jsonb)
      into tasks_payload
      from (
        select jsonb_build_object(
          'id', t.id,
          'fonte', 'tarefa',
          'titulo', t.title,
          'inicio', t.due_at,
          'fim', t.due_at + interval '30 minutes',
          'concluida', t.completed,
          'responsavelId', t.owner_id,
          'responsavelNome', coalesce(p.full_name, t.owner_label),
          'contatoId', t.contact_id,
          'negocioId', t.deal_id
        ) as item
        from public.tasks t
        left join public.profiles p on p.id = t.owner_id
        where t.organization_id = robot_org
          and t.deleted_at is null
          and t.due_at is not null
          and t.due_at >= range_start
          and t.due_at < range_end
      ) tarefas;

      update public.connection_robot_credentials
      set last_used_at = now()
      where auth_user_id = auth.uid() and organization_id = robot_org and status = 'active';

      return jsonb_build_object(
        'organizationId', robot_org,
        'selectedAgentId', selected_agent,
        'periodo', jsonb_build_object('de', range_start, 'ate', range_end),
        'eventos', events_payload,
        'tarefas', tasks_payload
      );
    end;
    $$;

    revoke all on function public.update_member_responsibility(uuid, uuid, text) from public;
    revoke all on function public.revoke_connection_robot(uuid) from public;
    revoke all on function public.nucleo_agent_context(uuid) from public;
    revoke all on function public.nucleo_calendar_list(uuid, timestamptz, timestamptz) from public;
    grant execute on function public.update_member_responsibility(uuid, uuid, text) to authenticated;
    grant execute on function public.revoke_connection_robot(uuid) to authenticated;
    grant execute on function public.nucleo_agent_context(uuid) to authenticated;
    grant execute on function public.nucleo_calendar_list(uuid, timestamptz, timestamptz) to authenticated;

    commit;
