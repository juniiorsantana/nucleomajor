from pathlib import Path
import unittest


MIGRATION = Path(__file__).parent / "migrations" / "20260823010000_nucleo_conhecimento.sql"
HOTFIX = Path(__file__).parent / "migrations" / "20260823013000_corrigir_busca_conhecimento_found_ambigua.sql"


class NucleoKnowledgeMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.folded = cls.sql.casefold()
        cls.hotfix = HOTFIX.read_text(encoding="utf-8").casefold()

    def test_migration_is_transactional(self):
        self.assertTrue(self.sql.lstrip().startswith("-- Núcleo de Conhecimento"))
        self.assertEqual(self.folded.count("begin;"), 1)
        self.assertEqual(self.folded.count("commit;"), 1)

    def test_documents_are_tenant_scoped_and_versioned(self):
        self.assertIn("create table public.knowledge_documents", self.folded)
        self.assertIn("organization_id uuid not null", self.folded)
        self.assertIn("create table public.knowledge_document_versions", self.folded)
        self.assertIn("knowledge_documents_capture_version", self.folded)
        self.assertIn("unique (document_id, version)", self.folded)
        self.assertNotIn("grant select, insert, update, delete", self.folded)
        self.assertNotIn("for delete to authenticated", self.folded)

    def test_personal_scope_requires_current_user(self):
        self.assertIn("scope_type in ('organization', 'team', 'personal')", self.folded)
        self.assertIn("scope_type = 'personal' and scope_user_id is not null", self.folded)
        self.assertIn("scope_type <> 'personal' or scope_user_id = auth.uid()", self.folded)

    def test_robot_reads_only_through_operator_scoped_rpcs(self):
        self.assertIn("function public.nucleo_knowledge_search", self.folded)
        self.assertIn("function public.nucleo_knowledge_document", self.folded)
        self.assertIn("public.nucleo_operator_context(operator_phone)", self.folded)
        self.assertIn("document.organization_id = operator.organization_id", self.folded)
        self.assertIn("document.scope_user_id = operator.user_id", self.folded)
        self.assertNotIn("grant insert on public.knowledge_documents to authenticated", self.folded)

    def test_search_has_bounded_results_and_no_other_personal_documents(self):
        self.assertIn("least(greatest(coalesce(page_limit, 10), 1), 30)", self.folded)
        self.assertIn("document.scope_type <> 'personal' or document.scope_user_id = operator.user_id", self.folded)
        self.assertIn("left(document.content_markdown, 500)", self.folded)

    def test_search_alias_does_not_collide_with_plpgsql_found(self):
        for sql in (self.folded, self.hotfix):
            self.assertIn(") matched_row;", sql)
            self.assertIn("to_jsonb(matched_row)", sql)
            self.assertNotIn(") found;", sql)


if __name__ == "__main__":
    unittest.main()
