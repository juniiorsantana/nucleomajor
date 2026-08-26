from pathlib import Path
import unittest


MIGRATION = Path(__file__).parent / "migrations" / "20260826150000_fase_h_piloto_externo.sql"


class PhaseHPilotMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").casefold()

    def test_is_transactional_and_adds_three_rollout_modes(self):
        self.assertEqual(self.sql.count("begin;"), 1)
        self.assertEqual(self.sql.count("commit;"), 1)
        self.assertIn("customer_assistant_pilot_contacts", self.sql)
        self.assertIn("safe_mode not in ('off', 'pilot', 'active')", self.sql)
        self.assertIn("nucleo_customer_assistant_access", self.sql)

    def test_pilot_is_contact_scoped_and_forces_test_campaign(self):
        self.assertIn("private.customer_phone_matches", self.sql)
        self.assertIn("contact_not_selected", self.sql)
        self.assertIn("piloto atendimento major", self.sql)
        self.assertIn("'targetmode', 'campaign'", self.sql)
        self.assertIn("'targetcampaignid', pilot_campaign", self.sql)

    def test_only_external_collections_are_bound(self):
        self.assertIn("collection.audience = 'external'", self.sql)
        self.assertIn("collection.scope_type <> 'personal'", self.sql)
        self.assertNotIn("service_role", self.sql)

    def test_handoff_transitions_are_locked_and_vps_driven(self):
        self.assertIn("customer_handoff_transition", self.sql)
        self.assertIn("for update", self.sql)
        self.assertIn("'handoff_return_to_ai'", self.sql)
        self.assertIn("'handoff_close'", self.sql)
        self.assertIn("accepted_by", self.sql)
        self.assertIn("completed_at", self.sql)
        self.assertIn("last_error_code", self.sql)
        self.assertIn("routing_address", self.sql)

    def test_handoff_updates_are_not_directly_writable(self):
        self.assertIn("revoke update on public.customer_handoff_requests from authenticated", self.sql)
        self.assertIn("private.can_manage_org(request_row.organization_id)", self.sql)
        self.assertNotIn("create policy customer_handoff_requests_update", self.sql)

    def test_previous_postgres_namespace_regression_is_absent(self):
        self.assertNotIn("pg_catalog.coalesce", self.sql)


if __name__ == "__main__":
    unittest.main()
