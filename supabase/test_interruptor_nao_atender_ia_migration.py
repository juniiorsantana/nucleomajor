"""O interruptor 'Atendimento pela IA' grava e lê no banco, pela regra do gate."""

from pathlib import Path
import re
import unittest


PASTA = Path(__file__).parent / "migrations"
MIGRATION = PASTA / "20260913150000_interruptor_nao_atender_ia_grava_no_banco.sql"
GATE = PASTA / "20260911150000_contato_marcado_nao_atender_ia.sql"


def _funcao(sql: str, nome: str) -> str:
    inicio = sql.index(f"create or replace function public.{nome}(")
    fim = sql.index("$$;", inicio)
    return sql[inicio:fim]


class InterruptorNaoAtenderIaMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.folded = cls.sql.casefold()
        cls.gate = GATE.read_text(encoding="utf-8").casefold()
        cls.status = _funcao(cls.sql, "nucleo_contact_ai_opt_out_status").casefold()
        cls.set = _funcao(cls.sql, "nucleo_contact_ai_opt_out_set").casefold()

    def test_uma_transacao_sem_estado_entre_statements(self):
        """O SQL Editor não é `psql -f`: tabela temporária some entre statements."""
        self.assertEqual(self.folded.count("\nbegin;"), 1)
        self.assertEqual(self.folded.count("\ncommit;"), 1)
        self.assertNotIn("temporary table", self.folded)
        self.assertNotIn("temp table", self.folded)

    def test_exige_o_gate_que_trata_a_etiqueta(self):
        self.assertIn("corpo not like '%contact_opted_out%'", self.folded)

    def test_as_duas_funcoes_sao_definer_com_search_path_vazio_e_membro_ativo(self):
        for corpo in (self.status, self.set):
            self.assertIn("security definer", corpo)
            self.assertIn("set search_path = ''", corpo)
            self.assertIn("private.is_org_member(target_organization)", corpo)
            self.assertIn("auth.uid() is null", corpo)
            self.assertIn("'^[0-9]{10,15}$'", corpo)

    def test_casamento_e_o_mesmo_do_gate(self):
        """A tela dizer uma coisa e o gate decidir outra foi o defeito de 13/09."""
        for trecho in (
            "lower(coalesce(tag.legacy_id, '')) = 'nao-atender-ia'",
            "'noatenderia', 'naoatenderia'",
            "contact.deleted_at is null",
            "tag.deleted_at is null",
        ):
            self.assertIn(trecho, self.gate)
            self.assertIn(trecho, self.status)
            self.assertIn(trecho, self.set)
        self.assertIn("private.customer_phone_matches(requester_phone, contact.whatsapp_id)", self.gate)
        for corpo in (self.status, self.set):
            self.assertIn("private.customer_phone_matches(chat, contact.phone)", corpo)
            self.assertIn("private.customer_phone_matches(chat, contact.whatsapp_id)", corpo)

    def test_marca_todos_os_contatos_do_numero_e_cria_o_que_falta(self):
        self.assertIn("array_agg(contact.id", self.set)
        self.assertIn("from unnest(contatos)", self.set)
        self.assertIn("on conflict (contact_id, tag_id) do nothing", self.set)
        self.assertIn("insert into public.contacts", self.set)
        self.assertIn("on conflict (organization_id, legacy_id) do update", self.set)

    def test_desligar_remove_so_a_etiqueta_da_ia(self):
        remocao = self.set[self.set.index("delete from public.contact_tags"):]
        self.assertIn("marcacao.contact_id = any(contatos)", remocao)
        self.assertIn("'nao-atender-ia'", remocao)

    def test_parametro_contact_name_vai_qualificado(self):
        """`contact_name` também é coluna de whatsapp_conversations: sem prefixo, o PL/pgSQL recusa."""
        sem_comentarios = re.sub(r"--[^\n]*", "", self.set)
        usos = re.findall(r"[\w.]*contact_name", sem_comentarios)
        soltos = [u for u in usos if u == "contact_name"]
        # Só a declaração do parâmetro aparece solta.
        self.assertEqual(len(soltos), 1, usos)

    def test_devolve_o_estado_relido_e_nao_o_pedido(self):
        retorno = self.set[self.set.rindex("return jsonb_build_object("):]
        self.assertIn("'optedout', exists (", retorno)

    def test_so_authenticated_executa(self):
        self.assertIn(
            "revoke all on function public.nucleo_contact_ai_opt_out_set(uuid, text, boolean, text) from public, anon;",
            self.folded,
        )
        self.assertIn(
            "grant execute on function public.nucleo_contact_ai_opt_out_set(uuid, text, boolean, text) to authenticated;",
            self.folded,
        )
        self.assertNotIn("service_role", self.folded)


if __name__ == "__main__":
    unittest.main()
