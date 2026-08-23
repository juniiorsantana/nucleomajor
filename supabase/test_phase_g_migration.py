from pathlib import Path
import unittest


MIGRATION = Path(__file__).parent / "migrations" / "20260823060000_fase_g_assistente_operador.sql"


class PhaseGMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").casefold()

    def test_is_transactional(self):
        self.assertEqual(self.sql.count("begin;"), 1)
        self.assertEqual(self.sql.count("commit;"), 1)

    def test_pending_action_is_private_and_tenant_scoped(self):
        self.assertIn("create table if not exists public.assistant_pending_actions", self.sql)
        self.assertIn("organization_id uuid not null", self.sql)
        self.assertIn("connection_id uuid not null", self.sql)
        self.assertIn("enable row level security", self.sql)
        self.assertIn("revoke all on public.assistant_pending_actions from anon, authenticated", self.sql)

    def test_confirmation_is_explicit_expiring_and_idempotent(self):
        self.assertIn("if not operator_confirmed", self.sql)
        self.assertIn("status = 'expired'", self.sql)
        self.assertIn("unique (organization_id, connection_id, request_key)", self.sql)
        self.assertIn("confirmation_key", self.sql)
        self.assertIn("confirmation must arrive in a later operator turn", self.sql)
        self.assertIn("assistant_pending_actions_confirmation_key_idx", self.sql)
        self.assertIn("pg_advisory_xact_lock", self.sql)
        self.assertIn("for update", self.sql)
        self.assertIn("nucleo_calendar_operator_booking_create", self.sql)

    def test_preflight_and_contract_version_are_enforced(self):
        self.assertIn("function public.nucleo_assistant_capabilities", self.sql)
        self.assertIn("fase-g-1", self.sql)
        self.assertIn("'compativel', compatible", self.sql)
        self.assertIn("'confirmacaoobrigatoria', true", self.sql)

    def test_only_scoped_rpcs_are_granted(self):
        self.assertIn("function public.nucleo_calendar_operator_action_prepare", self.sql)
        self.assertIn("function public.nucleo_calendar_operator_action_pending", self.sql)
        self.assertIn("function public.nucleo_calendar_operator_action_confirm", self.sql)
        self.assertNotIn("grant select on public.assistant_pending_actions", self.sql)


if __name__ == "__main__":
    unittest.main()
