-- Eventos pessoais pertencem exclusivamente ao profissional responsável.
--
-- Dono e administrador gerenciam eventos corporativos, mas cargo gerencial não
-- autoriza editar, promover para corporativo ou excluir o evento pessoal de
-- outra pessoa. A equipe enxerga somente a indisponibilidade pelo RPC mascarado.

drop policy if exists calendar_events_update on public.calendar_events;
create policy calendar_events_update on public.calendar_events
for update to authenticated
using (
  private.is_org_member(organization_id)
  and (
    (visibility = 'personal' and owner_id = auth.uid())
    or (visibility = 'organization' and private.can_manage_org(organization_id))
  )
)
with check (
  private.is_org_member(organization_id)
  and (
    (visibility = 'personal' and owner_id = auth.uid())
    or (visibility = 'organization' and private.can_manage_org(organization_id))
  )
);

drop policy if exists calendar_events_delete on public.calendar_events;
create policy calendar_events_delete on public.calendar_events
for delete to authenticated
using (
  private.is_org_member(organization_id)
  and (
    (visibility = 'personal' and owner_id = auth.uid())
    or (visibility = 'organization' and private.can_manage_org(organization_id))
  )
);

comment on policy calendar_events_update on public.calendar_events is
  'Somente o profissional edita seu evento pessoal; owner/admin editam apenas eventos corporativos.';
comment on policy calendar_events_delete on public.calendar_events is
  'Somente o profissional exclui seu evento pessoal; owner/admin excluem apenas eventos corporativos.';

