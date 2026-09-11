# Prova comportamental da faxina do gatilho de realtime

Como validar `supabase/migrations/20260911050000_a_faxina_do_gatilho_nao_pode_travar_a_escrita.sql`
**antes** de colar no SQL Editor.

A migration tira a espera da faxina que nove gatilhos `for each row` rodavam
dentro da transação de quem escreveu, e faz o mesmo com a varredura de
expiração de `nucleo_runtime_commands_claim`.

## O que está sob teste, e por que é um `.sh`

As outras provas da casa são `psql -f` de um arquivo só. Esta não pode ser: o
que está sob teste é um **deadlock**, e deadlock precisa de duas sessões
disputando as mesmas linhas em ordens cruzadas. Um `psql -f` tem uma sessão.

`prova-faxina-do-gatilho.sh` abre dois `psql` de verdade e os coordena por
arquivos-marcador, usando o `\!` do próprio psql. Sem `sleep` adivinhado e sem
advisory lock — advisory lock entra no grafo de espera do Postgres e poluiria
exatamente a medida que se quer fazer.

O cenário, que é o coração da prova:

| | sessão A | sessão B |
|---|---|---|
| 1 | `select ... for update` em `prova-a` — trava a origem sem disparar gatilho | |
| 2 | | `update` em `prova-b` → o gatilho dispara → a faxina trava as linhas velhas |
| 3 | | `update` em `prova-a` → **espera por A** |
| 4 | `update` em `prova-c` → a faxina pede as linhas velhas → **espera por B** | |

Ciclo fechado. Com a faxina que espera, o Postgres mata uma das duas com
`40P01`. Com `skip locked`, A pula as linhas de B, termina, e B segue.

## Controle negativo embutido

O item **B** roda esse cenário contra a cadeia **sem** a correção e **exige**
ver `40P01`. Se o defeito não se reproduzir, a prova para ali e se declara
inválida (`PROVA INVÁLIDA`, saída 2).

Isso não é zelo: um item D ("não deadlocka mais") que passasse sem o B ter
falhado não provaria nada — provaria só que o cenário é frouxo. É a mesma
disciplina do controle negativo registrado em
[`README-prova-multi-agente.md`](./README-prova-multi-agente.md).

## Itens

| | O que prova |
|---|---|
| A | A cadeia inteira do repositório aplica do zero (sem a migration nova). |
| B | **O defeito se reproduz**: `40P01` no cenário acima. Controle negativo. |
| C | A migration aplica limpa — guardas de pré-voo e asserções finais passam contra Postgres real, não só contra leitura. |
| D | O **mesmo** cenário que falhou em B não deadlocka mais. |
| E | A faxina continua apagando o que passou de 7 dias. |
| F | E não apaga o que está dentro da janela. |
| G | O sinal continua saindo nos três caminhos (INSERT, UPDATE, DELETE). |
| H | A faxina **pula** a linha travada: a escrita termina, e a linha segurada pela outra sessão sobrevive. |
| I | A varredura de expiração tem `skip locked` e a entrega continua FIFO. |
| J | Reaplicar a migration **aborta** com a mensagem certa, em vez de reescrever por cima. |
| K | O banco descartável é destruído. |

## Como rodar

A receita de cluster descartável é a mesma das FASES C/D/E/13B/13C — os três
detalhes de `libpq5`, `listen_addresses` e `initdb` estão registrados em
[`README-prova-multi-agente.md`](./README-prova-multi-agente.md) e valem aqui
sem mudança. Resumo, na VPS, como usuário comum (nunca root, nunca contra o
Supabase):

```bash
B=/tmp/prova-faxina
mkdir -p $B/sock

# 1. os três debs do PGDG (postgresql-17, postgresql-client-17, libpq5 do PG18)
#    descompactados em $B/root — ver o README citado acima.
export LD_LIBRARY_PATH=$B/root/usr/lib/x86_64-linux-gnu
export PATH=$B/root/usr/lib/postgresql/17/bin:$PATH

# 2. cluster
initdb -D $B/data --auth=trust -E UTF8 --locale=C
# no postgresql.conf:  listen_addresses = ''
#                      unix_socket_directories = '/tmp/prova-faxina/sock'
pg_ctl -D $B/data -l $B/pg.log start

# 3. a prova
export PGHOST=$B/sock
cd /caminho/do/nucleomajor
./scripts/sql/prova-faxina-do-gatilho.sh .
```

Ao terminar:

```bash
pg_ctl -D $B/data stop && rm -rf $B
pgrep -u "$(id -un)" postgres    # tem de não achar nada
```

Os arquivos vêm de uma máquina Windows: o script já faz `tr -d '\r'` em tudo
que passa pelo `psql`. Não pule isso se for rodar algum passo à mão.

## O que esta prova NÃO faz

- **Não prova a semântica de entrega de comandos ponta a ponta.** Sem credencial
  de robô no banco descartável, `nucleo_runtime_commands_claim` não chega a
  entregar nada; o item I confere a forma da varredura no corpo vivo, e o resto
  é coberto por `test/faxina-do-gatilho-migration.test.mjs` e pelas asserções da
  própria migration.
- **Não mede produção.** Se o deadlock em produção some, quem diz é o log do
  runtime: depois de aplicada, `conversation.sync_failed` e
  `runtime.commands_unavailable` param de aparecer com `código 40P01`. Foi o
  patch `runtime-handoff-com-prazo` que pôs o status HTTP no log — sem ele, a
  recusa não dizia a causa.
- **Não tenta esgotar as ordens de disputa possíveis.** Prova um ciclo concreto,
  o mesmo que a produção vinha fechando. A garantia geral não vem do cenário e
  sim da propriedade: uma transação que nunca espera não entra em ciclo de
  espera.

## Resultado registrado

Executada em **11/09/2026**, PostgreSQL **17.9** userspace descartável na VPS
(`/tmp/prova-faxina`, socket unix, `listen_addresses = ''` — sem porta TCP):

- **64 migrations** do repositório aplicaram limpas, do zero;
- **itens A–K: PASS em todos**;
- o item B, que é o que dá valor ao resto, falhou de propósito contra o código
  antigo e registrou a mensagem esperada:

      psql:sessao-b.sql:6: ERROR: 40P01: deadlock detected

- o item D rodou **o mesmo cenário** depois da migration: nenhum `40P01`;
- o item H mediu a garantia direto: com uma linha velha travada por outra
  sessão, a escrita terminou em **0s** e a linha travada **sobreviveu** — foi
  pulada, não esperada;
- o item J confirmou que reaplicar aborta, em vez de reescrever por cima;
- o cluster foi **destruído** ao fim: `/tmp` limpo, nenhum processo `postgres`
  sobrevivente;
- **produção não foi tocada**: nenhum comando contra o Supabase, e os dois
  serviços do runtime seguiram `active` com `NRestarts=0` e o mesmo
  `ExecMainStartTimestamp` de antes (`01:45:55 -03`, o deploy do
  `handoff-com-prazo`).

### O SQL Editor derrubou a primeira aplicação

A migration passou na prova e **mesmo assim falhou** no SQL Editor, em
11/09/2026, com `42P01: relation "_faxina_acl_antes" does not exist`.

O `psql -f` da prova roda o arquivo inteiro numa transação só, então a tabela
temporária com `on commit drop` sobrevivia até o bloco final. No SQL Editor não
sobrevive — lá os statements não compartilham essa transação. A 13B tem o mesmo
padrão; a 13C, que aplicou limpa pelo mesmo caminho, não usava tabela nenhuma.

Lição para a próxima migration desta casa: **prova em `psql -f` não cobre o
SQL Editor.** O que a substituiu é mais forte do que era — em vez de comparar o
ACL com um retrato de antes, o bloco final exige o estado desejado: quem pode
executar a reserva, quem não pode, e os nove gatilhos ainda apontando para a
função certa. `test/faxina-do-gatilho-migration.test.mjs` ganhou uma trava para
a tabela temporária não voltar por cópia.

### Duas correções que a própria execução exigiu

Ficam registradas porque são exatamente o tipo de coisa que só aparece contra um
banco de verdade:

1. **`prova-agente-padrao-seed.sql` não serve aqui.** Ele guarda o estado
   PRÉ-FASE C de propósito e aborta com `SEED INVALIDO: is_default ja existe`
   quando a cadeia está completa. A prova passou a criar a própria fixture.
2. **`whatsapp_connections_one_live_per_org`** só admite uma conexão viva por
   organização, então as três conexões do cenário vivem em três organizações.
   Isso não enfraquece nada: a faxina apaga por IDADE, sem filtro de
   organização — três tenants disputando as mesmas linhas velhas é precisamente
   o que produção faz.
