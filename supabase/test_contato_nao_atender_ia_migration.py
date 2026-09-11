"""A etiqueta 'Não atender IA' passa a valer no gate do agente de clientes."""

from pathlib import Path
import unittest


MIGRATION = Path(__file__).parent / "migrations" / "20260911150000_contato_marcado_nao_atender_ia.sql"


class ContatoNaoAtenderIaMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.folded = cls.sql.casefold()

    def test_is_transactional_and_guarded(self):
        self.assertEqual(self.folded.count("begin;"), 1)
        self.assertEqual(self.folded.count("commit;"), 1)
        # Recusa reescrever por cima de um corpo que não é o esperado, e
        # recusa aplicação repetida.
        self.assertIn("if corpo like '%contact_opted_out%' then", self.folded)
        self.assertIn("corpo not like '%''reason'', ''active''%'", self.folded)

    def test_opt_out_comes_before_active_and_pilot(self):
        corpo = self.sql[self.sql.index("$function$") : self.sql.rindex("$function$")]
        self.assertLess(corpo.index("contact_opted_out"), corpo.index("'reason', 'active'"))
        self.assertLess(corpo.index("contact_opted_out"), corpo.index("customer_assistant_pilot_contacts"))
        # E depois de `off`: rollout desligado continua sendo `rollout_off`.
        self.assertLess(corpo.index("rollout_off"), corpo.index("contact_opted_out"))

    def test_matches_tag_by_legacy_id_or_normalized_name(self):
        self.assertIn("lower(coalesce(tag.legacy_id, '')) = 'nao-atender-ia'", self.folded)
        self.assertIn("'noatenderia', 'naoatenderia'", self.folded)
        self.assertIn("contact.deleted_at is null", self.folded)
        self.assertIn("tag.deleted_at is null", self.folded)
        self.assertIn("private.customer_phone_matches(requester_phone, contact.whatsapp_id)", self.folded)

    def test_pilot_branch_is_preserved_verbatim(self):
        self.assertIn("piloto atendimento major", self.folded)
        self.assertIn("'targetmode', 'campaign'", self.folded)
        self.assertIn("contact_not_selected", self.folded)
        self.assertIn("pilot_campaign_unavailable", self.folded)
        self.assertNotIn("service_role", self.folded)

    def test_keeps_security_definer_with_empty_search_path(self):
        self.assertIn("security definer", self.folded)
        self.assertIn("set search_path to ''", self.folded)
        self.assertIn("pg_get_functiondef(p.oid) like '%set search_path to ''''%'", self.folded)


if __name__ == "__main__":
    unittest.main()
