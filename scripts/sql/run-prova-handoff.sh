#!/usr/bin/env bash
# Somente cluster descartável. Recebe um pacote de SQL, nunca credencial de produção.
set -euo pipefail
archive=$1
B=$(mktemp -d /tmp/fase-14.XXXXXX)
cleanup() {
  if [[ -f "$B/data/postmaster.pid" ]]; then pg_ctl -D "$B/data" -m fast stop >>"$B/cleanup.log" 2>&1; fi
  cp "$B"/*.log "${archive%.tar}-evidence/" 2>/dev/null || true
  case "$B" in /tmp/fase-14.*) rm -rf -- "$B";; *) exit 2;; esac
}
mkdir -p "$B/root" "$B/sock" "$B/deb" "${archive%.tar}-evidence"
trap cleanup EXIT
base=https://apt.postgresql.org/pub/repos/apt/pool/main/p
cd "$B/deb"
for pkg in postgresql-17/postgresql-17_17.9-1.pgdg24.04+1_amd64.deb postgresql-17/postgresql-client-17_17.9-1.pgdg24.04+1_amd64.deb postgresql-18/libpq5_18.6-1.pgdg24.04+2_amd64.deb; do
  curl -fsSLO "$base/$pkg"
done
for pkg in *.deb; do dpkg-deb -x "$pkg" "$B/root"; done
export LD_LIBRARY_PATH="$B/root/usr/lib/x86_64-linux-gnu"
export PATH="$B/root/usr/lib/postgresql/17/bin:$PATH"
initdb -D "$B/data" --auth=trust -E UTF8 --locale=C >"$B/initdb.log" 2>&1
printf "listen_addresses = ''\nunix_socket_directories = '%s'\n" "$B/sock" >>"$B/data/postgresql.conf"
pg_ctl -D "$B/data" -l "$B/pg.log" start
tar -xf "$archive" -C "$B"
find "$B/supabase" "$B/scripts" -name '*.sql' -exec sed -i 's/\r$//' {} +
export PGHOST="$B/sock" PGDATABASE=control
createdb control
apply() { psql -X -v ON_ERROR_STOP=1 -f "$1" >>"$B/migrations.log" 2>&1 || { tail -25 "$B/migrations.log"; exit 1; }; }
apply "$B/scripts/sql/harness-supabase-minimo.sql"
for file in "$B"/supabase/migrations/*.sql; do
  name=$(basename "$file")
  [[ "$name" < 20260904190000 ]] || continue
  apply "$file"
done
apply "$B/scripts/sql/prova-agente-padrao-seed.sql"
for file in "$B"/supabase/migrations/*.sql; do
  name=$(basename "$file")
  [[ "$name" > 20260904180000 && "$name" < 20260906180000 ]] || continue
  apply "$file"
done
createdb -T control handoff
psql -X -v ON_ERROR_STOP=1 -f "$B/scripts/sql/validar-fase-14.sql" >"$B/validation-before.log"
export PGDATABASE=handoff
apply "$B/supabase/migrations/20260906180000_fase_14b_handoff_entre_agentes.sql"
apply "$B/supabase/migrations/20260906190000_fase_14c_capacidade_handoff_agente.sql"
psql -X -v ON_ERROR_STOP=1 -f "$B/scripts/sql/validar-fase-14.sql" >"$B/validation-after.log"
for database in control handoff; do
  psql -X -d "$database" -At -c "select n.nspname||'.'||p.proname, md5(pg_get_functiondef(p.oid)), md5(replace(p.prosrc,chr(13),'')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' order by 1,2" >"$B/hashes-$database.log"
done
psql -X -v ON_ERROR_STOP=1 -f "$B/scripts/sql/prova-handoff-entre-agentes.sql" 2>&1 | tee "$B/prova.log"
psql -X -v ON_ERROR_STOP=1 -f "$B/scripts/sql/prova-preparacao-sdr-fase-14.sql" 2>&1 | tee "$B/prova-sdr.log"
echo 'PROVA PASS; encerrando e removendo cluster descartavel'
