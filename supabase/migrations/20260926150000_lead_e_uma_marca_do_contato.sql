-- Lead é uma marca do contato, e o negócio só existe para quem é lead.
--
-- Decidido com o dono em 24/09/2026:
--
--   Contato  - todo mundo que está no CRM;
--   Lead     - o contato que alguém criou ou transformou em lead;
--   Negócio  - a oportunidade no Funil, e só existe para quem é lead.
--
-- O que esta migration grava, para que o Funil conte por período:
--
--   * `contacts.lead_at`: quando o contato virou lead. É uma data, não um
--     sim/não, porque é ela que responde "quantos leads criamos no mês". O
--     banco carimba a hora dele: o cliente só diz "é lead" (qualquer valor não
--     nulo) e a data que fica é `now()`. Uma vez marcada, não muda; desmarcar é
--     possível só enquanto o contato não tem negócio.
--   * `deals.closed_at`: quando o negócio foi ganho ou perdido. Até aqui só
--     havia `updated_at`, que muda a cada edição e fazia um negócio de agosto
--     parecer de outubro.
--   * `deal_stage_history`: uma linha a cada vez que o negócio muda de etapa ou
--     de status. É ela que responde "quantos chegaram em Proposta no mês". O
--     banco guardava só a etapa atual, e o evento `deal.updated` do portal só
--     diz QUAIS campos mudaram, não de onde para onde.
--
-- Quem marca o lead:
--
--   * o portal, ao criar um lead ou transformar um contato em lead;
--   * o próprio banco, ao nascer um negócio para quem ainda não é lead. O
--     portal pergunta antes; o trigger é o que garante a regra para qualquer
--     outro caminho (a extensão, um bundle antigo do portal num navegador);
--   * a IA, quando a qualificação dela termina em `qualified`;
--   * o formulário do site (`lead.site`), que é captação de lead por definição.
--
-- Os dois últimos entram por trigger em `contact_qualifications` e
-- `contact_events`, e não por troca de corpo em
-- `nucleo_customer_qualification_update` e `nucleo_site_lead_receive`: são
-- funções grandes, e reescrever para acrescentar uma linha arriscaria levar
-- junto uma divergência de produção.
--
-- Quem NÃO vira lead: o contato que o fluxo cria para atender alguém
-- desconhecido (`flow_contact_for`, evento de origem `chatbot`) e o que o
-- interruptor "não atender IA" cria. São contatos, não oportunidades.
--
-- A primeira etapa do Funil passa de "Novo lead" para "Lead". Organizações
-- novas nascem com as etapas de `create_organization`, que tem duas
-- assinaturas com o nome antigo no corpo; em vez de reescrevê-las, um trigger
-- em `stages` troca o nome na chegada. Os fluxos que disparam por etapa usam o
-- id, não o nome (`private.flow_trigger_on_stage`), então nada quebra.
--
-- Aplicar pelo SQL Editor ou `supabase db query --linked -f`, uma vez.
-- Nunca `supabase db push` neste projeto.

begin;

do $$
begin
  if to_regclass('public.contact_qualifications') is null
     or to_regclass('public.contact_events') is null then
    raise exception 'abortado: faltam contact_qualifications ou contact_events';
  end if;
  if to_regprocedure('private.is_org_member(uuid)') is null then
    raise exception 'abortado: falta private.is_org_member(uuid)';
  end if;
end;
$$;

-- ------------------------------------------------------------ colunas

alter table public.contacts add column if not exists lead_at timestamptz;
alter table public.deals add column if not exists closed_at timestamptz;

create index if not exists contacts_org_lead_at_idx
  on public.contacts (organization_id, lead_at)
  where lead_at is not null and deleted_at is null;
create index if not exists contacts_org_created_at_idx
  on public.contacts (organization_id, created_at)
  where deleted_at is null;
create index if not exists deals_org_created_at_idx
  on public.deals (organization_id, created_at)
  where deleted_at is null;
create index if not exists deals_org_closed_at_idx
  on public.deals (organization_id, closed_at)
  where closed_at is not null and deleted_at is null;

-- ------------------------------------------------- histórico de etapas

create table if not exists public.deal_stage_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deal_id uuid not null,
  contact_id uuid not null,
  -- Nulo na primeira linha do negócio: ele nasceu, não veio de lugar nenhum.
  from_stage_id uuid,
  to_stage_id uuid not null,
  from_status public.deal_status,
  to_status public.deal_status not null,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  foreign key (deal_id, organization_id)
    references public.deals(id, organization_id) on delete cascade
);

create index if not exists deal_stage_history_org_changed_idx
  on public.deal_stage_history (organization_id, changed_at);
create index if not exists deal_stage_history_deal_idx
  on public.deal_stage_history (deal_id, changed_at);

alter table public.deal_stage_history enable row level security;

-- Só leitura para quem é da organização. Quem escreve é o trigger.
drop policy if exists deal_stage_history_select on public.deal_stage_history;
create policy deal_stage_history_select
  on public.deal_stage_history for select to authenticated
  using (private.is_org_member(organization_id));

revoke insert, update, delete, truncate on public.deal_stage_history from authenticated, anon;
grant select on public.deal_stage_history to authenticated;

-- ------------------------------------------ os dados que já existem
--
-- Antes dos triggers, para que o carimbo `now()` não passe por cima das datas
-- reconstruídas.
--
-- Lead é quem: foi criado pelo portal (o evento `contact.created` de origem
-- `web`; o do fluxo tem origem `chatbot`), veio do formulário do site, foi
-- qualificado pela IA, ou tem negócio. A data é a mais antiga dessas.

with origem as (
  select evento.contact_id, min(coalesce(evento.occurred_at, evento.created_at)) as quando
  from public.contact_events evento
  where evento.contact_id is not null
    and ((evento.event_type = 'contact.created' and evento.source = 'web')
      or evento.event_type = 'lead.site')
  group by evento.contact_id
  union all
  select negocio.contact_id, min(negocio.created_at)
  from public.deals negocio
  where negocio.deleted_at is null
  group by negocio.contact_id
  union all
  select qualificacao.contact_id, min(qualificacao.updated_at)
  from public.contact_qualifications qualificacao
  where qualificacao.status = 'qualified'
  group by qualificacao.contact_id
), primeira as (
  select origem.contact_id, min(origem.quando) as quando
  from origem
  group by origem.contact_id
)
update public.contacts contato
set lead_at = greatest(contato.created_at, primeira.quando)
from primeira
where primeira.contact_id = contato.id
  and contato.lead_at is null;

-- A data real de fechamento se perdeu; `updated_at` é o melhor que existe.
update public.deals negocio
set closed_at = negocio.updated_at
where negocio.status <> 'aberto'
  and negocio.closed_at is null;

-- O histórico de etapas começa hoje. Não há como saber por onde os negócios
-- antigos passaram, e inventar uma linha de "entrou na etapa atual quando
-- nasceu" contaria errado quem já andou pelo Funil.

-- ------------------------------------------------------ triggers

-- contacts: o carimbo do lead e a regra de desmarcar.
create or replace function private.contact_lead_mark()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.lead_at is not null then
      new.lead_at := now();
    end if;
    return new;
  end if;

  if old.lead_at is null and new.lead_at is not null then
    new.lead_at := now();
  elsif old.lead_at is not null and new.lead_at is null then
    if exists (
      select 1 from public.deals negocio
      where negocio.contact_id = old.id and negocio.deleted_at is null
    ) then
      raise exception 'contato com negócio continua lead'
        using errcode = 'P0001', hint = 'lead_tem_negocio';
    end if;
  elsif old.lead_at is not null then
    -- Uma vez lead, a data não muda: é ela que diz em que mês ele entrou.
    new.lead_at := old.lead_at;
  end if;
  return new;
end;
$$;

-- AFTER: o evento na ficha do contato, para a linha do tempo mostrar quando
-- virou lead e quando deixou de ser.
create or replace function private.contact_lead_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.lead_at is not null)
     or (tg_op = 'UPDATE' and old.lead_at is null and new.lead_at is not null) then
    insert into public.contact_events (organization_id, contact_id, event_type, entity_type, entity_id, source, payload, occurred_at, created_by)
    values (new.organization_id, new.id, 'contact.lead_marked', 'contato', new.id, 'sistema', '{}'::jsonb, new.lead_at,
      (select perfil.id from public.profiles perfil where perfil.id = auth.uid()));
  elsif tg_op = 'UPDATE' and old.lead_at is not null and new.lead_at is null then
    insert into public.contact_events (organization_id, contact_id, event_type, entity_type, entity_id, source, payload, occurred_at, created_by)
    values (new.organization_id, new.id, 'contact.lead_unmarked', 'contato', new.id, 'sistema',
      jsonb_build_object('leadDesde', old.lead_at), now(),
      (select perfil.id from public.profiles perfil where perfil.id = auth.uid()));
  end if;
  return null;
end;
$$;

drop trigger if exists contacts_lead_mark on public.contacts;
create trigger contacts_lead_mark
  before insert or update of lead_at on public.contacts
  for each row execute function private.contact_lead_mark();

drop trigger if exists contacts_lead_event on public.contacts;
create trigger contacts_lead_event
  after insert or update of lead_at on public.contacts
  for each row execute function private.contact_lead_event();

-- Marca um contato como lead, se ainda não for. Um lugar só, para os três
-- caminhos automáticos.
create or replace function private.contact_become_lead(target_contact uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.contacts contato
  set lead_at = now()
  where contato.id = target_contact
    and contato.lead_at is null
    and contato.deleted_at is null;
$$;

-- deals, BEFORE: a data de fechamento. Só o banco escreve nela.
create or replace function private.deal_closed_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.closed_at := case when new.status = 'aberto' then null else now() end;
  elsif new.status is distinct from old.status then
    new.closed_at := case when new.status = 'aberto' then null else now() end;
  else
    new.closed_at := old.closed_at;
  end if;
  return new;
end;
$$;

-- deals, AFTER: o histórico e a regra "negócio só para lead".
create or replace function private.deal_track()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null then
    return null;
  end if;

  if tg_op = 'INSERT' or new.contact_id is distinct from old.contact_id then
    perform private.contact_become_lead(new.contact_id);
  end if;

  if tg_op = 'INSERT'
     or new.stage_id is distinct from old.stage_id
     or new.status is distinct from old.status then
    insert into public.deal_stage_history (
      organization_id, deal_id, contact_id, from_stage_id, to_stage_id,
      from_status, to_status, changed_by
    ) values (
      new.organization_id, new.id, new.contact_id,
      case when tg_op = 'UPDATE' then old.stage_id end, new.stage_id,
      case when tg_op = 'UPDATE' then old.status end, new.status,
      auth.uid()
    );
  end if;
  return null;
end;
$$;

drop trigger if exists deals_closed_at on public.deals;
create trigger deals_closed_at
  before insert or update on public.deals
  for each row execute function private.deal_closed_at();

drop trigger if exists deals_track on public.deals;
create trigger deals_track
  after insert or update on public.deals
  for each row execute function private.deal_track();

-- A IA qualificou: é lead.
create or replace function private.qualification_makes_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'qualified' then
    perform private.contact_become_lead(new.contact_id);
  end if;
  return null;
end;
$$;

drop trigger if exists contact_qualifications_make_lead on public.contact_qualifications;
create trigger contact_qualifications_make_lead
  after insert or update of status on public.contact_qualifications
  for each row execute function private.qualification_makes_lead();

-- O formulário do site entrou: é lead.
create or replace function private.site_event_makes_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_type = 'lead.site' and new.contact_id is not null then
    perform private.contact_become_lead(new.contact_id);
  end if;
  return null;
end;
$$;

drop trigger if exists contact_events_site_makes_lead on public.contact_events;
create trigger contact_events_site_makes_lead
  after insert on public.contact_events
  for each row when (new.event_type = 'lead.site')
  execute function private.site_event_makes_lead();

revoke all on function private.contact_lead_mark() from public;
revoke all on function private.contact_lead_event() from public;
revoke all on function private.contact_become_lead(uuid) from public;
revoke all on function private.deal_closed_at() from public;
revoke all on function private.deal_track() from public;
revoke all on function private.qualification_makes_lead() from public;
revoke all on function private.site_event_makes_lead() from public;

-- ------------------------------------------- "Novo lead" vira "Lead"

update public.stages etapa
set name = 'Lead'
where etapa.legacy_id = 'novo-lead'
  and etapa.name = 'Novo lead'
  and etapa.deleted_at is null;

create or replace function private.stage_default_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.legacy_id = 'novo-lead' and new.name = 'Novo lead' then
    new.name := 'Lead';
  end if;
  return new;
end;
$$;

revoke all on function private.stage_default_name() from public;

drop trigger if exists stages_default_name on public.stages;
create trigger stages_default_name
  before insert on public.stages
  for each row execute function private.stage_default_name();

commit;
