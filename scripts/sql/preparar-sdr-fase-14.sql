-- Configuração da Major, após o pré-check: vínculo de Recepção e Vendas ao SDR.
-- Executar pelo SQL Editor. O bloco DO é atômico e pode ser repetido.
do $preparar_sdr$
declare
  target_org constant uuid := '338e44ca-36ab-437c-b8ac-aa7c60fee64a';
  target_profile constant uuid := '85ef7c76-e439-4a4d-9ff2-8b3109a650de';
  reception_id uuid;
  sales_id uuid;
begin
  perform 1 from public.assistant_profiles
  where id = target_profile and organization_id = target_org
    and slug = 'sdr' and audience = 'customer' and active
  for update;
  if not found then raise exception 'SDR ativo da Major não encontrado'; end if;

  select id into reception_id from public.skill_definitions
  where owner_type = 'platform' and organization_id is null and slug = 'recepcao'
    and status = 'published' and audience in ('customer', 'both')
    and coalesce((spec #>> '{routing,fallback}')::boolean, false);
  if reception_id is null then raise exception 'Recepção publicada com fallback não encontrada'; end if;

  select id into sales_id from public.skill_definitions
  where owner_type = 'platform' and organization_id is null and slug = 'vendas'
    and status = 'published' and audience in ('customer', 'both');
  if sales_id is null then raise exception 'Vendas publicada não encontrada'; end if;

  insert into public.assistant_profile_skills (
    organization_id, profile_id, skill_id, enabled, priority
  ) values
    (target_org, target_profile, reception_id, true, 1000),
    (target_org, target_profile, sales_id, true, 20)
  on conflict (profile_id, skill_id) do update
    set enabled = true, updated_at = now()
    where not public.assistant_profile_skills.enabled;
end;
$preparar_sdr$;

select profile.slug as agente, skill.slug as skill, binding.enabled,
  binding.priority, skill.current_version,
  coalesce((skill.spec #>> '{routing,fallback}')::boolean, false) as fallback
from public.assistant_profile_skills binding
join public.assistant_profiles profile on profile.id = binding.profile_id
join public.skill_definitions skill on skill.id = binding.skill_id
where profile.id = '85ef7c76-e439-4a4d-9ff2-8b3109a650de'
  and profile.organization_id = '338e44ca-36ab-437c-b8ac-aa7c60fee64a'
  and skill.slug in ('recepcao', 'vendas')
order by skill.slug;
