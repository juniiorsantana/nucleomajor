-- Diagnóstico: por que a etiqueta "Não atender IA" não parou a IA (13/09/2026)
--
-- SOMENTE LEITURA. Um único SELECT, para o SQL Editor devolver tudo de uma vez.
-- Não mostra telefone inteiro nem nome: só os 4 últimos dígitos e o tamanho.
--
-- Como ler o resultado:
--   etiquetas            -> quantas etiquetas "Não atender IA" existem e se o gate as reconhece
--   contatos_marcados    -> cada contato marcado: tamanho do telefone (15 dígitos = código
--                           interno LID, não é telefone) e se ele casa com alguma conversa
--   conversas_sem_marca  -> conversas recentes cujo número NÃO casa com nenhum contato
--                           marcado, mas que têm contato marcado com os mesmos 4 finais
--                           (sinal de telefone gravado diferente do que chega)

with conexao as (
  select id, organization_id
  from public.whatsapp_connections
  where id = '8ee1e6d0-a9d0-4041-b6ea-878716a34a71'
),
etiqueta as (
  select tag.id, tag.legacy_id, tag.name, tag.deleted_at,
    (lower(coalesce(tag.legacy_id, '')) = 'nao-atender-ia'
      or lower(regexp_replace(tag.name, '[^A-Za-z]', '', 'g')) in ('noatenderia', 'naoatenderia')
    ) as gate_reconhece
  from public.tags tag
  join conexao on conexao.organization_id = tag.organization_id
  where lower(regexp_replace(tag.name, '[^A-Za-z]', '', 'g')) like '%atenderia%'
     or lower(coalesce(tag.legacy_id, '')) like '%atender%'
),
marcados as (
  select contact.id, contact.phone, contact.whatsapp_id, contact.deleted_at,
    etiqueta.gate_reconhece, etiqueta.deleted_at as etiqueta_apagada
  from public.contact_tags marcacao
  join etiqueta on etiqueta.id = marcacao.tag_id
  join public.contacts contact
    on contact.id = marcacao.contact_id
   and contact.organization_id = marcacao.organization_id
),
conversas as (
  select conversa.contact_phone, conversa.last_message_at
  from public.whatsapp_conversations conversa
  join conexao on conexao.id = conversa.connection_id
  where conversa.last_message_at > now() - interval '7 days'
)
select jsonb_build_object(
  'etiquetas', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'legacy_id', legacy_id, 'nome', name, 'apagada', deleted_at is not null,
      'gate_reconhece', gate_reconhece
    )), '[]'::jsonb) from etiqueta
  ),
  'contatos_marcados', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'telefone_final', right(regexp_replace(coalesce(m.phone, ''), '[^0-9]', '', 'g'), 4),
      'telefone_digitos', length(regexp_replace(coalesce(m.phone, ''), '[^0-9]', '', 'g')),
      'whatsapp_id_final', right(regexp_replace(coalesce(m.whatsapp_id, ''), '[^0-9]', '', 'g'), 4),
      'whatsapp_id_digitos', length(regexp_replace(coalesce(m.whatsapp_id, ''), '[^0-9]', '', 'g')),
      'contato_apagado', m.deleted_at is not null,
      'etiqueta_apagada', m.etiqueta_apagada is not null,
      'gate_reconhece_etiqueta', m.gate_reconhece,
      'conversas_que_casam', (
        select count(*) from conversas c
        where private.customer_phone_matches(c.contact_phone, m.phone)
           or private.customer_phone_matches(c.contact_phone, m.whatsapp_id)
      ),
      'digitos_da_conversa_com_mesmo_final', (
        select coalesce(jsonb_agg(distinct length(c.contact_phone)), '[]'::jsonb) from conversas c
        where right(c.contact_phone, 4) in (
          right(regexp_replace(coalesce(m.phone, ''), '[^0-9]', '', 'g'), 4),
          right(regexp_replace(coalesce(m.whatsapp_id, ''), '[^0-9]', '', 'g'), 4)
        )
      )
    )), '[]'::jsonb) from marcados m
  ),
  'conversas_recentes', (select count(*) from conversas),
  'conversas_com_15_digitos', (select count(*) from conversas where length(contact_phone) = 15)
) as diagnostico;
