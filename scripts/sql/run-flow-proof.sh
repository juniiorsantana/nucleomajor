#!/usr/bin/env bash
set -euo pipefail
flow_root=/tmp/nucleo-flow-phase3-20260907
export LD_LIBRARY_PATH="$flow_root/root/usr/lib/x86_64-linux-gnu"
export PATH="$flow_root/root/usr/lib/postgresql/17/bin:$PATH"
export PGHOST="$flow_root/socket" PGUSER=nucleo
test "$(id -u)" != 0
test -S "$PGHOST/.s.PGSQL.5432"
if ! psql -d postgres -Atc "select 1 from pg_database where datname='flow_control'" | grep -qx 1; then
  createdb flow_control
  psql -v ON_ERROR_STOP=1 -d flow_control -f "$flow_root/input/harness-supabase-minimo.sql" > "$flow_root/chain.log" 2>&1
  for file in "$flow_root/input/migrations/"*.sql; do
    name=${file##*/}
    if [[ "$name" == 20260907010000* ]]; then continue; fi
    if [[ "$name" == 20260904190000* ]]; then
      psql -v ON_ERROR_STOP=1 -d flow_control -f "$flow_root/input/prova-agente-padrao-seed.sql" >> "$flow_root/chain.log" 2>&1
    fi
    printf '%s\n' "$name"
    psql -v ON_ERROR_STOP=1 -d flow_control -f "$file" >> "$flow_root/chain.log" 2>&1
  done
fi
# Recreate only the named disposable test database, never the control database.
dropdb --if-exists flow_test
createdb -T flow_control flow_test
psql -v ON_ERROR_STOP=1 -d flow_test -f "$flow_root/input/migrations/20260907010000_fluxos_execucao_persistida.sql"
psql -v ON_ERROR_STOP=1 -d flow_test -f "$flow_root/input/prova-fluxos-execucao.sql"
for db in flow_control flow_test; do
  psql -d "$db" -Atc "select n.nspname,p.proname,md5(replace(p.prosrc,chr(13),'')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='private' and p.proname='intelligence_payload') or (n.nspname='public' and p.proname in ('nucleo_intelligence_context_resolve_v2','nucleo_intelligence_context_resolve_v3')) order by 1,2" > "$flow_root/$db.hashes"
done
diff -u "$flow_root/flow_control.hashes" "$flow_root/flow_test.hashes"
psql -X -qAt -v ON_ERROR_STOP=1 -d flow_test -f "$flow_root/input/validar-fluxos-execucao.sql" > "$flow_root/acceptance.json"
python3 -c 'import json,sys; result=json.load(open(sys.argv[1])); assert result["tudo_confere"], result; print("R PASS: all 15 normalized bodies, grants, table and trigger match acceptance")' "$flow_root/acceptance.json"
