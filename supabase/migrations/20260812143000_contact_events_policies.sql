-- Mantém o histórico sincronizável por todos os fluxos autorizados da empresa.
drop policy if exists events_update on public.contact_events;
drop policy if exists events_delete on public.contact_events;

create policy events_update on public.contact_events for update to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

create policy events_delete on public.contact_events for delete to authenticated
using (private.is_org_member(organization_id));
