"""Real SQL + runtime processes + synthetic loopback Bridge, never WhatsApp."""

import importlib.util
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace

ROOT = Path("/tmp/nucleo-flow-phase3-20260907")
sys.path.insert(0, str(ROOT / "input/runtime"))
spec = importlib.util.spec_from_file_location("proof", ROOT / "input/prova-fluxos-concorrencia.py")
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)

from arbitro import Arbitro, DONO_BOT, DONO_IA
from flow_runtime import FlowExecutor
from flow_turn import FlowTurn
from operator_verification import OperatorVerifier, OperatorVerificationError

PHONE = "5511999993333"


class SqlVerifier(OperatorVerifier):
    def __init__(self):
        pass

    def _rpc(self, name, body, label):
        assert name.startswith("nucleo_flow_")
        args = []
        for key, value in body.items():
            assert key.replace("_", "").isalnum()
            literal = str(value) if type(value) is int else "'" + str(value).replace("'", "''") + "'"
            args.append(key + " => " + literal)
        result = proof.query("select public." + name + "(" + ",".join(args) + ");", check=False)
        if result.returncode:
            raise OperatorVerificationError(result.stderr)
        return json.loads(result.stdout)


def process_step(db_path, url):
    arbiter = Arbitro(Path(db_path))
    try:
        registry = SimpleNamespace(find=lambda org, conn: SimpleNamespace(revoked=False)
                                   if (org, conn) == (proof.ORG, proof.CONN) else None)
        FlowExecutor(SqlVerifier(), arbiter, registry, proof.CONN, url, "synthetic-token").poll_once()
    finally:
        arbiter.close()


def main():
    sent = []
    bridge_state = {"fail_confirmation": False}

    class Bridge(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            assert body["recipient"] == PHONE
            if body.get("confirm"):
                sent.append(body["message"])
                response, status = {"success": True}, 200
                if bridge_state["fail_confirmation"]:
                    bridge_state["fail_confirmation"] = False
                    response, status = {"success": False}, 500
            else:
                response, status = {"pending": True, "confirm_token": "synthetic-preview"}, 202
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(response).encode())

        def log_message(self, *args):
            pass

    subprocess.run([str(Path(proof.PSQL).with_name("createdb")), "-T", "flow_test", "flow_concurrency"], env=proof.ENV, check=True)
    bridge = ThreadingHTTPServer(("127.0.0.1", 0), Bridge)
    threading.Thread(target=bridge.serve_forever, daemon=True).start()
    try:
        fixture = (ROOT / "input/prova-fluxos-execucao.sql").read_text().split("select pg_temp.robot();")[0]
        proof.query(fixture + "\ncommit;")
        verifier = SqlVerifier()
        with tempfile.TemporaryDirectory(prefix="flow-process-proof-", dir=ROOT) as tmp:
            db = Path(tmp) / "sessions.db"
            arbiter = Arbitro(db)
            arbiter.definir_ia(proof.CONN, True)
            session = arbiter.definir_dono(proof.CONN, PHONE, DONO_BOT)
            run = verifier.flow_start(PHONE, "runtime-proof", "f3000000-0000-4000-8000-000000000006", 1, session.id, session.flow_epoch)
            arbiter.close()
            url = "http://127.0.0.1:" + str(bridge.server_port)

            def step():
                subprocess.run([sys.executable, __file__, "step", str(db), url], check=True)

            # A new OS process for every step: no cursor or ownership in memory.
            for _ in range(4):
                step()
            state = verifier.flow_state(run["executionId"])
            assert state["status"] == "suspended", state
            assert sent == ["VIP"], sent
            arbiter = Arbitro(db)
            try:
                turn = FlowTurn.load(verifier, arbiter, proof.CONN, PHONE, proof.ORG)
                assert turn.active()
                assert turn.current_step()["objetivoIa"] == "Confirmar o pedido do cliente"
                verifier.flow_finish_ai(run["executionId"], state["suspensionId"], PHONE, "sucesso")
                verifier.flow_finish_ai(run["executionId"], state["suspensionId"], PHONE, "sucesso")
                assert not turn.active()
            finally:
                arbiter.close()
            step()
            step()
            assert sent == ["VIP", "Concluido"], sent
            assert verifier.flow_state(run["executionId"])["status"] == "completed"
            print("K PASS: independent runtime processes preserve tags, branch, suspension and ordered messages")
            print("L PASS: duplicate AI completion advances once; persisted ownership resumes without browser")

            arbiter = Arbitro(db)
            session = arbiter.definir_dono(proof.CONN, PHONE, DONO_BOT)
            second = verifier.flow_start(PHONE, "human-proof", "f3000000-0000-4000-8000-000000000006", 1, session.id, session.flow_epoch)
            arbiter.assumir(proof.CONN, PHONE, "test human takeover")
            arbiter.definir_dono(proof.CONN, PHONE, DONO_IA)
            arbiter.close()
            step()
            assert verifier.flow_state(second["executionId"])["status"] == "cancelled"
            assert sent == ["VIP", "Concluido"]
            print("M PASS: human takeover and return to AI cannot resurrect old execution")

            def start_scenario(message):
                arbiter = Arbitro(db)
                try:
                    session = arbiter.definir_dono(proof.CONN, PHONE, DONO_BOT)
                    return verifier.flow_start(PHONE, message, "f3000000-0000-4000-8000-000000000006", 1, session.id, session.flow_epoch)
                finally:
                    arbiter.close()

            for outcome in ("falha", "expired"):
                scenario = start_scenario("runtime-" + outcome)
                for _ in range(4):
                    step()
                assert verifier.flow_state(scenario["executionId"])["status"] == "suspended"
                if outcome == "falha":
                    arbiter = Arbitro(db)
                    try:
                        assert FlowTurn.load(verifier, arbiter, proof.CONN, PHONE, proof.ORG).fail()
                    finally:
                        arbiter.close()
                else:
                    proof.query("update public.chatbot_flow_executions set suspension_expires_at=now()-interval '1 second' "
                                "where id='" + scenario["executionId"] + "';")
                    step()
                assert verifier.flow_state(scenario["executionId"])["cursor"] == "failure"
                step()
                step()
                assert sent[-2:] == ["VIP", "Vamos ajudar"], sent
                assert verifier.flow_state(scenario["executionId"])["status"] == "completed"
            print("P PASS: model failure and expiration both execute the configured failure path")

            uncertain = start_scenario("runtime-uncertain")
            step()
            step()
            before = len(sent)
            bridge_state["fail_confirmation"] = True
            step()
            assert verifier.flow_state(uncertain["executionId"])["status"] == "needs_review"
            step()
            assert len(sent) == before + 1
            print("Q PASS: uncertain Bridge confirmation requires review and does not resend after restart")
    finally:
        bridge.shutdown()
        bridge.server_close()
        subprocess.run([str(Path(proof.PSQL).with_name("dropdb")), "flow_concurrency"], env=proof.ENV, check=True)


if __name__ == "__main__":
    if len(sys.argv) > 1:
        process_step(sys.argv[2], sys.argv[3])
    else:
        main()
