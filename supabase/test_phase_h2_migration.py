from pathlib import Path
import unittest


MIGRATION = Path(__file__).parent / "migrations" / "20260824153000_fase_h2_skill_runtime.sql"


class PhaseH2MigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").casefold()

    def test_is_transactional_and_not_public(self):
        self.assertEqual(self.sql.count("begin;"), 1)
        self.assertEqual(self.sql.count("commit;"), 1)
        self.assertIn("revoke all on function public.nucleo_intelligence_context_resolve_v2", self.sql)
        self.assertIn("to authenticated", self.sql)
        self.assertNotIn("to anon", self.sql)

    def test_reselects_skill_but_preserves_existing_campaign_flow(self):
        self.assertIn("set active_skill_id = null", self.sql)
        self.assertIn("public.nucleo_intelligence_context_resolve(", self.sql)
        self.assertNotIn("set campaign_id = null", self.sql)

    def test_returns_bounded_runtime_contract(self):
        self.assertIn("'schemaversion', 'fase-h-2'", self.sql)
        self.assertIn("'runtimecontext'", self.sql)
        self.assertIn("'instructions', instructions", self.sql)
        self.assertIn("encode(extensions.digest(skill_spec::text, 'sha256'), 'hex')", self.sql)
        self.assertIn("skills privadas ou", self.sql)
        self.assertIn("length(instructions) > 20000", self.sql)
        self.assertIn("published skill contains an unsupported tool", self.sql)

    def test_does_not_accept_tenant_skill_or_campaign_ids(self):
        signature = self.sql.split(
            "create or replace function public.nucleo_intelligence_context_resolve_v2(", 1
        )[1].split(")\nreturns", 1)[0]
        self.assertNotIn("organization", signature)
        self.assertNotIn("skill", signature)
        self.assertNotIn("campaign", signature)
        self.assertIn("robot_org uuid := private.robot_organization()", self.sql)


if __name__ == "__main__":
    unittest.main()
