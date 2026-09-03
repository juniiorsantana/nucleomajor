/**
 * Validação do contrato que atravessa o provider.
 *
 * IndexedDB aceita praticamente qualquer objeto serializável. Sem uma
 * validação explícita, um backup malformado ou uma alteração incompleta pode
 * entrar na base e só revelar o problema muito depois, na interface.
 */

import { STATUS_NEGOCIO } from "../domain/types.js";
import { TIPOS_CONDICAO } from "../domain/regras.js";
import { ALVOS_IA, DESTINOS_TRANSFERENCIA, TIPOS_PASSO, saidasDoPasso } from "../domain/chatbots.js";
import { SAIDA_PADRAO, VERSAO_CANVAS } from "../domain/chatbotGrafo.js";

export const VERSAO_PACOTE = 1;

const erro = (mensagem, campo = null) => {
  const e = new Error(mensagem);
  e.codigo = "dados-invalidos";
  if (campo) e.campo = campo;
  return e;
};

const objeto = (valor, nome) => {
  if (!valor || typeof valor !== "object" || Array.isArray(valor))
    throw erro(`${nome} inválido.`);
};

const texto = (valor, campo, { vazio = false } = {}) => {
  if (typeof valor !== "string" || (!vazio && !valor.trim()))
    throw erro(`${campo} inválido.`, campo);
};

const id = (valor, campo) => texto(valor, campo);

const data = (valor, campo) => {
  if (!Number.isFinite(valor) || valor < 0) throw erro(`${campo} inválido.`, campo);
};

const listaUnica = (registros, nome) => {
  const ids = new Set();
  for (const registro of registros) {
    if (ids.has(registro.id)) throw erro(`${nome} com id duplicado: ${registro.id}.`);
    ids.add(registro.id);
  }
  return ids;
};

export function validarContato(contato, nome = "Contato") {
  objeto(contato, nome);
  id(contato.id, `${nome}.id`);
  texto(contato.nome, `${nome}.nome`, { vazio: true });
  texto(contato.telefone, `${nome}.telefone`, { vazio: true });
  if (contato.waId !== null && typeof contato.waId !== "string")
    throw erro(`${nome}.waId inválido.`, `${nome}.waId`);
  if (contato.fotoUrl !== null && contato.fotoUrl !== undefined && typeof contato.fotoUrl !== "string")
    throw erro(`${nome}.fotoUrl invÃ¡lido.`, `${nome}.fotoUrl`);
  for (const campo of ["empresa", "cargo", "email", "origem", "responsavel"])
    texto(contato[campo], `${nome}.${campo}`, { vazio: true });
  if (!Array.isArray(contato.tags) || contato.tags.some((tag) => typeof tag !== "string"))
    throw erro(`${nome}.tags inválido.`, `${nome}.tags`);
  data(contato.criadoEm, `${nome}.criadoEm`);
  data(contato.atualizadoEm, `${nome}.atualizadoEm`);
  if (contato.ultimaEm !== null) data(contato.ultimaEm, `${nome}.ultimaEm`);
  return contato;
}

export function validarNegocio(negocio, nome = "Negócio") {
  objeto(negocio, nome);
  id(negocio.id, `${nome}.id`);
  id(negocio.contactId, `${nome}.contactId`);
  texto(negocio.titulo, `${nome}.titulo`, { vazio: true });
  if (negocio.valor !== null && !Number.isFinite(negocio.valor))
    throw erro(`${nome}.valor inválido.`, `${nome}.valor`);
  id(negocio.stageId, `${nome}.stageId`);
  if (!Object.values(STATUS_NEGOCIO).includes(negocio.status))
    throw erro(`${nome}.status inválido.`, `${nome}.status`);
  texto(negocio.origem, `${nome}.origem`, { vazio: true });
  texto(negocio.motivoPerda, `${nome}.motivoPerda`, { vazio: true });
  data(negocio.criadoEm, `${nome}.criadoEm`);
  data(negocio.atualizadoEm, `${nome}.atualizadoEm`);
  return negocio;
}

export function validarTarefa(tarefa, nome = "Tarefa") {
  objeto(tarefa, nome);
  id(tarefa.id, `${nome}.id`);
  // Tarefa sem contato é válida. `tasks.contact_id` deixou de ser
  // obrigatório no banco em `20260827130000_ferramenta_tarefas_operador`, e
  // desde 03/09/2026 a tela também não exige — "ligar para o contador" é
  // uma tarefa de verdade e não é de cliente nenhum. Só a validação local
  // ainda cobrava, e cobrava depois de a pessoa ter preenchido o resto.
  if (tarefa.contactId != null && tarefa.contactId !== "") id(tarefa.contactId, `${nome}.contactId`);
  if (tarefa.dealId !== null) id(tarefa.dealId, `${nome}.dealId`);
  texto(tarefa.titulo, `${nome}.titulo`, { vazio: true });
  if (tarefa.venceEm !== null) data(tarefa.venceEm, `${nome}.venceEm`);
  if (typeof tarefa.concluida !== "boolean")
    throw erro(`${nome}.concluida inválido.`, `${nome}.concluida`);
  if (tarefa.concluidaEm !== null) data(tarefa.concluidaEm, `${nome}.concluidaEm`);
  texto(tarefa.responsavel, `${nome}.responsavel`, { vazio: true });
  data(tarefa.criadoEm, `${nome}.criadoEm`);
  return tarefa;
}

export function validarNota(nota, nome = "Nota") {
  objeto(nota, nome);
  id(nota.id, `${nome}.id`);
  id(nota.contactId, `${nome}.contactId`);
  texto(nota.texto, `${nome}.texto`, { vazio: true });
  texto(nota.autor, `${nome}.autor`, { vazio: true });
  data(nota.criadoEm, `${nome}.criadoEm`);
  return nota;
}

export function validarEvento(evento, nome = "Evento") {
  objeto(evento, nome);
  id(evento.id, `${nome}.id`);
  id(evento.contactId, `${nome}.contactId`);
  texto(evento.tipo, `${nome}.tipo`);
  texto(evento.origem, `${nome}.origem`, { vazio: true });
  if (evento.entidadeId !== null && evento.entidadeId !== undefined) id(evento.entidadeId, `${nome}.entidadeId`);
  if (evento.carga !== null && (typeof evento.carga !== "object" || Array.isArray(evento.carga)))
    throw erro(`${nome}.carga inválida.`, `${nome}.carga`);
  data(evento.ocorridoEm, `${nome}.ocorridoEm`);
  data(evento.criadoEm, `${nome}.criadoEm`);
  return evento;
}

export function validarEstagio(estagio, nome = "Estágio") {
  objeto(estagio, nome);
  id(estagio.id, `${nome}.id`);
  texto(estagio.nome, `${nome}.nome`);
  if (!Number.isInteger(estagio.ordem) || estagio.ordem < 0)
    throw erro(`${nome}.ordem inválida.`, `${nome}.ordem`);
  return estagio;
}

export function validarTag(tag, nome = "Tag") {
  objeto(tag, nome);
  id(tag.id, `${nome}.id`);
  texto(tag.nome, `${nome}.nome`);
  texto(tag.cor, `${nome}.cor`);
  return tag;
}

const listaTextosUnica = (valores, campo) => {
  if (!Array.isArray(valores) || valores.some((valor) => typeof valor !== "string" || !valor.trim()))
    throw erro(`${campo} inválido.`, campo);
  const ids = new Set(valores);
  if (ids.size !== valores.length) throw erro(`${campo} contém ids duplicados.`, campo);
  return ids;
};

export function validarCondicao(condicao, nome = "Condição") {
  objeto(condicao, nome);
  texto(condicao.tipo, `${nome}.tipo`);
  switch (condicao.tipo) {
    case TIPOS_CONDICAO.temEtiqueta:
      id(condicao.etiquetaId, `${nome}.etiquetaId`);
      break;
    case TIPOS_CONDICAO.estagioAtual:
      id(condicao.stageId, `${nome}.stageId`);
      break;
    case TIPOS_CONDICAO.primeiraConversa:
    case TIPOS_CONDICAO.tarefaAtrasada:
      break;
    case TIPOS_CONDICAO.semInteracaoHa:
      if (!Number.isInteger(condicao.dias) || condicao.dias < 0)
        throw erro(`${nome}.dias inválido.`, `${nome}.dias`);
      break;
    default:
      throw erro(`${nome}.tipo desconhecido.`, `${nome}.tipo`);
  }
  return condicao;
}

export function validarPasso(passo, nome = "Passo") {
  objeto(passo, nome);
  id(passo.id, `${nome}.id`);
  texto(passo.tipo, `${nome}.tipo`);
  if (passo.tipo === TIPOS_PASSO.enviarMensagem) {
    texto(passo.texto, `${nome}.texto`);
  } else if (passo.tipo === TIPOS_PASSO.editarEtiquetas) {
    const adicionar = listaTextosUnica(passo.adicionar, `${nome}.adicionar`);
    const remover = listaTextosUnica(passo.remover, `${nome}.remover`);
    if ([...adicionar].some((tagId) => remover.has(tagId)))
      throw erro(`${nome} não pode adicionar e remover a mesma etiqueta.`, nome);
  } else if (passo.tipo === TIPOS_PASSO.transferir) {
    // O destino é uma lista fechada: um valor livre aqui viraria uma conversa
    // entregue a um dono que não existe, e o atendimento ficaria sem ninguém.
    if (!Object.values(DESTINOS_TRANSFERENCIA).includes(passo.destino))
      throw erro(`${nome}.destino inválido.`, `${nome}.destino`);
    if (passo.motivo !== undefined && passo.motivo !== null) texto(passo.motivo, `${nome}.motivo`, { vazio: true });
    if (passo.destino === DESTINOS_TRANSFERENCIA.ia) {
      const alvo = passo.alvoIa || ALVOS_IA.recepcao;
      if (!Object.values(ALVOS_IA).includes(alvo)) throw erro(`${nome}.alvoIa inválido.`, `${nome}.alvoIa`);
      if (alvo === ALVOS_IA.skill && !passo.skillId) throw erro(`${nome}.skillId é obrigatório.`, `${nome}.skillId`);
      if (alvo === ALVOS_IA.campanha && !passo.campanhaId) throw erro(`${nome}.campanhaId é obrigatório.`, `${nome}.campanhaId`);
      for (const field of ["retornoPassoId", "falhaPassoId"]) {
        if (passo[field] !== undefined && passo[field] !== null) texto(passo[field], `${nome}.${field}`, { vazio: true });
      }
    }
  } else {
    throw erro(`${nome}.tipo desconhecido.`, `${nome}.tipo`);
  }
  return passo;
}

export function validarChatbot(chatbot, nome = "Chatbot") {
  objeto(chatbot, nome);
  id(chatbot.id, `${nome}.id`);
  texto(chatbot.nome, `${nome}.nome`);
  if (typeof chatbot.ativo !== "boolean") throw erro(`${nome}.ativo inválido.`, `${nome}.ativo`);
  if (!Array.isArray(chatbot.condicoes)) throw erro(`${nome}.condicoes inválido.`, `${nome}.condicoes`);
  if (!Array.isArray(chatbot.passos)) throw erro(`${nome}.passos inválido.`, `${nome}.passos`);
  chatbot.condicoes.forEach((condicao, i) => validarCondicao(condicao, `${nome}.condicoes[${i}]`));
  chatbot.passos.forEach((passo, i) => validarPasso(passo, `${nome}.passos[${i}]`));
  listaUnica(chatbot.passos, `${nome}.passos`);
  if (!Number.isInteger(chatbot.execucoes) || chatbot.execucoes < 0)
    throw erro(`${nome}.execucoes inválido.`, `${nome}.execucoes`);
  if (chatbot.ultimaExecucaoEm !== null) data(chatbot.ultimaExecucaoEm, `${nome}.ultimaExecucaoEm`);
  data(chatbot.criadoEm, `${nome}.criadoEm`);
  data(chatbot.atualizadoEm, `${nome}.atualizadoEm`);
  if (chatbot.canvas !== undefined) {
    objeto(chatbot.canvas, `${nome}.canvas`);
    // A v1 continua válida: registro gravado antes das saídas nomeadas é lido
    // como cadeia linear e regravado canônico no primeiro salvamento. Recusá-lo
    // aqui apagaria chatbot de quem só abriu a tela.
    if (chatbot.canvas.versao !== 1 && chatbot.canvas.versao !== VERSAO_CANVAS)
      throw erro(`${nome}.canvas.versao inválida.`, `${nome}.canvas.versao`);
    if (!Array.isArray(chatbot.canvas.nos) || !Array.isArray(chatbot.canvas.conexoes))
      throw erro(`${nome}.canvas inválido.`, `${nome}.canvas`);

    const idsEsperados = new Set(["entrada", "condicoes", ...chatbot.passos.map((passo) => passo.id)]);
    const idsNos = new Set();
    chatbot.canvas.nos.forEach((no, indice) => {
      objeto(no, `${nome}.canvas.nos[${indice}]`);
      id(no.id, `${nome}.canvas.nos[${indice}].id`);
      if (!Number.isFinite(no.x) || !Number.isFinite(no.y))
        throw erro(`${nome}.canvas.nos[${indice}] possui posição inválida.`, `${nome}.canvas.nos[${indice}]`);
      if (idsNos.has(no.id))
        throw erro(`${nome}.canvas possui nó duplicado: ${no.id}.`, `${nome}.canvas.nos`);
      idsNos.add(no.id);
    });
    if (idsNos.size !== idsEsperados.size || [...idsEsperados].some((idNo) => !idsNos.has(idNo)))
      throw erro(`${nome}.canvas não corresponde aos passos do chatbot.`, `${nome}.canvas.nos`);

    const pares = new Set();
    chatbot.canvas.conexoes.forEach((conexao, indice) => {
      objeto(conexao, `${nome}.canvas.conexoes[${indice}]`);
      id(conexao.source, `${nome}.canvas.conexoes[${indice}].source`);
      id(conexao.target, `${nome}.canvas.conexoes[${indice}].target`);
      if (!idsNos.has(conexao.source) || !idsNos.has(conexao.target))
        throw erro(`${nome}.canvas possui conexão para nó inexistente.`, `${nome}.canvas.conexoes[${indice}]`);
      // `saida` é opcional só para aceitar a v1. Quando vier, precisa ser uma
      // porta que o bloco de origem realmente tem — conexão presa numa porta
      // inexistente é um fluxo que nunca sai do lugar.
      if (conexao.saida !== undefined) {
        texto(conexao.saida, `${nome}.canvas.conexoes[${indice}].saida`);
        const passo = chatbot.passos.find((p) => p.id === conexao.source);
        if (passo && !saidasDoPasso(passo).includes(conexao.saida))
          throw erro(
            `${nome}.canvas possui conexão numa saída que o bloco não tem.`,
            `${nome}.canvas.conexoes[${indice}].saida`
          );
      }
      const par = `${conexao.source}:${conexao.saida || SAIDA_PADRAO}`;
      if (pares.has(par))
        throw erro(`${nome}.canvas possui conexão duplicada.`, `${nome}.canvas.conexoes`);
      pares.add(par);
    });
  }
  return chatbot;
}

export function referenciasDeTagsDoChatbot(chatbot) {
  const ids = new Set();
  for (const condicao of chatbot.condicoes || []) {
    if (condicao.tipo === TIPOS_CONDICAO.temEtiqueta) ids.add(condicao.etiquetaId);
  }
  for (const passo of chatbot.passos || []) {
    if (passo.tipo !== TIPOS_PASSO.editarEtiquetas) continue;
    (passo.adicionar || []).forEach((idTag) => ids.add(idTag));
    (passo.remover || []).forEach((idTag) => ids.add(idTag));
  }
  return ids;
}

export function validarReferenciasDeTags(chatbot, tags, nome = "Chatbot") {
  const ids = new Set(tags.map((tag) => tag.id));
  for (const tagId of referenciasDeTagsDoChatbot(chatbot)) {
    if (!ids.has(tagId)) throw erro(`${nome} aponta para etiqueta inexistente: ${tagId}.`, `${nome}.tags`);
  }
  return chatbot;
}

/** Valida estrutura, ids únicos e todas as referências cruzadas do backup. */
export function validarPacote(pacote) {
  objeto(pacote, "Pacote");
  if (pacote.versao !== VERSAO_PACOTE)
    throw erro(`Versão de backup não suportada: ${pacote.versao ?? "ausente"}.`, "versao");

  if (!Array.isArray(pacote.eventos)) pacote.eventos = [];
  if (!Array.isArray(pacote.chatbots)) pacote.chatbots = [];
  const colecoes = ["contatos", "negocios", "tarefas", "notas", "estagios", "tags", "eventos", "chatbots"];
  for (const chave of colecoes) {
    if (!Array.isArray(pacote[chave])) throw erro(`Pacote.${chave} inválido.`, chave);
  }

  pacote.contatos.forEach((r, i) => validarContato(r, `contatos[${i}]`));
  pacote.negocios.forEach((r, i) => validarNegocio(r, `negocios[${i}]`));
  pacote.tarefas.forEach((r, i) => validarTarefa(r, `tarefas[${i}]`));
  pacote.notas.forEach((r, i) => validarNota(r, `notas[${i}]`));
  pacote.eventos.forEach((r, i) => validarEvento(r, `eventos[${i}]`));
  pacote.estagios.forEach((r, i) => validarEstagio(r, `estagios[${i}]`));
  pacote.tags.forEach((r, i) => validarTag(r, `tags[${i}]`));
  pacote.chatbots.forEach((r, i) => validarChatbot(r, `chatbots[${i}]`));

  const contatos = listaUnica(pacote.contatos, "Contato");
  const negocios = listaUnica(pacote.negocios, "Negócio");
  const estagios = listaUnica(pacote.estagios, "Estágio");
  listaUnica(pacote.tarefas, "Tarefa");
  listaUnica(pacote.notas, "Nota");
  const eventos = listaUnica(pacote.eventos, "Evento");
  const tags = listaUnica(pacote.tags, "Tag");
  listaUnica(pacote.chatbots, "Chatbot");

  for (const contato of pacote.contatos) {
    for (const tag of contato.tags) {
      if (!tags.has(tag)) throw erro(`Contato ${contato.id} aponta para tag inexistente: ${tag}.`);
    }
  }
  for (const chatbot of pacote.chatbots) validarReferenciasDeTags(chatbot, pacote.tags, `Chatbot ${chatbot.id}`);
  for (const negocio of pacote.negocios) {
    if (!contatos.has(negocio.contactId))
      throw erro(`Negócio ${negocio.id} aponta para contato inexistente.`);
    if (!estagios.has(negocio.stageId))
      throw erro(`Negócio ${negocio.id} aponta para estágio inexistente.`);
  }
  for (const tarefa of pacote.tarefas) {
    if (!contatos.has(tarefa.contactId))
      throw erro(`Tarefa ${tarefa.id} aponta para contato inexistente.`);
    if (tarefa.dealId !== null && !negocios.has(tarefa.dealId))
      throw erro(`Tarefa ${tarefa.id} aponta para negócio inexistente.`);
  }
  for (const nota of pacote.notas) {
    if (!contatos.has(nota.contactId))
      throw erro(`Nota ${nota.id} aponta para contato inexistente.`);
  }
  for (const evento of pacote.eventos) {
    if (!contatos.has(evento.contactId))
      throw erro(`Evento ${evento.id} aponta para contato inexistente.`);
    if (evento.entidadeId && !negocios.has(evento.entidadeId) && evento.entidadeTipo === "negocio")
      throw erro(`Evento ${evento.id} aponta para negócio inexistente.`);
  }

  return pacote;
}
