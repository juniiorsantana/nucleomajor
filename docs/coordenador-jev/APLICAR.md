# Aplicar a migration do coordenador

Migration: `supabase/migrations/20260930100000_o_coordenador_le_as_conversas.sql`.
Aplicação **manual, pelo SQL Editor**, como todas (`docs/DEPLOYMENT.md`).

## O que ela faz

- Acrescenta a função **"Leitura automatica das conversas"**
  (`conversation_insights`) ao catálogo do painel, **desligada para todas as
  empresas**.
- Cria `conversation_insight_runs` e `conversation_insight_answers`, com RLS
  de leitura para membros da empresa e **nenhuma** escrita direta.
- Cria as RPCs `nucleo_insights_pending` e `nucleo_insights_record`, que só o
  robô da conexão consegue chamar.
- Não cria gatilho, não mexe em nenhuma tabela ou função existente.

Sozinha, ela não muda nada para ninguém: a função nasce desligada e o runtime
ainda não chama as RPCs.

## Antes

1. A `main` atualizada não tem migration nova depois de `20260929120000` que
   mexa em `platform_features`, `whatsapp_conversations` ou
   `whatsapp_messages` (o outro programador também publica migrations).
2. Pré-requisitos, que a própria migration confere e aborta se faltar:
   `20260924100000` (funções por empresa), `20260913230000` (autoria das
   mensagens) e o espelho das conversas.

## Aplicar

1. No SQL Editor, cole o arquivo inteiro. No Windows, antes de rodar, no
   console do navegador: `monaco.editor.getModels()[0].setEOL(0)` (LF), para os
   corpos das funções não ficarem com CRLF.
2. Rode. A migration é uma transação (`begin` … `commit`) e termina com uma
   conferência própria que aborta tudo se o estado não for o prometido.
3. Rode `scripts/sql/validar-coordenador-jev.sql`. **Todas as colunas `true`.**
4. Registre em `docs/STATUS.md`, seção "Banco aplicado".

## Depois

1. No painel da plataforma (`painel.nucleomajor.com`), ligue "Leitura
   automatica das conversas" **só para a Núcleo Major**. Ele pede a
   confirmação de IA.
2. Confira: `select private.org_has_feature('338e44ca-36ab-437c-b8ac-aa7c60fee64a', 'conversation_insights');` → `true`.
3. Siga para o deploy do runtime: `patches/runtime-coordenador-jev-DEPLOY.md`.

## Voltar atrás

Desligar a função no painel cala o coordenador no próximo ciclo. A migration
não precisa ser desfeita: as tabelas vazias não atrapalham nada. Se for mesmo
preciso remover:

```sql
begin;
drop function if exists public.nucleo_insights_record(jsonb);
drop function if exists public.nucleo_insights_pending(integer, integer);
drop table if exists public.conversation_insight_answers;
drop table if exists public.conversation_insight_runs;
delete from public.organization_entitlements where key = 'conversation_insights';
delete from public.platform_features where key = 'conversation_insights';
commit;
```
