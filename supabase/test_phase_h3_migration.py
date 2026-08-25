from pathlib import Path
import unittest


MIGRATION = Path(__file__).parent / "migrations" / "20260824210000_fase_h3_orquestracao_contextual.sql"


class PhaseH3MigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").casefold()

    def test_is_additive_transactional_and_keeps_h2(self):
        self.assertEqual(self.sql.count("begin;"), 1)
        self.assertEqual(self.sql.count("commit;"), 1)
        self.assertIn("nucleo_intelligence_context_resolve_v3", self.sql)
        self.assertIn("nucleo_intelligence_context_resolve_v2", self.sql)
        self.assertNotIn("drop function public.nucleo_intelligence_context_resolve_v2", self.sql)

    def test_persists_workflow_pending_actions_and_chatbot_return(self):
        for table in (
            "conversation_skill_sessions",
            "customer_pending_actions",
            "chatbot_flow_sessions",
            "chatbot_ai_handoffs",
        ):
            self.assertIn(f"create table if not exists public.{table}", self.sql)
            self.assertIn(f"alter table public.{table} enable row level security", self.sql)
        self.assertIn("return_node_id", self.sql)
        self.assertIn("failure_node_id", self.sql)
        self.assertIn("revision bigint", self.sql)

    def test_has_three_bounded_ttls(self):
        self.assertIn("context_hours integer := 24", self.sql)
        self.assertIn("subflow_hours integer := 2", self.sql)
        self.assertIn("confirmation_minutes integer := 30", self.sql)
        self.assertIn("context_expires_at", self.sql)
        self.assertIn("subflow_expires_at", self.sql)
        self.assertIn("expires_at timestamptz", self.sql)

    def test_routing_has_fallback_negative_keywords_and_pending_precedence(self):
        self.assertIn("routing,fallback", self.sql)
        self.assertIn("activation,negativekeywords", self.sql)
        self.assertIn("if pending_exists then", self.sql)
        self.assertIn("published reception skill is required", self.sql)
        self.assertIn("matches.score desc", self.sql)

    def test_customer_booking_requires_separate_persisted_confirmation(self):
        self.assertIn("nucleo_customer_calendar_action_prepare", self.sql)
        self.assertIn("nucleo_customer_calendar_action_pending", self.sql)
        self.assertIn("nucleo_customer_calendar_action_confirm", self.sql)
        self.assertIn("confirmation must arrive in a later customer turn", self.sql)
        self.assertIn("customer confirmation is required", self.sql)
        self.assertIn("unique (organization_id, connection_id, request_key)", self.sql)

    def test_robot_derives_tenant_and_tables_are_not_directly_writable(self):
        self.assertIn("robot_org uuid := private.robot_organization()", self.sql)
        self.assertIn("revoke all on public.conversation_skill_sessions", self.sql)
        self.assertNotIn("service_role", self.sql)
        self.assertNotIn("to anon", self.sql)

    def test_postgres_expressions_are_not_schema_qualified_as_functions(self):
        self.assertNotIn("pg_catalog.coalesce", self.sql)


if __name__ == "__main__":
    unittest.main()
