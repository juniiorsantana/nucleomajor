-- Colocar alguém numa tarefa passa a avisar essa pessoa, e ela responde.
--
-- Três coisas que a leva anterior deixou de pé, e que só aparecem quando a
-- tarefa tem mais de um responsável:
--
-- 1. **A tarefa de três lembrava um.** `private.task_reschedule_reminders`
--    enfileira para `coalesce(new.owner_id, new.created_by)` e mais ninguém —
--    e o índice único `calendar_reminders_task_live_idx` é
--    `(task_id, channel, remind_at)`, **sem o dono**, então nem daria para
--    enfileirar o segundo sem colidir. Abrir a tarefa para vários responsáveis
--    sem mexer aqui deixaria dois dos três sem lembrete nenhum.
--
-- 2. **Não havia aviso de atribuição.** Toda linha de `calendar_reminders` é um
--    LEMBRETE, amarrado a um horário. "Você entrou nesta tarefa" não é
--    lembrete: chega agora, e não trinta minutos antes de nada. Daí a coluna
--    `kind` — sem ela o aviso chegaria na tela com cara de "sua tarefa começa
--    em breve", que é mentira.
--
-- 3. **Não havia aceite.** `read_at` diz "eu vi", que não é "eu assumo". Quem
--    delegou precisa da segunda informação, e é ela que responde a única
--    pergunta que importa depois de atribuir: pegou ou não pegou?
--
-- O que NÃO muda: a tarefa entra na agenda da pessoa no ato, aceite ou não. Um
-- aceite que segura a tarefa fora da agenda cria um limbo — quem delegou acha
-- que delegou, e a tarefa não está na faixa de ninguém.

begin;

-- -------------------------------------------------------------------------
-- O estado do aceite

alter table public.task_assignees
  add column if not exists notified_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists declined_at timestamptz,
  add column if not exists decline_reason text not null default '';

alter table public.task_assignees
  drop constraint if exists task_assignees_resposta_unica;
alter table public.task_assignees
  add constraint task_assignees_resposta_unica
  check (accepted_at is null or declined_at is null);

alter table public.task_assignees
  drop constraint if exists task_assignees_motivo_so_na_recusa;
alter table public.task_assignees
  add constraint task_assignees_motivo_so_na_recusa
  check (declined_at is not null or decline_reason = '');

alter table public.task_assignees
  drop constraint if exists task_assignees_motivo_curto;
alter table public.task_assignees
  add constraint task_assignees_motivo_curto
  check (length(decline_reason) <= 280);

-- Tudo que existia antes desta migration conta como assumido.
--
-- Ninguém foi perguntado, e marcar as tarefas de ontem como "aguardando
-- aceite" encheria a tela de pendência que nunca houve — o jeito mais rápido
-- de a equipe aprender a ignorar a pílula antes mesmo de ela significar algo.
update public.task_assignees
set accepted_at = created_at
where accepted_at is null and declined_at is null;

comment on column public.task_assignees.notified_at is
  'Quando o aviso de atribuição foi enfileirado. Nulo em linha do backfill: ninguém é avisado de tarefa que já era sua.';
comment on column public.task_assignees.accepted_at is
  'Quando a pessoa assumiu. Nulo não segura a tarefa — ela já está na agenda; nulo só mantém a pílula de pendente.';

-- -------------------------------------------------------------------------
-- A fila aprende a diferença entre lembrar e avisar

alter table public.calendar_reminders
  add column if not exists kind text not null default 'reminder';

alter table public.calendar_reminders
  drop constraint if exists calendar_reminders_kind_check;
alter table public.calendar_reminders
  add constraint calendar_reminders_kind_check
  check (kind in ('reminder', 'assignment'));

comment on column public.calendar_reminders.kind is
  'reminder: falta X para começar. assignment: você entrou nesta tarefa agora. A tela lê isto para não anunciar um horário que o aviso de atribuição não tem.';

-- O índice antigo era `(task_id, channel, remind_at)` e é o que impedia duas
-- pessoas na mesma tarefa. Com `owner_id` e `kind`, cada responsável tem a
-- própria linha, e o aviso de atribuição não disputa lugar com o lembrete que
-- por acaso caia no mesmo instante.
drop index if exists public.calendar_reminders_task_live_idx;
create unique index calendar_reminders_task_live_idx
  on public.calendar_reminders (task_id, owner_id, channel, kind, remind_at)
  where task_id is not null and status <> 'cancelled';

-- -------------------------------------------------------------------------
-- Enfileirar

-- Ganha `target_kind`, com padrão, para que os chamadores de evento (que só
-- lembram) continuem passando oito argumentos. É `drop` e não `create or
-- replace` porque acrescentar parâmetro cria sobrecarga em vez de substituir,
-- e duas versões da mesma função é como se perde a conta de qual roda.
drop function if exists private.enqueue_calendar_reminders(
  uuid, uuid, uuid, uuid, bigint, text, timestamptz, integer[]);

create or replace function private.enqueue_calendar_reminders(
  target_organization uuid,
  target_owner uuid,
  target_event uuid,
  target_task uuid,
  target_version bigint,
  target_title text,
  target_starts_at timestamptz,
  target_minutes integer[],
  target_kind text default 'reminder'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  minutes_before integer;
  target_remind_at timestamptz;
  send_in_app boolean := true;
  send_whatsapp boolean := false;
begin
  if target_owner is null or target_starts_at <= now() - interval '1 minute' then
    return;
  end if;

  select preference.in_app_enabled, preference.whatsapp_enabled
  into send_in_app, send_whatsapp
  from public.calendar_member_preferences preference
  where preference.organization_id = target_organization
    and preference.user_id = target_owner;
  if not found then
    send_in_app := true;
    send_whatsapp := false;
  end if;

  foreach minutes_before in array coalesce(target_minutes, '{}'::integer[])
  loop
    target_remind_at := target_starts_at - make_interval(mins => minutes_before);
    if send_in_app then
      insert into public.calendar_reminders (
        organization_id, owner_id, event_id, task_id, source_version,
        title_snapshot, starts_at_snapshot, remind_at, channel, kind
      ) values (
        target_organization, target_owner, target_event, target_task, target_version,
        target_title, target_starts_at, target_remind_at, 'in_app', target_kind
      ) on conflict do nothing;
    end if;
    if send_whatsapp then
      insert into public.calendar_reminders (
        organization_id, owner_id, event_id, task_id, source_version,
        title_snapshot, starts_at_snapshot, remind_at, channel, kind
      ) values (
        target_organization, target_owner, target_event, target_task, target_version,
        target_title, target_starts_at, target_remind_at, 'whatsapp', target_kind
      ) on conflict do nothing;
    end if;
  end loop;
end;
$$;

-- O aviso de atribuição tem caminho próprio, e não é um lembrete de zero
-- minutos: ele chega AGORA, uma vez por canal, e vale para tarefa sem data —
-- que é justamente a que mais precisa de alguém sabendo que existe.
--
-- `starts_at_snapshot` é `not null` e a tarefa pode não ter vencimento; o
-- `coalesce` para `now()` preenche a coluna sem inventar prazo, e é por isso
-- que `kind` existe: a tela lê o tipo antes de anunciar qualquer horário.
create or replace function private.enqueue_assignment_notice(
  target_organization uuid,
  target_owner uuid,
  target_task uuid,
  target_version bigint,
  target_title text,
  target_due_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  send_in_app boolean := true;
  send_whatsapp boolean := false;
begin
  if target_owner is null then return; end if;

  select preference.in_app_enabled, preference.whatsapp_enabled
  into send_in_app, send_whatsapp
  from public.calendar_member_preferences preference
  where preference.organization_id = target_organization
    and preference.user_id = target_owner;
  if not found then
    send_in_app := true;
    send_whatsapp := false;
  end if;

  if send_in_app then
    insert into public.calendar_reminders (
      organization_id, owner_id, task_id, source_version,
      title_snapshot, starts_at_snapshot, remind_at, channel, kind
    ) values (
      target_organization, target_owner, target_task, target_version,
      target_title, coalesce(target_due_at, now()), now(), 'in_app', 'assignment'
    ) on conflict do nothing;
  end if;
  if send_whatsapp then
    insert into public.calendar_reminders (
      organization_id, owner_id, task_id, source_version,
      title_snapshot, starts_at_snapshot, remind_at, channel, kind
    ) values (
      target_organization, target_owner, target_task, target_version,
      target_title, coalesce(target_due_at, now()), now(), 'whatsapp', 'assignment'
    ) on conflict do nothing;
  end if;
end;
$$;

-- -------------------------------------------------------------------------
-- Os gatilhos

-- O aviso nasce do vínculo, e não da tela. Assim ele vale para todo caminho
-- de escrita — portal, extensão, assistente — em vez de valer só para quem
-- lembrar de chamar a RPC certa.
--
-- Ninguém é avisado do que acabou de escrever: `user_id = created_by` sai. E
-- tarefa concluída ou apagada não gera aviso, senão reabrir o histórico
-- dispararia mensagem de coisa que já acabou.
create or replace function private.task_assignee_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  alvo record;
begin
  -- Quem se colocou na própria tarefa já assumiu: ninguém precisa confirmar
  -- para si mesmo, e sem isto a tela mostraria "aguardando o Lucas" numa
  -- tarefa que o Lucas acabou de escrever.
  if new.user_id = new.created_by then
    update public.task_assignees
    set accepted_at = coalesce(accepted_at, now())
    where task_id = new.task_id and user_id = new.user_id;
    return new;
  end if;

  -- Já avisado, não avisa de novo. Quem grava a lista de responsáveis pode
  -- reescrevê-la inteira a cada salvamento (é o que o portal fazia), e sem
  -- esta guarda corrigir a data de uma tarefa mandaria o mesmo aviso pela
  -- terceira vez. Sair da tarefa cancela as linhas, então voltar a ela
  -- volta a avisar — que é o certo.
  if exists (
    select 1 from public.calendar_reminders aviso
    where aviso.task_id = new.task_id
      and aviso.owner_id = new.user_id
      and aviso.kind = 'assignment'
      and aviso.status <> 'cancelled'
  ) then
    return new;
  end if;

  select task.title, task.due_at, task.version, task.completed, task.deleted_at
  into alvo
  from public.tasks task
  where task.id = new.task_id;

  if not found or alvo.completed or alvo.deleted_at is not null then
    return new;
  end if;

  perform private.enqueue_assignment_notice(
    new.organization_id, new.user_id, new.task_id, alvo.version,
    alvo.title, alvo.due_at
  );

  update public.task_assignees
  set notified_at = now()
  where task_id = new.task_id and user_id = new.user_id;

  return new;
end;
$$;

drop trigger if exists task_assignees_notify on public.task_assignees;
create trigger task_assignees_notify
after insert on public.task_assignees
for each row execute function private.task_assignee_notify();

-- O lembrete passa a sair para CADA responsável.
--
-- Sem responsável em `task_assignees` (tarefa criada por um caminho que ainda
-- não escreve lá, como a extensão), cai no principal — nenhuma tarefa fica
-- sem lembrete por causa de uma lacuna de sincronização.
create or replace function private.task_reschedule_reminders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  responsavel uuid;
begin
  if tg_op = 'UPDATE' then
    -- Só o LEMBRETE é remarcado a cada edição. O aviso de atribuição não
    -- se remarca: ele já aconteceu, e cancelá-lo por causa de uma troca de
    -- título faria a pessoa nunca saber que entrou na tarefa.
    update public.calendar_reminders
    set status = 'cancelled', error_code = 'source-updated'
    where task_id = new.id
      and kind = 'reminder'
      and status in ('pending', 'processing', 'failed');

    -- Concluir ou apagar, sim: aviso de tarefa que já acabou é ruído.
    if new.completed or new.deleted_at is not null then
      update public.calendar_reminders
      set status = 'cancelled', error_code = 'task-closed'
      where task_id = new.id
        and kind = 'assignment'
        and status in ('pending', 'processing', 'failed');
    end if;
  end if;

  if new.deleted_at is null and not new.completed and new.due_at is not null then
    for responsavel in
      select assignment.user_id
      from public.task_assignees assignment
      where assignment.task_id = new.id
      union
      select coalesce(new.owner_id, new.created_by)
      where not exists (
        select 1 from public.task_assignees assignment
        where assignment.task_id = new.id
      )
    loop
      perform private.enqueue_calendar_reminders(
        new.organization_id, responsavel, null, new.id, new.version,
        new.title, new.due_at, new.reminder_minutes
      );
    end loop;
  end if;
  return new;
end;
$$;

-- Entrar numa tarefa que já existe também rende lembrete, e sair dela cancela
-- o que sobrou. Antes, mudar de responsável deixava o lembrete do antigo vivo
-- e o novo sem nenhum — porque só `tasks` tinha gatilho.
create or replace function private.task_assignee_reschedule_reminders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  alvo record;
begin
  if tg_op = 'DELETE' then
    update public.calendar_reminders
    set status = 'cancelled', error_code = 'assignee-removed'
    where task_id = old.task_id
      and owner_id = old.user_id
      and status in ('pending', 'processing', 'failed');
    return old;
  end if;

  select task.title, task.due_at, task.version, task.completed,
         task.deleted_at, task.reminder_minutes, task.organization_id
  into alvo
  from public.tasks task
  where task.id = new.task_id;

  if found and not alvo.completed and alvo.deleted_at is null and alvo.due_at is not null then
    perform private.enqueue_calendar_reminders(
      alvo.organization_id, new.user_id, null, new.task_id, alvo.version,
      alvo.title, alvo.due_at, alvo.reminder_minutes
    );
  end if;
  return new;
end;
$$;

-- Quando tirar-e-recolocar reavisa, e quando não — verificado em produção
-- em 03/09/2026, com escrita real revertida.
--
-- A guarda dentro de `task_assignee_notify` protege quem insere SEM apagar
-- antes. Ela sozinha não bastaria: apagar a linha cancela o aviso, e a
-- reinserção seguinte passaria direto pela guarda. Quem fecha esse furo é o
-- provider, que grava a DIFERENÇA e não mexe em quem continua na tarefa.
-- As duas defesas são necessárias, e não uma a redundância da outra.
--
-- O corte cai no lugar certo porque o cancelamento abaixo só alcança
-- `pending`, `processing` e `failed`. Um aviso já ENTREGUE (`sent`)
-- sobrevive, e a guarda o enxerga:
--
--   tiraram você ANTES de você ver  -> cancelado, e recolocar avisa de novo
--                                      (certo: você nunca soube);
--   tiraram você DEPOIS de você ver -> o registro fica, e recolocar não
--                                      repete a mensagem (certo: você já sabe).
--
-- Estreitar o cancelamento para incluir `sent` faria a segunda linha virar
-- a primeira, e a equipe receberia a mesma mensagem a cada ida e volta.
drop trigger if exists task_assignees_reminders on public.task_assignees;
create trigger task_assignees_reminders
after insert or delete on public.task_assignees
for each row execute function private.task_assignee_reschedule_reminders();

-- A reconstrução por preferência acompanha: quem liga o WhatsApp hoje precisa
-- receber os lembretes das tarefas em que ENTROU, e não só das que criou.
create or replace function private.rebuild_member_calendar_reminders(
  target_organization uuid,
  target_owner uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
begin
  update public.calendar_reminders reminder
  set status = 'cancelled', error_code = 'preferences-updated'
  where reminder.organization_id = target_organization
    and reminder.owner_id = target_owner
    and reminder.kind = 'reminder'
    and reminder.status in ('pending', 'failed');

  for item in
    select event.id, null::uuid task_id, event.version, event.title,
      event.starts_at starts_at, event.reminder_minutes
    from public.calendar_events event
    where event.organization_id = target_organization
      and event.owner_id = target_owner
      and event.deleted_at is null
      and event.status in ('scheduled', 'tentative')
      and event.starts_at > now()
    union all
    select null::uuid, task.id, task.version, task.title,
      task.due_at, task.reminder_minutes
    from public.tasks task
    where task.organization_id = target_organization
      and task.deleted_at is null and not task.completed
      and task.due_at > now()
      and (
        exists (
          select 1 from public.task_assignees assignment
          where assignment.task_id = task.id and assignment.user_id = target_owner
        )
        or (
          coalesce(task.owner_id, task.created_by) = target_owner
          and not exists (
            select 1 from public.task_assignees assignment
            where assignment.task_id = task.id
          )
        )
      )
  loop
    perform private.enqueue_calendar_reminders(
      target_organization, target_owner, item.id, item.task_id, item.version,
      item.title, item.starts_at, item.reminder_minutes
    );
  end loop;
end;
$$;

commit;

-- -------------------------------------------------------------------------
-- O que a tela lê e escreve

begin;

-- `kind` entra no retorno para a tela poder dizer "Ana colocou você nesta
-- tarefa" em vez de anunciar um horário que o aviso de atribuição não tem.
drop function if exists public.calendar_notifications_list(uuid, integer);

create function public.calendar_notifications_list(
  target_organization uuid,
  max_items integer default 50
)
returns table (
  id uuid,
  source_type text,
  source_id uuid,
  kind text,
  title text,
  starts_at timestamptz,
  remind_at timestamptz,
  channel text,
  status text,
  delivered_at timestamptz,
  read_at timestamptz,
  error_code text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_org_member(target_organization) then
    raise exception 'organization access denied';
  end if;
  max_items := greatest(1, least(coalesce(max_items, 50), 100));

  update public.calendar_reminders reminder
  set status = 'sent', delivered_at = coalesce(reminder.delivered_at, now())
  where reminder.organization_id = target_organization
    and reminder.owner_id = auth.uid()
    and reminder.channel = 'in_app'
    and reminder.status = 'pending'
    and reminder.remind_at <= now();

  return query
  select reminder.id,
    case when reminder.event_id is not null then 'event' else 'task' end,
    coalesce(reminder.event_id, reminder.task_id),
    reminder.kind,
    reminder.title_snapshot,
    reminder.starts_at_snapshot,
    reminder.remind_at,
    reminder.channel,
    reminder.status,
    reminder.delivered_at,
    reminder.read_at,
    reminder.error_code
  from public.calendar_reminders reminder
  where reminder.organization_id = target_organization
    and reminder.owner_id = auth.uid()
    and reminder.status <> 'cancelled'
  order by coalesce(reminder.delivered_at, reminder.remind_at) desc
  limit max_items;
end;
$$;

revoke all on function public.calendar_notifications_list(uuid, integer) from public;
grant execute on function public.calendar_notifications_list(uuid, integer) to authenticated;

-- Assumir ou recusar.
--
-- Só quem foi colocado responde por si: nem quem criou nem o dono da empresa
-- assumem no lugar de alguém. "Assumi" dito por outra pessoa não é aceite, é
-- suposição — e era exatamente o que a tarefa sem responsável já fazia.
--
-- Recusar NÃO apaga o vínculo. A tarefa continua visível para quem delegou,
-- agora com o motivo: sumir seria a mesma coisa que nunca ter avisado.
create or replace function public.task_assignment_respond(
  target_organization uuid,
  target_task uuid,
  accept boolean,
  reason text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  motivo text := left(coalesce(trim(reason), ''), 280);
begin
  if not private.is_org_member(target_organization) then
    raise exception 'organization access denied';
  end if;

  update public.task_assignees
  set accepted_at = case when accept then now() else null end,
      declined_at = case when accept then null else now() end,
      decline_reason = case when accept then '' else motivo end
  where task_id = target_task
    and organization_id = target_organization
    and user_id = auth.uid();

  if not found then
    raise exception 'assignment not found';
  end if;
end;
$$;

revoke all on function public.task_assignment_respond(uuid, uuid, boolean, text) from public;
grant execute on function public.task_assignment_respond(uuid, uuid, boolean, text) to authenticated;

-- -------------------------------------------------------------------------
-- O worker da VPS

-- `notification_worker_claim_reminders` devolvia título e horário, e o texto
-- da mensagem é montado do outro lado, no `whatsapp-assistant`. Sem `kind`,
-- um aviso de atribuição sairia redigido como lembrete — e, em tarefa sem
-- vencimento, anunciando como prazo o instante em que ele foi enfileirado.
--
-- A coluna é ACRESCENTADA ao fim do retorno de propósito: o worker lê a
-- resposta da API por nome de campo, então um campo novo é ignorado até
-- alguém ensiná-lo a olhar. Nada quebra hoje, e nada sai errado hoje
-- tampouco: `channel = 'whatsapp'` só existe para quem verificou telefone,
-- e em 03/09/2026 isso é ninguém. **Verificar telefone antes de o worker
-- aprender `kind` é o que faria a primeira mensagem sair torta.**
drop function if exists public.notification_worker_claim_reminders(integer);

create function public.notification_worker_claim_reminders(max_items integer default 20)
returns table (
  reminder_id uuid,
  recipient_phone text,
  title text,
  starts_at timestamptz,
  source_type text,
  kind text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker_org uuid := private.notification_worker_organization();
  worker_connection uuid := private.notification_worker_connection();
begin
  if worker_org is null or worker_connection is null then
    raise exception 'notification worker credential is inactive';
  end if;
  max_items := greatest(1, least(coalesce(max_items, 20), 50));

  update public.calendar_reminders reminder
  set status = case when reminder.attempt_count >= 3 then 'review' else 'pending' end,
      claimed_by_connection = null,
      claim_expires_at = null,
      error_code = case when reminder.attempt_count >= 3 then 'lease-expired' else reminder.error_code end
  where reminder.organization_id = worker_org
    and reminder.channel = 'whatsapp'
    and reminder.status = 'processing'
    and reminder.claim_expires_at <= now();

  update public.calendar_reminders reminder
  set status = 'failed', error_code = 'phone-not-verified'
  where reminder.organization_id = worker_org
    and reminder.channel = 'whatsapp'
    and reminder.status = 'pending'
    and reminder.remind_at <= now()
    and not exists (
      select 1 from public.calendar_member_preferences preference
      where preference.organization_id = reminder.organization_id
        and preference.user_id = reminder.owner_id
        and preference.whatsapp_enabled
        and preference.phone_verified_at is not null
    );

  return query
  with candidates as (
    select reminder.id
    from public.calendar_reminders reminder
    join public.calendar_member_preferences preference
      on preference.organization_id = reminder.organization_id
     and preference.user_id = reminder.owner_id
     and preference.whatsapp_enabled
     and preference.phone_verified_at is not null
    where reminder.organization_id = worker_org
      and reminder.channel = 'whatsapp'
      and reminder.status = 'pending'
      and reminder.attempt_count < 3
      and reminder.remind_at <= now()
      and reminder.next_attempt_at <= now()
    order by reminder.remind_at
    for update of reminder skip locked
    limit max_items
  )
  update public.calendar_reminders reminder
  set status = 'processing', attempt_count = reminder.attempt_count + 1,
      claimed_by_connection = worker_connection,
      claim_expires_at = now() + interval '5 minutes'
  from candidates, public.calendar_member_preferences preference
  where reminder.id = candidates.id
    and preference.organization_id = reminder.organization_id
    and preference.user_id = reminder.owner_id
  returning reminder.id, preference.phone_e164, reminder.title_snapshot,
    reminder.starts_at_snapshot,
    case when reminder.event_id is not null then 'event' else 'task' end,
    reminder.kind;
end;
$$;

revoke all on function public.notification_worker_claim_reminders(integer) from public;
grant execute on function public.notification_worker_claim_reminders(integer) to authenticated;

commit;
