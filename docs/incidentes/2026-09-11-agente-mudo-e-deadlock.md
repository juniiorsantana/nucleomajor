# 11/09/2026 — o agente que não respondia, e o deadlock que o log escondia

Registro do que foi diagnosticado, corrigido, aplicado e do que ficou aberto.
Escrito no meio do trabalho, a pedido, para o estado não viver só no terminal.

## Como começou

Um contato mandou mensagem e o agente não respondeu. Os dois serviços estavam
`active` e o modelo tinha respondido 28 vezes nas 24h anteriores — não era queda.

## Defeito 1 — o handoff automático não sabia acabar

**Causa.** Em 06/09 às 19:42 o Claude saiu com 1 num turno de cliente
(`triage.failed`, depois `run.failed` com `error_code: model_unavailable`). O
worker fez o que devia — entregou a conversa para um humano — mas `dono = humano`
não vence, e ninguém tinha sido chamado: sem atendente, sem pedido na fila do
portal, sem botão para devolver. A conversa `17de6f0c…` (contato 556592475324)
acumulou dez mensagens e respondeu `ignored_handoff` até 11/09.

O mesmo defeito existia no caminho `intelligence.handoff` (contexto
indisponível), que é o mais perigoso dos dois porque depende do Supabase.

**Correção.** Coluna `dono_ate` no árbitro e `assumir_por_falha()`. Handoff com
prazo é do runtime e vence em 30 min; handoff de gente não vence nunca. A
migração do árbitro cura o que o defeito já tinha quebrado: sessões abertas, com
dono humano, motivo de falha e **sem atendente registrado**.

Junto, a segunda metade: `_rpc` descartava status e corpo e levantava sempre
"Supabase recusou X". Agora leva `HTTP <status>` e o `code` do PostgREST — e só
isso, porque a mensagem do banco é texto livre e o erro termina no journal.

**Estado: EM PRODUÇÃO desde 11/09 01:45.** Release `handoff-com-prazo`, 499
testes verdes no Python do serviço. A cura pegou exatamente a conversa travada e
não tocou nas duas que tinham atendente.

## Defeito 2 — as recusas do Supabase eram deadlock

**Como apareceu.** Só depois que o defeito 1 pôs o status no log. A primeira
recusa seguinte disse tudo:

    Supabase recusou reserva de comandos do runtime (HTTP 500, código 40P01)

`40P01` é `deadlock_detected`. Antes disso eram 2.828 recusas em três dias
(414 + 1413 + 1001, só na sincronia de conversas) sem causa conhecida.

**Causa.** `private.portal_realtime_notify` rodava, a cada disparo e dentro da
transação de quem escreveu, um `delete` sem teto, sem ordem e **esperando**. São
**nove gatilhos `for each row`** desembocando na mesma tabela — inclusive
`whatsapp_conversations` e `connection_runtime_commands`. É ali que RPCs sem
relação nenhuma se cruzavam.

**Correção.** `for update skip locked` + `limit`. A garantia não é a ordem — é
que uma transação que nunca espera não entra em ciclo de espera. Mesmo
tratamento na varredura de expiração de `nucleo_runtime_commands_claim`.

**Prova.** `scripts/sql/prova-faxina-do-gatilho.sh` — duas sessões de verdade,
com controle negativo: o item B **exige** ver o `40P01` antes da correção. Rodou
em PostgreSQL 17.9 descartável na VPS, 64 migrations do zero, itens A–K PASS.

**Estado: APLICADA EM PRODUÇÃO em 11/09, mas por um caminho torto** — ver abaixo.

## O tropeço da aplicação, e o que ele ensinou

A migration guardava o ACL de antes numa **tabela temporária** com
`on commit drop`, copiado da 13B. O SQL Editor recusou:

    ERROR: 42P01: relation "_faxina_acl_antes" does not exist

O `psql -f` da prova roda o arquivo inteiro numa transação só; o SQL Editor não.
**Lição: prova em `psql -f` não cobre o SQL Editor.**

Pior: o editor roda statement por statement, então **os dois `create or replace`
entraram e foram commitados** antes do erro. A correção ficou no ar sem nunca ter
passado pelo bloco de conferência. A conferência foi feita depois, por consulta
ao catálogo, e deu tudo certo:

| conferência | resultado |
|---|---|
| gatilho com `skip locked`, teto e janela de 7 dias | ✅ |
| varredura de expiração com `skip locked` | ✅ |
| entrega de comandos ainda FIFO | ✅ |
| `authenticated` executa a reserva | ✅ |
| nove gatilhos ainda ligados | ✅ |
| nenhum lixo deixado para trás | ✅ |

## O achado do `anon`

A mesma conferência mostrou `anon` COM EXECUTE em
`nucleo_runtime_commands_claim`. **Não é regressão desta migration** — é assim
desde 26/08, pelo mesmo mecanismo já diagnosticado na ETAPA 11D
(`20260905200000_a_rpc_de_agente_padrao_nao_atende_anonimo.sql`): o projeto tem
`ALTER DEFAULT PRIVILEGES` concedendo EXECUTE a `anon`, `authenticated` e
`service_role` em toda função criada no schema `public`, e `revoke ... from
public` não alcança concessão nominal a papel.

**Não é explorável.** A função é `security definer` e começa por
`private.robot_organization()`, que exige `auth.uid()` e o `app_metadata` do JWT.
Chamada anônima levanta `robot credential is inactive or connection was revoked`
antes de ler qualquer linha. É superfície, não vazamento — exatamente o que a 11D
registrou para o caso dela.

**Mas a minha migration afirmava o contrário.** Eu tinha posto
`if has_function_privilege('anon', ...) then raise` no bloco final. Isso passa no
Postgres descartável (que não tem os default privileges) e **abortaria numa
reconstrução do zero contra um projeto Supabase real**. Migration não é lugar de
exigir o que o projeto ainda não cumpre.

## Estado agora, arquivo por arquivo

Commitado, portal (`melhoria/conversas-inbox`):

```
2ac614e fix: a migration não pode depender de tabela temporária
7509418 test: a prova da faxina roda, e o deadlock aparece antes de sumir
b2b3658 fix: a faxina do gatilho de realtime deixa de travar quem escreve
6794a04 chore: guardar no git os patches que já estão em produção
```

Commitado, runtime (`fix/handoff-com-prazo`, árvore byte a byte igual à produção):

```
416a591 fix: o handoff que o runtime dá em si mesmo agora sabe acabar
7f7f5e1 fix: o agente confundia a própria resposta com um atendente humano
```

**NÃO commitado, e é onde eu parei:**

- `supabase/migrations/20260911050000_…sql` — tirei a asserção sobre `anon`
  (3 linhas de código a menos, o resto é comentário explicando o porquê). O
  **corpo das duas funções não foi tocado**, então o que está em produção
  continua correto.
- `test/faxina-do-gatilho-migration.test.mjs` — **está vermelho** (12 passam, 1
  falha). O teste ainda exige a mensagem `FALHOU: anon ganhou o EXECUTE…` que eu
  acabei de remover da migration. É o próximo passo: tirar essa linha da lista e
  acrescentar a trava que impede a asserção de voltar.

## O que falta

1. **Fechar o teste** (acima) e commitar.
2. **Confirmar o defeito 2 em horário movimentado.** O log está limpo desde
   01:48, mas a aplicação caiu dentro dessa janela de silêncio e às três da manhã
   quase não há escrita concorrente. Deadlock precisa de concorrência: o teste de
   verdade é o próximo pico.
3. **Push.** Nada foi empurrado. Os dois remotos usam contas diferentes nesta
   máquina (o runtime é da `juiiorsantana`, que não é a ativa).
4. **Hardening do `anon`**, se for decidido: trilha própria, no molde da 11D,
   nunca dentro de uma correção de deadlock.
5. **Dois limites conhecidos do defeito 1**, deixados de fora de propósito: o
   handoff automático continua sem registrar pedido na fila do portal (o prazo
   resolve o prejuízo, não a visibilidade), e a retomada não responde a mensagem
   que se perdeu na falha — ela acontece na mensagem seguinte.
