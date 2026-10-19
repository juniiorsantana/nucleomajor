-- Conferência das migrations 20261020100000 a 20261020130000, depois de
-- aplicadas. Só leitura (SELECT); colar no SQL Editor ou rodar com
-- `supabase db query --linked -f`. Cada consulta diz o que esperar.

-- 1. Colunas, gatilhos, índices e permissões (esperado: tudo true).
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'whatsapp_conversations' and column_name = 'changed_at' and is_nullable = 'NO') as conversas_changed_at,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'whatsapp_messages' and column_name = 'changed_at' and is_nullable = 'NO') as mensagens_changed_at,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contacts' and column_name = 'changed_at' and is_nullable = 'NO') as contatos_changed_at,
  (select count(*) from pg_trigger where tgname like '%\_zz\_mudou\_em' and not tgisinternal) = 3 as tres_gatilhos,
  to_regclass('public.whatsapp_conversations_changed_idx') is not null
    and to_regclass('public.whatsapp_messages_changed_idx') is not null
    and to_regclass('public.contacts_changed_idx') is not null
    and to_regclass('public.contacts_phone_key_idx') is not null
    and to_regclass('public.whatsapp_conversations_phone_key_idx') is not null as indices,
  to_regprocedure('public.nucleo_conversation_list(uuid, timestamptz, integer)') is not null as rpc_da_lista,
  (select prosecdef from pg_proc where oid = to_regprocedure('public.nucleo_conversation_list(uuid, timestamptz, integer)')) as lista_definer,
  not has_function_privilege('anon', 'public.nucleo_conversation_list(uuid, timestamptz, integer)', 'execute') as anon_sem_lista,
  has_function_privilege('authenticated', 'public.nucleo_conversation_list(uuid, timestamptz, integer)', 'execute') as autenticado_com_lista,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'portal_realtime_events' and column_name = 'entity_key') as aviso_com_chave,
  (select count(*) from pg_trigger where tgfoid = 'private.portal_realtime_notify()'::regprocedure and not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)) = 9 as nove_gatilhos_de_realtime;

-- 2. Os corpos (esperado: notify 2fc7ef197dcf315e45f8be57ef388d94,
--    sync_without_photos beac3e50f74dc2353460e4d22d60b7dc,
--    sync 16b0fba867ef700650251279e8d7edec).
select p.oid::regprocedure::text as funcao, md5(replace(p.prosrc, chr(13), '')) as md5
from pg_proc p
where p.oid in (
  'private.portal_realtime_notify()'::regprocedure,
  'public.nucleo_conversation_sync_without_photos(jsonb)'::regprocedure,
  'public.nucleo_conversation_sync(jsonb)'::regprocedure
);

-- 3. changed_at só anda com mudança de verdade. Rodar alguns minutos depois de
--    aplicar: as conversas com changed_at recente são as que receberam
--    mensagem, não o lote inteiro. Depois da 130000, updated_at também.
select count(*) as conversas,
  count(*) filter (where changed_at > now() - interval '5 minutes') as mudaram_em_5_min,
  count(*) filter (where updated_at > now() - interval '5 minutes') as regravadas_em_5_min
from public.whatsapp_conversations;

-- 4. A sincronia não regrava (depois da 130000). Rodar duas vezes com 1 minuto
--    de intervalo: n_tup_upd sobe só com as conversas que mudaram (antes da
--    130000: cerca de 4 updates por conversa por minuto, por conexão ativa).
select n_tup_upd, n_tup_hot_upd, now() as em
from pg_stat_user_tables where relid = 'public.whatsapp_conversations'::regclass;

-- 5. Avisos de realtime da última hora por tópico; no tópico conversas, todos
--    com entity_key (os de antes da 120000 não têm).
select topic, count(*) as avisos, count(entity_key) as com_chave
from public.portal_realtime_events
where created_at > now() - interval '1 hour'
group by topic order by topic;

-- 6. br_phone_key contra a tabela de casos (esperado: 0 linhas). É a mesma de
--    supabase/provas/casos-telefone-br.json (test/casos-telefone-br.test.mjs
--    confere que o bloco abaixo não divergiu dela).
select caso ->> 'entrada' as entrada, caso ->> 'chave' as esperada,
  private.br_phone_key(caso ->> 'entrada') as banco
from jsonb_array_elements(($casos$
{
  "sobre": "Casos de telefone para provar que private.br_phone_key (SQL) e variantesBR (apps/emyleads/src/lib/phone.js) casam os mesmos contatos. Dois telefones casam no portal se variantesBR deles se cruza; no banco, se br_phone_key é igual e não nulo. Lido por test/casos-telefone-br.test.mjs e por supabase/provas/prova-escala-banco.mjs.",
  "casos": [
    {
      "entrada": "(65) 99217-8164",
      "chave": "556592178164",
      "nota": "celular escrito como se digita, com o 9"
    },
    {
      "entrada": "6592178164",
      "chave": "556592178164",
      "nota": "celular sem DDI e sem o 9"
    },
    {
      "entrada": "65992178164",
      "chave": "556592178164",
      "nota": "celular sem DDI, com o 9"
    },
    {
      "entrada": "556592178164",
      "chave": "556592178164",
      "nota": "forma antiga, 8 dígitos começando com 9"
    },
    {
      "entrada": "5565992178164",
      "chave": "556592178164",
      "nota": "forma nova, 9 dígitos"
    },
    {
      "entrada": "+55 65 99217-8164",
      "chave": "556592178164",
      "nota": "com + e espaços"
    },
    {
      "entrada": "0055 65 99217-8164",
      "chave": "556592178164",
      "nota": "com zeros de discagem internacional"
    },
    {
      "entrada": "065992178164",
      "chave": "556592178164",
      "nota": "com zero de operadora antes do DDD"
    },
    {
      "entrada": "551187654321",
      "chave": "551187654321",
      "nota": "8 dígitos começando com 8"
    },
    {
      "entrada": "5511987654321",
      "chave": "551187654321",
      "nota": "o mesmo com o 9"
    },
    {
      "entrada": "556576543210",
      "chave": "556576543210",
      "nota": "8 dígitos começando com 7"
    },
    {
      "entrada": "5565976543210",
      "chave": "556576543210",
      "nota": "o mesmo com o 9"
    },
    {
      "entrada": "556566543210",
      "chave": "556566543210",
      "nota": "8 dígitos começando com 6"
    },
    {
      "entrada": "5565966543210",
      "chave": "556566543210",
      "nota": "o mesmo com o 9"
    },
    {
      "entrada": "556532345678",
      "chave": "556532345678",
      "nota": "fixo, 8 dígitos começando com 3"
    },
    {
      "entrada": "5565932345678",
      "chave": "556532345678",
      "nota": "9 dígitos começando com 9 e depois 3 (só casa com o fixo)"
    },
    {
      "entrada": "556512345678",
      "chave": "556512345678",
      "nota": "8 dígitos começando com 1"
    },
    {
      "entrada": "5565912345678",
      "chave": "556512345678",
      "nota": "9 + 1: casa com o de cima"
    },
    {
      "entrada": "556502345678",
      "chave": "556502345678",
      "nota": "8 dígitos começando com 0"
    },
    {
      "entrada": "5565902345678",
      "chave": "556502345678",
      "nota": "9 + 0: casa com o de cima"
    },
    {
      "entrada": "5565812345678",
      "chave": "5565812345678",
      "nota": "9 dígitos começando com 8: sozinho"
    },
    {
      "entrada": "5565712345678",
      "chave": "5565712345678",
      "nota": "9 dígitos começando com 7: sozinho"
    },
    {
      "entrada": "6532345678",
      "chave": "556532345678",
      "nota": "fixo sem DDI"
    },
    {
      "entrada": "11987654321",
      "chave": "551187654321",
      "nota": "São Paulo sem DDI"
    },
    {
      "entrada": "11 8765-4321",
      "chave": "551187654321",
      "nota": "São Paulo sem DDI e sem o 9"
    },
    {
      "entrada": "14155552671",
      "chave": "5514155552671",
      "nota": "EUA (11 dígitos começando com 1)"
    },
    {
      "entrada": "+1 415 555 2671",
      "chave": "5514155552671",
      "nota": "EUA com +"
    },
    {
      "entrada": "351912345678",
      "chave": "351912345678",
      "nota": "Portugal (12 dígitos)"
    },
    {
      "entrada": "447911123456",
      "chave": "447911123456",
      "nota": "Reino Unido"
    },
    {
      "entrada": "5511987654321000",
      "chave": null,
      "nota": "16 dígitos: inválido"
    },
    {
      "entrada": "55119876543210",
      "chave": "55119876543210",
      "nota": "14 dígitos começando com 55: internacional, sem variante"
    },
    {
      "entrada": "551198765432100",
      "chave": "551198765432100",
      "nota": "15 dígitos começando com 55"
    },
    {
      "entrada": "12345",
      "chave": null,
      "nota": "curto demais"
    },
    {
      "entrada": "123456789",
      "chave": null,
      "nota": "9 dígitos: curto demais"
    },
    {
      "entrada": "",
      "chave": null,
      "nota": "vazio"
    },
    {
      "entrada": null,
      "chave": null,
      "nota": "nulo"
    },
    {
      "entrada": "abc",
      "chave": null,
      "nota": "sem dígitos"
    },
    {
      "entrada": "0000000000",
      "chave": null,
      "nota": "só zeros"
    },
    {
      "entrada": "120363012345678901",
      "chave": null,
      "nota": "id de grupo (18 dígitos): inválido"
    },
    {
      "entrada": "5565992178164-1600000000",
      "chave": null,
      "nota": "grupo antigo, telefone-carimbo"
    },
    {
      "entrada": "123456789012345",
      "chave": "123456789012345",
      "nota": "15 dígitos (LID curto)"
    },
    {
      "entrada": "98765432109876",
      "chave": "98765432109876",
      "nota": "14 dígitos qualquer"
    },
    {
      "entrada": "٥٥٦٥٩٩٢١٧٨١٦٤",
      "chave": null,
      "nota": "dígitos arábicos não contam como dígito"
    },
    {
      "entrada": "55 (65) 9 9217 8164",
      "chave": "556592178164",
      "nota": "formatação solta"
    },
    {
      "entrada": "5521999998888",
      "chave": "552199998888",
      "nota": "Rio, 9 + 9"
    },
    {
      "entrada": "552199998888",
      "chave": "552199998888",
      "nota": "Rio sem o 9"
    },
    {
      "entrada": "5521899998888",
      "chave": "5521899998888",
      "nota": "9 dígitos começando com 8"
    }
  ]
}
$casos$::jsonb) -> 'casos') as caso
where private.br_phone_key(caso ->> 'entrada') is distinct from caso ->> 'chave';

-- 7. A lista bate com as conversas, por empresa (esperado: conversas =
--    na_lista; com_contato é quantas casaram um contato do CRM). Como dono do
--    banco a RLS não filtra; a função roda como quem chama.
select o.id as organizacao,
  (select count(*) from public.whatsapp_conversations c where c.organization_id = o.id) as conversas,
  (select count(*) from public.nucleo_conversation_list(o.id, null, 5000)) as na_lista,
  (select count(contact_id) from public.nucleo_conversation_list(o.id, null, 5000)) as com_contato
from public.organizations o
where exists (select 1 from public.whatsapp_conversations c where c.organization_id = o.id)
order by conversas desc;
