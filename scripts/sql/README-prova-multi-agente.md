# Prova comportamental do multi-agent (FASE E)

Registro de como a FASE E (`unique (organization_id, audience)` removida de
`assistant_profiles`, migration
`20260905000000_a_audience_deixa_de_limitar_a_um_agente.sql`) foi validada
**comportamentalmente**. Ver
[`docs/intelligence/MULTI-AGENT-MIGRATION.md`](../../docs/intelligence/MULTI-AGENT-MIGRATION.md)
para o desenho e a auditoria de dependências.

Complementa [`README-prova-agente-padrao.md`](./README-prova-agente-padrao.md),
que descreve o harness e a prova das FASES C/D. A receita de cluster é a mesma;
o que muda está registrado abaixo.

## Resultado registrado

Executado em 04/09/2026, PostgreSQL 17.9 userspace descartável na VPS:

- 48 migrations até a FASE B aplicaram limpas, do zero;
- itens **A–N** de `prova-multi-agente.sql`: **PASS** em todos;
- itens **O, P, Q, Q.2** (revisão semântica da ETAPA 10B, ver abaixo): **PASS**;
- controle negativo: **PASS** — a prova sabe reprovar (ver abaixo);
- produção: **não alterada**, reconferida por hash das 6 funções antes e
  depois, com a unique antiga ainda de pé lá.

## Arquivos

| Arquivo | Papel |
|---|---|
| `harness-supabase-minimo.sql` | Mesmo das FASES C/D. |
| `prova-agente-padrao-seed.sql` | Mesmo das FASES C/D — fixtures pré-C, commitadas. |
| `prova-multi-agente.sql` | A prova A–N. Roda dentro de uma transação que termina em `ROLLBACK`, mais um bloco pós-rollback que confere que nada vazou. |

`test/agent-multi-audience.test.mjs` cobre o lado estático (a migration declara
o que promete; a UI não escolhe agente por audience arbitrária). Os dois se
complementam e nenhum substitui o outro.

## Sequência de reprodução

```
1. harness-supabase-minimo.sql
2. migrations do repositório, em ordem, até a FASE B inclusive
   (20260904160000) — NÃO aplicar C ainda
3. prova-agente-padrao-seed.sql        <-- fixtures pré-C, COMMIT
4. migration da FASE C (20260904190000)
5. migration da FASE D (20260904230000)
6. migration da FASE E (20260905000000)
7. prova-multi-agente.sql
8. destruir o cluster
```

Como nas fases anteriores: os arquivos saem do Windows com CRLF, normalizar com
`tr -d '\r'` antes de aplicar via `psql -f`.

## O cluster descartável, na prática

A receita das FASES C/D dizia "PostgreSQL 17.6 userspace, sem root, sem Docker"
e não registrava como obter o binário. Fica registrado, porque custou tempo:

```
B=/tmp/fase-e
# 1. binários, sem instalar nada no sistema
curl -sSLO .../pool/main/p/postgresql-17/postgresql-17_17.9-1.pgdg24.04%2B1_amd64.deb
curl -sSLO .../pool/main/p/postgresql-17/postgresql-client-17_17.9-1.pgdg24.04%2B1_amd64.deb
curl -sSLO .../pool/main/p/postgresql-18/libpq5_18.6-1.pgdg24.04%2B2_amd64.deb
for d in *.deb; do dpkg-deb -x "$d" $B/root; done

# 2. cluster, como usuário não-root (initdb recusa root)
export LD_LIBRARY_PATH=$B/root/usr/lib/x86_64-linux-gnu
export PATH=$B/root/usr/lib/postgresql/17/bin:$PATH
initdb -D $B/data --auth=trust -E UTF8 --locale=C

# 3. sem porta TCP: escrever no postgresql.conf, não passar por -o
#    listen_addresses = ''
#    unix_socket_directories = '/tmp/fase-e/sock'
pg_ctl -D $B/data -l $B/pg.log start
```

Três detalhes que custaram uma iteração cada:

- **`libpq5` tem de vir do PGDG, não do Ubuntu.** O `libpq5` do noble é 16.x, e
  o `psql` 17 morre com `undefined symbol: PQchangePassword`. O PGDG publica
  `libpq5` a partir do pacote-fonte do **PostgreSQL 18**, e ela é
  retrocompatível.
- **`listen_addresses = ''` vai no `postgresql.conf`.** Passar por
  `pg_ctl -o` através de `ssh` + `su -c` atravessa três níveis de aspas e as
  aspas vazias chegam literais (`could not translate host name "x27x27"`).
- **`initdb` recusa rodar como root.** Use um usuário comum; o cluster inteiro
  vive em `/tmp` e é destruído depois.

### Desvio de versão, registrado

As provas das FASES C/D usaram **17.6**, igual a produção. Em 04/09/2026 o 17.6
já não estava no pool do PGDG (só 17.9 e 17.11 para noble), e a prova da FASE E
rodou em **17.9**. A semântica sob teste — inferência de `ON CONFLICT` por
índice parcial, unique, RLS, `select into` sem `strict` — não varia entre
patches do mesmo major. Se algum dia isso importar, o caminho é compilar 17.6 da
fonte; não foi feito.

## Controle negativo

Uma prova que só imprime PASS não vale nada. Dois sabotadores foram aplicados ao
banco descartável **depois** da prova passar:

| Sabotagem | Esperado | Obtido |
|---|---|---|
| Devolver `on conflict (organization_id, audience) do nothing` a `provision_intelligence` | A função quebra: o árbitro não existe mais | `ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification` |
| Redefinir `intelligence_payload` sem `is_default` (FASE D ausente) | A guarda da migration aborta | `ERROR: FASE E abortada: intelligence_payload nao seleciona por is_default (FASE D ausente)` |

O primeiro é a prova de que a reescrita de `provision_intelligence` era mesmo
necessária, e não zelo: sem ela, criar organização passaria a falhar no primeiro
`insert` depois do DROP.

## Itens O–Q: a semântica do reencontro

Acrescentados na ETAPA 10B, antes de aplicar em produção. Eles respondem uma
pergunta que a prova A–N não fazia: quando `provision_intelligence` reencontra
um padrão que já existe, o que ela faz com ele?

| Item | O que prova |
|---|---|
| `O` | Reencontrar o padrão **não atualiza campo nenhum**. Personaliza nome, tom, `active`, template, `brand_config` e `process_config`; chama a função; a linha volta byte a byte idêntica. Trava a decisão de manter `DO NOTHING` — `DO UPDATE` reverteria o nome escolhido pelo cliente. |
| `P` | Com padrão **e** não-padrão customizado, o não-padrão fica intacto byte a byte: não alterado, não promovido, não apagado, e a contagem de agentes não muda. |
| `Q` | A **única** divergência entre o árbitro antigo (unique inteira) e o novo (índice parcial): audience povoada e sem padrão. O antigo não fazia nada; o novo cria o padrão que faltava — sem promover nem tocar em quem já estava lá. Inalcançável pelo gatilho real. |
| `Q.2` | O custo dessa divergência: se o agente órfão for homônimo, o slug colide e a função **falha alto** (`unique_violation`), não em silêncio. |

## Onde a prova ainda não chega

- **RLS real com JWT de usuário final.** A prova roda como superusuário; o item
  L confere as policies por introspecção (por organização, nunca por audience) e
  o L.2 confere isolamento de skills por `profile_id`, mas ninguém autenticou
  como membro de outra organização para tentar ler um agente alheio. Isso não
  mudou nesta fase — as policies são as mesmas de antes.
- **`resolve_v2` ponta a ponta.** O item F prova a seleção do padrão pelo
  payload (por onde v1, v2, v3 e o preview passam) e a seleção própria de
  `nucleo_customer_assistant_access`. O join do skill `tarefas` do v2 exigiria
  montar operador verificado e sessão — máquina da FASE H3. Coberto pelo
  contrato estático da FASE D.
- **A aplicação em produção**, que continua **não feita** de propósito até ser
  autorizada em etapa separada.
