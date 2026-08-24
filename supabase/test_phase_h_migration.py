from pathlib import Path
import unittest


MIGRATION = Path(__file__).parent / "migrations" / "20260823120000_fase_h_inteligencia_contextual.sql"


class PhaseHMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").casefold()

    def test_is_transactional(self):
        self.assertEqual(self.sql.count("begin;"), 1)
        self.assertEqual(self.sql.count("commit;"), 1)

    def test_models_agents_skills_campaigns_and_context(self):
        for table in (
            "assistant_templates",
            "skill_definitions",
            "assistant_profiles",
            "knowledge_collections",
            "organization_campaigns",
            "conversation_intelligence_contexts",
            "intelligence_simulations",
        ):
            self.assertIn(f"create table if not exists public.{table}", self.sql)
            self.assertIn(f"alter table public.{table} enable row level security", self.sql)
        self.assertIn("assistente-interno", self.sql)
        self.assertIn("assistente-atendimento", self.sql)
        self.assertIn("pre-qualificacao", self.sql)
        self.assertIn("skill_definitions_spec_shape_check", self.sql)
        self.assertIn("jsonb_typeof(spec #> '{activation,keywords}') = 'array'", self.sql)
        self.assertIn("jsonb_typeof(spec -> 'allowedtools') = 'array'", self.sql)

    def test_external_knowledge_must_be_explicit_and_not_personal(self):
        self.assertIn("audience text not null default 'internal'", self.sql)
        self.assertIn("knowledge_documents_external_scope_check", self.sql)
        self.assertIn("audience = 'internal' or scope_type in ('organization', 'team')", self.sql)
        self.assertIn("document.audience = 'external'", self.sql)
        self.assertIn("document.scope_type <> 'personal'", self.sql)
        self.assertIn("documentoscomodados", self.sql)

    def test_runtime_derives_tenant_connection_and_audience(self):
        self.assertIn("robot_org uuid := private.robot_organization()", self.sql)
        self.assertIn("credential.auth_user_id = auth.uid()", self.sql)
        self.assertIn("function public.nucleo_intelligence_context_resolve", self.sql)
        self.assertIn("resolved_audience text := 'customer'", self.sql)
        self.assertIn("conversation is assigned to human service", self.sql)
        self.assertIn("'conexaoid', robot_connection", self.sql)

    def test_customer_actions_never_accept_tenant_or_contact_ids(self):
        self.assertIn("function public.nucleo_customer_qualification_update", self.sql)
        self.assertIn("function public.nucleo_customer_handoff_request", self.sql)
        qualification_signature = self.sql.split(
            "create or replace function public.nucleo_customer_qualification_update(", 1
        )[1].split(")\nreturns", 1)[0]
        self.assertNotIn("organization", qualification_signature)
        self.assertNotIn("contact_id", qualification_signature)
        self.assertIn("regexp_replace(coalesce(requester_phone", self.sql)
        self.assertIn("context.audience = 'customer'", self.sql)
        self.assertIn("active skill does not allow crm qualification", self.sql)
        self.assertIn("allowed_tool.value in ('crm.contact.upsert', 'crm.tag.apply', 'crm.deal.qualify')", self.sql)

    def test_versions_rollback_and_safe_simulation_exist(self):
        self.assertIn("create table if not exists public.skill_versions", self.sql)
        self.assertIn("private.capture_skill_version", self.sql)
        self.assertIn("function public.intelligence_skill_rollback", self.sql)
        self.assertIn("create table if not exists public.intelligence_simulations", self.sql)
        self.assertIn("'simulator'", self.sql)

    def test_anon_has_no_access_and_rls_is_enabled(self):
        self.assertNotIn("to anon", self.sql)
        self.assertIn("revoke all on public.assistant_templates", self.sql)
        self.assertGreaterEqual(self.sql.count("enable row level security"), 17)
        self.assertIn("private.can_manage_org(organization_id)", self.sql)


if __name__ == "__main__":
    unittest.main()
