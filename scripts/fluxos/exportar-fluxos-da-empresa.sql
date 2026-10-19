-- Etapa 11 — passo 1 da conversão v2 → v3: exportar os fluxos de UMA empresa.
--
-- Só leitura. Colar no SQL Editor trocando o id da empresa, copiar o valor da
-- coluna `exportacao` (um JSON) para um arquivo, por exemplo
-- `D:\MajorHub\16 - Trabalho em Conjunto\nucleomajor\01 - Entrada\AAAA-MM-DD_fluxos-<empresa>.json`,
-- e rodar:
--
--   node scripts/fluxos/converter-v2-para-v3.mjs <arquivo.json> <pasta de saída>
--
-- O JSON leva as definições dos fluxos (texto das mensagens incluído): não
-- guardar fora do disco D: nem mandar para fora.

select jsonb_build_object(
  'organizationId', o.id,
  'organizationName', o.name,
  'exportedAt', now(),
  'recursos', (
    select jsonb_object_agg(funcao, private.org_has_feature(o.id, funcao))
    from unnest(array['chatbots', 'ai_customer', 'fluxos_ramificados']) as funcao
  ),
  'fluxos', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'name', b.name, 'active', b.active, 'version', b.version, 'definition', b.definition
    ) order by b.created_at)
    from public.chatbot_definitions b
    where b.organization_id = o.id and b.deleted_at is null
  ), '[]'::jsonb)
) as exportacao
from public.organizations o
where o.id = '00000000-0000-0000-0000-000000000000';  -- troque pelo id da empresa
