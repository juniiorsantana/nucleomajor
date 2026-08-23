from pathlib import Path
import unittest


MIGRATION = Path(__file__).parent / "migrations" / "20260823030000_fase_f_web.sql"


class PhaseFMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").casefold()

    def test_is_transactional(self):
        self.assertEqual(self.sql.count("begin;"), 1)
        self.assertEqual(self.sql.count("commit;"), 1)

    def test_chatbots_are_versioned_and_tenant_scoped(self):
        self.assertIn("create table if not exists public.chatbot_definitions", self.sql)
        self.assertIn("create table if not exists public.chatbot_versions", self.sql)
        self.assertIn("organization_id uuid not null", self.sql)
        self.assertIn("chatbot_definition_versioning", self.sql)
        self.assertIn("private.can_manage_org(organization_id)", self.sql)
        self.assertIn("function public.migrate_local_chatbots", self.sql)

    def test_executions_are_idempotent(self):
        self.assertIn("chatbot_execution_idempotency", self.sql)
        self.assertIn("external_message_id", self.sql)
        self.assertIn("function public.chatbot_execution_claim", self.sql)
        self.assertIn("function public.chatbot_execution_complete", self.sql)
        self.assertIn("claimed_by = auth.uid()", self.sql)

    def test_assistant_is_scoped_to_current_user(self):
        for table in ("assistant_threads", "assistant_messages", "assistant_tool_runs"):
            self.assertIn(f"create table if not exists public.{table}", self.sql)
            self.assertIn(f"alter table public.{table} enable row level security", self.sql)
        self.assertGreaterEqual(self.sql.count("user_id = auth.uid()"), 6)
        self.assertIn("pending_confirmation", self.sql)
        self.assertIn("idempotency_key", self.sql)
        self.assertIn("thread.id = assistant_messages.thread_id", self.sql)
        self.assertIn("thread.id = assistant_tool_runs.thread_id", self.sql)

    def test_calendar_confirmation_is_atomic_and_permission_aware(self):
        self.assertIn("function public.assistant_calendar_event_confirm", self.sql)
        self.assertIn("pg_advisory_xact_lock", self.sql)
        self.assertIn("for update", self.sql)
        self.assertIn("calendar_event_participants", self.sql)
        self.assertIn("member.role = 'member'", self.sql)
        self.assertIn("status = 'completed'", self.sql)

    def test_browser_never_receives_service_role_permissions(self):
        self.assertNotIn("service_role", self.sql)
        self.assertNotIn("to anon", self.sql)


if __name__ == "__main__":
    unittest.main()
