/**
 * O ritmo da tela de Conexões.
 *
 * Até 23/10/2026 o cartão se relia a cada 2,5 s, com qualquer aviso do
 * Realtime (até o de mensagem nova em `conversas`) e mais uma vez por aviso.
 * Cada volta, numa conexão remota, eram TRÊS leituras de `whatsapp_connections`
 * e TRÊS de `connection_runtime_status`: a lista, a prontidão e o resumo do
 * atendimento, os dois últimos caindo de volta na mesma consulta da lista. Foi
 * o topo do `pg_stat_statements` quando o projeto passou da cota de egress.
 *
 * Agora: 2,5 s só enquanto alguém pareia (o QR tem laço próprio, de 15 s); no
 * resto, o aviso `connections` do Realtime (que chega a cada heartbeat da VPS,
 * ~20 s por conexão) puxa a releitura, no máximo uma a cada 15 s, e a
 * releitura de fundo de 30 s cobre o canal caído.
 */
export const CARTAO_PAREANDO_MS = 2500;
export const CARTAO_FUNDO_MS = 30000;
export const AVISO_MINIMO_MS = 15000;

export const cadenciaDoCartao = (alguemPareando) => (alguemPareando ? CARTAO_PAREANDO_MS : CARTAO_FUNDO_MS);

/**
 * O aviso do Realtime merece uma releitura?
 *
 * Só o tópico `connections` mexe no cartão. Pareando, toda mudança conta;
 * fora disso, um aviso logo depois de uma leitura espera a próxima.
 */
export function avisoPedeReleitura({ topico, alguemPareando = false, ultimaLeitura = 0, agora = Date.now() }) {
  if (topico !== "connections") return false;
  if (alguemPareando) return true;
  return agora - ultimaLeitura >= AVISO_MINIMO_MS;
}

/**
 * Prontidão e resumo do atendimento precisam de outra ida ao servidor?
 *
 * Só quando o gateway local respondeu (`online`). Sem ele, `gateway.prontidao`
 * e `gateway.resumoAtendimento` devolvem exatamente `readiness` e `attendance`
 * da lista que acabou de chegar, relendo as duas tabelas para isso.
 */
export const precisaPerguntarAoGateway = (estado) => estado?.gateway === "online";
