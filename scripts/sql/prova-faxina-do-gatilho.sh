#!/usr/bin/env bash
# ============================================================================
# APENAS TESTE. NUNCA EXECUTAR CONTRA PRODUÇÃO NEM CONTRA QUALQUER BANCO
# LIGADO (Supabase real, réplica, staging com dados de verdade).
# ============================================================================
#
# Prova comportamental de
# supabase/migrations/20260911050000_a_faxina_do_gatilho_nao_pode_travar_a_escrita.sql
#
# Por que esta prova é um script e não um .sql, como as outras da casa: o que
# está sob teste é um DEADLOCK. Deadlock precisa de duas sessões disputando as
# mesmas linhas em ordens cruzadas, e um `psql -f` só tem uma. Aqui são dois
# psql de verdade, coordenados por arquivos-marcador através do `\!` do próprio
# psql — sem sleep adivinhado, sem advisory lock (que entraria no grafo de
# espera e poluiria justamente o que se quer medir).
#
# A espinha da prova é o controle negativo: o item B roda o cenário contra a
# cadeia SEM a correção e EXIGE ver `40P01`. Se o defeito não se reproduzir, a
# prova para ali e declara-se inválida — um item D que passa sem que B tenha
# falhado não prova nada.
#
# Uso (na VPS, com o cluster descartável no ar — receita em
# README-prova-faxina-do-gatilho.md):
#
#     export PGHOST=/tmp/prova-faxina/sock
#     ./scripts/sql/prova-faxina-do-gatilho.sh /caminho/do/nucleomajor
#
set -uo pipefail

REPO="${1:-.}"
DB="${DB:-prova_faxina}"
PSQL="${PSQL:-psql}"
MIGRACAO="20260911050000_a_faxina_do_gatilho_nao_pode_travar_a_escrita.sql"

TRABALHO="$(mktemp -d)"
MARCADORES="$TRABALHO/marcadores"
mkdir -p "$MARCADORES"
trap 'rm -rf "$TRABALHO"' EXIT

FALHAS=0

pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FALHAS=$((FALHAS + 1)); }
item() { printf '\n[%s] %s\n' "$1" "$2"; }
morrer() { printf '\nPROVA INVÁLIDA: %s\n' "$1"; exit 2; }

sql() { "$PSQL" -q -X -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }
valor() { "$PSQL" -tAX -d "$DB" -c "$1" | tr -d '[:space:]'; }

# ---------------------------------------------------------------------------
# Montagem: cadeia do zero, SEM a migration nova
# ---------------------------------------------------------------------------
item A "a cadeia do repositório aplica do zero"

dropdb --if-exists "$DB" >/dev/null 2>&1
createdb "$DB" || morrer "não consegui criar o banco $DB"

aplicadas=0
# CRLF: os arquivos vêm de uma máquina Windows e o psql não perdoa.
tr -d '\r' < "$REPO/scripts/sql/harness-supabase-minimo.sql" > "$TRABALHO/harness.sql"
"$PSQL" -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$TRABALHO/harness.sql" \
  || morrer "o harness do Supabase não aplicou"

for arquivo in $(ls "$REPO"/supabase/migrations/*.sql | sort); do
  nome="$(basename "$arquivo")"
  [ "$nome" = "$MIGRACAO" ] && continue
  tr -d '\r' < "$arquivo" > "$TRABALHO/m.sql"
  if ! "$PSQL" -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$TRABALHO/m.sql" > "$TRABALHO/m.log" 2>&1; then
    cat "$TRABALHO/m.log"
    morrer "a migration $nome não aplicou — a cadeia não é a do repositório"
  fi
  aplicadas=$((aplicadas + 1))
done
pass "$aplicadas migrations aplicadas limpas (a nova fica de fora até o item C)"

# Fixture própria, e não `prova-agente-padrao-seed.sql`: aquele seed guarda o
# estado PRÉ-FASE C de propósito e aborta com "is_default ja existe" quando a
# cadeia está completa — que é exatamente o caso aqui. O que esta prova precisa
# é bem menos: uma organização, e a identidade mínima que ela exige
# (auth.users -> profiles -> organizations).
sql "
  insert into auth.users (id, email)
  values ('bbbbbbbb-0000-4000-8000-00000000fa11', 'prova-faxina@exemplo.invalido')
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name)
  values ('bbbbbbbb-0000-4000-8000-00000000fa11', 'Ator da prova da faxina')
  on conflict (id) do nothing;

  insert into public.organizations (id, name, slug, created_by)
  values
    ('bbbbbbbb-000a-4000-8000-00000000fa11', 'Prova faxina A', 'prova-faxina-a',
     'bbbbbbbb-0000-4000-8000-00000000fa11'),
    ('bbbbbbbb-000b-4000-8000-00000000fa11', 'Prova faxina B', 'prova-faxina-b',
     'bbbbbbbb-0000-4000-8000-00000000fa11'),
    ('bbbbbbbb-000c-4000-8000-00000000fa11', 'Prova faxina C', 'prova-faxina-c',
     'bbbbbbbb-0000-4000-8000-00000000fa11'),
    ('bbbbbbbb-000d-4000-8000-00000000fa11', 'Prova faxina D', 'prova-faxina-d',
     'bbbbbbbb-0000-4000-8000-00000000fa11')
  on conflict (id) do nothing;
" || morrer "não consegui criar as organizações da prova"

[ "$(valor "select count(*) from public.organizations;")" = "4" ] \
  || morrer "esperava quatro organizações no banco descartável"

# Três conexões: duas que as sessões travam uma da outra, e uma terceira só
# para disparar o gatilho sem disputar linha de origem.
#
# Uma organização cada, porque `whatsapp_connections_one_live_per_org` só
# admite uma conexão viva por organização — e isso não enfraquece a prova, pelo
# contrário: a faxina apaga por IDADE, sem filtro de organização, então três
# tenants disputando as mesmas linhas velhas é exatamente o que produção faz.
sql "
  insert into public.whatsapp_connections (organization_id, name)
  values
    ('bbbbbbbb-000a-4000-8000-00000000fa11', 'prova-a'),
    ('bbbbbbbb-000b-4000-8000-00000000fa11', 'prova-b'),
    ('bbbbbbbb-000c-4000-8000-00000000fa11', 'prova-c');
" || morrer "não consegui semear as conexões da prova"

# Contagem por nome DISTINTO, e não total: com duas organizações no banco, um
# insert cruzado daria três linhas com os nomes errados e o cenário quebraria
# em silêncio — a sessão travaria uma conexão que a outra nunca procura.
[ "$(valor "select count(distinct name) from public.whatsapp_connections where name like 'prova-%';")" = "3" ] \
  || morrer "as três conexões da prova (prova-a, prova-b, prova-c) não ficaram no lugar"

# ---------------------------------------------------------------------------
# O cenário: duas sessões, ordens cruzadas
# ---------------------------------------------------------------------------
# A trava a conexão `prova-a` sem disparar gatilho nenhum (select for update).
# B escreve em `prova-b`, e com isso a faxina do gatilho trava as linhas velhas
# da tabela de eventos. Então B pede `prova-a` (travada por A) e A escreve em
# `prova-c`, cuja faxina pede as linhas velhas (travadas por B).
#
# Ciclo fechado. Com a faxina que espera, é deadlock. Com `skip locked`, A pula
# as linhas de B, termina, e B segue.
semear_velhas() {
  sql "delete from public.portal_realtime_events;" >/dev/null
  sql "
    with organizacao as (select id from public.organizations order by id limit 1)
    insert into public.portal_realtime_events (organization_id, topic, entity_id, created_at)
    select organizacao.id, 'connections', gen_random_uuid(), now() - interval '30 days'
    from organizacao, generate_series(1, 40);
  " >/dev/null
}

escrever_sessoes() {
  cat > "$TRABALHO/sessao-a.sql" <<SQLA
\set VERBOSITY verbose
begin;
select id from public.whatsapp_connections where name = 'prova-a' for update;
\! touch "$MARCADORES/a1"
\! while [ ! -f "$MARCADORES/b2" ]; do sleep 0.05; done
update public.whatsapp_connections set name = name where name = 'prova-c';
commit;
SQLA

  cat > "$TRABALHO/sessao-b.sql" <<SQLB
\set VERBOSITY verbose
\! while [ ! -f "$MARCADORES/a1" ]; do sleep 0.05; done
begin;
update public.whatsapp_connections set name = name where name = 'prova-b';
\! touch "$MARCADORES/b2"
update public.whatsapp_connections set name = name where name = 'prova-a';
commit;
SQLB
}

disputar() {
  rm -f "$MARCADORES"/*
  semear_velhas
  escrever_sessoes
  "$PSQL" -X -d "$DB" -f "$TRABALHO/sessao-a.sql" > "$TRABALHO/a.log" 2>&1 &
  local pid_a=$!
  "$PSQL" -X -d "$DB" -f "$TRABALHO/sessao-b.sql" > "$TRABALHO/b.log" 2>&1 &
  local pid_b=$!
  wait $pid_a $pid_b 2>/dev/null
  grep -h "40P01" "$TRABALHO/a.log" "$TRABALHO/b.log" | head -1
}

# ---------------------------------------------------------------------------
item B "o defeito se reproduz SEM a correção (controle negativo)"
# ---------------------------------------------------------------------------
deadlock_antes="$(disputar)"
if [ -n "$deadlock_antes" ]; then
  pass "deadlock observado como esperado: $(echo "$deadlock_antes" | tr -s ' ')"
else
  echo "--- sessão A ---"; cat "$TRABALHO/a.log"
  echo "--- sessão B ---"; cat "$TRABALHO/b.log"
  morrer "o cenário NÃO deadlockou contra o código defeituoso. Sem controle negativo, o item D não provaria nada."
fi

# ---------------------------------------------------------------------------
item C "a migration aplica limpa contra Postgres de verdade"
# ---------------------------------------------------------------------------
tr -d '\r' < "$REPO/supabase/migrations/$MIGRACAO" > "$TRABALHO/nova.sql"
if "$PSQL" -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$TRABALHO/nova.sql" > "$TRABALHO/nova.log" 2>&1; then
  pass "aplicou — as guardas de pré-voo e o bloco final de asserções passaram"
else
  cat "$TRABALHO/nova.log"
  morrer "a migration não aplicou"
fi

corpo_gatilho="$(valor "
  select pg_get_functiondef(p.oid) like '%for update skip locked%'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'portal_realtime_notify';")"
[ "$corpo_gatilho" = "t" ] && pass "o corpo vivo do gatilho tem skip locked" \
  || fail "o corpo vivo do gatilho NÃO tem skip locked"

# ---------------------------------------------------------------------------
item D "o mesmo cenário não deadlocka mais"
# ---------------------------------------------------------------------------
deadlock_depois="$(disputar)"
if [ -z "$deadlock_depois" ]; then
  pass "nenhum 40P01 no cenário que acabou de falhar no item B"
else
  echo "--- sessão A ---"; cat "$TRABALHO/a.log"
  echo "--- sessão B ---"; cat "$TRABALHO/b.log"
  fail "ainda deadlocka: $deadlock_depois"
fi

# ---------------------------------------------------------------------------
item E "a faxina continua apagando o que passou de 7 dias"
# ---------------------------------------------------------------------------
semear_velhas
antes="$(valor "select count(*) from public.portal_realtime_events where created_at < now() - interval '7 days';")"
sql "update public.whatsapp_connections set name = name where name = 'prova-c';"
depois="$(valor "select count(*) from public.portal_realtime_events where created_at < now() - interval '7 days';")"
[ "$antes" -gt 0 ] || morrer "o seed de linhas velhas não funcionou"
[ "$depois" = "0" ] && pass "$antes linhas velhas apagadas por um único evento" \
  || fail "sobraram $depois linhas velhas de $antes"

# ---------------------------------------------------------------------------
item F "e não apaga o que está dentro da janela"
# ---------------------------------------------------------------------------
sql "delete from public.portal_realtime_events;"
sql "
  insert into public.portal_realtime_events (organization_id, topic, entity_id, created_at)
  select organization.id, 'connections', gen_random_uuid(), now() - interval '2 days'
  from public.organizations organization limit 1;"
sql "update public.whatsapp_connections set name = name where name = 'prova-c';"
novas="$(valor "select count(*) from public.portal_realtime_events where created_at > now() - interval '7 days';")"
[ "$novas" -ge 2 ] && pass "a linha de 2 dias sobreviveu, e o evento novo entrou" \
  || fail "esperava ao menos 2 linhas dentro da janela, achei $novas"

# ---------------------------------------------------------------------------
item G "o sinal continua saindo nos dois ramos"
# ---------------------------------------------------------------------------
sql "delete from public.portal_realtime_events;"
sql "update public.whatsapp_connections set name = name where name = 'prova-c';"
por_update="$(valor "select count(*) from public.portal_realtime_events;")"
sql "delete from public.portal_realtime_events;"
# Na quarta organização, que não tem conexão viva nenhuma.
sql "
  insert into public.whatsapp_connections (organization_id, name)
  values ('bbbbbbbb-000d-4000-8000-00000000fa11', 'prova-efemera');"
sql "delete from public.whatsapp_connections where name = 'prova-efemera';"
por_delete="$(valor "select count(*) from public.portal_realtime_events where topic = 'connections';")"
[ "$por_update" -ge 1 ] && pass "UPDATE emite evento" || fail "UPDATE não emitiu evento"
[ "$por_delete" -ge 2 ] && pass "INSERT e DELETE emitem evento" \
  || fail "esperava evento de INSERT e de DELETE, achei $por_delete"

# ---------------------------------------------------------------------------
item H "a faxina PULA a linha travada em vez de esperar por ela"
# ---------------------------------------------------------------------------
# A garantia inteira da correção, medida diretamente: uma sessão segura uma
# linha velha, a outra escreve. A segunda tem de terminar — e a linha segurada
# tem de sobreviver, porque foi pulada.
rm -f "$MARCADORES"/*
semear_velhas
alvo="$(valor "select id from public.portal_realtime_events order by id limit 1;")"

cat > "$TRABALHO/segura.sql" <<SQLH
begin;
select id from public.portal_realtime_events where id = $alvo for update;
\! touch "$MARCADORES/segurando"
\! while [ ! -f "$MARCADORES/escreveu" ]; do sleep 0.05; done
commit;
SQLH

"$PSQL" -q -X -d "$DB" -f "$TRABALHO/segura.sql" > "$TRABALHO/h.log" 2>&1 &
pid_h=$!
while [ ! -f "$MARCADORES/segurando" ]; do sleep 0.05; done

inicio="$(date +%s)"
sql "update public.whatsapp_connections set name = name where name = 'prova-c';"
saida=$?
fim="$(date +%s)"
sobreviveu="$(valor "select count(*) from public.portal_realtime_events where id = $alvo;")"
touch "$MARCADORES/escreveu"
wait $pid_h 2>/dev/null

[ "$saida" = "0" ] && pass "a escrita terminou com a linha velha travada por outra sessão" \
  || fail "a escrita falhou com a linha travada"
[ $((fim - inicio)) -lt 2 ] && pass "terminou em $((fim - inicio))s — não esperou pelo lock" \
  || fail "demorou $((fim - inicio))s: parece que esperou"
[ "$sobreviveu" = "1" ] && pass "a linha travada foi pulada, não apagada" \
  || fail "a linha travada sumiu — alguém esperou por ela"

# ---------------------------------------------------------------------------
item I "a reserva de comandos não mudou de comportamento"
# ---------------------------------------------------------------------------
# Aqui não há credencial de robô, então o que se prova é a forma da varredura
# no corpo vivo — a semântica de entrega é coberta pelo teste estático e pelas
# asserções da própria migration.
varredura_ok="$(valor "
  select substring(pg_get_functiondef(p.oid) from 'with vencidos as.*?from vencidos') like '%for update skip locked%'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'nucleo_runtime_commands_claim';")"
fifo_ok="$(valor "
  select pg_get_functiondef(p.oid) like '%order by command.created_at%'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'nucleo_runtime_commands_claim';")"
[ "$varredura_ok" = "t" ] && pass "a varredura de expiração tem skip locked" \
  || fail "a varredura de expiração não tem skip locked"
[ "$fifo_ok" = "t" ] && pass "a entrega continua FIFO" || fail "a entrega deixou de ser FIFO"

# ---------------------------------------------------------------------------
item J "reaplicar a migration aborta, em vez de reescrever por cima"
# ---------------------------------------------------------------------------
if "$PSQL" -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$TRABALHO/nova.sql" > "$TRABALHO/rerun.log" 2>&1; then
  fail "aplicou de novo sem reclamar"
else
  if grep -q "ja foi consertada" "$TRABALHO/rerun.log"; then
    pass "abortou com a mensagem certa"
  else
    cat "$TRABALHO/rerun.log"
    fail "abortou, mas por outro motivo"
  fi
fi

# ---------------------------------------------------------------------------
item K "nada fica para trás"
# ---------------------------------------------------------------------------
dropdb "$DB" && pass "banco descartável destruído" || fail "não consegui destruir o banco"

printf '\n============================================================\n'
if [ "$FALHAS" = "0" ]; then
  printf 'PROVA COMPLETA: todos os itens passaram.\n'
  printf 'O item B falhou de propósito ANTES da correção — é o que dá valor ao D.\n'
  exit 0
fi
printf 'PROVA COM %s FALHA(S). Não aplicar em produção.\n' "$FALHAS"
exit 1
