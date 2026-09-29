-- O lead entra no Funil sozinho.
--
-- Decidido com o dono em 29/09/2026: quem vira lead aparece no kanban na hora,
-- na primeira etapa, sem ninguém precisar criar o negócio à mão. Até aqui o
-- lead era só a marca `contacts.lead_at`, e o Funil mostra negócios: a
-- Adriani tinha 47 leads e 3 cartões.
--
-- A regra mora no banco, e não no portal, porque lead nasce por várias portas:
-- o portal (criar lead, marcar como lead), o formulário do Meta, o formulário
-- do site e a IA quando qualifica. Um trigger em `contacts` pega todas.
--
-- O negócio automático:
--   * nasce na primeira etapa da organização (menor `position`);
--   * tem título vazio — o cartão mostra o nome do cliente e "Negócio a
--     definir" até alguém dizer o que ele quer;
--   * herda a origem do contato;
--   * só nasce se o contato não tem NENHUM negócio vivo (aberto, ganho ou
--     perdido). Quem cria o negócio junto com o lead não ganha dois: quando o
--     negócio nasce primeiro, `deal_track` promove o contato a lead e este
--     trigger já encontra o negócio.
--
-- Inserir o negócio dispara `chatbot_flow_trigger_on_stage` como qualquer
-- negócio novo: um fluxo ativo com gatilho na etapa "Lead" roda para cada lead
-- que entra. É o comportamento certo daqui em diante. Para os leads antigos
-- (o preenchimento no fim), conferido em 29/09/2026: nenhuma organização com
-- lead sem negócio tem fluxo ativo por etapa.
--
-- Aplicar pelo SQL Editor, uma vez. Nunca `supabase db push` neste projeto.

begin;

do $$
begin
  if to_regprocedure('private.deal_track()') is null
     or to_regprocedure('private.contact_lead_mark()') is null then
    raise exception 'abortado: falta a migration 20260926170000 (lead é uma marca do contato)';
  end if;
end;
$$;

create or replace function private.lead_enters_funnel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  primeira uuid;
  autor uuid;
begin
  if new.lead_at is null or new.deleted_at is not null then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.lead_at is not null then
    return null;
  end if;
  if exists (
    select 1 from public.deals negocio
    where negocio.contact_id = new.id and negocio.deleted_at is null
  ) then
    return null;
  end if;

  select etapa.id into primeira
  from public.stages etapa
  where etapa.organization_id = new.organization_id and etapa.deleted_at is null
  order by etapa.position, etapa.created_at
  limit 1;
  if primeira is null then
    return null;
  end if;

  select perfil.id into autor from public.profiles perfil where perfil.id = auth.uid();

  insert into public.deals (organization_id, contact_id, stage_id, title, source, created_by, updated_by)
  values (new.organization_id, new.id, primeira, '', coalesce(new.source, ''), autor, autor);
  return null;
end;
$$;

revoke all on function private.lead_enters_funnel() from public;

drop trigger if exists contacts_lead_enters_funnel on public.contacts;
create trigger contacts_lead_enters_funnel
  after insert or update of lead_at on public.contacts
  for each row execute function private.lead_enters_funnel();

comment on function private.lead_enters_funnel() is
  'Lead novo ganha negócio na primeira etapa do Funil, se ainda não tem nenhum. Ver 20260929120000.';

-- Os leads que já existiam e nunca ganharam negócio.
insert into public.deals (organization_id, contact_id, stage_id, title, source)
select contato.organization_id, contato.id,
       (select etapa.id from public.stages etapa
        where etapa.organization_id = contato.organization_id and etapa.deleted_at is null
        order by etapa.position, etapa.created_at limit 1),
       '', coalesce(contato.source, '')
from public.contacts contato
where contato.lead_at is not null and contato.deleted_at is null
  and not exists (
    select 1 from public.deals negocio
    where negocio.contact_id = contato.id and negocio.deleted_at is null
  )
  and exists (
    select 1 from public.stages etapa
    where etapa.organization_id = contato.organization_id and etapa.deleted_at is null
  );

commit;
