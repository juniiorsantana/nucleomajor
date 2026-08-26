from pathlib import Path
import unittest


ROOT = Path(__file__).parent / "migrations"
CONTROL = (ROOT / "20260825120000_vps_runtime_control_plane.sql").read_text(encoding="utf-8").casefold()
CHATBOT = (ROOT / "20260825130000_vps_chatbot_executor.sql").read_text(encoding="utf-8").casefold()
COMMANDS = (ROOT / "20260826010000_vps_operator_verification_commands.sql").read_text(encoding="utf-8").casefold()


class VpsRuntimeMigrationTests(unittest.TestCase):
    def test_control_plane_derives_scope_and_is_read_only_for_portal(self):
        self.assertIn("robot_org uuid := private.robot_organization()", CONTROL)
        self.assertNotIn("organization_id', runtime_payload", CONTROL)
        self.assertIn("enable row level security", CONTROL)
        self.assertIn("grant select on public.connection_runtime_status", CONTROL)
        self.assertNotIn("grant insert on public.connection_runtime_status", CONTROL)
        self.assertIn("private.portal_realtime_notify('connections')", CONTROL)

    def test_heartbeat_contains_no_phone_message_or_secret_columns(self):
        table = CONTROL.split("create table if not exists public.connection_runtime_status", 1)[1].split(");", 1)[0]
        for forbidden in ("phone", "message", "token", "secret", "content"):
            self.assertNotIn(forbidden, table)

    def test_chatbot_executor_is_robot_scoped_and_idempotent(self):
        self.assertGreaterEqual(CHATBOT.count("robot_org uuid := private.robot_organization()"), 3)
        self.assertIn("chatbot_execution_idempotency", (ROOT / "20260823030000_fase_f_web.sql").read_text(encoding="utf-8").casefold())
        self.assertIn("status', 'already_processed'", CHATBOT)
        self.assertIn("for update", CHATBOT)
        self.assertIn("chatbot definition changed before execution", CHATBOT)

    def test_migrations_avoid_the_previous_postgres_namespace_regression(self):
        self.assertNotIn("pg_catalog.coalesce", CONTROL + CHATBOT + COMMANDS)

    def test_operator_command_keeps_code_out_of_the_browser(self):
        self.assertIn("whatsapp_operator_verification_enqueue", COMMANDS)
        self.assertIn("nucleo_runtime_commands_claim", COMMANDS)
        self.assertIn("private.robot_organization()", COMMANDS)
        self.assertIn("for update skip locked", COMMANDS)
        self.assertIn("private_payload = '{}'::jsonb", COMMANDS)
        self.assertNotIn("grant select on public.connection_runtime_commands", COMMANDS)

        enqueue_return = COMMANDS.split(
            "return jsonb_build_object(\n    'command_id'", 1
        )[1].split("end;", 1)[0]
        self.assertNotIn("verification_code", enqueue_return)
        self.assertNotIn("target_phone_e164", enqueue_return)


if __name__ == "__main__":
    unittest.main()
