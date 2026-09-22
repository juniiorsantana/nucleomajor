/**
 * O que o plano da empresa libera, lido de `organization_access_state`
 * (`sessao.acesso.recursos`).
 *
 * Sem essa leitura (`recursos` nulo: banco antes da migration de cobrança, ou
 * falha de rede), tudo fica liberado. A trava de verdade mora no banco; esconder
 * por dúvida seria tirar de quem pagou.
 *
 * A chave específica sempre vence. `assistant` ("tem alguma IA") só decide
 * quando a específica não existe — senão o plano Atendimento, que tem
 * `assistant` ligado, abriria o assistente da equipe que ele não tem.
 */
const ligado = (recursos, chave) => recursos[chave] === true;
const definido = (recursos, chave) => recursos[chave] !== undefined && recursos[chave] !== null;
const porCompatibilidade = (recursos) => recursos.assistant !== false;

export function planoLibera(recursos, recurso) {
  if (!recursos) return true;
  switch (recurso) {
    // Agentes, conhecimento, simulador: servem a qualquer IA do plano.
    case "inteligencia":
      if (definido(recursos, "ai_customer") || definido(recursos, "ai_team")) {
        return ligado(recursos, "ai_customer") || ligado(recursos, "ai_team");
      }
      return porCompatibilidade(recursos);
    // A equipe falando com o assistente pelo WhatsApp (operadores).
    case "assistente_equipe":
      return definido(recursos, "ai_team") ? ligado(recursos, "ai_team") : porCompatibilidade(recursos);
    // A IA respondendo os clientes finais.
    case "atendimento_ia":
      return definido(recursos, "ai_customer") ? ligado(recursos, "ai_customer") : porCompatibilidade(recursos);
    case "chatbots":
      return recursos.chatbots !== false;
    default:
      return true;
  }
}

export const NOMES_DOS_PLANOS_COM_IA = "Atendimento com IA e Completo";
