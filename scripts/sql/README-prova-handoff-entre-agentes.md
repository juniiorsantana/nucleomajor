# FASE 14 — Prova comportamental

Executada em 06/09/2026 no host SSH conhecido da Major, com PostgreSQL **17.9**
userspace descartável. **A–H, incluindo G2: PASS.** Produção não foi alterada.

`run-prova-handoff.sh` monta a cadeia completa em `control`, com o harness mínimo
e o seed pré-C usados pela 13C, e clona em `handoff` antes de aplicar 14B/14C.
São **57 migrations de base e duas novas**. O cluster nasce em diretório exclusivo
`/tmp/fase-14.XXXXXX`, sem porta TCP. Um trap encerra o processo e remove o cluster,
inclusive em falha. Logs são preservados fora dele para coleta.

```sh
tar -cf /tmp/fase-14-sql.tar supabase/migrations scripts/sql
bash scripts/sql/run-prova-handoff.sh /tmp/fase-14-sql.tar
```

Executar somente em ambiente descartável, como usuário sem privilégios de root.
Nunca executar seed, harness ou prova no Supabase. As migrations de produção
devem ser aplicadas exclusivamente pelo SQL Editor.

| Item | Evidência |
|---|---|
| A | Skill publicada com a capacidade atravessa v2 e v3 |
| B | Fixo muda, skill é zerada, sessão é fechada, contexto segue ativo |
| C | Auditoria contém exatamente quatro campos; resumo não sai no retorno |
| D | Turno seguinte recebe persona/skill do destino, sem skill exclusiva da origem |
| E | A→B→A, terceiro salto permitido e quarto recusado sem incrementar |
| F | Destino inexistente, inativo, outro público/tenant, self e motivo inválido recusados |
| G | Humano prevalece, contexto fechado/ausente e robô revogado recusados |
| G2 | Vínculos equivalentes: payload inteiro igual fora agente e revisão da sessão |
| H | ROLLBACK remove fixtures e auditoria da prova |

A lista `skillsPermitidos` muda quando os vínculos diferem: preservar as skills
anteriores seria o vazamento que a fase evita. D prova o isolamento; G2 prova a
compatibilidade sem mascarar diferenças no resto do payload.

## Comparação com controle

Foram comparadas **143 funções anteriores e 144 posteriores** em `public/private`
(incluindo uma sobrecarga; 142 e 143 nomes distintos).
A única função adicionada é a RPC; somente v2 e v3 mudam. Todas as outras,
inclusive `private.intelligence_payload`, permanecem idênticas.

| Função | MD5 do corpo normalizado antes | Depois |
|---|---|---|
| intelligence_payload | `4ed9516507bcf8322f14e313fa08a94e` | igual |
| nucleo_customer_agent_handoff | ausente | `c5a77221e64b6be22720cc1800faf683` |
| resolve_v2 | `c3409285d0afb1a7227f0787c01cb4a3` | `cf6d7160329a589602d730412215c801` |
| resolve_v3 | `ca95dbd5882f8547ceb1d593c0590722` | `f74eee42963ae1c1a0f033ce3905811b` |

`md5(pg_get_functiondef(intelligence_payload))` continua
`fa473433b5a5f6e3b440383fcffce4e0`, como na 13C.
Evidências locais: `artifacts/fase-14/fase-14-sql-evidence/`.

## Aplicação e aceite pendentes

1. Executar [validar-fase-14.sql](./validar-fase-14.sql) no SQL Editor. Conferir
   baselines, slugs, audience e fallback publicado do destino; não publicar skill
   nova antes de os dois resolvedores aceitarem a capacidade.
2. Aplicar 14B e depois 14C pelo SQL Editor, cada arquivo inteiro em sua transação.
3. Reexecutar a validação: os quatro hashes aceitos devem conferir; a coluna deve
   ser integer, NOT NULL, default 0; RPC sem EXECUTE para anon, com EXECUTE para
   authenticated, SECURITY DEFINER e search_path vazio.
4. Confirmar o slug comercial proposto `sdr` nas instruções; corrigir ambas se
   divergir do agente real. A Recepção **e Vendas**
   têm a capacidade: “quero fechar plano” ativa Vendas pelas regras anteriores.
5. Publicar somente as skills alteradas, com `npm run intelligence:publish --
   --slug recepcao --apply` e `--slug vendas --apply`; conferir versões/hashes.
6. Conferir HEAD/arquivos/serviços da VPS, publicar runtime, conferir
   ActiveState/NRestarts e executar a conversa real.

O navegador foi impedido de abrir Supabase pela revisão automática de acesso.
As consultas SSH atuais também não encontraram unidades `whatsapp*`, apesar do
registro de produção da 13C. Não tratar o checkout limpo `da11193` como prova
de serviço rodando. Runtime, banco e skills não foram publicados nesta execução.

## Limites da prova

Sem tráfego WhatsApp real, concorrência ou RLS com JWT de usuário final. O JWT de
robô é simulado por GUC, como nas provas anteriores. A auditoria pode ser podada;
o teto depende exclusivamente da coluna, sob lock do contexto.

As primeiras rodadas corrigiram fixtures: profile já criado por trigger,
`revoked_at` obrigatório na revogação e comparação de `skillsPermitidos` entre
agentes com bindings distintos. Nenhuma guarda da RPC foi relaxada.
