"""Disposable PostgreSQL only: independent connections contend for one step."""

import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import threading

ROOT = Path("/tmp/nucleo-flow-phase3-20260907")
ENV = {**os.environ, "PGHOST": str(ROOT / "socket"), "PGUSER": "nucleo",
       "LD_LIBRARY_PATH": str(ROOT / "root/usr/lib/x86_64-linux-gnu")}
PSQL = str(ROOT / "root/usr/lib/postgresql/17/bin/psql")
ORG = "f3000000-0000-4000-8000-000000000002"
ROBOT = "f3000000-0000-4000-8000-000000000001"
CONN = "f3000000-0000-4000-8000-000000000003"


def query(sql, robot=ROBOT, org=ORG, conn=CONN, check=True):
    claims = json.dumps({"app_metadata": {"is_robot": True, "organization_id": org, "connection_id": conn}})
    prefix = f"set request.jwt.claim.sub='{robot}'; set request.jwt.claims='{claims}';\n"
    result = subprocess.run([PSQL, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-d", "flow_concurrency"],
                            input=prefix + sql, text=True, capture_output=True, env=ENV)
    if check and result.returncode:
        raise RuntimeError(result.stderr)
    return result


def main():
    assert ROOT.is_dir() and ENV["PGHOST"] == "/tmp/nucleo-flow-phase3-20260907/socket"
    # A separate disposable database permits independent committed sessions.
    subprocess.run([str(Path(PSQL).with_name("createdb")), "-T", "flow_test", "flow_concurrency"], env=ENV, check=True)
    fixture = (ROOT / "input/prova-fluxos-execucao.sql").read_text().split("select pg_temp.robot();")[0]
    try:
        query(fixture + "\ncommit;")
        state = json.loads(query("select public.nucleo_flow_start('5511999993333','concurrent',"
            "'f3000000-0000-4000-8000-000000000006',1,'f3000000-0000-4000-8000-000000000007');").stdout)
        execution = state["executionId"]
        barrier = threading.Barrier(2)

        def claim():
            barrier.wait(timeout=5)
            return query(f"select public.nucleo_flow_claim('{execution}',0);", check=False)

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: claim(), range(2)))
        assert sorted(r.returncode == 0 for r in results) == [False, True], results
        assert "flow revision changed" in next(r.stderr for r in results if r.returncode)
        print("G PASS: two independent connections, exactly one claim accepted")

        query("""
          update public.whatsapp_connections set status='revoked',revoked_at=now()
            where id='f3000000-0000-4000-8000-000000000003';
          insert into auth.users(id,email) values
            ('f3000000-0000-4000-8000-000000000011','flow-other@example.invalid');
          insert into public.whatsapp_connections(id,organization_id,name,status) values
            ('f3000000-0000-4000-8000-000000000013','f3000000-0000-4000-8000-000000000002','Other','connected');
          insert into public.connection_robot_credentials(connection_id,organization_id,auth_user_id,status) values
            ('f3000000-0000-4000-8000-000000000013','f3000000-0000-4000-8000-000000000002',
             'f3000000-0000-4000-8000-000000000011','active');
        """)
        for sql in (f"select public.nucleo_flow_state('{execution}');",
                    f"select public.nucleo_flow_claim('{execution}',1);",
                    f"select public.nucleo_flow_cancel('{execution}','human_takeover');"):
            result = query(sql, robot="f3000000-0000-4000-8000-000000000011",
                           conn="f3000000-0000-4000-8000-000000000013", check=False)
            assert result.returncode and "flow execution unavailable" in result.stderr
        print("H PASS: another active robot connection cannot read, claim or cancel execution")
        query("""
          insert into auth.users(id,email) values
            ('f3000000-0000-4000-8000-000000000021','flow-other-org@example.invalid');
          insert into public.organizations(id,name,slug,created_by) values
            ('f3000000-0000-4000-8000-000000000022','Other','flow-proof-other','f3000000-0000-4000-8000-000000000021');
          insert into public.whatsapp_connections(id,organization_id,name,status) values
            ('f3000000-0000-4000-8000-000000000023','f3000000-0000-4000-8000-000000000022','Other org','connected');
          insert into public.connection_robot_credentials(connection_id,organization_id,auth_user_id,status) values
            ('f3000000-0000-4000-8000-000000000023','f3000000-0000-4000-8000-000000000022',
             'f3000000-0000-4000-8000-000000000021','active');
        """)
        result = query(f"select public.nucleo_flow_state('{execution}');",
            robot="f3000000-0000-4000-8000-000000000021", org="f3000000-0000-4000-8000-000000000022",
            conn="f3000000-0000-4000-8000-000000000023", check=False)
        assert result.returncode and "flow execution unavailable" in result.stderr
        print("I PASS: another organization cannot access execution")
    finally:
        subprocess.run([str(Path(PSQL).with_name("dropdb")), "flow_concurrency"], env=ENV, check=True)
        print("J PASS: dedicated concurrent proof database removed")


if __name__ == "__main__":
    main()
