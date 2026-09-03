/**
 * LocalProvider — implementa as operações do CRM contra o IndexedDB local.
 *
 * Este arquivo é UMA implementação da interface, não a interface. O dia em que
 * o EmyLeads passar a ler o bridge, nasce um `bridgeProvider.js` exportando um
 * `operacoes` com exatamente as mesmas chaves, e o `background/index.js` troca
 * um import. Nada na interface muda — é esse o ponto de toda a arquitetura.
 *
 * Por isso nenhuma operação aqui devolve cursor, handle ou objeto vivo: só
 * dados serializáveis, que atravessam `chrome.runtime.sendMessage` sem perder
 * nada.
 */

import { criarOperacoesConversas } from "./conversasMock.js";
import { gerarSeed } from "../domain/seed.js";
import {
  criarContato,
  criarNegocio,
  criarNota,
  criarTarefa,
  uid,
} from "../domain/types.js";
import { regraAtende } from "../domain/regras.js";
import {
  TIPOS_PASSO,
  criarChatbot,
  criarPasso,
} from "../domain/chatbots.js";
import {
  assinaturaContexto,
  ordenarChatbots,
  planoDosPassos,
} from "../domain/chatbotRuntime.js";
import { normalizePhone, variantesBR } from "../lib/phone.js";
import { paraSlug } from "../lib/texto.js";
import * as db from "./db.js";
import {
  VERSAO_PACOTE,
  validarContato,
  validarEstagio,
  validarNegocio,
  validarNota,
  validarEvento,
  validarChatbot,
  validarReferenciasDeTags,
  referenciasDeTagsDoChatbot,
  validarPacote,
  validarTag,
  validarTarefa,
} from "./validacao.js";

const { LOJAS } = db;

const agora = () => Date.now();

/* ------------------------------------------------------------------ */
/* Contatos                                                            */
/* ------------------------------------------------------------------ */

/**
 * Procura por telefone tentando as duas formas do nono dígito. O contato pode
 * ter sido importado com o 9 e existir no WhatsApp sem ele, ou o contrário —
 * ver `variantesBR`.
 */
async function contatoPorTelefone(telefone) {
  for (const forma of variantesBR(telefone)) {
    const achados = await db.porIndice(LOJAS.contatos, "telefone", forma);
    if (achados[0]) return achados[0];
  }
  return null;
}

async function garantirTelefoneDisponivel(telefone, ignorarId = null) {
  if (!telefone) return;
  const existente = await contatoPorTelefone(telefone);
  if (existente && existente.id !== ignorarId) {
    const erro = new Error("Já existe um contato com esse telefone.");
    erro.codigo = "telefone-duplicado";
    erro.contatoId = existente.id;
    throw erro;
  }
}

async function contatoPorWaId(waId) {
  if (!waId) return null;
  const achados = await db.porIndice(LOJAS.contatos, "waId", waId);
  return achados[0] || null;
}

/**
 * Resolve qual contato da base corresponde à conversa aberta.
 *
 * A ordem importa. O `waId` é a identidade real do WhatsApp e vem primeiro;
 * o telefone é o que o usuário digitou ou importou e serve de ponte na
 * primeira vez.
 *
 * O passo que faz a diferença é o **aprendizado**: quando um contato é achado
 * pelo telefone e ainda não tem `waId`, gravamos o wid nele. Da segunda vez em
 * diante ele resolve pela identidade exata — inclusive quando o WhatsApp
 * endereça por LID, que não é derivável do telefone. É assim que o problema do
 * LID some sem precisar do bridge.
 */
async function resolverContato({ waId = null, telefone = null, nome = null } = {}) {
  const tel = telefone ? normalizePhone(telefone) : null;

  const aprender = async (contato) => {
    if (waId && contato.waId !== waId) {
      const salvo = await db.gravar(LOJAS.contatos, { ...contato, waId, atualizadoEm: agora() });
      await registrarEvento({
        contactId: salvo.id,
        tipo: "contact.whatsapp_linked",
        entidadeTipo: "contato",
        entidadeId: salvo.id,
        carga: { waId },
      });
      return salvo;
    }
    return contato;
  };

  if (waId) {
    const porWid = await contatoPorWaId(waId);
    if (porWid) return porWid;
  }

  if (tel) {
    const porTel = await contatoPorTelefone(tel);
    if (porTel) return aprender(porTel);
  }

  // Último recurso, e só quem chamou decide usá-lo: no modo degradado o
  // WhatsApp não entrega identidade nenhuma além do que está escrito no
  // cabeçalho. Sem isto o painel continuaria de pé e não reconheceria
  // ninguém — vivo e inútil.
  //
  // Nome é palpite: dois contatos homônimos casam com o primeiro. Por isso
  // exige correspondência exata, nunca sobrescreve waId por aqui, e a
  // interface avisa que a identificação está aproximada.
  if (nome?.trim()) {
    const alvo = nome.trim().toLowerCase();
    const todos = await db.todos(LOJAS.contatos);
    const porNome = todos.filter((c) => c.nome?.trim().toLowerCase() === alvo);
    if (porNome.length === 1) return porNome[0];
  }

  return null;
}

async function criarContatoNovo(dados = {}) {
  const tel = normalizePhone(dados.telefone);
  await garantirTelefoneDisponivel(tel);
  const contato = criarContato({ ...dados, telefone: tel || "" });
  validarContato(contato);
  const salvo = await db.gravar(LOJAS.contatos, contato);
  await registrarEvento({ contactId: salvo.id, tipo: "contact.created", entidadeTipo: "contato", entidadeId: salvo.id, carga: {} });
  return salvo;
}

async function atualizarContato({ id, patch }) {
  const atual = await db.buscar(LOJAS.contatos, id);
  if (!atual) throw new Error("Contato não encontrado.");

  const proximo = { ...atual, ...patch, id, atualizadoEm: agora() };
  if (patch.telefone !== undefined) {
    proximo.telefone = normalizePhone(patch.telefone) || "";
  }
  await garantirTelefoneDisponivel(proximo.telefone, id);
  validarContato(proximo);
  const salvo = await db.gravar(LOJAS.contatos, proximo);
  await registrarEvento({ contactId: id, tipo: "contact.updated", entidadeTipo: "contato", entidadeId: id, carga: { campos: Object.keys(patch || {}) } });
  return salvo;
}

/**
 * Remove o contato e tudo que pendura nele. Negócio, tarefa e nota órfãos
 * apareceriam em listagens sem dono e não teriam como ser limpos depois.
 */
async function removerContato({ id }) {
  return db.comLojas(
    [LOJAS.contatos, LOJAS.negocios, LOJAS.tarefas, LOJAS.notas, LOJAS.eventos],
    "readwrite",
    async (lojas) => {
      const contato = await db.pedir(lojas[LOJAS.contatos].get(id));
      if (!contato) throw new Error("Contato não encontrado.");

      const [negocios, tarefas, notas, eventos] = await Promise.all([
        db.pedir(lojas[LOJAS.negocios].index("contactId").getAll(id)),
        db.pedir(lojas[LOJAS.tarefas].index("contactId").getAll(id)),
        db.pedir(lojas[LOJAS.notas].index("contactId").getAll(id)),
        db.pedir(lojas[LOJAS.eventos].index("contactId").getAll(id)),
      ]);

      negocios.forEach((n) => lojas[LOJAS.negocios].delete(n.id));
      tarefas.forEach((t) => lojas[LOJAS.tarefas].delete(t.id));
      notas.forEach((n) => lojas[LOJAS.notas].delete(n.id));
      eventos.forEach((e) => lojas[LOJAS.eventos].delete(e.id));
      lojas[LOJAS.contatos].delete(id);
      return { id };
    }
  );
}

/**
 * Importa uma lista já parseada. Devolve o que entrou e o que foi ignorado,
 * em vez de só um número: sem isso o usuário não tem como saber se a planilha
 * tinha 40 duplicados ou 40 telefones inválidos.
 */
async function importarContatos({ linhas = [] }) {
  const existentes = await db.todos(LOJAS.contatos);
  const jaTem = new Set(existentes.map((c) => c.telefone).filter(Boolean));

  const novos = [];
  const ignorados = [];

  for (const linha of linhas) {
    const tel = normalizePhone(linha.telefone);
    if (!tel) {
      ignorados.push({ ...linha, motivo: "telefone inválido" });
      continue;
    }
    // Duplicata também pela outra forma do nono dígito: a mesma pessoa numa
    // planilha com o 9 e na base sem ele entraria duas vezes.
    const formas = variantesBR(tel);
    if (formas.some((f) => jaTem.has(f))) {
      ignorados.push({ ...linha, motivo: "já estava na base" });
      continue;
    }
    formas.forEach((f) => jaTem.add(f));
    novos.push(criarContato({ ...linha, telefone: tel }));
  }

  if (novos.length) await db.gravarVarios(LOJAS.contatos, novos);
  for (const contato of novos) {
    await registrarEvento({
      contactId: contato.id,
      tipo: "contact.imported",
      entidadeTipo: "contato",
      entidadeId: contato.id,
      carga: { origem: "arquivo" },
    });
  }
  return { importados: novos.length, ignorados };
}

/**
 * Importa contatos lidos do WhatsApp conectado.
 *
 * Diferente da planilha, cada item já traz o `waId`, então a deduplicação é
 * exata e o contato nasce reconhecendo a conversa — sem depender do
 * aprendizado da primeira abertura.
 *
 * `etiqueta` vem das etiquetas do WhatsApp Business e vira uma tag do
 * EmyLeads, criada na hora se ainda não existir. É o que faz a organização que
 * já existe na conta atravessar para o CRM em vez de ser refeita à mão.
 */
async function importarDoWhatsApp({ itens = [], etiqueta = null }) {
  const existentes = await db.todos(LOJAS.contatos);
  const porWid = new Set(existentes.map((c) => c.waId).filter(Boolean));
  const porTelefone = new Set(
    existentes.flatMap((c) => variantesBR(c.telefone))
  );

  let tagId = null;
  if (etiqueta?.nome) {
    tagId = paraSlug(etiqueta.nome) || uid();
    const tags = await db.todos(LOJAS.tags);
    if (!tags.some((t) => t.id === tagId)) {
      await db.gravar(LOJAS.tags, {
        id: tagId,
        nome: etiqueta.nome,
        cor: etiqueta.cor || "#16a34a",
      });
    }
  }

  const novos = [];
  let jaExistiam = 0;

  for (const item of itens) {
    const tel = normalizePhone(item.telefone);
    const formas = variantesBR(tel);

    if (
      (item.waId && porWid.has(item.waId)) ||
      formas.some((f) => porTelefone.has(f))
    ) {
      jaExistiam += 1;
      continue;
    }

    if (item.waId) porWid.add(item.waId);
    formas.forEach((f) => porTelefone.add(f));

    novos.push(
      criarContato({
        nome: item.nome || (tel ? formatarSimples(tel) : "Sem nome"),
        telefone: tel || "",
        waId: item.waId || null,
        empresa: item.empresa || "",
        origem: "WhatsApp",
        // Vem do chat.list quando o escopo é "conversas" — é a única fonte
        // de última interação que existe sem o bridge.
        ultimaEm: item.ultimaEm || null,
        tags: tagId ? [tagId] : [],
      })
    );
  }

  if (novos.length) await db.gravarVarios(LOJAS.contatos, novos);
  for (const contato of novos) {
    await registrarEvento({
      contactId: contato.id,
      tipo: "contact.imported",
      entidadeTipo: "contato",
      entidadeId: contato.id,
      carga: { origem: "whatsapp", etiqueta: etiqueta?.nome || null },
    });
  }
  return { importados: novos.length, jaExistiam, tagId };
}

/** Nome de emergência para contato sem nome salvo. */
const formatarSimples = (tel) => `+${tel}`;

/* ------------------------------------------------------------------ */
/* Negócios, tarefas e notas                                           */
/* ------------------------------------------------------------------ */

async function exigirContato(id) {
  if (!(await db.buscar(LOJAS.contatos, id)))
    throw new Error("Contato não encontrado.");
}

async function exigirNegocio(id) {
  if (!(await db.buscar(LOJAS.negocios, id)))
    throw new Error("Negócio não encontrado.");
}

async function exigirEstagio(id) {
  if (!(await db.buscar(LOJAS.estagios, id)))
    throw new Error("Estágio não encontrado.");
}

async function criarNegocioNovo(dados = {}) {
  const negocio = criarNegocio(dados);
  await exigirContato(negocio.contactId);
  await exigirEstagio(negocio.stageId);
  validarNegocio(negocio);
  const salvo = await db.gravar(LOJAS.negocios, negocio);
  await registrarEvento({ contactId: negocio.contactId, tipo: "deal.created", entidadeTipo: "negocio", entidadeId: negocio.id, carga: { titulo: negocio.titulo } });
  return salvo;
}

async function criarTarefaNova(dados = {}) {
  const tarefa = criarTarefa(dados);
  if (tarefa.contactId) await exigirContato(tarefa.contactId);
  if (tarefa.dealId !== null) await exigirNegocio(tarefa.dealId);
  validarTarefa(tarefa);
  const salvo = await db.gravar(LOJAS.tarefas, tarefa);
  await registrarEvento({ contactId: tarefa.contactId, tipo: "task.created", entidadeTipo: "tarefa", entidadeId: tarefa.id, carga: { titulo: tarefa.titulo } });
  return salvo;
}

async function criarNotaNova(dados = {}) {
  const nota = criarNota(dados);
  await exigirContato(nota.contactId);
  validarNota(nota);
  const salvo = await db.gravar(LOJAS.notas, nota);
  await registrarEvento({ contactId: nota.contactId, tipo: "note.created", entidadeTipo: "nota", entidadeId: nota.id, carga: {} });
  return salvo;
}

async function registrarEvento(dados = {}) {
  const evento = {
    id: dados.id || uid(),
    contactId: dados.contactId || "",
    tipo: dados.tipo || "contact.updated",
    entidadeTipo: dados.entidadeTipo || null,
    entidadeId: dados.entidadeId || null,
    origem: dados.origem || "app",
    carga: dados.carga || {},
    ocorridoEm: dados.ocorridoEm || agora(),
    criadoEm: dados.criadoEm || agora(),
  };
  await exigirContato(evento.contactId);
  validarEvento(evento);
  return db.gravar(LOJAS.eventos, evento);
}

const atualizarEm = (loja, validar) => async ({ id, patch }) => {
  const atual = await db.buscar(loja, id);
  if (!atual) throw new Error("Registro não encontrado.");
  const proximo = { ...atual, ...patch, id, atualizadoEm: agora() };
  validar(proximo);
  return db.gravar(loja, proximo);
};

async function atualizarNegocio({ id, patch }) {
  if (patch.contactId !== undefined) await exigirContato(patch.contactId);
  if (patch.stageId !== undefined) await exigirEstagio(patch.stageId);
  // Lido ANTES da gravação: é a única janela em que o estágio antigo ainda
  // existe. Sem ele o log guarda só o nome do campo que mudou, e a linha do
  // tempo consegue dizer "mexeram no estágio" mas nunca "de onde para onde" -
  // que é justamente a informação que faz a entrada valer a linha.
  const anterior = patch.stageId !== undefined ? await db.buscar(LOJAS.negocios, id) : null;
  const salvo = await atualizarEm(LOJAS.negocios, validarNegocio)({ id, patch });
  const carga = { campos: Object.keys(patch || {}) };
  if (anterior && anterior.stageId !== salvo.stageId) {
    carga.estagio = { de: anterior.stageId, para: salvo.stageId };
  }
  await registrarEvento({ contactId: salvo.contactId, tipo: "deal.updated", entidadeTipo: "negocio", entidadeId: id, carga });
  return salvo;
}

async function atualizarTarefa({ id, patch }) {
  if (patch.contactId !== undefined) await exigirContato(patch.contactId);
  if (patch.dealId !== undefined && patch.dealId !== null)
    await exigirNegocio(patch.dealId);
  const salvo = await atualizarEm(LOJAS.tarefas, validarTarefa)({ id, patch });
  await registrarEvento({ contactId: salvo.contactId, tipo: "task.updated", entidadeTipo: "tarefa", entidadeId: id, carga: { campos: Object.keys(patch || {}) } });
  return salvo;
}

async function atualizarNota({ id, patch }) {
  if (patch.contactId !== undefined) await exigirContato(patch.contactId);
  const salvo = await atualizarEm(LOJAS.notas, validarNota)({ id, patch });
  await registrarEvento({ contactId: salvo.contactId, tipo: "note.updated", entidadeTipo: "nota", entidadeId: id, carga: { campos: Object.keys(patch || {}) } });
  return salvo;
}

async function concluirTarefa({ id, concluida }) {
  const atual = await db.buscar(LOJAS.tarefas, id);
  if (!atual) throw new Error("Tarefa não encontrada.");
  const salvo = await db.gravar(LOJAS.tarefas, {
    ...atual,
    concluida,
    concluidaEm: concluida ? agora() : null,
  });
  await registrarEvento({ contactId: atual.contactId, tipo: concluida ? "task.completed" : "task.reopened", entidadeTipo: "tarefa", entidadeId: id, carga: {} });
  return salvo;
}

/* ------------------------------------------------------------------ */
/* Ficha completa — uma chamada só                                     */
/* ------------------------------------------------------------------ */

/**
 * Tudo que o painel precisa para desenhar a ficha, numa ida só.
 *
 * Cinco chamadas separadas atravessando message passing dariam cinco
 * re-renderizações e um piscar visível a cada troca de conversa — e trocar de
 * conversa é a ação mais frequente do produto.
 */
async function fichaDoContato({ contactId }) {
  const [contato, negocios, tarefas, notas, eventos] = await Promise.all([
    db.buscar(LOJAS.contatos, contactId),
    db.porIndice(LOJAS.negocios, "contactId", contactId),
    db.porIndice(LOJAS.tarefas, "contactId", contactId),
    db.porIndice(LOJAS.notas, "contactId", contactId),
    db.porIndice(LOJAS.eventos, "contactId", contactId),
  ]);
  if (!contato) return null;

  return {
    contato,
    negocios: negocios.sort((a, b) => b.criadoEm - a.criadoEm),
    tarefas: tarefas.sort(
      (a, b) => (a.venceEm ?? Infinity) - (b.venceEm ?? Infinity)
    ),
    notas: notas.sort((a, b) => b.criadoEm - a.criadoEm),
    eventos: eventos.sort((a, b) => (b.ocorridoEm || b.criadoEm) - (a.ocorridoEm || a.criadoEm)),
  };
}

/* ------------------------------------------------------------------ */
/* Motor de condições — Fase 1 do chatbot                              */
/* ------------------------------------------------------------------ */

/**
 * Regras que atendem para o contato agora, para o painel sugerir uma ação.
 * Reaproveita fichaDoContato em vez de duplicar as cinco leituras — mesma
 * razão do comentário logo acima dela.
 */
async function tagsDoChatbotValidas(chatbot) {
  const tags = await db.todos(LOJAS.tags);
  validarReferenciasDeTags(chatbot, tags);
  return tags;
}

const CHAVE_AUTO = (messageId) => `chatbot.auto:${messageId}`;
const RESERVA_AUTO_MS = 2 * 60 * 1000;
const CHAVE_PAUSA = "automacao.pausa";

/**
 * O kill switch das respostas automáticas.
 *
 * Mora no provider, e não na interface, de propósito. O painel pode estar
 * recolhido, numa aba antiga ou desmontado, e mesmo assim `prepararAutomatico`
 * continua sendo chamado por qualquer aba do WhatsApp que esteja aberta. Este
 * é o único ponto por onde TODA resposta automática passa, então é o único
 * lugar onde uma pausa vale de verdade.
 *
 * Pausar não enfileira: mensagem que chega durante a pausa simplesmente deixa
 * de ser respondida. Retomar não pode disparar de uma vez tudo o que ficou
 * represado — é exatamente disso que o atendente está fugindo ao apertar o
 * botão.
 *
 * Fica só nesta máquina (ver a denylist do remoteProvider). Um atendente que
 * puxa o freio precisa que ele pegue agora, não depois de um round-trip de
 * sincronização que pode falhar.
 */
async function estadoAutomacao() {
  const registro = await db.buscar(LOJAS.meta, CHAVE_PAUSA);
  return { pausada: !!registro?.pausada, desde: registro?.desde ?? null };
}

async function pausarAutomacao({ pausada, agora: instante = Date.now() } = {}) {
  const estado = { pausada: !!pausada, desde: pausada ? instante : null };
  await db.gravar(LOJAS.meta, { chave: CHAVE_PAUSA, ...estado });
  return estado;
}

const CHAVE_DIARIO = "automacao.diario";
const DIARIO_LIMITE = 200;

/**
 * O diário da automação — por que o bot respondeu, ou por que não respondeu.
 *
 * Sem ele o piloto é cego: `prepararAutomatico` decide "não vou responder" de
 * seis maneiras diferentes, e olhando a conversa é impossível distinguir bot
 * desativado, condição que não bate, contato fora da base, automação pausada e
 * mensagem que outra aba já respondeu.
 *
 * Anel de tamanho fixo num registro só. O diário é diagnóstico do agora, não
 * histórico: quem precisa de durabilidade e auditoria usa o evento
 * `chatbot.executado`, que é a fonte de verdade e não expira.
 *
 * Nunca lança. Um diário quebrado não pode derrubar um envio.
 */
async function registrarNoDiario(entrada) {
  try {
    await db.comLojas([LOJAS.meta], "readwrite", async (abertas) => {
      const atual = await db.pedir(abertas[LOJAS.meta].get(CHAVE_DIARIO));
      // Mais nova primeiro: é a ordem em que se lê ao investigar, e faz o
      // rollup por chatbot ser o primeiro acerto de cada tipo.
      const entradas = [entrada, ...(atual?.entradas || [])].slice(0, DIARIO_LIMITE);
      abertas[LOJAS.meta].put({ chave: CHAVE_DIARIO, entradas });
    });
  } catch (err) {
    console.error("[EmyLeads] falha ao registrar no diário da automação:", err);
  }
}

/** Registro vindo do content script, que enxerga o que o provider não vê. */
const registrarAutomacao = ({ resultado, motivo, ...resto }) =>
  registrarNoDiario({
    em: Date.now(),
    messageId: null,
    contactId: null,
    chatbotId: null,
    chatbotNome: null,
    ...resto,
    resultado,
    motivo,
  });

async function lerDiario({ limite = DIARIO_LIMITE } = {}) {
  const registro = await db.buscar(LOJAS.meta, CHAVE_DIARIO);
  const entradas = (registro?.entradas || []).slice(0, limite);

  // O resumo por chatbot é derivado na leitura, e não mantido num segundo
  // registro: uma fonte só não tem como divergir da outra.
  const porChatbot = new Map();
  for (const entrada of entradas) {
    if (!entrada.chatbotId) continue;
    if (!porChatbot.has(entrada.chatbotId)) {
      porChatbot.set(entrada.chatbotId, {
        chatbotId: entrada.chatbotId,
        nome: entrada.chatbotNome || null,
        ultimoDisparo: null,
        ultimoErro: null,
      });
    }
    const alvo = porChatbot.get(entrada.chatbotId);
    if (!alvo.nome && entrada.chatbotNome) alvo.nome = entrada.chatbotNome;
    // As entradas vêm da mais nova para a mais velha, então o primeiro acerto
    // de cada tipo já é o último que aconteceu.
    if (!alvo.ultimoDisparo && entrada.resultado === "enviado") alvo.ultimoDisparo = entrada;
    if (!alvo.ultimoErro && entrada.resultado === "erro") alvo.ultimoErro = entrada;
  }

  return { entradas, porChatbot: [...porChatbot.values()] };
}

async function prepararExecucao({ contactId, chatbotId, agora: instante = Date.now() }) {
  const [bot, ficha] = await Promise.all([
    db.buscar(LOJAS.chatbots, chatbotId),
    fichaDoContato({ contactId }),
  ]);
  if (!bot) {
    const erro = new Error("Chatbot não encontrado.");
    erro.codigo = "chatbot-nao-encontrado";
    throw erro;
  }
  if (!ficha) return null;
  if (bot.ativo === false) {
    const erro = new Error("Este chatbot está desativado.");
    erro.codigo = "chatbot-nao-se-aplica";
    throw erro;
  }
  if (!regraAtende(bot, { ...ficha, agora: instante })) {
    const erro = new Error("As condições do chatbot não se aplicam mais.");
    erro.codigo = "chatbot-nao-se-aplica";
    throw erro;
  }

  const plano = planoDosPassos(bot, ficha.contato);
  return {
    chatbotId: bot.id,
    nome: bot.nome,
    mensagem: plano.mensagem,
    etiquetas: plano.etiquetas,
    parouEm: plano.parouEm,
      transferencia: plano.transferencia,
    restantes: plano.restantes,
    contextoVersao: assinaturaContexto(bot, ficha),
  };
}

async function avaliarChatbots({ contactId, agora: instante = Date.now() }) {
  const ficha = await fichaDoContato({ contactId });
  if (!ficha) return { sugestoes: [] };
  const bots = ordenarChatbots(await db.todos(LOJAS.chatbots));
  const sugestoes = bots
    .filter((bot) => bot.ativo !== false && regraAtende(bot, { ...ficha, agora: instante }))
    .map((bot) => {
      const plano = planoDosPassos(bot, ficha.contato);
      return {
        chatbotId: bot.id,
        nome: bot.nome,
        mensagem: plano.mensagem,
        passos: bot.passos,
        etiquetas: plano.etiquetas,
      };
    });
  return { sugestoes };
}

/**
 * Escolhe e reserva o primeiro chatbot aplicável a uma mensagem recebida.
 *
 * Devolve SEMPRE `{ preparacao, motivo }`, nunca `null` seco. São seis saídas
 * diferentes para "não vou responder", e o chamador precisa distinguir uma da
 * outra — é essa distinção que responde "por que o bot não respondeu?" quando
 * o atendente pergunta.
 */
async function prepararAutomatico({ contactId, messageId, agora: instante = Date.now() }) {
  if (!contactId || !messageId) throw new Error("Mensagem automatica invalida.");

  const ignorar = async (motivo, bot = null) => {
    await registrarNoDiario({
      em: instante,
      messageId,
      contactId,
      chatbotId: bot?.id || null,
      chatbotNome: bot?.nome || null,
      resultado: "ignorado",
      motivo,
    });
    return { preparacao: null, motivo };
  };

  // Antes de qualquer leitura de ficha e, principalmente, antes da reserva:
  // uma automação pausada não pode consumir o messageId, senão a mensagem
  // ficaria queimada para sempre e não seria respondida nem depois de retomar.
  const { pausada } = await estadoAutomacao();
  if (pausada) return ignorar("automacao-pausada");

  const relogioReserva = Date.now();

  const ficha = await fichaDoContato({ contactId });
  if (!ficha) return ignorar("contato-sem-ficha");
  if (ficha.eventos.some((evento) => evento.carga?.mensagemRecebidaId === messageId))
    return ignorar("mensagem-ja-respondida");

  const bots = ordenarChatbots(await db.todos(LOJAS.chatbots));
  const bot = bots.find(
    (item) => item.ativo !== false && regraAtende(item, { ...ficha, agora: instante })
  );
  if (!bot) return ignorar("nenhum-bot-aplicavel");

  const chave = CHAVE_AUTO(messageId);
  const reservou = await db.comLojas([LOJAS.meta], "readwrite", async (abertas) => {
    const atual = await db.pedir(abertas[LOJAS.meta].get(chave));
    const ativa =
      atual &&
      (atual.status === "enviado" || relogioReserva - (atual.criadoEm || 0) < RESERVA_AUTO_MS);
    if (ativa) return false;
    abertas[LOJAS.meta].put({
      chave,
      status: "reservado",
      contactId,
      chatbotId: bot.id,
      criadoEm: relogioReserva,
    });
    return true;
  });
  // Outra aba (ou uma execução ainda dentro da janela de reserva) já pegou
  // esta mensagem. Não é erro: é a proteção funcionando.
  if (!reservou) return ignorar("reserva-ativa", bot);

  const plano = planoDosPassos(bot, ficha.contato);
  return {
    preparacao: {
      chatbotId: bot.id,
      nome: bot.nome,
      mensagem: plano.mensagem,
      etiquetas: plano.etiquetas,
      parouEm: plano.parouEm,
      transferencia: plano.transferencia,
      restantes: plano.restantes,
      contextoVersao: assinaturaContexto(bot, ficha),
    },
    motivo: null,
  };
}

async function marcarAutomaticoEnviado({ contactId, chatbotId, chatbotNome = null, messageId, agora: instante = Date.now() }) {
  const chave = CHAVE_AUTO(messageId);
  const marcou = await db.comLojas([LOJAS.meta], "readwrite", async (abertas) => {
    const reserva = await db.pedir(abertas[LOJAS.meta].get(chave));
    if (!reserva || reserva.contactId !== contactId || reserva.chatbotId !== chatbotId)
      return false;
    abertas[LOJAS.meta].put({ ...reserva, status: "enviado", enviadoEm: instante });
    return true;
  });

  // O diário registra o disparo aqui, e não no `executar`: este é o instante em
  // que o WhatsApp aceitou a mensagem. O que vier depois pode falhar sem que o
  // cliente deixe de ter recebido o texto.
  if (marcou) {
    await registrarNoDiario({
      em: instante,
      messageId,
      contactId,
      chatbotId,
      chatbotNome,
      resultado: "enviado",
      motivo: "enviado",
    });
  }
  return marcou;
}

async function cancelarAutomatico({ contactId, chatbotId, chatbotNome = null, messageId, erro = null }) {
  const chave = CHAVE_AUTO(messageId);
  const cancelou = await db.comLojas([LOJAS.meta], "readwrite", async (abertas) => {
    const reserva = await db.pedir(abertas[LOJAS.meta].get(chave));
    if (
      reserva?.status === "reservado" &&
      reserva.contactId === contactId &&
      reserva.chatbotId === chatbotId
    ) {
      abertas[LOJAS.meta].delete(chave);
      return true;
    }
    return false;
  });

  if (cancelou) {
    await registrarNoDiario({
      em: Date.now(),
      messageId,
      contactId,
      chatbotId,
      chatbotNome,
      resultado: "erro",
      motivo: "falha-no-envio",
      erro: erro || null,
    });
  }
  return cancelou;
}

async function executarChatbot({ contactId, chatbotId, preparacao = null, mensagemRecebidaId = null, agora: instante = Date.now() }) {
  const lojas = [LOJAS.contatos, LOJAS.negocios, LOJAS.tarefas, LOJAS.notas, LOJAS.eventos, LOJAS.chatbots, ...(mensagemRecebidaId ? [LOJAS.meta] : [])];
  return db.comLojas(lojas, "readwrite", async (abertas) => {
    const [bot, contato, negocios, tarefas, notas, eventos] = await Promise.all([
      db.pedir(abertas[LOJAS.chatbots].get(chatbotId)),
      db.pedir(abertas[LOJAS.contatos].get(contactId)),
      db.pedir(abertas[LOJAS.negocios].index("contactId").getAll(contactId)),
      db.pedir(abertas[LOJAS.tarefas].index("contactId").getAll(contactId)),
      db.pedir(abertas[LOJAS.notas].index("contactId").getAll(contactId)),
      db.pedir(abertas[LOJAS.eventos].index("contactId").getAll(contactId)),
    ]);
    if (!bot) {
      const erro = new Error("Chatbot não encontrado.");
      erro.codigo = "chatbot-nao-encontrado";
      throw erro;
    }
    if (!contato) throw new Error("Contato não encontrado.");
    if (mensagemRecebidaId) {
      const jaExecutado = eventos.some(
        (evento) => evento.carga?.mensagemRecebidaId === mensagemRecebidaId
      );
      const reserva = await db.pedir(
        abertas[LOJAS.meta].get(CHAVE_AUTO(mensagemRecebidaId))
      );
      if (
        jaExecutado ||
        !reserva ||
        reserva.contactId !== contactId ||
        reserva.chatbotId !== chatbotId
      ) {
        const erro = new Error("Esta mensagem recebida ja foi processada.");
        erro.codigo = "chatbot-mensagem-processada";
        throw erro;
      }
    }
    if (bot.ativo === false) {
      const erro = new Error("Este chatbot está desativado.");
      erro.codigo = "chatbot-nao-se-aplica";
      throw erro;
    }
    const ficha = { contato, negocios, tarefas, notas, eventos };
    if (!regraAtende(bot, { ...ficha, agora: instante })) {
      const erro = new Error("As condições do chatbot não se aplicam mais.");
      erro.codigo = "chatbot-nao-se-aplica";
      throw erro;
    }
    if (preparacao && preparacao.contextoVersao !== assinaturaContexto(bot, ficha)) {
      const erro = new Error("A preparação do chatbot ficou obsoleta.");
      erro.codigo = "chatbot-preparacao-obsoleta";
      throw erro;
    }

    const plano = planoDosPassos(bot, contato);
    const proximoContato = plano.etiquetas.length
      ? { ...contato, tags: plano.tagsFinais, atualizadoEm: instante }
      : contato;
    const proximoBot = {
      ...bot,
      execucoes: (bot.execucoes || 0) + 1,
      ultimaExecucaoEm: instante,
      atualizadoEm: bot.atualizadoEm,
    };
    const evento = {
      id: uid(),
      contactId,
      tipo: "chatbot.executado",
      entidadeTipo: "chatbot",
      entidadeId: bot.id,
      origem: "app",
      carga: {
        chatbotId: bot.id,
        etiquetas: plano.etiquetas,
        ...(mensagemRecebidaId ? { mensagemRecebidaId } : {}),
      },
      ocorridoEm: instante,
      criadoEm: instante,
    };
    validarChatbot(proximoBot);
    validarEvento(evento);
    if (plano.etiquetas.length) validarContato(proximoContato);
    abertas[LOJAS.contatos].put(proximoContato);
    abertas[LOJAS.eventos].put(evento);
    abertas[LOJAS.chatbots].put(proximoBot);
    if (mensagemRecebidaId)
      abertas[LOJAS.meta].delete(CHAVE_AUTO(mensagemRecebidaId));
    return {
      chatbotId: bot.id,
      nome: bot.nome,
      mensagem: plano.mensagem,
      contato: proximoContato,
      etiquetas: plano.etiquetas,
      parouEm: plano.parouEm,
      transferencia: plano.transferencia,
      restantes: plano.restantes,
      execucoes: proximoBot.execucoes,
    };
  });
}

async function listarChatbots() {
  return ordenarChatbots(await db.todos(LOJAS.chatbots));
}

async function buscarChatbot({ id }) {
  return db.buscar(LOJAS.chatbots, id);
}

async function criarChatbotNovo(dados = {}) {
  const chatbot = criarChatbot(dados);
  validarChatbot(chatbot);
  await tagsDoChatbotValidas(chatbot);
  return db.gravar(LOJAS.chatbots, chatbot);
}

async function atualizarChatbot({ id, patch }) {
  const atual = await db.buscar(LOJAS.chatbots, id);
  if (!atual) throw new Error("Chatbot não encontrado.");
  const proximo = {
    ...atual,
    ...patch,
    id,
    criadoEm: atual.criadoEm,
    atualizadoEm: agora(),
  };
  validarChatbot(proximo);
  await tagsDoChatbotValidas(proximo);
  return db.gravar(LOJAS.chatbots, proximo);
}

async function duplicarChatbot({ id }) {
  const atual = await db.buscar(LOJAS.chatbots, id);
  if (!atual) throw new Error("Chatbot não encontrado.");
  const copia = criarChatbot({
    nome: `${atual.nome} (cópia)`,
    ativo: false,
    condicoes: atual.condicoes.map((condicao) => ({ ...condicao })),
    passos: atual.passos.map((passo) => criarPasso(passo.tipo, {
      ...passo,
      id: uid(),
      adicionar: passo.adicionar ? [...passo.adicionar] : undefined,
      remover: passo.remover ? [...passo.remover] : undefined,
    })),
  });
  validarChatbot(copia);
  await tagsDoChatbotValidas(copia);
  return db.gravar(LOJAS.chatbots, copia);
}

/* ------------------------------------------------------------------ */
/* Estágios e tags                                                     */
/* ------------------------------------------------------------------ */

/**
 * Remove um estágio, realocando os negócios que estavam nele.
 *
 * Apagar direto deixaria negócio apontando para um estágio inexistente — ele
 * sumiria do funil sem sumir da base, que é a pior forma de perder dado:
 * silenciosa. Por isso o destino é obrigatório quando há negócio envolvido, e
 * o erro carrega a contagem para a interface poder perguntar.
 */
async function removerEstagio({ id, moverPara = null }) {
  return db.comLojas([LOJAS.estagios, LOJAS.negocios], "readwrite", async (lojas) => {
    const removido = await db.pedir(lojas[LOJAS.estagios].get(id));
    if (!removido) throw new Error("Estágio não encontrado.");

    const negocios = await db.pedir(
      lojas[LOJAS.negocios].index("stageId").getAll(id)
    );

    if (negocios.length) {
      if (!moverPara) {
        const erro = new Error(
          `Este estágio tem ${negocios.length} negócio(s). Escolha para onde movê-los.`
        );
        erro.codigo = "estagio-com-negocios";
        erro.quantidade = negocios.length;
        throw erro;
      }
      if (moverPara === id) throw new Error("Escolha outro estágio de destino.");
      const destino = await db.pedir(lojas[LOJAS.estagios].get(moverPara));
      if (!destino) throw new Error("Estágio de destino não existe.");
      negocios.forEach((n) =>
        lojas[LOJAS.negocios].put({ ...n, stageId: moverPara, atualizadoEm: agora() })
      );
    }

    lojas[LOJAS.estagios].delete(id);

    // Renumera na mesma transação para não deixar buraco em caso de falha.
    const restantes = (await db.pedir(lojas[LOJAS.estagios].getAll()))
      .filter((e) => e.id !== id)
      .sort((a, b) => a.ordem - b.ordem);
    restantes.forEach((e, i) =>
      lojas[LOJAS.estagios].put({ ...e, ordem: i })
    );

    return { id, movidos: negocios.length };
  });
}

/**
 * Remove uma tag e a tira de todos os contatos.
 *
 * Sem a limpeza, o contato ficaria com um id de tag órfão no array: invisível
 * na interface, mas presente no dado — e voltaria a aparecer no dia em que
 * alguém criasse outra tag com o mesmo slug.
 */
async function removerTag({ id }) {
  return db.comLojas([LOJAS.tags, LOJAS.contatos, LOJAS.chatbots], "readwrite", async (lojas) => {
    const tag = await db.pedir(lojas[LOJAS.tags].get(id));
    if (!tag) throw new Error("Tag não encontrada.");

    const chatbots = await db.pedir(lojas[LOJAS.chatbots].getAll());
    const usadosPor = chatbots.filter((chatbot) => referenciasDeTagsDoChatbot(chatbot).has(id));
    if (usadosPor.length) {
      const erro = new Error(`A etiqueta está sendo usada por ${usadosPor.length} chatbot(s).`);
      erro.codigo = "tag-em-uso-chatbot";
      erro.chatbotIds = usadosPor.map((chatbot) => chatbot.id);
      throw erro;
    }

    const contatos = await db.pedir(lojas[LOJAS.contatos].getAll());
    const afetados = contatos.filter((c) => (c.tags || []).includes(id));
    afetados.forEach((c) =>
      lojas[LOJAS.contatos].put({
        ...c,
        tags: c.tags.filter((t) => t !== id),
        atualizadoEm: agora(),
      })
    );
    lojas[LOJAS.tags].delete(id);
    return { id, contatosAfetados: afetados.length };
  });
}

/* ------------------------------------------------------------------ */
/* Configuração e dados                                                */
/* ------------------------------------------------------------------ */

async function exportarTudo() {
  const [contatos, negocios, tarefas, notas, estagios, tags, eventos, chatbots] =
    await Promise.all([
      db.todos(LOJAS.contatos),
      db.todos(LOJAS.negocios),
      db.todos(LOJAS.tarefas),
      db.todos(LOJAS.notas),
      db.todos(LOJAS.estagios),
      db.todos(LOJAS.tags),
      db.todos(LOJAS.eventos),
      db.todos(LOJAS.chatbots),
    ]);
  return {
    versao: VERSAO_PACOTE,
    exportadoEm: agora(),
    contatos,
    negocios,
    tarefas,
    notas,
    estagios,
    tags,
    eventos,
    chatbots,
  };
}

async function importarTudo({ pacote }) {
  validarPacote(pacote);

  const mapa = {
    contatos: LOJAS.contatos,
    negocios: LOJAS.negocios,
    tarefas: LOJAS.tarefas,
    notas: LOJAS.notas,
    estagios: LOJAS.estagios,
    tags: LOJAS.tags,
    eventos: LOJAS.eventos,
    chatbots: LOJAS.chatbots,
  };
  const contagem = {};
  return db.comLojas(Object.values(mapa), "readwrite", async (lojas) => {
    for (const [chave, loja] of Object.entries(mapa)) {
      const registros = pacote[chave];
      registros.forEach((registro) => lojas[loja].put(registro));
      contagem[chave] = registros.length;
    }
    return contagem;
  });
}

/** Popula a base com dados fictícios, para desenvolvimento. Nunca automático. */
async function semear() {
  const { contatos, negocios, tarefas, notas } = gerarSeed();
  const [estagios, tags] = await Promise.all([
    db.todos(LOJAS.estagios),
    db.todos(LOJAS.tags),
  ]);
  await importarTudo({
    pacote: {
      versao: VERSAO_PACOTE,
      exportadoEm: agora(),
      contatos,
      negocios,
      tarefas,
      notas,
      estagios,
      tags,
    },
  });
  return {
    contatos: contatos.length,
    negocios: negocios.length,
    tarefas: tarefas.length,
    notas: notas.length,
  };
}

async function apagarTudo() {
  await Promise.all(
    [
      LOJAS.contatos,
      LOJAS.negocios,
      LOJAS.tarefas,
      LOJAS.notas,
      LOJAS.eventos,
    ].map((l) => db.limpar(l))
  );
  return { ok: true };
}

async function salvarEstagios({ estagios = [] }) {
  estagios.forEach((estagio, i) => validarEstagio(estagio, `estagios[${i}]`));
  return db.gravarVarios(LOJAS.estagios, estagios);
}

async function salvarTags({ tags = [] }) {
  tags.forEach((tag, i) => validarTag(tag, `tags[${i}]`));
  return db.gravarVarios(LOJAS.tags, tags);
}

/* ------------------------------------------------------------------ */
/* A interface                                                         */
/* ------------------------------------------------------------------ */

export const operacoes = {
  "contatos.listar": () => db.todos(LOJAS.contatos),
  "contatos.buscar": ({ id }) => db.buscar(LOJAS.contatos, id),
  "contatos.resolver": resolverContato,
  "contatos.criar": criarContatoNovo,
  "contatos.atualizar": atualizarContato,
  "contatos.remover": removerContato,
  "contatos.importar": importarContatos,
  "contatos.importarDoWhatsApp": importarDoWhatsApp,
  "contatos.ficha": fichaDoContato,

  "negocios.listar": () => db.todos(LOJAS.negocios),
  "negocios.porContato": ({ contactId }) =>
    db.porIndice(LOJAS.negocios, "contactId", contactId),
  "negocios.criar": criarNegocioNovo,
  "negocios.atualizar": atualizarNegocio,
  "negocios.remover": ({ id }) => db.apagar(LOJAS.negocios, id),

  "tarefas.listar": () => db.todos(LOJAS.tarefas),
  "tarefas.porContato": ({ contactId }) =>
    db.porIndice(LOJAS.tarefas, "contactId", contactId),
  "tarefas.criar": criarTarefaNova,
  "tarefas.atualizar": atualizarTarefa,
  "tarefas.concluir": concluirTarefa,
  "tarefas.remover": ({ id }) => db.apagar(LOJAS.tarefas, id),

  "notas.listar": () => db.todos(LOJAS.notas),
  "notas.porContato": ({ contactId }) =>
    db.porIndice(LOJAS.notas, "contactId", contactId),
  "notas.criar": criarNotaNova,
  "notas.remover": ({ id }) => db.apagar(LOJAS.notas, id),

  "eventos.listar": () => db.todos(LOJAS.eventos),
  "eventos.porContato": ({ contactId }) => db.porIndice(LOJAS.eventos, "contactId", contactId),
  "eventos.registrar": registrarEvento,

  "chatbots.listar": listarChatbots,
  "chatbots.buscar": buscarChatbot,
  "chatbots.criar": criarChatbotNovo,
  "chatbots.atualizar": atualizarChatbot,
  "chatbots.remover": ({ id }) => db.apagar(LOJAS.chatbots, id),
  "chatbots.duplicar": duplicarChatbot,
  "chatbots.avaliar": avaliarChatbots,
  "chatbots.preparar": prepararExecucao,
  "chatbots.prepararAutomatico": prepararAutomatico,
  "chatbots.marcarAutomaticoEnviado": marcarAutomaticoEnviado,
  "chatbots.cancelarAutomatico": cancelarAutomatico,
  "chatbots.executar": executarChatbot,

  "automacao.estado": estadoAutomacao,
  "automacao.pausar": pausarAutomacao,
  "automacao.diario": lerDiario,
  "automacao.registrar": registrarAutomacao,

  "estagios.listar": () => db.todos(LOJAS.estagios),
  "estagios.salvar": salvarEstagios,
  "estagios.remover": removerEstagio,

  "tags.listar": () => db.todos(LOJAS.tags),
  "tags.salvar": salvarTags,
  "tags.remover": removerTag,

  // Preferências de interface (painel recolhido, aba ativa). Ficam no mesmo
  // lugar que o resto: o content script não guarda estado próprio, senão a
  // preferência viveria sob a origem do web.whatsapp.com.
  "config.ler": async ({ chave }) =>
    (await db.buscar(LOJAS.meta, chave))?.valor ?? null,
  "config.gravar": ({ chave, valor }) =>
    db.gravar(LOJAS.meta, { chave, valor }),

  "dados.exportar": exportarTudo,
  "dados.importar": importarTudo,
  "dados.apagar": apagarTudo,
  "dados.semear": semear,

  // Conversas ainda não têm de onde vir: o histórico é de demonstração e mora
  // em `conversasMock.js`, que sai inteiro no dia em que existir a rota de
  // mensagens. Os contatos, esses, são os de verdade.
  ...criarOperacoesConversas({ listarContatos: () => db.todos(LOJAS.contatos) }),
};
