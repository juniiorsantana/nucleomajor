# Continuação do trabalho multi-agent

Ponto de retomada escrito em **04/09/2026**, no fim da ETAPA 9A, para quem
assume o trabalho em outra máquina e outra conta. Este arquivo não substitui
[MULTI-AGENT-MIGRATION.md](./MULTI-AGENT-MIGRATION.md) — aquele é o desenho,
este é o **estado**: o que está aplicado, o que está só escrito, o que
bloqueia, e as armadilhas de ambiente que já custaram tempo.

## Onde parar de ler o resto e olhar primeiro

| Coisa | Valor |
|---|---|
| Branch canônica | `feature/multi-agent-foundation` |
| HEAD | ver `git log -1` — este arquivo foi atualizado após a FASE E ser validada comportamentalmente |
| Próxima ação | **aplicar a FASE E em produção** (`20260905000000_a_audience_deixa_de_limitar_a_um_agente.sql`), com o mesmo fluxo controlado das FASES B, C e D |
| Bloqueio | nenhum — prova A–N passou, com controle negativo |
| Produção | FASES B, C e **D aplicadas** (D em 04/09/2026). A **E está escrita e provada, não aplicada**: a unique antiga continua de pé em produção, e multi-agent segue **não** liberado |

## Histórico da branch

`git log --oneline origin/main..HEAD`, do mais antigo para o mais novo:

```
4098dd7 feat: as ferramentas do agente ganham um registro único      (Tool Registry)
84cfbe0 feat: a resposta dos resolvedores ganha um contrato próprio  (Intelligence Contract)
410a2ce feat: resolver inteligência deixa de ser chamar RPC          (Intelligence Core)
e47332c feat: o assistente vira Agent, com identidade que o banco guarda  (FASE B)
1fa4f2c feat: o agente padrão vira coluna, em vez de consequência da constraint (FASE C)
c715d92 docs: registra a aplicação da FASE B em produção
37940a9 test: torna reproduzível a prova comportamental do agente padrão
01fb766 docs: registra a aplicação da FASE C em produção
3d2173b feat: os resolvedores param de pegar "algum" agente e pedem o padrão (FASE D)
```

Existe uma branch antiga, `identidade-e-padrao-do-agente`, que recebeu um
commit por engano e **não deve ser reescrita nem resetada**. O conteúdo dela já
foi trazido por cherry-pick (`37940a9`). Ignore-a.

## Estado de cada fase

| Fase | Estado | Onde |
|---|---|---|
| A — `AgentDefinition` no domínio | ✅ feita | `packages/intelligence/src/agent.mjs` |
| B — `slug`, `role`, `soul_markdown` | ✅ **aplicada em produção** 04/09/2026 | `20260904160000_...sql` |
| C — `is_default` + índice parcial + unique de slug | ✅ **aplicada em produção** 04/09/2026 | `20260904190000_...sql` |
| D — resolvedores usam o padrão | ✅ **validada comportamentalmente** (A–H PASS, 04/09/2026), **NÃO aplicada em produção** | `20260904230000_...sql` |
| E — remover `unique (organization_id, audience)` | pendente | — |
| F — API/UI para criar agente | pendente | — |
| G — Agent Router | pendente | — |

**Ordem inegociável: C e D antes de E.** Remover a unique antes de os
resolvedores saberem o que é "o agente padrão" é regressão silenciosa — nenhum
erro, só o agente variando entre chamadas.

## O que está em produção hoje

Conferido por consulta ao catálogo em 04/09/2026 (nunca pela mensagem de
sucesso — ver "Armadilhas"):

- `assistant_profiles` tem `slug` (not null), `role`, `soul_markdown`,
  `is_default boolean not null default false`.
- 2 perfis, 1 organização: 1 `internal` + 1 `customer`, ambos `active`, ambos
  `is_default = true`. Zero colisões de slug.
- Constraints: `unique (organization_id, audience)` **ainda existe**;
  `assistant_profiles_organization_slug_key` existe; índice parcial
  `assistant_profiles_one_default_idx` (`where is_default`) existe.
- `private.provision_intelligence` cria os dois perfis iniciais com
  `is_default = true`.
- **Nenhum resolvedor usa `is_default` ainda** — é exatamente isso que a FASE D
  muda, e ela não foi aplicada.

Hashes das funções vivas no fim da ETAPA 9A, para comparar antes de aplicar
qualquer coisa (se algum divergir, alguém mexeu em produção fora daqui):

```
private.intelligence_payload                     a50d3dae87b31f575d7b9cc12c916509
private.provision_intelligence                   d9449193f7f64d56638870c2ccaba6ef
public.nucleo_customer_assistant_access          b78b130bf1d33b0534ef3f5ddaadbe42
public.nucleo_intelligence_context_resolve_v2    59560191528beec6d74cb3f9b7a11631
public.nucleo_intelligence_context_resolve_v3    e4aa5c0afb9e0673c1331c24597a3388
```

## A FASE D em uma tela

A regra:

```
organização + audience + is_default = true   ->   o agente
depois, e só depois, verifica-se `active`
```

A ordem é o ponto inteiro. `intelligence_payload` filtrava `and profile.active`
**dentro** do `where` da seleção. Com um agente só, isso é indistinguível de
checar depois. Com dois, é a diferença entre "o padrão está parado, recuse" e
"o padrão está parado, então fale pelo outro". Um agente não herda a conversa
de outro por acidente de disponibilidade.

Três funções mudaram, e em cada uma a **única** alteração é a seleção:

- `private.intelligence_payload` — o ponto por onde passa todo o runtime.
- `public.nucleo_customer_assistant_access` — passa a pedir o padrão de
  `customer`; `profile_inactive` preservado.
- `public.nucleo_intelligence_context_resolve_v2` — só o join que acha o skill
  `tarefas`, que entrava por um perfil `internal` qualquer.

**Não** foram tocadas, de propósito: `nucleo_intelligence_context_resolve` (v1),
`nucleo_intelligence_context_resolve_v3` e `intelligence_context_preview`. A
cadeia real é **v3 → v2 → v1 → `intelligence_payload`**, e o "pin" do v3 não é
escolha de usuário: `intelligence_payload` regrava
`conversation_intelligence_contexts.assistant_profile_id` a cada turno. Corrigir
o payload corrige os três. Redefini-los criaria uma segunda semântica de padrão
— e os testes `F` e `H` reprovam quem tentar.

## O que falta, na ordem

### 1. Prova comportamental da FASE D — ✅ feita em 04/09/2026

`scripts/sql/prova-resolvedor-agente-padrao.sql` rodou num Postgres 17.6
descartável na VPS (mesma receita da FASE C —
`scripts/sql/README-prova-agente-padrao.md`) e deu **PASS em A–H**, incluindo:

- E.1–E.3: `nucleo_customer_assistant_access` fim a fim (default ativo,
  inativo, ausente), via credencial de robô simulada por GUCs de JWT.
- F.1–F.3: o cenário com **dois agentes** na mesma audience e a `unique
  (organization_id, audience)` removida dentro da transação — o padrão
  inativo **recusa** em vez de cair no segundo agente ativo, tanto por
  `intelligence_payload` quanto por `nucleo_customer_assistant_access`.
- G: controle negativo — a regra antiga *teria* caído no agente B.
- H: pós-`ROLLBACK`, a unique antiga voltou e nada vazou.

Produção reconferida por hash das 5 funções antes e depois da prova:
**idêntica**. Ambiente da VPS destruído por completo ao final (processo,
cluster, diretório em `/tmp`) — nada residual.

`v3` não foi exercitado ponta a ponta de propósito: ele não tem seleção de
agente própria (lê `context_row.assistant_profile_id`, que o item D prova
estar correto), e montar o caminho completo exigiria skill de recepção
publicada e sessão de skill — máquina da FASE H3, alheia ao que a FASE D
mudou. Coberto pelo item D + pelo contrato estático `H` do arquivo de teste.

### 2. Aplicar a FASE D em produção — **próximo passo**

Mesmo fluxo controlado das FASES B e C:

```
supabase db query --linked -f supabase/migrations/20260904230000_resolvers_usam_agente_padrao.sql
```

Antes: conferir os hashes acima. Depois: conferir o EFEITO por consulta, e
registrar em `docs/STATUS.md`, seção "Banco aplicado", no mesmo formato das
entradas das FASES B e C.

Esperado no pós-check: os três hashes mudam, `v3` e `provision_intelligence`
**não** mudam, e a `unique (organization_id, audience)` continua de pé.

### 3. FASE E — e a dívida que ela vai encontrar

Ao remover `unique (organization_id, audience)`, os dois
`on conflict (organization_id, audience)` de `private.provision_intelligence`
ficam sem índice correspondente e a função **passa a falhar**. Tem de ser
tratado **junto** com a FASE E, não depois. Está registrado em dois lugares e
ainda assim é fácil de esquecer.

## Armadilhas de ambiente que já custaram tempo

### O working tree principal tem trabalho de outra pessoa

Sempre. O conjunto muda de semana para semana. **Nunca** `git add -A` nem
`git commit -a`. Confira `git status` a cada sessão, adicione caminho por
caminho, e confira `git diff --cached --name-only` antes de commitar.

Todo o trabalho das ETAPAS 8.2E, 8.3 e 9A foi feito em **worktree separado**,
justamente por isso. Recomendo manter.

Existe também uma worktree paralela do Codex com a branch `main` checada lá —
consequência: `git branch -f main` é recusado, e o ref local `main` **fica atrás
de `origin/main`**. Audite ancestralidade sempre contra `origin/main`, nunca
contra `main`.

### `supabase db push` é destrutivo neste projeto

O histórico remoto de migrations está incompleto (registro só até
`20260819180000`; tudo de `20260821120000` em diante foi aplicado pelo SQL
Editor sem constar em `supabase_migrations.schema_migrations`). `db push`
tentaria reaplicar mais de trinta migrations já aplicadas, e uma delas começa
com `create table` sem `if not exists`.

Aplicar **uma por vez**, explicitamente:
`supabase db query --linked -f <arquivo>`. Nada de `migration repair`.

### Worktree novo não enxerga o link do Supabase

`--linked` falha com "Cannot find project ref": o vínculo mora em
`supabase/.temp/`, que é gitignored e não vem no checkout. Copie
`supabase/.temp` do working tree principal para a worktree; `supabase projects
list` passa a marcar `"linked":true` no EmyLeads (`lwoqcvuspsmfowiuipmv`).
Apague a cópia antes de remover a worktree.

O CLI guarda **um** token por vez e esta máquina alterna entre clientes. Se
`supabase projects list` não trouxer `lwoqcvuspsmfowiuipmv`, o login é de outro
cliente — e `supabase login` precisa de TTY, fora do Claude Code.

### As funções em produção têm CRLF

Toda migration que subiu pelo SQL Editor a partir do Windows gravou `prosrc`
com CRLF. Comparar corpo de função com o do repositório acusa divergência em
100% dos casos se você não normalizar (`tr -d '\r'`, ou `re.sub(r'\r+\n','\n')`).
Sem isso, o sinal de verdade — alguém editou em produção — some no ruído.

Corolário importante: ao escrever migration que faz `create or replace` de
função existente, extraia o corpo da **definição viva** (`pg_get_functiondef`),
não do repositório. Foi assim que a FASE C e a FASE D foram escritas.

### Conferir o efeito, nunca a mensagem de sucesso

`supabase db query` devolve `rows: []` e exit 0 para uma migration inteira.
Isso não prova nada. Toda checagem pós-aplicação das FASES B, C e D foi feita
por consulta ao catálogo (`pg_constraint`, `pg_indexes`,
`information_schema.columns`, `md5(pg_get_functiondef(...))`).

### Duas falhas de teste são do ambiente, não suas

`test/knowledge-search.test.mjs` e `test/server.test.mjs` falham com
`ERR_MODULE_NOT_FOUND: dotenv` numa worktree sem `node_modules` instalado. Elas
falham igual no baseline. A suíte relevante é:

```
node --test test/*.test.mjs        # 162/164 com as duas acima falhando
```

## O que NÃO fazer

- Não aplicar a FASE D em produção antes da prova comportamental passar.
- Não remover `unique (organization_id, audience)` (isso é FASE E).
- Não implementar Agent Router (FASE G) nem criar segundo agente.
- Não migrar consumidor real para o Intelligence Core; não mexer no Portal nem
  no Simulador legados.
- Não rodar `prova-*.sql` nem o seed contra produção — nem "só para ver", nem
  porque terminam em `ROLLBACK`.
- Não reescrever nem resetar a branch `identidade-e-padrao-do-agente`.
- Não reiniciar WhatsApp Assistant, Bridge ou serviços da VPS: migration de
  banco não exige restart nestas fases.

## Dívidas conhecidas, fora do caminho crítico

- **UI ainda escolhe agente implicitamente**: `Inteligencia.jsx:91` faz
  `data.profiles.find(item => item.audience === "customer")` para amarrar
  campanha. Com N agentes, toda campanha nova iria para o primeiro perfil
  customer, sem aviso. É FASE F, e está fora do escopo da FASE D de propósito.
- **Não existe rota de `insert` em `assistant_profiles`**: hoje agentes só
  nascem pelo trigger de provisionamento. Criar agente pela UI exige criar essa
  rota do zero (FASE F).
- **`salvarSkill` vincula a todos os perfis da audience** — semântica a rever
  quando houver N agentes.
