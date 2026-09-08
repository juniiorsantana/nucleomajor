"""Guarda o que a migration de "nova conversa" abre — e o que ela NÃO afrouxa.

A Leva 2 (20260902200000) fechou uma porta de propósito: a fila só enfileira
para conversa já espelhada, e é isso que impede o portal de virar uma via de
envio frio para qualquer número. Esta migration abre uma passagem por essa
porta, e o valor destes testes está quase todo no lado negativo — provar que o
que continuava fechado continua fechado.

Três coisas, portanto, e nesta ordem de importância:

  1. `conversation_send` e `conversation_owner` continuam exigindo espelho.
     Se um dia essa exigência sumir por descuido numa reescrita, é aqui que
     aparece — e não em produção, com mensagem saindo para número arbitrário.
  2. A passagem nova é uma função só, e ela é estreita: telefone individual sem
     traço (o que exclui grupo por construção) e teto por hora.
  3. `conversation_check` não exige espelho, e é o ÚNICO que não exige.
"""

from pathlib import Path
import re
import unittest


MIGRATION = (
    Path(__file__).parent
    / "migrations"
    / "20260908120000_nova_conversa_e_verificacao_de_numero.sql"
)

BLOCO = re.compile(r"/\*.*?\*/", re.DOTALL)
LINHA = re.compile(r"--[^\n]*")


def sem_comentarios(sql):
    """O que o teste afirma é sobre o schema, não sobre a prosa que o explica."""
    return LINHA.sub(" ", BLOCO.sub(" ", sql))


def ramo_da_verificacao(corpo):
    """O ramo de `conversation_check` dentro da `enqueue`.

    Recortado do `if` até a linha que fecha o ramo (`validade`), e não até o
    primeiro `else` — dentro dele existe um `if conexao is null then ... else`,
    e cortar ali deixaria metade do ramo de fora, fazendo o teste afirmar sobre
    um pedaço em vez de sobre a decisão inteira.
    """
    depois = corpo.split("if comando = 'conversation_check' then", 1)[1]
    return depois.split("validade := interval '2 minutes'", 1)[0]


def corpo_da_funcao(sql, nome):
    """O corpo de uma função, para afirmar o que está DENTRO dela.

    Sem este recorte, `assertIn` acharia a frase em qualquer lugar do arquivo e
    o teste passaria mesmo que a guarda tivesse migrado para a função errada —
    que é exatamente o engano que estes testes existem para pegar.
    """
    inicio = sql.index(f"create or replace function {nome}")
    return sql[inicio:].split("$$;", 1)[0]


class NovaConversaMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = sem_comentarios(MIGRATION.read_text(encoding="utf-8").casefold())

    def test_is_transactional(self):
        self.assertEqual(self.sql.count("begin;"), 1)
        self.assertEqual(self.sql.count("commit;"), 1)

    def test_nenhuma_tabela_nova_e_nenhuma_policy_de_escrita(self):
        """Quem escreve no espelho continua sendo RPC `security definer`.

        Uma policy de escrita aqui deixaria o navegador inserir conversa
        direto, sem passar pelo teto nem pela verificação — as duas coisas que
        tornam esta migration aceitável.
        """
        self.assertNotIn("create table", self.sql)
        for verbo in ("for insert", "for update", "for delete", "for all"):
            self.assertNotIn(verbo, self.sql)
        self.assertNotIn("grant insert", self.sql)
        self.assertNotIn("grant update", self.sql)
        self.assertNotIn("grant delete", self.sql)
        self.assertNotIn("service_role", self.sql)
        self.assertNotIn("to anon", self.sql)

    # ------------------------------------------------- o que NÃO afrouxou

    def test_enviar_e_atribuir_continuam_exigindo_conversa_espelhada(self):
        """O teste mais importante deste arquivo.

        A guarda de espelho é o que impede a fila de mandar mensagem para
        número arbitrário. Ela está dentro da `enqueue`, que esta migration
        reescreve por inteiro — e uma reescrita é exatamente onde uma garantia
        se perde sem ninguém notar.
        """
        corpo = corpo_da_funcao(self.sql, "public.nucleo_conversation_command_enqueue")
        self.assertIn("conversation is not mirrored for this connection", corpo)
        self.assertIn("from public.whatsapp_conversations conversation", corpo)

    def test_a_guarda_de_espelho_fica_no_ramo_de_enviar_e_atribuir(self):
        """A exigência não pode ter escorregado para fora do `else`.

        Se ela estivesse antes do `if comando = 'conversation_check'`, a
        verificação passaria a exigir espelho — e verificar é justamente o que
        se faz ANTES de existir conversa. Se estivesse depois de tudo, nenhum
        comando exigiria.
        """
        corpo = corpo_da_funcao(self.sql, "public.nucleo_conversation_command_enqueue")
        ramo_check = corpo.index("if comando = 'conversation_check' then")
        espelho = corpo.index("conversation is not mirrored for this connection")
        self.assertLess(ramo_check, espelho)

    def test_o_atendente_continua_sendo_resolvido_do_perfil(self):
        """Sem isto, a faixa pode dizer que alguém assumiu o que outra pegou."""
        corpo = corpo_da_funcao(self.sql, "public.nucleo_conversation_command_enqueue")
        self.assertIn("from public.organization_members membro", corpo)
        self.assertIn("membro.status = 'active'", corpo)
        self.assertIn("attendant is not an active member of this organization", corpo)

    def test_a_idempotencia_continua_saindo_do_clique_e_nao_do_texto(self):
        corpo = corpo_da_funcao(self.sql, "public.nucleo_conversation_command_enqueue")
        self.assertIn("conversation command needs a client id", corpo)
        chave = corpo.split("chave := encode(", 1)[1].split(");", 1)[0]
        self.assertNotIn("texto", chave)

    # ---------------------------------------------------- a lista de tipos

    def test_a_lista_de_comandos_e_reescrita_por_inteiro(self):
        """A lição de 20260829190000: a lista mora num lugar só e é reescrita.

        Um check acrescentado em vez de reescrito derruba a escrita que o
        causou, e não só o comando novo.
        """
        self.assertEqual(self.sql.count("connection_runtime_commands_command_type_check"), 2)
        for tipo in (
            "'operator_verification_send'",
            "'handoff_return_to_ai'",
            "'handoff_close'",
            "'conversation_send'",
            "'conversation_owner'",
            "'conversation_check'",
        ):
            self.assertIn(tipo, self.sql)

    # ------------------------------------------------------- a verificação

    def test_verificar_nao_exige_espelho_e_e_o_unico_que_nao_exige(self):
        corpo = corpo_da_funcao(self.sql, "public.nucleo_conversation_command_enqueue")
        ramo = ramo_da_verificacao(corpo)
        self.assertNotIn("whatsapp_conversations", ramo)
        # Perguntar não envia nada, mas ainda sai da conta pareada: a conexão
        # continua tendo de ser desta organização.
        self.assertIn("connection is not available for this organization", ramo)

    def test_verificar_recusa_identificador_de_grupo(self):
        """`resolveSendRecipientJID` retorna cedo para servidor de grupo.

        Um grupo chegando ao Bridge produziria um "sim" que ninguém apurou.
        """
        corpo = corpo_da_funcao(self.sql, "public.nucleo_conversation_command_enqueue")
        ramo = ramo_da_verificacao(corpo)
        self.assertIn("'^[0-9]{10,15}$'", ramo)
        self.assertIn("phone number is invalid", ramo)

    def test_o_desfecho_devolve_o_resultado_do_runtime(self):
        """Sem isto a resposta da verificação morre no banco.

        `public_result` sempre existiu e o runtime sempre a escreveu; o que não
        existia era um caminho de volta para a tela.
        """
        corpo = corpo_da_funcao(self.sql, "public.nucleo_conversation_command_status")
        self.assertIn("'result', comando.public_result", corpo)
        self.assertIn("'errorcode', comando.error_code", corpo)
        # `private_payload` continua fora: ali mora o texto da mensagem, que a
        # conclusão apaga.
        retorno = corpo.split("return jsonb_build_object(", 1)[1]
        self.assertNotIn("private_payload", retorno)

    # ----------------------------------------------------- iniciar conversa

    def test_iniciar_e_uma_funcao_separada_e_nao_um_ramo_da_enqueue(self):
        """Uma superfície de risco se audita de uma vez."""
        self.assertIn("create or replace function public.nucleo_conversation_start", self.sql)
        corpo = corpo_da_funcao(self.sql, "public.nucleo_conversation_start")
        self.assertIn("security definer", corpo)
        self.assertIn("set search_path = ''", corpo)

    def test_iniciar_exige_ser_da_organizacao_e_nao_ser_dono(self):
        """Prospectar é trabalho de quem atende, não privilégio de dono."""
        corpo = corpo_da_funcao(self.sql, "public.nucleo_conversation_start")
        self.assertIn("not private.is_org_member(target_organization)", corpo)
        self.assertIn("organization membership required", corpo)
        self.assertNotIn("can_manage_org", self.sql)

    def test_iniciar_so_aceita_telefone_individual_sem_traco(self):
        """É assim que grupo fica de fora, sem uma condição sobre `chat_kind`.

        O check da coluna aceita traço por causa de grupo antigo
        (`<telefone>-<carimbo>`). Esta função é mais estreita de propósito.
        """
        corpo = corpo_da_funcao(self.sql, "public.nucleo_conversation_start")
        self.assertIn("'^[0-9]{10,15}$'", corpo)
        self.assertIn("phone number is invalid", corpo)
        # A regex frouxa da coluna não pode aparecer aqui dentro.
        self.assertNotIn("[0-9-]", corpo)

    def test_iniciar_tem_teto_por_hora(self):
        """O teto é o que substitui a guarda de espelho.

        Sem ele, o que esta migration abre é disparo em massa — que é um
        produto diferente, e não é este.
        """
        corpo = corpo_da_funcao(self.sql, "public.nucleo_conversation_start")
        self.assertIn("too many conversations started in the last hour", corpo)
        self.assertIn("iniciadas >= 30", corpo)
        # Conta só o que o portal semeou: um dia movimentado de conversas
        # recebidas não pode fechar a porta sozinho.
        self.assertIn("conversation.started_at is not null", corpo)
        self.assertIn("now() - interval '1 hour'", corpo)

    def test_a_conversa_nasce_com_dono_humano_e_o_arbitro_e_avisado(self):
        """Uma conversa aberta por gente e respondida pela IA é pior que nada.

        O que se escreve no espelho é palpite; quem manda em quem atende
        continua sendo o árbitro da VPS, e por isso a função também enfileira
        `conversation_owner`.
        """
        corpo = corpo_da_funcao(self.sql, "public.nucleo_conversation_start")
        self.assertIn("'humano'", corpo)
        self.assertIn("public.nucleo_conversation_command_enqueue", corpo)
        self.assertIn("'conversation_owner'", corpo)

    def test_iniciar_nao_manda_mensagem(self):
        """A conversa abre vazia; a primeira mensagem sai pelo composer.

        Enfileirar um envio aqui daria à função duas responsabilidades e um
        caminho de envio que não passa pela mesma tela que todos os outros.
        """
        corpo = corpo_da_funcao(self.sql, "public.nucleo_conversation_start")
        self.assertNotIn("'conversation_send'", corpo)

    def test_reabrir_conversa_existente_nao_gasta_cota_nem_duplica(self):
        corpo = corpo_da_funcao(self.sql, "public.nucleo_conversation_start")
        self.assertIn("ja_existe := found", corpo)
        self.assertIn("if not ja_existe then", corpo)
        # Uma corrida entre duas abas da mesma pessoa não pode levantar erro.
        self.assertIn("on conflict (connection_id, contact_phone) do nothing", corpo)

    # ------------------------------------------------------ a conexão e o resto

    def test_a_conexao_e_resolvida_e_nunca_adivinhada(self):
        """Com duas conexões vivas, recusa em vez de escolher.

        Escolher seria decidir por qual número da empresa aquele cliente será
        abordado. Sem o helper, porém, uma organização com a caixa de entrada
        vazia nunca conseguiria começar a primeira conversa — não há linha de
        onde a tela leia a conexão.
        """
        self.assertIn("create or replace function private.conexao_da_organizacao", self.sql)
        corpo = corpo_da_funcao(self.sql, "private.conexao_da_organizacao")
        self.assertIn("organization has more than one connection; choose one", corpo)
        self.assertIn("connection is not available for this organization", corpo)
        self.assertIn("connection.status <> 'revoked'", corpo)
        self.assertIn("connection.revoked_at is null", corpo)

    def test_a_trilha_de_quem_iniciou_e_gravada(self):
        self.assertIn("add column if not exists started_by uuid", self.sql)
        self.assertIn("add column if not exists started_at timestamptz", self.sql)
        # Índice parcial: só as linhas semeadas interessam ao teto.
        self.assertIn("where started_at is not null", self.sql)

    def test_as_funcoes_sao_revogadas_antes_de_concedidas(self):
        for assinatura in (
            "public.nucleo_conversation_command_enqueue(uuid, uuid, text, text, jsonb)",
            "public.nucleo_conversation_command_status(uuid, uuid)",
            "public.nucleo_conversation_start(uuid, uuid, text, text)",
        ):
            revoga = self.sql.index(f"revoke all on function {assinatura} from public;")
            concede = self.sql.index(f"grant execute on function {assinatura} to authenticated;")
            self.assertLess(revoga, concede)

    def test_o_helper_de_conexao_nao_e_concedido_a_ninguem(self):
        """Ele é chamado por funções `security definer`, e por mais ninguém."""
        self.assertIn(
            "revoke all on function private.conexao_da_organizacao(uuid) from public;",
            self.sql,
        )
        self.assertNotIn("grant execute on function private.conexao_da_organizacao", self.sql)

    def test_a_migration_se_prova_na_propria_transacao(self):
        """A disciplina do repositório: afirmar dentro do `begin`/`commit`."""
        prova = self.sql.rsplit("do $$", 1)[1]
        self.assertIn("o identificador de grupo novo passa como telefone", prova)
        self.assertIn("conversation_check", prova)
        self.assertIn("started_by", prova)


if __name__ == "__main__":
    unittest.main()
