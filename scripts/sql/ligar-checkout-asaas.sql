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
-- BLOCO 2 — quais Links de Pagamento vendem cada plano, e em que ciclo.
--
-- São até seis links no Asaas: Base, Atendimento com IA e Completo, cada um
-- mensal e anual. Crie no Asaas como Link de Pagamento de COBRANÇA RECORRENTE,
-- forma de pagamento "o cliente escolhe" (cartão ou boleto/Pix), e o ciclo
-- igual ao da linha abaixo (Mensal ou Anual).
--
-- O ID é o número no fim do endereço do link no Asaas:
--   https://www.asaas.com/c/725104409743      →  725104409743
--   https://sandbox.asaas.com/c/725104409743  →  725104409743
--
-- Troque cada COLE_AQUI_... pelo número do link correspondente. Apague as
-- linhas dos links que você ainda não criou. O link do sandbox e o de produção
-- são links diferentes: rode este bloco uma vez para cada ambiente.
--
-- ATENÇÃO: só publique os links de Atendimento e Completo depois que a IA
-- mínima estiver na VPS (plano-tres-planos-e-ia.md, Parte B). Antes disso o
-- script da VPS não monta conexão com IA.
-- ---------------------------------------------------------------------------
insert into public.billing_payment_links (provider, external_link_id, plan_code, billing_cycle, label)
values
  ('asaas', 'COLE_AQUI_BASE_MENSAL',        'base',        'MONTHLY', 'Base mensal'),
  ('asaas', 'COLE_AQUI_BASE_ANUAL',         'base',        'YEARLY',  'Base anual'),
  ('asaas', 'COLE_AQUI_ATENDIMENTO_MENSAL', 'atendimento', 'MONTHLY', 'Atendimento com IA mensal'),
  ('asaas', 'COLE_AQUI_ATENDIMENTO_ANUAL',  'atendimento', 'YEARLY',  'Atendimento com IA anual'),
  ('asaas', 'COLE_AQUI_COMPLETO_MENSAL',    'completo',    'MONTHLY', 'Completo mensal'),
  ('asaas', 'COLE_AQUI_COMPLETO_ANUAL',     'completo',    'YEARLY',  'Completo anual')
on conflict (provider, external_link_id) do update
  set plan_code = excluded.plan_code,
      billing_cycle = excluded.billing_cycle,
      label = excluded.label,
      active = true;
