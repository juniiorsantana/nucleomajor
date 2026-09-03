"""Guarda o que a Leva 2 das Conversas promete — e o que ela não afrouxa.

A Leva 1 abriu a travessia num sentido só. Esta migration abre o outro, e o
outro é o perigoso: escrever significa mandar mensagem do portal para o
WhatsApp de alguém. Estes testes prendem as barreiras que tornam isso aceitável
— ser membro da organização, a conversa já existir no espelho, e o conteúdo
sumir do payload quando o comando termina.

Prende também o que a Leva 1 fazia e não pode parar de fazer: a RPC de
sincronia é reescrita por inteiro aqui, e uma reescrita é exatamente onde uma
garantia se perde sem ninguém notar.
"""

from pathlib import Path
import re
import unittest


MIGRATION = (
    Path(__file__).parent
    / "migrations"
    / "20260902200000_conversas_escrita_grupos_e_nomes.sql"
)

BLOCO = re.compile(r"/\*.*?\*/", re.DOTALL)
LINHA = re.compile(r"--[^\n]*")


def sem_comentarios(sql):
    """O que o teste afirma é sobre o schema, não sobre a prosa que o explica."""
    return LINHA.sub(" ", BLOCO.sub(" ", sql))


class ConversasEscritaMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = sem_comentarios(MIGRATION.read_text(encoding="utf-8").casefold())

    def test_is_transactional(self):
        self.assertEqual(self.sql.count("begin;"), 1)
        self.assertEqual(self.sql.count("commit;"), 1)

    # ------------------------------------------------------- escrever

    def test_nenhuma_tabela_nova_e_nenhuma_policy_de_escrita(self):
        """A fila já existia. Esta migration pendura tipos nela, e nada mais.

        Uma tabela nova de comandos significaria uma segunda fila com regras
        próprias de reivindicação e expiração — e a que já existe foi escrita
        para ser a única.
        """
        self.assertNotIn("create table", self.sql)
        for verbo in ("for insert", "for update", "for delete", "for all"):
            self.assertNotIn(verbo, self.sql)
        self.assertNotIn("grant insert", self.sql)
        self.assertNotIn("grant update", self.sql)
        self.assertNotIn("grant delete", self.sql)
        self.assertNotIn("service_role", self.sql)
        self.assertNotIn("to anon", self.sql)

    def test_a_lista_de_comandos_e_reescrita_por_inteiro(self):
        """A lição de 20260829190000, aplicada ao check de `command_type`.

        Um check acrescentado em vez de reescrito derruba a escrita que o
        causou, e não só o aviso.
        """
        self.assertIn(
            "check (command_type in (\n"
            "    'operator_verification_send', 'handoff_return_to_ai', 'handoff_close',\n"
            "    'conversation_send', 'conversation_owner'\n"
            "  ))",
            self.sql,
        )

    def test_enfileirar_exige_ser_da_organizacao(self):
        self.assertIn(
            "create or replace function public.nucleo_conversation_command_enqueue", self.sql
        )
        self.assertIn("security definer", self.sql)
        self.assertIn("set search_path = ''", self.sql)
        self.assertIn("not private.is_org_member(target_organization)", self.sql)
        self.assertIn("organization membership required", self.sql)
        # `is_org_member` e não `can_manage_org`: responder cliente é o trabalho
        # de quem atende, não privilégio de dono.
        self.assertNotIn("can_manage_org", self.sql)

    def test_enfileirar_exige_conversa_ja_espelhada(self):
        """A guarda que impede a fila de virar envio para número arbitrário."""
        self.assertIn("from public.whatsapp_conversations conversation", self.sql)
        self.assertIn("conversation is not mirrored for this connection", self.sql)

    def test_o_atendente_e_resolvido_do_perfil_e_nao_aceito_do_chamador(self):
        """Sem isto, a faixa pode dizer que Lucas assumiu o que outra pessoa pegou."""
        self.assertIn("from public.organization_members membro", self.sql)
        self.assertIn("join public.profiles profile on profile.id = membro.user_id", self.sql)
        self.assertIn("membro.status = 'active'", self.sql)
        self.assertIn("attendant is not an active member of this organization", self.sql)

    def test_a_idempotencia_sai_do_clique_e_nao_do_texto(self):
        """Chavear pelo conteúdo engoliria o segundo "ok" de um atendimento."""
        self.assertIn("conversation command needs a client id", self.sql)
        self.assertIn(
            "concat_ws(':', 'conversation-command', comando, target_connection::text,"
            " chat, cliente)",
            self.sql,
        )
        # O texto NÃO entra na chave.
        chave = self.sql.split("chave := encode(", 1)[1].split(");", 1)[0]
        self.assertNotIn("texto", chave)

    def test_o_texto_tem_teto_e_o_comando_tem_prazo(self):
        self.assertIn("length(texto) > 4000", self.sql)
        self.assertIn("message text is invalid", self.sql)
        # Uma mensagem parada na fila além do prazo não deve sair sozinha: quem
        # a escreveu já saiu da tela, e a conversa já mudou.
        self.assertIn("validade := interval '10 minutes'", self.sql)
        self.assertIn("validade := interval '5 minutes'", self.sql)

    def test_o_desfecho_devolve_slug_e_nao_frase(self):
        """O texto em português vive no portal; melhorá-lo não pode exigir migration."""
        self.assertIn(
            "create or replace function public.nucleo_conversation_command_status", self.sql
        )
        self.assertIn("'errorcode', comando.error_code", self.sql)
        self.assertIn("command_type in ('conversation_send', 'conversation_owner')", self.sql)

    def test_as_duas_rpcs_sao_revogadas_antes_de_concedidas(self):
        for assinatura in (
            "public.nucleo_conversation_command_enqueue(uuid, uuid, text, text, jsonb)",
            "public.nucleo_conversation_command_status(uuid, uuid)",
        ):
            self.assertIn(f"revoke all on function {assinatura} from public", self.sql)
            self.assertIn(f"grant execute on function {assinatura} to authenticated", self.sql)

    # ---------------------------------------------------------- grupo

    def test_o_check_do_identificador_aceita_grupo_e_recusa_vazio(self):
        self.assertEqual(self.sql.count("check (contact_phone ~ '^[0-9][0-9-]{5,39}$')"), 2)
        # O check antigo precisa CAIR nas duas tabelas. Se sobrevivesse ao lado
        # do novo, os dois valeriam juntos e nenhum grupo com traço entraria —
        # sem erro de migration, e descoberto dias depois.
        for tabela in ("whatsapp_conversations", "whatsapp_messages"):
            self.assertIn(f"drop constraint if exists {tabela}_contact_phone_check", self.sql)
        self.assertIn("esperado um check de contact_phone por tabela", self.sql)

    def test_o_tipo_de_chat_e_fechado(self):
        self.assertIn("check (chat_kind in ('direto', 'grupo'))", self.sql)
        self.assertIn("chat_kind text not null default 'direto'", self.sql)

    # ------------------------------------------- o que a Leva 1 garantia

    def test_a_sincronia_reescrita_nao_perdeu_nenhuma_garantia(self):
        """A RPC é reescrita por inteiro aqui — é onde uma garantia se perde."""
        self.assertIn("private.robot_organization()", self.sql)
        self.assertIn("robot credential is inactive or connection was revoked", self.sql)
        self.assertIn("robot connection is inactive or revoked", self.sql)
        self.assertIn("credential.status = 'active'", self.sql)
        self.assertIn("connection.status <> 'revoked'", self.sql)
        self.assertIn("octet_length(sync_payload::text) > 262144", self.sql)
        self.assertIn("conversation sync batch is too large", self.sql)
        self.assertIn("on conflict (connection_id, contact_phone) do update set", self.sql)
        self.assertIn(
            "on conflict (connection_id, contact_phone, message_id) do nothing", self.sql
        )
        self.assertIn("sent_at < now() - interval '90 days'", self.sql)

    def test_continua_sem_material_de_midia(self):
        for proibido in ("media_key", "file_sha256", "file_enc_sha256", "file_length"):
            self.assertNotIn(proibido, self.sql)

    def test_a_identidade_de_quem_atende_so_sobrevive_no_dono_humano(self):
        """A mesma regra do árbitro, repetida aqui de propósito.

        Um lote fora de ordem gravaria "Atendente · Lucas" numa conversa já
        devolvida para a IA, e a lista mentiria sobre quem responde.
        """
        self.assertEqual(self.sql.count("= 'humano'\n        then"), 2)
        self.assertIn("else '' end as attendant_name", self.sql)


if __name__ == "__main__":
    unittest.main()
