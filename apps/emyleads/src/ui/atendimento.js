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
