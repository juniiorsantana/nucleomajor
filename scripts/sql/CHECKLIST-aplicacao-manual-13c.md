# FASE 13C — aplicação manual pelo dono do projeto

Preparado em 06/09/2026. **Não comprova aplicação em produção.**

Código do banco: `fase-13c/soul-do-agente`, commit `1f232a0`, no origin.
Runtime: `fase-13c/soul-no-prompt`, commit `475b907`, publicado no remoto
`github` de `juiiorsantana/whatsapp-mcp-hardened`; inclui o ancestral `4b969e3`.
A URL já estava correta: o acesso exigia a conta `juiiorsantana`, enquanto a
conta ativa era `juniiorsantana`. A conta padrão não foi trocada.

A [prova A–J](./README-prova-soul-do-agente.md) passou em Postgres descartável.
Aplicar é uma etapa distinta, executada **somente pelo dono no SQL Editor**.
Não usar CLI, PAT, Management API, `db push` ou `migration repair`.

A consulta deste checklist também foi executada em PostgreSQL 17.9
descartável em 06/09/2026, antes e depois da 13C, com
`default_transaction_read_only=on`. Identificou as duas fases, a constraint
validada, as seis funções preservadas e o objeto `dados` idêntico. Evidências:
`artifacts/fase-13c-checklist-20260906/antes.json` e `depois.json`. O cluster foi
removido e os serviços da VPS mantiveram estado, reinícios e horário de ativação.

## 1. Guardar a linha de base

- [ ] Abrir o SQL Editor do projeto EmyLeads e conferir o identificador
  `lwoqcvuspsmfowiuipmv` no painel. `current_database()` costuma ser `postgres`
  em vários projetos e, sozinho, não identifica o destino.
- [ ] Escolher um intervalo sem edições de agentes ou turnos de conversa,
  para comparar os dados antes e depois. Não é necessário reiniciar serviços.
- [ ] Executar **inteira** a consulta [validar-fase-13c.sql](./validar-fase-13c.sql)
  e exportar o JSON como evidência **ANTES**. Ela apenas lê catálogos e tabelas;
  não chama o resolvedor, não cria fixtures e não devolve o texto das personas.
- [ ] Conferir: `funcoes_encontradas = 7`, `payload_13b_confirmado = true`,
  `payload_13c_confirmado = false`, `coluna_soul_existe = true`,
  `digest_texto_existe = true`, `dados.perfis.soul_acima_de_8000 = 0` e
  `constraint_soul = []`. Qualquer divergência exige análise antes de aplicar;
  `payload_13c_confirmado = true` indica que não se deve reaplicar.

Guardar o objeto `dados` e os metadados das sete funções. As contagens antigas
registradas na documentação não substituem essa leitura atual.

## 2. Aplicar uma única migration

- [ ] Em outra consulta do SQL Editor, abrir e colar **todo** o conteúdo de
  [20260906010000_fase_13c_soul_do_agente_no_prompt.sql](../../supabase/migrations/20260906010000_fase_13c_soul_do_agente_no_prompt.sql),
  do commit `1f232a0`, incluindo `begin;`, as guardas, as asserções e `commit;`.
- [ ] Executar o arquivo inteiro uma vez. Não executar só a seleção do editor
  nem retirar as guardas. Se ocorrer erro, guardar a mensagem e parar para
  análise; não ajustar ou reaplicar automaticamente.
- [ ] Não executar `prova-*.sql`, seeds ou harness no Supabase.

## 3. Conferir o efeito

- [ ] Executar novamente [validar-fase-13c.sql](./validar-fase-13c.sql), no mesmo
  projeto, papel e timezone, e exportar o JSON como evidência **DEPOIS**.
- [ ] Exigir `payload_13c_confirmado = true` e o hash normalizado exato abaixo.
- [ ] Conferir `funcoes_encontradas = 7`. Entre as sete funções, somente o
  corpo de `private.intelligence_payload` pode mudar. Nas outras seis, os
  hashes e metadados devem permanecer iguais aos da evidência ANTES.
- [ ] No payload, assinatura, dono, ACL, `security_definer = true` e
  `configuracao` com `search_path=""` devem permanecer iguais a ANTES.
- [ ] `constraint_soul` deve conter uma única CHECK (`tipo = "c"`),
  `validada = true`, aceitando `soul_markdown IS NULL` ou
  `length(soul_markdown) <= 8000`. Conferir a definição, não apenas o nome.
- [ ] O objeto `dados` deve ser idêntico a ANTES: contagens, padrões, ativos,
  datas e fingerprints dos perfis, contextos e `intelligence_audit_log`.
  Os fingerprints incluem todas as colunas, portanto também detectam troca
  de agente sem mudança de contagem. Havendo diferença, investigar atividade
  concorrente antes de concluir se foi efeito da migration; não restaurar
  dados nem declarar sucesso automaticamente.

| Valor | Esperado |
|---|---|
| Corpo ANTES: `md5(replace(prosrc, chr(13), ''))` | `f5a6b72b2a01f96aab60e5d6b4e50319` |
| Corpo DEPOIS: `md5(replace(prosrc, chr(13), ''))` | **`4ed9516507bcf8322f14e313fa08a94e`** |
| Definição no cluster de prova: `md5(pg_get_functiondef(...))` | `fa473433b5a5f6e3b440383fcffce4e0` |

O hash da definição pode divergir por CRLF ao colar pelo Windows. O aceite usa
o **corpo normalizado**, além das conferências estruturais e de dados acima.

## 4. Devolver as evidências

Enviar a confirmação de aplicação, o horário e os dois JSONs ANTES/DEPOIS.
A conferência do catálogo permitirá registrar o resultado em `docs/STATUS.md`.
O deploy do runtime na VPS é uma etapa separada; esta consulta não comprova
que a nova persona já entrou em um prompt real. O runtime novo aceita payload
sem Soul, e o antigo ignora as chaves novas.
