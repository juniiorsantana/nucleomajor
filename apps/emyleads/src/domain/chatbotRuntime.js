/**
 * O executor do chatbot: dado um bot e um contato, o que vai acontecer.
 *
 * Estava na linha 600 de um `localProvider.js` de 1245 linhas, cercado de
 * IndexedDB. É lógica pura — entra chatbot e contato, sai um plano — mas só
 * dava para exercitá-la através do banco, o que fazia cada teste de decisão
 * custar uma transação.
 *
 * Sai daqui um plano, não um efeito. Quem grava contato, evento e contador é o
 * provider; quem manda a mensagem é o content script. Essa separação é o que
 * permite testar "o que este fluxo faria" sem WhatsApp, sem banco e sem aba
 * aberta.
 *
 * A ordem dos passos vem do **grafo**, não do array — ver `chatbotGrafo.js`.
 * Enquanto nenhum bloco ramifica, os dois dão o mesmo caminho.
 */

import { conexoesDoChatbot, NO_CONDICOES, SAIDA_PADRAO } from "./chatbotGrafo.js";
import { TIPOS_PASSO } from "./chatbots.js";
import { avaliarExpressao } from "./regras.js";

/** Ordem de avaliação: o primeiro chatbot compatível vence. */
export const ordenarChatbots = (chatbots) =>
  [...chatbots].sort((a, b) => a.criadoEm - b.criadoEm || a.id.localeCompare(b.id));

/**
 * A primeira transferência entre os passos restantes.
 *
 * Só a primeira: dois blocos de transferência no mesmo caminho são
 * contraditórios, e obedecer ao último faria a ordem no canvas significar o
 * contrário do que ela parece.
 */
export function proximaTransferencia(passos = []) {
  const passo = passos.find((p) => p.tipo === TIPOS_PASSO.transferir);
  return passo ? {
    destino: passo.destino,
    motivo: passo.motivo || "",
    transferNodeId: passo.id,
    targetMode: passo.alvoIa || "reception",
    targetSkillId: passo.skillId || null,
    targetCampaignId: passo.campanhaId || null,
    returnNodeId: passo.retornoPassoId || null,
    failureNodeId: passo.falhaPassoId || null,
  } : null;
}

const contextoDaExecucao = (entrada) => {
  if (entrada?.contato) return entrada;
  return {
    contato: entrada || { tags: [] },
    negocios: [],
    tarefas: [],
    notas: [],
    eventos: [],
    agora: Date.now(),
  };
};

/** Resolve somente o caminho escolhido; uma convergência aparece uma única vez. */
export function caminhoDaExecucao(chatbot, entrada) {
  const contexto = contextoDaExecucao(entrada);
  const porId = new Map((chatbot.passos || []).map((passo) => [passo.id, passo]));
  const destinos = new Map(
    conexoesDoChatbot(chatbot).map((conexao) => [
      `${conexao.source}:${conexao.saida || SAIDA_PADRAO}`,
      conexao.target,
    ])
  );
  const caminho = [];
  const visitados = new Set();
  let atual = destinos.get(`${NO_CONDICOES}:${SAIDA_PADRAO}`);

  while (atual && porId.has(atual) && !visitados.has(atual)) {
    visitados.add(atual);
    const passo = porId.get(atual);
    caminho.push(passo);
    if (passo.tipo === TIPOS_PASSO.condicao) {
      const porta = avaliarExpressao(passo.expressao, contexto) ? "sim" : "nao";
      atual = destinos.get(`${atual}:${porta}`);
      continue;
    }
    if (passo.tipo === TIPOS_PASSO.encerrar || passo.tipo === TIPOS_PASSO.transferir) break;
    atual = destinos.get(`${atual}:${SAIDA_PADRAO}`);
  }
  return caminho;
}

/**
 * O que este chatbot faz com este contato, agora.
 *
 * Para na primeira mensagem: o que vem depois fica em `restantes`, sinalizado
 * no canvas mas não executado nesta fase.
 */
export function planoDosPassos(chatbot, entrada) {
  const contexto = contextoDaExecucao(entrada);
  const contato = contexto.contato;
  const caminho = caminhoDaExecucao(chatbot, contexto);
  const atuais = new Set(contato.tags || []);
  const alteradas = new Set();
  let mensagem = null;
  let parouEm = null;
  let restantes = [];
  let transferencia = null;

  for (let indice = 0; indice < caminho.length; indice += 1) {
    const passo = caminho[indice];

    // Transferência antes da mensagem encerra o plano: o fluxo entregou a
    // conversa e não tem mais o que dizer.
    if (passo.tipo === TIPOS_PASSO.transferir) {
      transferencia = proximaTransferencia([passo]);
      parouEm = indice;
      restantes = caminho.slice(indice + 1);
      break;
    }

    if (passo.tipo === TIPOS_PASSO.enviarMensagem) {
      mensagem = passo.texto;
      parouEm = indice;
      restantes = caminho.slice(indice + 1);
      // O fluxo natural é "manda a saudação e passa para a IA", com a
      // transferência DEPOIS da mensagem. Como a execução para na primeira
      // mensagem, esse bloco nunca rodaria e o bot ficaria mudo para sempre.
      // Por isso a transferência é colhida aqui, para ser aplicada depois do
      // envio confirmado — nunca antes: virar o dono e o envio falhar entrega
      // uma conversa onde a saudação nunca chegou.
      transferencia = proximaTransferencia(restantes);
      break;
    }

    for (const tagId of passo.remover || []) {
      if (atuais.delete(tagId)) alteradas.add(tagId);
    }
    for (const tagId of passo.adicionar || []) {
      if (!atuais.has(tagId)) alteradas.add(tagId);
      atuais.add(tagId);
    }
  }

  return {
    mensagem,
    etiquetas: [...alteradas],
    tagsFinais: [...atuais],
    parouEm,
    restantes,
    transferencia,
  };
}

/**
 * A impressão digital do que o plano assumiu.
 *
 * Existe para recusar uma preparação que envelheceu entre o preparo e o envio:
 * o contato ganhou uma etiqueta, o negócio mudou de estágio, alguém editou o
 * bot. Executar com base numa leitura vencida mandaria a mensagem errada.
 *
 * **A topologia entra aqui**, e não só os passos. Desde a v2 a ordem vem do
 * grafo; um canvas religado sem mexer em `passos` muda o que o bot faz, e uma
 * assinatura cega para isso deixaria passar exatamente essa edição.
 */
export const assinaturaContexto = (bot, ficha) => JSON.stringify({
  bot: {
    id: bot.id,
    ativo: bot.ativo,
    condicoes: bot.condicoes,
    passos: bot.passos,
    conexoes: conexoesDoChatbot(bot),
    atualizadoEm: bot.atualizadoEm,
  },
  ficha: {
    contato: { id: ficha.contato.id, tags: ficha.contato.tags, atualizadoEm: ficha.contato.atualizadoEm },
    negocios: ficha.negocios.map(({ id, stageId, status, atualizadoEm }) => ({ id, stageId, status, atualizadoEm })).sort((a, b) => a.id.localeCompare(b.id)),
    tarefas: ficha.tarefas.map(({ id, venceEm, concluida, concluidaEm }) => ({ id, venceEm, concluida, concluidaEm })).sort((a, b) => a.id.localeCompare(b.id)),
    notas: ficha.notas.map(({ id, criadoEm, texto }) => ({ id, criadoEm, texto })).sort((a, b) => a.id.localeCompare(b.id)),
    eventos: ficha.eventos.map(({ id, tipo, ocorridoEm, criadoEm }) => ({ id, tipo, ocorridoEm, criadoEm })).sort((a, b) => a.id.localeCompare(b.id)),
  },
});
