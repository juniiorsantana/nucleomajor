"""Prende o teto que engolia o QR — e as guardas que a reescrita podia levar.

A falha que esta migration conserta não era de código nem de rota: o correio
funcionava, e recusava exatamente a única carga que importava. Um resultado sem
imagem (`starting_pairing`, `qr_expired`) passava pelo teto de 2048 bytes; um
com imagem (`awaiting_qr`, ~5 KB) era recusado pelo banco, virava `unexpected`
no runtime e "O QR não veio" na tela.

Por isso os testes daqui não olham só o número novo. Trocar um teto exigiu
reescrever a função inteira, e uma reescrita perde uma guarda sem produzir erro
nenhum no dia em que for escrita.
"""

from pathlib import Path
import re
import unittest


MIGRATION = (
    Path(__file__).parent
    / "migrations"
    / "20260910120000_a_imagem_do_qr_nao_cabe_em_dois_mil_bytes.sql"
)

BLOCO = re.compile(r"/\*.*?\*/", re.DOTALL)
LINHA = re.compile(r"--[^\n]*")


def sem_comentarios(sql):
    return LINHA.sub(" ", BLOCO.sub(" ", sql))


class ImagemDoQrMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bruto = MIGRATION.read_text(encoding="utf-8")
        cls.sql = sem_comentarios(cls.bruto.casefold())
        inicio = cls.sql.index(
            "create or replace function public.nucleo_runtime_command_complete"
        )
        cls.corpo = cls.sql[inicio : cls.sql.index("$$;", inicio)]

    def test_e_transacional(self):
        self.assertEqual(self.sql.count("begin;"), 1)
        self.assertEqual(self.sql.count("commit;"), 1)

    def test_nao_cria_nem_derruba_tabela(self):
        """Aditiva. A fila existe desde 20260826010000 e não é tocada aqui."""
        self.assertNotIn("create table", self.sql)
        self.assertNotIn("drop table", self.sql)
        self.assertNotIn("alter table", self.sql)

    def test_a_folga_cabe_no_qr_de_verdade(self):
        """12 KB não é um número redondo: é medida.

        `rsc.io/qr` com a escala 8 que o bridge aplica devolve 5,3 KB para um
        código de 160 caracteres e 6,1 KB para um de 200. A 8 KB o teto passaria
        a depender do comprimento do código que o WhatsApp resolvesse mandar — e
        um teto que só falha às vezes é a mesma falha intermitente de novo.
        """
        self.assertIn("teto := case when command_row.command_type = 'connection_pair_qr'", self.corpo)
        self.assertIn("then 12288 else 2048 end", self.corpo)

    def test_o_teto_curto_continua_valendo_para_o_resto_da_fila(self):
        """O teto existe para a fila não virar depósito. Ele não foi removido —
        só deixou de valer para a única carga que é uma imagem."""
        self.assertIn("2048", self.corpo)
        self.assertIn(
            "octet_length(coalesce(completion_result, '{}'::jsonb)::text) > teto",
            self.corpo,
        )

    def test_abrir_pareamento_nao_ganha_folga(self):
        """`connection_pair_start` responde `{status}` e nada mais. Dar folga a
        quem não carrega imagem só alargaria a superfície."""
        self.assertNotIn("connection_pair_start", self.corpo)

    def test_o_tamanho_e_conferido_depois_de_achar_o_comando(self):
        """Sem o comando não há tipo, e sem tipo não há teto.

        A troca de ordem não afrouxa nada: a guarda de reivindicação continua
        na frente, e um resultado grande num comando de outro runtime já morria
        ali.
        """
        posicao_do_teto = self.corpo.index("teto := case")
        posicao_da_guarda = self.corpo.index("runtime command is not claimed by this runtime")
        self.assertLess(posicao_da_guarda, posicao_do_teto)

    def test_a_forma_do_resultado_continua_sendo_conferida_antes(self):
        """Só o TAMANHO depende do tipo. "Isto é um objeto?" não depende, e
        continua sendo a primeira pergunta."""
        posicao_do_tipo = self.corpo.index("jsonb_typeof")
        posicao_da_busca = self.corpo.index("select command.* into command_row")
        self.assertLess(posicao_do_tipo, posicao_da_busca)

    def test_a_reescrita_manteve_as_guardas(self):
        """Uma função reescrita por inteiro para mudar um número é onde uma
        guarda some sem ninguém ver."""
        self.assertIn("robot connection is inactive or revoked", self.corpo)
        self.assertIn("runtime command completion status is invalid", self.corpo)
        self.assertIn("runtime command error code is invalid", self.corpo)
        self.assertIn("command.claimed_by = auth.uid()", self.corpo)
        self.assertIn("command.status = 'claimed'", self.corpo)
        self.assertIn("for update", self.corpo)

    def test_a_reescrita_manteve_o_desfecho_do_handoff(self):
        """Este trecho não tem nada a ver com QR — e é exatamente por isso que
        ele é o mais fácil de perder numa reescrita."""
        self.assertIn("customer_handoff_requests", self.corpo)
        self.assertIn("conversation_intelligence_contexts", self.corpo)
        self.assertIn("handoff_close", self.corpo)
        self.assertIn("handoff_return_to_ai", self.corpo)
        self.assertIn("connection_robot_credentials", self.corpo)

    def test_a_conclusao_continua_apagando_o_payload_privado(self):
        """O que a fila carrega na ida não sobra na linha depois do desfecho."""
        self.assertIn("private_payload = '{}'::jsonb", self.corpo)

    def test_quem_pode_executar_nao_mudou(self):
        self.assertIn(
            "revoke all on function "
            "public.nucleo_runtime_command_complete(uuid, text, text, jsonb, uuid) from public",
            self.sql,
        )
        self.assertIn(
            "grant execute on function "
            "public.nucleo_runtime_command_complete(uuid, text, text, jsonb, uuid) to authenticated",
            self.sql,
        )

    def test_a_migration_prova_a_si_mesma(self):
        """O bloco `do` roda na mesma transação: uma guarda perdida falha aqui,
        e não no primeiro pareamento em produção."""
        self.assertIn("o teto da imagem do qr nao esta na funcao", self.sql)
        self.assertIn("o teto curto do resto da fila se perdeu", self.sql)
        self.assertIn("a guarda de reivindicacao se perdeu", self.sql)
        self.assertIn("a reescrita perdeu o desfecho do handoff", self.sql)
        self.assertIn("a reescrita perdeu o registro de uso da credencial", self.sql)


if __name__ == "__main__":
    unittest.main()
