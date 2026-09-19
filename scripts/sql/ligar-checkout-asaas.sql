-- Liga o checkout do Asaas ao banco. Rodar no SQL Editor do Supabase DEPOIS
-- da migration 20260920100000_o_pagamento_libera_a_empresa.sql.
--
-- São DOIS blocos, e cada um roda SOZINHO (selecione o bloco e execute).

-- ---------------------------------------------------------------------------
-- BLOCO 1 — o token do webhook.
--
-- O resultado mostra `billing_intake_token`. Copie o valor para a variável
-- BILLING_INTAKE_TOKEN da Hostinger. Ele NÃO aparece de novo: o banco guarda
-- só o sha256. Rodar este bloco outra vez gera outro token e invalida o
-- anterior (aí é preciso trocar a variável na Hostinger também).
-- ---------------------------------------------------------------------------
with novo as (
  select encode(extensions.gen_random_bytes(32), 'hex') as token
), gravado as (
  insert into public.billing_intakes (provider, token_hash)
  select 'asaas', encode(extensions.digest(novo.token, 'sha256'), 'hex')
  from novo
  on conflict (provider) do update
    set token_hash = excluded.token_hash, enabled = true, updated_at = now()
  returning provider
)
select novo.token as billing_intake_token
from novo, gravado;

-- ---------------------------------------------------------------------------
-- BLOCO 2 — qual Link de Pagamento vende o plano Base.
--
-- O ID é o número no fim do endereço do link no Asaas:
--   https://www.asaas.com/c/725104409743      →  725104409743
--   https://sandbox.asaas.com/c/725104409743  →  725104409743
-- Troque COLE_AQUI_O_ID_DO_LINK pelo número e rode. O link do sandbox e o de
-- produção são links diferentes: rode uma vez para cada.
-- ---------------------------------------------------------------------------
insert into public.billing_payment_links (provider, external_link_id, plan_code, label)
values ('asaas', 'COLE_AQUI_O_ID_DO_LINK', 'base', 'Plano Base mensal')
on conflict (provider, external_link_id) do update
  set plan_code = excluded.plan_code, label = excluded.label, active = true;
