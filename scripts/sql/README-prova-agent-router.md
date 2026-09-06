# Prova comportamental do Agent Router (FASE 13, primeira fatia)

Registro de como a migration
`20260905220000_fase_13_agent_router.sql` deve ser validada
**comportamentalmente**. A migration instala a precedência
**afinidade → campanha → padrão** dentro de `private.intelligence_payload`, que
é o único ponto de decisão por onde passam v1, v2, v3 e o preview.

Complementa [`README-prova-agente-padrao.md`](./README-prova-agente-padrao.md) e
[`README-prova-multi-agente.md`](./README-prova-multi-agente.md): a receita de
cluster descartável é a mesma das FASES C/D/E, inclusive os três detalhes de
`libpq5`, `listen_addresses` e `initdb` que estão registrados lá. O que muda é
a sequência (mais migrations) e o arquivo de prova.

## Resultado registrado

Executado em **06/09/2026**, PostgreSQL **17.9** userspace descartável na VPS
(`/tmp/fase-13`, socket unix, `listen_addresses = ''` — sem porta TCP):

- **56 migrations** do repositório aplicaram limpas, do zero, na ordem abaixo —
  inclusive a própria FASE 13, o que significa que suas guardas de pré-voo e
  suas asserções finais passaram contra Postgres real, e não só contra leitura;
- itens **A–L** de `prova-agent-router.sql`: **PASS em todos**, incluindo o
  `G.1`/`G.2`/`G.3` e o controle negativo do `I`;
- **zero fixtures** deixadas pela transação, conferido depois do `ROLLBACK` por
  contagem independente: 0 agentes da prova, 0 campanhas, 0 contextos, 0
  sessões de skill, 0 conexões, 0 credenciais de robô, 1 organização (a do
  seed), 2 perfis, 1 padrão de clientes. As 5 skills que restam
  (`agenda, pre-qualificacao, suporte, tarefas, vendas`) são de plataforma,
  semeadas por migration — estão idênticas no banco de controle;
- **produção não foi tocada**: nenhum comando contra o Supabase, e os dois
  serviços do runtime na VPS seguiram `active` com `NRestarts=0` e os mesmos
  `ActiveEnterTimestamp` de antes (bridge 03/09, assistente 04/09);
- o cluster foi **destruído** ao fim, com `/tmp` limpo e nenhum processo
  `postgres` do usuário sobrevivente.

### Comparação com banco de controle

No mesmo cluster foi montado um segundo banco (`sem_router`) com **a mesma
cadeia menos a FASE 13**, para comparar antes/depois por introspecção:

| Função | Sem FASE 13 | Com FASE 13 |
|---|---|---|
| `private.intelligence_payload` | `7d026211…` | **`75e64817…`** (a única que mudou) |
| `private.provision_intelligence` | `2ce57ef0…` | `2ce57ef0…` |
| `public.nucleo_intelligence_context_resolve` (v1) | `486f653b…` | `486f653b…` |
| `public.nucleo_intelligence_context_resolve_v2` | `a1110719…` | `a1110719…` |
| `public.nucleo_intelligence_context_resolve_v3` | `e4aa5c0a…` | `e4aa5c0a…` |
| `public.nucleo_customer_assistant_access` | `7ac0a815…` | `7ac0a815…` |
| `public.intelligence_context_preview` | `ea6b4c1c…` | `ea6b4c1c…` |

Os hashes do banco de controle batem com os que `docs/STATUS.md` registra para
**produção** (`7d026211…`, `2ce57ef0…`, `a1110719…`, `e4aa5c0a…`, `7ac0a815…`):
o cluster descartável reproduz o corpo vivo, então a comparação vale.

Também conferido, idêntico nos dois bancos:

- **assinatura**: `target_organization uuid, target_audience text,
  target_channel text, conversation_hash text, incoming_text text,
  source_data jsonb, should_persist boolean`;
- **`SECURITY DEFINER`**: `prosecdef = t`;
- **`search_path`**: `{"search_path=\"\""}`;
- **ACL**: `(padrão do banco)` nos dois — o `CREATE OR REPLACE` não mexeu em
  privilégio (a própria migration também assere isso, comparando `proacl`,
  `proowner`, `prosecdef` e `proconfig` antes e depois);
- **`schemaVersion`**: `fase-h-1` no payload (item J, que também trava as
  chaves de `assistente` e as de primeiro nível) e `fase-h-3` no v3 (item K).
  O **v2 foi exercitado de verdade**: o v3 o chama por baixo, então o `K PASS`
  só é possível com o v2 respondendo `audiencia = customer` normalmente.

### Desvio registrado

A cadeia incluiu as duas migrations que `docs/STATUS.md` marca como escritas e
**não aplicadas** em produção (`20260903210000_aviso_de_atribuicao_de_tarefa` e
`20260903230000_uma_verificacao_de_telefone_basta`), porque a receita manda
aplicar a cadeia do repositório em ordem. As duas aplicaram limpas e nenhuma
toca `assistant_profiles`, `organization_campaigns`,
`conversation_intelligence_contexts` ou qualquer resolvedor — o que a tabela de
hashes acima confirma, já que o corpo pré-FASE-13 saiu idêntico ao de produção.

### Versão

Produção é **17.6**; a prova rodou em **17.9**, como a da FASE E — o 17.6 não
está mais no pool do PGDG para noble. A semântica sob teste (`select into` sem
`strict`, índice parcial, FK composta, `%rowtype := null`) não varia entre
patches do mesmo major.

## Arquivos

| Arquivo | Papel |
|---|---|
| `harness-supabase-minimo.sql` | Mesmo das FASES C/D/E. |
| `prova-agente-padrao-seed.sql` | Mesmo das FASES C/D/E — fixtures pré-C, commitadas. |
| `prova-agent-router.sql` | A prova A–L. Roda dentro de uma transação que termina em `ROLLBACK`, mais um bloco pós-rollback (item L) que confere que nada vazou. |

`test/agent-router-migration.test.mjs` cobre o lado estático (a migration
declara a precedência que promete, não mexe em schema, não inventa vocabulário
de roteamento e preserva o contrato de saída). Os dois se complementam e nenhum
substitui o outro.

## Sequência de reprodução

```
1. harness-supabase-minimo.sql
2. migrations do repositório, em ordem, até a FASE B (20260904160000)
   inclusive — NÃO aplicar a FASE C ainda
3. prova-agente-padrao-seed.sql        <-- fixtures pré-C, COMMIT
4. 20260904190000  (FASE C)
5. 20260904230000  (FASE D)
6. 20260905000000  (FASE E)
7. 20260905120000 e 20260905160000  (FASE F, nesta ordem)
8. 20260905200000  (hardening da RPC da FASE F)
9. 20260905220000  (FASE 13 — o que está sendo provado)
10. prova-agent-router.sql
```

Como nas fases anteriores: os arquivos saem do Windows com CRLF, normalizar com
`tr -d '\r'` antes de aplicar via `psql -f`.

Diferença em relação à prova da FASE D: aqui **nenhuma constraint é removida
dentro do teste**. A FASE E já tirou `unique (organization_id, audience)`, então
o segundo agente entra por `insert` normal. Se algum dia este script precisar de
um `alter table`, é sinal de que a sequência acima foi rodada errada.

## Itens

| Item | O que prova |
|---|---|
| `A` | Conversa nova, sem campanha: o padrão continua atendendo. Nada regrediu. |
| `B` | Conversa pinada em agente **não-padrão** é atendida por ele. É a fase inteira em um item. |
| `C` | Persistir não devolve a conversa ao padrão, e o turno seguinte continua no mesmo agente. Existe porque o corpo da FASE D fazia `set assistant_profile_id = selected_profile.id` com o padrão — a afinidade tinha campo e não tinha efeito. |
| `D` | Agente pinado **inativo** recusa, com o padrão ativo ao lado. Cair no padrão aqui trocaria personalidade, skills e conhecimento no meio da conversa. |
| `E` | Campanha elegível leva a conversa nova para o agente **da campanha**, e devolve essa campanha no payload. |
| `F` | Campanha cujo agente está inativo recusa, sem cair no padrão. |
| `G.1` | Campanha de clientes apontando para agente **interno** recusa — audience não é enforcado por FK, é decisão da função. |
| `G.2` | Campanha apontando para agente de **outra organização** é impossível: a FK composta `(assistant_profile_id, organization_id)` levanta `foreign_key_violation`. Estrutura, não policy. |
| `G.3` | A mesma chave de conversa, em outra organização, **não** herda a afinidade: resolve o padrão de lá. |
| `H` | Sem afinidade e sem campanha, o padrão atende — nos dois públicos. O caminho de todo dia. |
| `I` | Sem padrão, e com dois agentes ativos, falha fechado. Inclui **controle negativo**: a regra antiga (`audience + active + limit 1`) encontra alguém no mesmo estado em que a nova recusou — ou seja, o item não passou por acidente. |
| `J` | `schemaVersion` = `fase-h-1` e as chaves de `assistente` e de primeiro nível do payload são exatamente as de antes. É o que o runtime valida na borda. |
| `K` | O **v3 ponta a ponta** resolve pelo agente pinado. O discriminador é a skill de recepção publicada e vinculada **só** ao agente não-padrão: se o v3 lesse o padrão, morreria em `published reception skill is required for customer routing`. |
| `L` | Pós-rollback: agente, campanha, skill, contextos, conexão, credencial de robô e a organização 2 sumiram, e o padrão do seed continua sendo um só. |

## Onde a prova não chega

- **RLS com JWT de usuário final.** Roda como superusuário, como as provas
  anteriores. A fatia não muda policy nenhuma — é `CREATE OR REPLACE` de uma
  função `security definer` —, mas ninguém autenticou como membro de outra
  organização para tentar ler agente alheio.
- **Concorrência.** Dois turnos simultâneos da mesma conversa não são
  exercitados. O `select ... limit 1` do contexto não pega `for update` (não
  pegava antes desta fatia também); quem serializa o turno de cliente é o
  `for update` do v3, um nível acima.
- **Tráfego real.** Como nas FASES D e E, produção segue sem tráfego
  observável no caminho de resolução; o que sustenta a fase é esta prova mais a
  introspecção do catálogo depois de aplicar.
- **O worker.** `whatsapp-mcp-hardened` não muda nesta fatia e por isso não
  entra na prova. A validação de que ele continua aceitando o payload é o
  contrato `J` mais os testes de `whatsapp-assistant/test_intelligence.py`, que
  não foram alterados.
