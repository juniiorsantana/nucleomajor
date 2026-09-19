# Leva 2: o plano sem IA nunca chega ao Claude

Esta leva só pode ser aplicada **depois** da Leva 1
([ROTEIRO-LEVA-1-CHECKOUT-ASAAS.md](ROTEIRO-LEVA-1-CHECKOUT-ASAAS.md)).

## O que muda

São três camadas.

1. **Na VPS (a trava principal, que entra na Leva 3).** A conexão de um
   cliente Base nasce com o assistente desligado na política do Bridge e sem
   login do Claude. Nenhuma mensagem chega ao runtime.
2. **No banco (esta migration).** Quatro funções vivas vão **intactas** para o
   schema `private`, com o mesmo nome. No lugar de cada uma entra uma função
   fina, com a mesma assinatura, que confere o plano e depois delega:
   - `nucleo_customer_assistant_access`: sem IA, responde `allowed: false`
     com `plan_without_assistant`, e o runtime ignora a mensagem sem avisar o
     cliente;
   - `nucleo_intelligence_context_resolve_v2` e `_v3`: sem IA, não entregam
     contrato, e o runtime não chama o Claude. O roteador da FASE 13 roda
     dentro deles;
   - `customer_assistant_rollout_update`: sem IA, recusa `pilot` e `active`.
3. **No servidor.** `POST /api/assistant/messages` responde 402 para plano sem
   IA.

A trava vale também para empresa **bloqueada** por falta de pagamento, mesmo
que o plano dela tenha IA.

**Para a Major (plano `full`, ativa), nada muda.** A prova compara as quatro
funções antes e depois da migration (resultado ou erro, com ids e horários
normalizados) e todas saem idênticas.

## Provas

- `scripts/sql/prova-plano-sem-ia.mjs`: **28 verificações, PASS** (inclui executar o "Desfazer" abaixo). Reaplica o
  harness e todas as migrations reais em PGlite 0.5.8.
- `test/assistant-plan.test.mjs`: a trava do servidor.

## Aplicar

1. No SQL Editor, abra o **arquivo**
   `supabase/migrations/20260920110000_plano_sem_ia_nao_chama_o_claude.sql`,
   copie tudo e rode.
2. Confira com esta consulta. As quatro linhas precisam voltar `true`:

   ```sql
   select p.proname,
          n.nspname,
          position('org_has_feature' in p.prosrc) > 0 as confere_o_plano
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname in ('nucleo_customer_assistant_access', 'nucleo_intelligence_context_resolve_v2',
                       'nucleo_intelligence_context_resolve_v3', 'customer_assistant_rollout_update')
     and n.nspname = 'public';
   ```

3. Mande uma mensagem de um número de cliente para o WhatsApp da Major e
   confirme que o atendimento continua exatamente como antes.

## Desfazer

Rode no SQL Editor, na ordem:

```sql
begin;
drop function public.nucleo_customer_assistant_access(text);
drop function public.nucleo_intelligence_context_resolve_v2(text, text, text, jsonb);
drop function public.nucleo_intelligence_context_resolve_v3(text, text, text, jsonb);
drop function public.customer_assistant_rollout_update(uuid, text, uuid[]);
alter function private.nucleo_customer_assistant_access(text) set schema public;
alter function private.nucleo_intelligence_context_resolve_v2(text, text, text, jsonb) set schema public;
alter function private.nucleo_intelligence_context_resolve_v3(text, text, text, jsonb) set schema public;
alter function private.customer_assistant_rollout_update(uuid, text, uuid[]) set schema public;
grant execute on function public.nucleo_customer_assistant_access(text) to authenticated;
grant execute on function public.nucleo_intelligence_context_resolve_v2(text, text, text, jsonb) to authenticated;
grant execute on function public.nucleo_intelligence_context_resolve_v3(text, text, text, jsonb) to authenticated;
grant execute on function public.customer_assistant_rollout_update(uuid, text, uuid[]) to authenticated;
commit;
```

**Atenção:** daqui em diante, uma migration que precise mudar o corpo de uma
dessas quatro funções muda `private.<mesmo nome>`. Um `create or replace` no
nome público substituiria a função fina e tiraria a trava.
