#!/usr/bin/env bash
# Run as nucleo. Only the explicitly named disposable directory is used.
set -euo pipefail
flow_root=/tmp/nucleo-flow-phase3-20260907
test "$(id -u)" != 0
mkdir -p "$flow_root/packages" "$flow_root/root" "$flow_root/socket"
chmod 700 "$flow_root/socket"
cd "$flow_root/packages"
for package in \
  postgresql-17/postgresql-17_17.9-1.pgdg24.04%2B1_amd64.deb \
  postgresql-17/postgresql-client-17_17.9-1.pgdg24.04%2B1_amd64.deb \
  postgresql-18/libpq5_18.6-1.pgdg24.04%2B2_amd64.deb; do
  filename=${package##*/}
  if ! test -f "$filename"; then
    curl --fail --silent --show-error --max-time 60 --retry 2 \
      "https://apt.postgresql.org/pub/repos/apt/pool/main/p/$package" -o "$filename"
  fi
  dpkg-deb -x "$filename" "$flow_root/root"
done
export LD_LIBRARY_PATH="$flow_root/root/usr/lib/x86_64-linux-gnu"
export PATH="$flow_root/root/usr/lib/postgresql/17/bin:$PATH"
if ! test -f "$flow_root/data/PG_VERSION"; then
  initdb -D "$flow_root/data" --auth=trust -E UTF8 --locale=C
  printf "\nlisten_addresses = ''\nunix_socket_directories = '%s'\n" "$flow_root/socket" >> "$flow_root/data/postgresql.conf"
fi
if ! pg_ctl -D "$flow_root/data" status; then
  pg_ctl -D "$flow_root/data" -l "$flow_root/postgres.log" start
fi
psql -h "$flow_root/socket" -d postgres -c 'select version();'
