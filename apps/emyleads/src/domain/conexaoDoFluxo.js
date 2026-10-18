/**
 * As conexões que dizem, pelo heartbeat, que não rodam fluxo (Etapa 11).
 *
 * O executor de fluxos só existe na VPS com `EMYLEADS_CHATBOT_RUNTIME=1` e
 * `NUCLEO_FLOW_RUNTIME=1` na conexão. Sem ele, o fluxo ativo não responde
 * ninguém — foi o risco da Adriani, que montava fluxo numa conexão sem
 * executor. O runtime informa `flowRuntime` (`online` ou `not_configured`).
 *
 * Só `not_configured` conta. `null` é "não sei" (runtime ou banco anterior à
 * Etapa 11, ou heartbeat velho) e não vira aviso: avisar por dúvida em toda
 * conexão de hoje ensinaria a ignorar o aviso.
 */
export function conexoesSemFluxo(conexoes = []) {
  return (conexoes || []).filter((conexao) => conexao?.readiness?.flowRuntime === "not_configured");
}

/** Texto do aviso, com o nome de cada conexão. */
export function textoDoAvisoSemFluxo(conexoes = []) {
  const nomes = conexoes.map((conexao) => `“${conexao?.name || "WhatsApp"}”`);
  if (!nomes.length) return "";
  if (nomes.length === 1) return `A conexão ${nomes[0]} não roda fluxo: os fluxos ativos não respondem nela.`;
  return `As conexões ${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)} não rodam fluxo: os fluxos ativos não respondem nelas.`;
}
