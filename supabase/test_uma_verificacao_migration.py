"""Revisão estática da ponte entre as duas verificações de telefone.

O risco desta migration não é ela não funcionar — é ela funcionar demais. Uma
ponte de mão dupla transformaria "quero lembrete no celular" em "posso comandar
o assistente", e uma sobrescrita silenciosa mandaria o lembrete para o aparelho
errado. Estes testes guardam as duas bordas.
"""

from pathlib import Path
import unittest


MIGRATION = (
    Path(__file__).parent
    / "migrations"
    / "20260903230000_uma_verificacao_de_telefone_basta.sql"
)


class UmaVerificacaoMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").casefold()

    def function_body(self, name):
        marcador = "function %s" % name
        self.assertIn(marcador, self.sql, name)
        return self.sql.split(marcador, 1)[1].split("$$;", 1)[0]

    def test_a_ponte_e_de_mao_unica(self):
        # Operador vira notificação. O contrário abriria um privilégio como
        # efeito colateral de uma preferência.
        self.assertIn(
            "update public.calendar_member_preferences",
            self.function_body("private.espelhar_telefone_verificado"),
        )
        # Nenhum gatilho no sentido inverso, e nenhuma escrita na tabela de
        # operadores em lugar nenhum do arquivo.
        self.assertNotIn("update public.whatsapp_connection_operators", self.sql)
        self.assertNotIn("insert into public.whatsapp_connection_operators", self.sql)
        self.assertNotIn(
            "on public.calendar_member_preferences\nfor each row", self.sql
        )

    def test_nao_sobrescreve_numero_ja_verificado_na_agenda(self):
        corpo = self.function_body("private.espelhar_telefone_verificado")
        # Quem cadastrou um número na Agenda escolheu aquele aparelho.
        self.assertIn("and preferencia.phone_verified_at is null", corpo)

    def test_normaliza_para_e164_antes_de_gravar(self):
        corpo = self.function_body("private.espelhar_telefone_verificado")
        # O operador guarda sem `+`; a agenda exige com. É por isso que a ponte
        # não é uma cópia.
        self.assertIn("else '+' || operador.phone_e164", corpo)
        # E recusa em silêncio o que não virar E.164 válido, em vez de deixar a
        # constraint derrubar a verificação do operador.
        self.assertIn(r"numero !~ '^\+[1-9][0-9]{9,14}$'", corpo)

    def test_nao_liga_o_whatsapp_por_conta_propria(self):
        corpo = self.function_body("private.espelhar_telefone_verificado")
        # Verificar não é consentir em receber. Ligar sozinho mandaria mensagem
        # para o telefone pessoal de quem nunca pediu.
        self.assertNotIn("whatsapp_enabled", corpo)

    def test_cria_a_linha_de_preferencia_se_faltar(self):
        corpo = self.function_body("private.espelhar_telefone_verificado")
        # Ela nasce no primeiro `calendar_context`; quem nunca abriu a Agenda é
        # exatamente quem mais precisa da ponte.
        self.assertIn("insert into public.calendar_member_preferences", corpo)
        self.assertIn("on conflict (organization_id, user_id) do nothing", corpo)

    def test_so_operador_ativo_e_verificado_atravessa(self):
        corpo = self.function_body("private.espelhar_telefone_verificado")
        self.assertIn("operador.verified_at is not null", corpo)
        self.assertIn("operador.status = 'active'", corpo)
        # Mais de uma conexão: vale o último ato.
        self.assertIn("order by operador.verified_at desc", corpo)

    def test_quem_ja_se_verificou_nao_se_verifica_de_novo(self):
        self.assertIn(
            "select private.espelhar_telefone_verificado(operador.organization_id, operador.user_id)",
            self.sql,
        )

    def test_as_funcoes_nao_confiam_no_search_path(self):
        for nome in (
            "private.espelhar_telefone_verificado",
            "private.operador_verificado_espelha_telefone",
        ):
            self.assertIn("set search_path = ''", self.function_body(nome), nome)


if __name__ == "__main__":
    unittest.main()
