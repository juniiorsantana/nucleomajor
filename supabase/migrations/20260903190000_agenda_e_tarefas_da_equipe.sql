-- A agenda da equipe: quem cria evento da empresa, e quem é responsável pela tarefa.
--
-- Duas decisões do cliente em 03/09/2026, e um defeito silencioso que apareceu
-- ao diagnosticá-las.
--
-- 1. QUALQUER MEMBRO CRIA EVENTO DA EMPRESA. Até aqui `calendar_events_insert`
--    exigia dono ou administrador para `visibility = 'organization'`, e foi o
--    que barrou o Lucas. Abrir a criação NÃO abre a edição: quem criou, mais
--    dono e administrador, seguem sendo os únicos que editam e excluem. Antes
--    desta migration o evento corporativo era editável por qualquer gestor e
--    por mais ninguém — agora o autor entra nessa lista, senão quem acabou de
--    criar não conseguiria corrigir o próprio horário.
--
-- 2. TAREFA TEM MAIS DE UM RESPONSÁVEL, e aparece na faixa de CADA um. É o que
--    faz a faixa vazia significar "essa pessoa está livre", que é o motivo de a
--    visão por pessoa existir. `tasks.owner_id` continua existindo como
--    responsável principal — é dele que saem os lembretes e o nome no bloco —,
--    e `task_assignees` passa a ser a lista completa.
--
-- O defeito silencioso: `tasks.owner_id` já existia desde
-- `20260821150000_agenda_compartilhada.sql` e é o que a agenda lê, mas a tela
-- gravava só `owner_label`, texto livre. Toda tarefa caía no criador e o nome
-- digitado era enfeite. O backfill abaixo não conserta o passado (não há como
-- adivinhar quem "Lucas" era), mas garante que toda tarefa já existente tenha
-- ao menos uma linha em `task_assignees`, para a agenda não perder tarefa
-- nenhuma quando passar a ler daqui.

begin;

-- -------------------------------------------------------------------------
-- Os responsáveis da tarefa

create table if not exists public.task_assignees (
  task_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (task_id, user_id),
  foreign key (task_id, organization_id)
    references public.tasks(id, organization_id) on delete cascade
);

comment on table public.task_assignees is
  'Responsáveis de uma tarefa. tasks.owner_id segue sendo o principal (lembretes e nome no bloco); esta tabela é a lista inteira.';

-- A agenda varre por pessoa e por organização; a chave primária só serve para
-- o caminho contrário (dada a tarefa, quem responde por ela).
create index if not exists task_assignees_user_idx
  on public.task_assignees (organization_id, user_id);

insert into public.task_assignees (task_id, organization_id, user_id, created_by)
select t.id, t.organization_id, coalesce(t.owner_id, t.created_by), t.created_by
from public.tasks t
where t.deleted_at is null
  and coalesce(t.owner_id, t.created_by) is not null
on conflict do nothing;

alter table public.task_assignees enable row level security;

-- Espelha `tasks_all`: quem enxerga a tarefa enxerga quem responde por ela.
-- Uma regra mais estreita aqui deixaria a tarefa visível e os responsáveis
-- invisíveis, e a agenda mostraria a faixa da pessoa errada.
drop policy if exists task_assignees_all on public.task_assignees;
create policy task_assignees_all on public.task_assignees for all to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

grant select, insert, update, delete on public.task_assignees to authenticated;

-- -------------------------------------------------------------------------
-- Evento da empresa: todo mundo cria, só o autor e a gestão editam

drop policy if exists calendar_events_insert on public.calendar_events;
create policy calendar_events_insert on public.calendar_events
for insert to authenticated
with check (
  private.is_org_member(organization_id)
  and created_by = auth.uid()
  and (
    (visibility = 'personal' and owner_id = auth.uid())
    or visibility = 'organization'
  )
);

drop policy if exists calendar_events_update on public.calendar_events;
create policy calendar_events_update on public.calendar_events
for update to authenticated
using (
  private.is_org_member(organization_id)
  and (
    (visibility = 'personal' and owner_id = auth.uid())
    or (visibility = 'organization'
        and (created_by = auth.uid() or private.can_manage_org(organization_id)))
  )
)
with check (
  private.is_org_member(organization_id)
  and (
    (visibility = 'personal' and owner_id = auth.uid())
    or (visibility = 'organization'
        and (created_by = auth.uid() or private.can_manage_org(organization_id)))
  )
);

drop policy if exists calendar_events_delete on public.calendar_events;
create policy calendar_events_delete on public.calendar_events
for delete to authenticated
using (
  private.is_org_member(organization_id)
  and (
    (visibility = 'personal' and owner_id = auth.uid())
    or (visibility = 'organization'
        and (created_by = auth.uid() or private.can_manage_org(organization_id)))
  )
);

comment on policy calendar_events_insert on public.calendar_events is
  'Todo membro cria evento da empresa; evento pessoal só para si mesmo.';
comment on policy calendar_events_update on public.calendar_events is
  'Evento pessoal só o dono edita; evento da empresa, quem criou mais dono/admin.';
comment on policy calendar_events_delete on public.calendar_events is
  'Evento pessoal só o dono exclui; evento da empresa, quem criou mais dono/admin.';

commit;

-- -------------------------------------------------------------------------
-- Os RPCs que a tela lê

begin;

-- `members` ganha a cor escolhida e o nome curto.
--
-- Sem isso a agenda derivava a cor do id em `agendaUtils.corDaPessoa` e
-- ignorava `profiles.color` — a mesma pessoa era roxa na Equipe e nas
-- Conversas e verde na agenda. A cor não vem por participação e sim por
-- perfil, porque a pessoa não muda de cor ao trocar de empresa
-- (`20260829120000_perfil_pessoal.sql`). Nulo continua querendo dizer "não
-- escolheu", e é a interface que deriva.
create or replace function public.calendar_context(target_organization uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not private.is_org_member(target_organization) then
    raise exception 'organization access denied';
  end if;

  insert into public.calendar_member_preferences (organization_id, user_id)
  values (target_organization, auth.uid())
  on conflict (organization_id, user_id) do nothing;

  select jsonb_build_object(
    'calendar', jsonb_build_object(
      'organizationId', calendar.organization_id,
      'displayName', calendar.display_name,
      'timezone', calendar.timezone,
      'dayStart', calendar.day_start,
      'dayEnd', calendar.day_end,
      'googleEnabled', calendar.enabled
    ),
    'preference', jsonb_build_object(
      'timezone', preference.timezone,
      'dayStart', preference.day_start,
      'dayEnd', preference.day_end,
      'defaultView', preference.default_view,
      'defaultReminderMinutes', preference.default_reminder_minutes,
      'inAppEnabled', preference.in_app_enabled,
      'whatsappEnabled', preference.whatsapp_enabled,
      'phoneLast4', preference.phone_last4,
      'phoneVerified', preference.phone_verified_at is not null
    ),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', member.user_id,
        'name', profile.full_name,
        'displayName', profile.display_name,
        'color', profile.color,
        'role', member.role,
        'responsibility', coalesce(member.responsibility, ''),
        'phoneVerified', case when member.user_id = auth.uid()
          then own_preference.phone_verified_at is not null else null end
      ) order by profile.full_name), '[]'::jsonb)
      from public.organization_members member
      join public.profiles profile on profile.id = member.user_id
      left join public.calendar_member_preferences own_preference
        on own_preference.organization_id = member.organization_id
       and own_preference.user_id = member.user_id
      where member.organization_id = target_organization and member.status = 'active'
    ),
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', category.id,
        'name', category.name,
        'color', category.color,
        'position', category.position
      ) order by category.position, category.name), '[]'::jsonb)
      from public.calendar_categories category
      where category.organization_id = target_organization and category.active
    )
  ) into result
  from public.organization_calendars calendar
  join public.calendar_member_preferences preference
    on preference.organization_id = calendar.organization_id
   and preference.user_id = auth.uid()
  where calendar.organization_id = target_organization;

  return result;
end;
$$;

-- `calendar_events_list` ganha `assignee_ids`.
--
-- Uma LINHA por tarefa, com a lista de responsáveis dentro — e não uma linha
-- por responsável. A diferença importa: a visão de mês e a de lista mostram a
-- tarefa uma vez só, e é a visão por pessoa que a repete numa faixa de cada
-- um. Devolver a tarefa duplicada faria o mês mostrá-la três vezes para
-- resolver um problema que só existe na grade por pessoa.
--
-- Para evento, `assignee_ids` é o próprio dono. Assim a tela tem um caminho só
-- para "de quem é este bloco" e não precisa perguntar o tipo antes.
--
-- O tipo de retorno muda, e por isso é `drop` e não `create or replace`.
drop function if exists public.calendar_events_list(uuid, timestamptz, timestamptz);

create function public.calendar_events_list(
  target_organization uuid,
  range_start timestamptz,
  range_end timestamptz
)
returns table (
  id uuid,
  source_type text,
  task_id uuid,
  organization_id uuid,
  owner_id uuid,
  owner_name text,
  assignee_ids uuid[],
  title text,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean,
  kind text,
  visibility text,
  contact_id uuid,
  status text,
  google_event_id text,
  google_calendar_id text,
  category_id uuid,
  category_name text,
  category_color text,
  location text,
  tags text[],
  reminder_minutes integer[]
)
language sql
security definer
set search_path = ''
as $$
  select
    event.id,
    'event'::text,
    null::uuid,
    event.organization_id,
    event.owner_id,
    profile.full_name,
    array[event.owner_id],
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then event.title else 'Indisponível' end,
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then event.description else '' end,
    event.starts_at,
    event.ends_at,
    event.all_day,
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then event.kind else 'blocked' end,
    event.visibility,
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then event.contact_id else null end,
    event.status,
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then event.google_event_id else null end,
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then event.google_calendar_id else null end,
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then event.category_id else null end,
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then category.name else null end,
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then category.color else '#CBD5E1' end,
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then event.location else '' end,
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then event.tags else '{}'::text[] end,
    case when event.owner_id = auth.uid()
      then event.reminder_minutes else '{}'::integer[] end
  from public.calendar_events event
  join public.profiles profile on profile.id = event.owner_id
  join public.calendar_categories category on category.id = event.category_id
  where event.organization_id = target_organization
    and event.deleted_at is null
    and event.status in ('scheduled', 'tentative')
    and event.starts_at < range_end
    and event.ends_at > range_start
    and private.is_org_member(target_organization)

  union all

  select
    task.id,
    'task'::text,
    task.id,
    task.organization_id,
    coalesce(task.owner_id, task.created_by),
    coalesce(profile.full_name, task.owner_label),
    -- Tarefa sem linha em `task_assignees` cai no principal, e tarefa sem
    -- principal nenhum devolve lista vazia em vez de `{null}` — a faixa
    -- "sem responsável" da tela conta com isso.
    coalesce(
      assignee.ids,
      array_remove(array[coalesce(task.owner_id, task.created_by)], null::uuid)
    ),
    task.title,
    ''::text,
    task.due_at,
    task.due_at + interval '30 minutes',
    false,
    'task'::text,
    'organization'::text,
    task.contact_id,
    case when task.completed then 'completed' else 'scheduled' end,
    null::text,
    null::text,
    null::uuid,
    'Tarefa'::text,
    '#F59E0B'::text,
    ''::text,
    '{}'::text[],
    case when coalesce(task.owner_id, task.created_by) = auth.uid()
      then task.reminder_minutes else '{}'::integer[] end
  from public.tasks task
  left join public.profiles profile on profile.id = task.owner_id
  left join lateral (
    select array_agg(assignment.user_id order by assignment.user_id) as ids
    from public.task_assignees assignment
    where assignment.task_id = task.id
  ) assignee on true
  where task.organization_id = target_organization
    and task.deleted_at is null
    and not task.completed
    and task.due_at is not null
    and task.due_at >= range_start
    and task.due_at < range_end
    and private.is_org_member(target_organization)

  order by starts_at;
$$;

revoke all on function public.calendar_events_list(uuid, timestamptz, timestamptz) from public;
grant execute on function public.calendar_events_list(uuid, timestamptz, timestamptz) to authenticated;

commit;
