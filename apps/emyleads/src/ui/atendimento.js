/**
 * Como o dono de um atendimento é apresentado a quem não escreveu o código.
 *
 * Mesma separação do `MOTIVOS` do diário: o slug é do gateway e é estável — o
 * histórico gravado depende dele —, e o texto é da interface.
 *
 * Vive em `ui/` porque as duas superfícies mostram o mesmo estado: o cartão da
 * conexão, na Gestão, e a faixa dentro do WhatsApp. `page/` não importa de
 * `content/`, e essa fronteira é o que mantém a Gestão viva fora da aba.
 */
export const DONOS = {
  bot: "Robô do CRM",
  ia: "Agente de IA",
  humano: "Atendente",
};

export const textoDoDono = (dono) => DONOS[dono] || dono || "—";

/**
 * O que o dono de uma conversa significa para quem está olhando.
 *
 * "Robô do CRM" e "Agente de IA" são dois automatismos diferentes no mesmo
 * número — foi a confusão entre eles que fez um contato receber duas respostas
 * para a mesma mensagem. Explicitar aqui é mais barato que descobrir de novo.
 */
export const EXPLICACAO_DO_DONO = {
  bot: "As regras dos chatbots atendem esta conversa.",
  ia: "O agente de IA responde esta conversa.",
  humano: "Alguém assumiu. Nenhum automatismo responde.",
};

/**
 * O dono, com o nome de quem assumiu quando existe.
 *
 * "Atendente" respondia a pergunta errada quando a equipe tem mais de uma
 * pessoa: quem olha precisa saber se é ela mesma ou a colega, e "Atendente"
 * serve igual para as duas. Cai no rótulo genérico quando a sessão foi
 * assumida antes de a identidade existir, ou por um fluxo que só disse
 * "alguém pegue".
 */
export function textoDoAtendimento(sessao) {
  if (sessao?.owner !== "humano") return textoDoDono(sessao?.owner);
  const nome = String(sessao?.attendantName || "").trim();
  return nome ? `Atendente · ${nome}` : DONOS.humano;
}

/**
 * A forma curta, para contagens: "1 na IA, 2 com atendente".
 *
 * Existe porque minusculizar o rótulo longo produzia "1 agente de ia" — a
 * sigla vira palavra e o texto fica ilegível justamente onde precisa ser lido
 * de relance.
 */
export const DONOS_CURTOS = {
  bot: "no robô",
  ia: "na IA",
  humano: "com atendente",
};

/** As opções na ordem em que fazem sentido escolher. */
export const OPCOES_DE_DONO = ["bot", "ia", "humano"].map((id) => ({
  id,
  rotulo: DONOS[id],
  curto: DONOS_CURTOS[id],
}));

/**
 * Por que um envio do portal não saiu.
 *
 * Mesma separação de sempre: o slug é do runtime e é estável — ele viaja pela
 * fila e entra no log —, e o texto é da interface.
 *
 * O que estes textos precisam fazer é dizer o QUE FAZER AGORA. "Falhou" manda
 * quem está atendendo abrir o WhatsApp no celular sem saber se vale tentar de
 * novo; "o Bridge está fora do ar, tente em um minuto" e "este contato não
 * pode receber" levam a ações opostas, e é essa distinção que o slug carrega.
 */
export const MOTIVOS_DE_ENVIO = {
  bridge_unavailable: "O WhatsApp da empresa está fora do ar. Tente de novo em um minuto.",
  identity_mismatch:
    "A conexão está travada: o WhatsApp pareado não é a conta que o sistema" +
    " espera. Enviar por ela seria enviar em nome de outra pessoa. Um" +
    " administrador precisa resolver em Conexões.",
  sending_disabled: "Esta conexão não está configurada para enviar pelo portal.",
  bridge_credentials_unavailable:
    "O runtime não conseguiu se autenticar no WhatsApp da empresa. Avise um administrador.",
  connection_not_registered: "Esta conexão não existe mais no runtime.",
  owner_not_supported_for_group: "Grupo não tem atendimento atribuído a alguém.",
  invalid_payload: "O runtime recusou o formato deste pedido.",
  unsupported_command: "O runtime desta VPS ainda não conhece este comando.",
  send_failed: "O WhatsApp recusou o envio.",
  // Não deveria mais aparecer: desde 03/09/2026 a resposta manual sai por uma
  // rota própria do Bridge, que não consulta `allowed_recipients` — essa lista
  // guarda quem o agente pode procurar sozinho, e nunca teve como propósito
  // impedir alguém de responder uma conversa aberta. O texto fica porque um
  // runtime antigo ainda pode devolver este motivo.
  recipient_not_allowed:
    "Este contato foi recusado pelo WhatsApp da empresa. Se o runtime da VPS" +
    " estiver desatualizado, é isso — peça a atualização.",
  expired:
    "O runtime não pegou este pedido a tempo. Confira se o assistente da VPS" +
    " está de pé e tente de novo.",
};

export const textoDoMotivoDeEnvio = (motivo) =>
  MOTIVOS_DE_ENVIO[motivo] || (motivo ? `O envio falhou (${motivo}).` : "O envio falhou.");
