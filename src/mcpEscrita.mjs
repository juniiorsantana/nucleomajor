/**
 * As escritas do MCP: lead e contato, Funil, tarefa, nota e agenda.
 *
 * O dono decidiu em 29/10/2026: ordem direta ("move a Maria para Proposta")
 * grava na hora, sem pedir confirmação. O que protege contra o engano é
 * outra coisa:
 *
 * - **Nunca chuta.** Duas Marias, duas etapas parecidas, dois negócios
 *   abertos: volta a lista e o modelo pergunta (`escolherPessoa`).
 * - **Nada apaga.** Não há ferramenta de apagar; cancelar compromisso só
 *   muda o status, e concluir tarefa só marca a caixinha.
 * - **Repetir não duplica.** O cliente refaz a chamada quando a rede cai;
 *   criar a mesma tarefa, nota ou compromisso de novo devolve a que já está
 *   lá, e o contato com o mesmo número não nasce duas vezes.
 *
 * As gravações são as mesmas do portal (`web/dataProvider.js` e
 * `web/agendaProvider.js`), com o token da pessoa: a RLS decide o que ela
 * pode mudar. Cada uma deixa um evento na linha do tempo do contato com
 * `source = 'mcp'`, para dar para saber depois o que veio do Claude.
 */

import { normalizePhone, variantesBR } from "../apps/emyleads/src/lib/phone.js";
import {
  ToolError,
  buscarPessoas,
  cortar,
  dataCurta,
  diaDaSemana,
  diaEmSaoPaulo,
  escolherPessoa,
  hora,
  nomeDoContato,
  semAcento,
  telefoneMascarado,
  termoDeBusca,
} from "./mcpTools.mjs";

const MINUTO_MS = 60 * 1000;
const DIA_MS = 24 * 60 * MINUTO_MS;
// Quanto tempo uma repetição conta como "a mesma chamada de novo".
const JANELA_DE_REPETICAO_MS = 10 * MINUTO_MS;

const org = (id) => `organization_id=eq.${encodeURIComponent(id)}`;
const eq = (valor) => `eq.${encodeURIComponent(valor)}`;
const iso = (data) => encodeURIComponent(data.toISOString());
const lista = (valores) => `(${valores.map((v) => encodeURIComponent(v)).join(",")})`;
const texto = (valor) => String(valor ?? "").trim();
const vazio = (valor) => valor === undefined || valor === null || texto(valor) === "";

/* ───────────────────────── datas ───────────────────────── */

const INSTANTE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2}))?$/;

/**
 * "2026-10-30", "2026-10-30 14:00" ou "2026-10-30T14:00", sempre no horário
 * de Brasília (-03:00, sem horário de verão desde 2019). Só o dia volta com
 * `soDia`, para quem chama decidir (tarefa às 9h, compromisso de dia todo).
 */
export function instanteEmBrasilia(valor, rotulo) {
  const cru = texto(valor);
  const partes = cru.match(INSTANTE);
  if (!partes) throw new ToolError(`Informe ${rotulo} como AAAA-MM-DD ou AAAA-MM-DD HH:MM (Brasília), por exemplo 2026-10-30 14:00.`);
  const [, dia, h, m] = partes;
  const soDia = h === undefined;
  const data = new Date(`${dia}T${soDia ? "00" : h.padStart(2, "0")}:${soDia ? "00" : m}:00-03:00`);
  if (Number.isNaN(data.getTime()) || diaEmSaoPaulo(data) !== dia) throw new ToolError(`${rotulo[0].toUpperCase()}${rotulo.slice(1)} não é uma data válida: ${cru}.`);
  return { data, dia, soDia };
}

function quandoEmTexto(data) {
  return `${diaDaSemana(data)} ${hora(data)}`;
}

/* ───────────────────────── registro e erros ───────────────────────── */

/** O evento na linha do tempo do contato. Falhar aqui não desfaz a gravação. */
async function registrarEvento({ db, user, empresa, agora }, { contactId, tipo, entidadeTipo, entidadeId, carga = {} }) {
  if (!contactId) return;
  try {
    await db.insert("contact_events", {
      organization_id: empresa.id,
      contact_id: contactId,
      event_type: tipo,
      entity_type: entidadeTipo || null,
      entity_id: entidadeId || null,
      source: "mcp",
      payload: carga,
      occurred_at: agora.toISOString(),
      created_by: user.id,
    });
  } catch {
    // A tarefa, a nota ou o negócio já estão gravados; o evento é só o rastro.
  }
}

/** O banco recusou: com permissão negada, diz isso; o resto segue como veio. */
function recusa(erro, acao) {
  if (erro instanceof ToolError || erro?.status === 401) return erro;
  if (erro?.upstream === 403 || /row-level security|permission denied/i.test(erro?.mensagemDoBanco || "")) {
    return new ToolError(`Sua conta não tem permissão para ${acao} nesta empresa.`);
  }
  return erro;
}

async function gravando(acao, fn) {
  try {
    return await fn();
  } catch (erro) {
    throw recusa(erro, acao);
  }
}

/* ───────────────────────── quem ───────────────────────── */

function rotuloDoContato(contato) {
  return `${nomeDoContato(contato.name, contato.phone)} (${telefoneMascarado(contato.phone)})`;
}

/**
 * O contato do CRM para quem foi pedido. Quem só existe no WhatsApp vira
 * contato aqui, como no "Marcar como lead" da conversa: sem isso, "anota
 * na ficha do fulano" não teria ficha onde anotar.
 */
async function contatoDoCandidato(contexto, candidato, { comoLead = false } = {}) {
  if (candidato.contato) return { contato: candidato.contato, criado: false };
  const { db, user, empresa, agora } = contexto;
  const conversa = candidato.conversa;
  const linha = await gravando("criar contatos", () => db.insert("contacts", {
    organization_id: empresa.id,
    name: texto(conversa.contact_name),
    phone: normalizePhone(conversa.contact_phone) || String(conversa.contact_phone || "").replace(/\D/g, ""),
    source: "WhatsApp",
    created_by: user.id,
    updated_by: user.id,
    ...(comoLead ? { lead_at: agora.toISOString() } : {}),
  }));
  await registrarEvento(contexto, { contactId: linha.id, tipo: "contact.created", entidadeTipo: "contato", entidadeId: linha.id });
  return { contato: linha, criado: true };
}

async function acharPessoa({ db, empresa }, busca) {
  if (vazio(busca)) throw new ToolError("Diga de quem: o nome (ou parte), o número ou os últimos dígitos.");
  return escolherPessoa(await buscarPessoas(db, empresa, busca), busca);
}

/** Quem da equipe vai cuidar: "eu" (ou nada) é quem pediu; nome escolhe na lista. */
async function pessoaDaEquipe({ db, user, empresa }, pedido) {
  const alvo = semAcento(pedido);
  if (!alvo || ["eu", "mim", "voce", "comigo"].includes(alvo)) return { id: user.id, nome: "você" };
  const vinculos = await db.select(`/rest/v1/organization_members?select=user_id&${org(empresa.id)}&status=eq.active`);
  const ids = [...new Set((vinculos || []).map((v) => v.user_id).filter(Boolean))];
  const perfis = ids.length ? await db.select(`/rest/v1/profiles?select=id,full_name&id=in.${lista(ids)}`) : [];
  const equipe = (perfis || []).filter((p) => p.full_name);
  // Nome inteiro, depois uma palavra inteira ("Ana" é a Ana Paula, não o
  // Santana), e só então o pedaço.
  const exatos = equipe.filter((p) => semAcento(p.full_name) === alvo);
  const porPalavra = equipe.filter((p) => semAcento(p.full_name).split(/\s+/).includes(alvo));
  const achados = exatos.length ? exatos : porPalavra.length ? porPalavra : equipe.filter((p) => semAcento(p.full_name).includes(alvo));
  if (achados.length === 1) return { id: achados[0].id, nome: achados[0].id === user.id ? "você" : achados[0].full_name };
  if (achados.length > 1) throw new ToolError(`Mais de uma pessoa da equipe combina com "${pedido}": ${achados.map((p) => p.full_name).join("; ")}. Qual?`);
  throw new ToolError(`Ninguém da equipe se chama "${pedido}". A equipe: ${equipe.map((p) => p.full_name).join("; ") || "sem nomes cadastrados"}.`);
}

/* ───────────────────────── etapas do Funil ───────────────────────── */

async function etapasDoFunil({ db, empresa }) {
  const etapas = await db.select(`/rest/v1/stages?select=id,name,position&${org(empresa.id)}&deleted_at=is.null&order=position.asc`);
  return (etapas || []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export function escolherEtapa(etapas, pedido) {
  const alvo = semAcento(pedido);
  const nomes = etapas.map((e) => e.name).join(", ");
  const exatas = etapas.filter((e) => semAcento(e.name) === alvo);
  if (exatas.length === 1) return exatas[0];
  const parecidas = etapas.filter((e) => semAcento(e.name).includes(alvo) || alvo.includes(semAcento(e.name)));
  if (parecidas.length === 1) return parecidas[0];
  if (parecidas.length > 1) throw new ToolError(`Mais de uma etapa combina com "${pedido}": ${parecidas.map((e) => e.name).join(", ")}. Qual?`);
  throw new ToolError(`O Funil não tem a etapa "${pedido}". As etapas são: ${nomes}.`);
}

/* ───────────────────────── leads e contatos ───────────────────────── */

const CAMPOS_DO_CONTATO = { nome: "name", email: "email", empresa_do_contato: "company", cargo: "job_title", origem: "source" };

async function criarContato(contexto, entrada) {
  const { db, user, empresa, agora } = contexto;
  const nome = texto(entrada.nome);
  if (!nome) throw new ToolError("Diga o nome do contato.");
  const telefone = vazio(entrada.telefone) ? "" : normalizePhone(entrada.telefone);
  if (!vazio(entrada.telefone) && !telefone) throw new ToolError(`O número "${entrada.telefone}" não parece um WhatsApp válido. Mande com DDD, por exemplo (65) 99217-8164.`);
  const lead = entrada.lead !== false;

  if (telefone) {
    const formas = variantesBR(telefone);
    const existentes = await db.select(`/rest/v1/contacts?select=id,name,phone,lead_at&${org(empresa.id)}&deleted_at=is.null&phone=in.${lista(formas.length ? formas : [telefone])}&limit=1`);
    const existente = (existentes || [])[0];
    if (existente) {
      const tipo = existente.lead_at ? "lead" : "contato (não é lead)";
      return {
        text: `Já existe: ${rotuloDoContato(existente)}, ${tipo}. Não criei outro.${lead && !existente.lead_at ? " Para transformar em lead, use editar_contato com lead=true." : ""}`,
        data: { criado: false, contato: { id: existente.id, nome: existente.name, lead: Boolean(existente.lead_at) } },
      };
    }
  } else {
    const mesmoNome = await db.select(`/rest/v1/contacts?select=id,name,phone,created_at&${org(empresa.id)}&deleted_at=is.null&name=ilike.${encodeURIComponent(termoDeBusca(nome))}&limit=1`);
    const recente = (mesmoNome || []).find((c) => agora.getTime() - Date.parse(c.created_at || 0) < JANELA_DE_REPETICAO_MS);
    if (recente) return { text: `${rotuloDoContato(recente)} acabou de ser criado. Não criei outro.`, data: { criado: false, contato: { id: recente.id, nome: recente.name } } };
  }

  const linha = await gravando("criar contatos", () => db.insert("contacts", {
    organization_id: empresa.id,
    name: nome,
    phone: telefone || "",
    email: texto(entrada.email) || null,
    company: texto(entrada.empresa_do_contato),
    job_title: texto(entrada.cargo),
    source: texto(entrada.origem),
    created_by: user.id,
    updated_by: user.id,
    // O banco troca a data por `now()`; daqui só sai "é lead".
    ...(lead ? { lead_at: agora.toISOString() } : {}),
  }));
  await registrarEvento(contexto, { contactId: linha.id, tipo: "contact.created", entidadeTipo: "contato", entidadeId: linha.id });
  return {
    text: `Feito. ${rotuloDoContato(linha)} entrou ${lead ? "como lead" : "como contato (não é lead)"}.`,
    data: { criado: true, contato: { id: linha.id, nome: linha.name, lead } },
  };
}

async function editarContato(contexto, entrada) {
  const { db, user, empresa, agora } = contexto;
  const patch = {};
  const mudancas = [];
  for (const [campo, coluna] of Object.entries(CAMPOS_DO_CONTATO)) {
    if (entrada[campo] === undefined) continue;
    patch[coluna] = campo === "email" ? texto(entrada[campo]) || null : texto(entrada[campo]);
    mudancas.push(campo === "empresa_do_contato" ? "empresa" : campo);
  }
  if (patch.name === "") throw new ToolError("O nome não pode ficar vazio.");
  if (typeof entrada.lead === "boolean") {
    patch.lead_at = entrada.lead ? agora.toISOString() : null;
    mudancas.push(entrada.lead ? "virou lead" : "deixou de ser lead");
  }
  if (!mudancas.length) throw new ToolError("Diga o que mudar: nome, email, empresa_do_contato, cargo, origem ou lead.");

  const candidato = await acharPessoa(contexto, entrada.busca);
  const { contato, criado } = await contatoDoCandidato(contexto, candidato, { comoLead: entrada.lead === true });
  if (contato.lead_at && entrada.lead === true) {
    delete patch.lead_at;
    if (!criado) mudancas.splice(mudancas.indexOf("virou lead"), 1, "já era lead");
  }
  let linhas;
  try {
    linhas = await db.update(
      `/rest/v1/contacts?id=${eq(contato.id)}&${org(empresa.id)}&deleted_at=is.null`,
      { ...patch, updated_by: user.id },
    );
  } catch (erro) {
    if (erro?.hint === "lead_tem_negocio") throw new ToolError(`${rotuloDoContato(contato)} tem negócio no Funil e continua lead. Marque o negócio como perdido ou remova-o no portal antes.`);
    throw recusa(erro, "editar contatos");
  }
  const linha = (linhas || [])[0];
  if (!linha) throw new ToolError(`Não consegui mudar ${rotuloDoContato(contato)}: sua conta não tem permissão ou o contato foi removido.`);
  await registrarEvento(contexto, { contactId: contato.id, tipo: "contact.updated", entidadeTipo: "contato", entidadeId: contato.id, carga: { campos: Object.keys(patch) } });
  return {
    text: `Feito. ${rotuloDoContato(linha)}${criado ? " entrou no CRM" : ""}: ${mudancas.join(", ")}.`,
    data: { contato: { id: linha.id, nome: linha.name, lead: Boolean(linha.lead_at) }, mudou: mudancas, criadoAgora: criado },
  };
}

/* ───────────────────────── Funil ───────────────────────── */

function valorEmTexto(valor) {
  return valor === null || valor === undefined ? "" : `R$ ${Number(valor).toLocaleString("pt-BR")}`;
}

function valorPedido(valor) {
  if (valor === undefined || valor === null || valor === "") return undefined;
  const numero = typeof valor === "number" ? valor : Number(String(valor).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  if (!Number.isFinite(numero) || numero < 0) throw new ToolError(`Não entendi o valor "${valor}". Mande só o número, por exemplo 1500.`);
  return numero;
}

async function criarNegocio(contexto, entrada) {
  const { db, user, empresa } = contexto;
  const valor = valorPedido(entrada.valor);
  const etapas = await etapasDoFunil(contexto);
  if (!etapas.length) throw new ToolError("O Funil desta empresa não tem etapas.");
  const etapa = vazio(entrada.etapa) ? etapas[0] : escolherEtapa(etapas, entrada.etapa);

  const candidato = await acharPessoa(contexto, entrada.busca);
  const { contato, criado } = await contatoDoCandidato(contexto, candidato, { comoLead: true });
  if (entrada.outro_negocio !== true) {
    const abertos = await db.select(`/rest/v1/deals?select=id,title,stage_id&contact_id=${eq(contato.id)}&${org(empresa.id)}&deleted_at=is.null&status=eq.aberto`);
    if ((abertos || []).length) {
      const nomeDaEtapa = new Map(etapas.map((e) => [e.id, e.name]));
      const qual = abertos.map((n) => `${n.title ? `"${n.title}" ` : ""}em ${nomeDaEtapa.get(n.stage_id) || "etapa removida"}`).join("; ");
      throw new ToolError(`${rotuloDoContato(contato)} já tem negócio aberto: ${qual}. Para mudar de etapa, use mover_negocio; para abrir outro mesmo assim, outro_negocio=true.`);
    }
  }
  // O banco promove o contato a lead quando nasce o negócio (20260926170000).
  const linha = await gravando("criar negócios", () => db.insert("deals", {
    organization_id: empresa.id,
    contact_id: contato.id,
    stage_id: etapa.id,
    title: texto(entrada.titulo),
    value: valor ?? null,
    source: "",
    status: "aberto",
    loss_reason: "",
    created_by: user.id,
    updated_by: user.id,
  }));
  await registrarEvento(contexto, { contactId: contato.id, tipo: "deal.created", entidadeTipo: "negocio", entidadeId: linha.id, carga: { titulo: linha.title } });
  const extras = [linha.title && `"${linha.title}"`, valorEmTexto(linha.value)].filter(Boolean).join(", ");
  return {
    text: `Feito. Negócio de ${rotuloDoContato(contato)}${extras ? ` (${extras})` : ""} criado em ${etapa.name}.${criado ? " A pessoa entrou no CRM como lead." : ""}`,
    data: { negocio: { id: linha.id, etapa: etapa.name, titulo: linha.title || null, valor: linha.value ?? null }, contato: { id: contato.id, nome: contato.name } },
  };
}

const SITUACOES = ["aberto", "ganho", "perdido"];

async function moverNegocio(contexto, entrada) {
  const { db, user, empresa } = contexto;
  const situacao = vazio(entrada.situacao) ? null : String(entrada.situacao);
  if (situacao && !SITUACOES.includes(situacao)) throw new ToolError(`Situação desconhecida: ${situacao}. Use aberto, ganho ou perdido.`);
  const valor = valorPedido(entrada.valor);
  if (vazio(entrada.etapa) && !situacao && valor === undefined && vazio(entrada.motivo_da_perda)) {
    throw new ToolError("Diga o que mudar no negócio: etapa, situacao (ganho, perdido, aberto), motivo_da_perda ou valor.");
  }
  const etapas = await etapasDoFunil(contexto);
  const etapa = vazio(entrada.etapa) ? null : escolherEtapa(etapas, entrada.etapa);

  const candidato = await acharPessoa(contexto, entrada.busca);
  const nome = nomeDoContato(candidato.contato?.name || candidato.conversa?.contact_name, candidato.contato?.phone || candidato.conversa?.contact_phone);
  if (!candidato.contato) throw new ToolError(`${nome} ainda não está no CRM, então não tem negócio. Para abrir um, use criar_negocio.`);
  const contato = candidato.contato;
  const negocios = await db.select(`/rest/v1/deals?select=id,title,stage_id,status,value,loss_reason&contact_id=${eq(contato.id)}&${org(empresa.id)}&deleted_at=is.null&order=updated_at.desc`);
  const nomeDaEtapa = new Map(etapas.map((e) => [e.id, e.name]));
  const rotulo = (n) => `${n.title ? `"${n.title}" ` : ""}em ${nomeDaEtapa.get(n.stage_id) || "etapa removida"} (${n.status})`;

  let escolhidos = negocios || [];
  if (!vazio(entrada.negocio)) {
    const alvo = semAcento(entrada.negocio);
    escolhidos = escolhidos.filter((n) => semAcento(n.title).includes(alvo));
  } else if (escolhidos.filter((n) => n.status === "aberto").length) {
    escolhidos = escolhidos.filter((n) => n.status === "aberto");
  }
  if (!escolhidos.length) {
    throw new ToolError(negocios?.length
      ? `Nenhum negócio de ${rotuloDoContato(contato)} combina com "${entrada.negocio}". Os negócios: ${negocios.map(rotulo).join("; ")}.`
      : `${rotuloDoContato(contato)} não tem negócio no Funil. Para abrir um, use criar_negocio.`);
  }
  if (escolhidos.length > 1) throw new ToolError(`${rotuloDoContato(contato)} tem ${escolhidos.length} negócios: ${escolhidos.map(rotulo).join("; ")}. Qual? Diga pelo título em negocio.`);
  const negocio = escolhidos[0];

  const patch = { updated_by: user.id };
  const mudancas = [];
  if (etapa && etapa.id !== negocio.stage_id) {
    patch.stage_id = etapa.id;
    mudancas.push(`${nomeDaEtapa.get(negocio.stage_id) || "etapa removida"} → ${etapa.name}`);
  }
  if (situacao && situacao !== negocio.status) {
    patch.status = situacao;
    mudancas.push(situacao === "ganho" ? "marcado como ganho" : situacao === "perdido" ? "marcado como perdido" : "reaberto");
  }
  if (!vazio(entrada.motivo_da_perda)) {
    if ((patch.status || negocio.status) !== "perdido") throw new ToolError("Motivo da perda só vale para negócio perdido. Mande situacao=perdido junto.");
    patch.loss_reason = texto(entrada.motivo_da_perda);
    mudancas.push(`motivo: ${patch.loss_reason}`);
  }
  if (valor !== undefined && valor !== Number(negocio.value)) {
    patch.value = valor;
    mudancas.push(`valor ${valorEmTexto(valor)}`);
  }
  if (!mudancas.length) return { text: `Nada a mudar: o negócio de ${rotuloDoContato(contato)} já está ${rotulo(negocio)}.`, data: { negocio: { id: negocio.id }, mudou: [] } };

  const linhas = await gravando("mexer no Funil", () => db.update(`/rest/v1/deals?id=${eq(negocio.id)}&${org(empresa.id)}`, patch));
  if (!(linhas || []).length) throw new ToolError(`Não consegui mudar o negócio de ${rotuloDoContato(contato)}: sua conta não tem permissão.`);
  await registrarEvento(contexto, { contactId: contato.id, tipo: "deal.updated", entidadeTipo: "negocio", entidadeId: negocio.id, carga: { campos: Object.keys(patch).filter((c) => c !== "updated_by") } });
  return {
    text: `Feito. Negócio de ${rotuloDoContato(contato)}: ${mudancas.join("; ")}.`,
    data: { negocio: { id: negocio.id, etapa: etapa?.name || nomeDaEtapa.get(negocio.stage_id) || null, situacao: patch.status || negocio.status }, mudou: mudancas },
  };
}

/* ───────────────────────── tarefas e notas ───────────────────────── */

async function contatoOpcional(contexto, busca) {
  if (vazio(busca)) return null;
  const { contato } = await contatoDoCandidato(contexto, await acharPessoa(contexto, busca));
  return contato;
}

async function criarTarefa(contexto, entrada) {
  const { db, user, empresa, agora } = contexto;
  const titulo = texto(entrada.titulo);
  if (!titulo) throw new ToolError("Diga o título da tarefa.");
  let prazo = null;
  if (!vazio(entrada.prazo)) {
    const pedido = instanteEmBrasilia(entrada.prazo, "o prazo");
    // Só o dia: às 9h, como as sugestões da análise (`prazoDaSugestao`).
    prazo = pedido.soDia ? new Date(`${pedido.dia}T09:00:00-03:00`) : pedido.data;
  }
  const responsavel = await pessoaDaEquipe(contexto, entrada.responsavel);
  const contato = await contatoOpcional(contexto, entrada.busca);

  const desde = new Date(agora.getTime() - JANELA_DE_REPETICAO_MS);
  const repetidas = await db.select(`/rest/v1/tasks?select=id,title,due_at,contact_id&${org(empresa.id)}&deleted_at=is.null&created_by=${eq(user.id)}&created_at=gte.${iso(desde)}&title=${eq(titulo)}`);
  const repetida = (repetidas || []).find((t) => (t.contact_id || null) === (contato?.id || null));
  if (repetida) return { text: `A tarefa "${titulo}" já estava criada agora há pouco. Não criei outra.`, data: { criada: false, tarefa: { id: repetida.id } } };

  const linha = await gravando("criar tarefas", () => db.insert("tasks", {
    organization_id: empresa.id,
    contact_id: contato?.id || null,
    deal_id: null,
    title: titulo,
    due_at: prazo ? prazo.toISOString() : null,
    completed: false,
    completed_at: null,
    owner_label: "",
    owner_id: responsavel.id,
    created_by: user.id,
    updated_by: user.id,
  }));
  try {
    await db.insert("task_assignees", { task_id: linha.id, organization_id: empresa.id, user_id: responsavel.id, created_by: user.id });
  } catch {
    // Sem a linha de responsável, `owner_id` continua dizendo de quem é (`tarefasUtils.js`).
  }
  await registrarEvento(contexto, { contactId: linha.contact_id, tipo: "task.created", entidadeTipo: "tarefa", entidadeId: linha.id, carga: { titulo } });
  const partes = [prazo ? `para ${quandoEmTexto(prazo)}` : "sem prazo", `de ${responsavel.nome}`, contato && `ligada a ${rotuloDoContato(contato)}`].filter(Boolean);
  return {
    text: `Feito. Tarefa "${titulo}" ${partes.join(", ")}.`,
    data: { criada: true, tarefa: { id: linha.id, titulo, prazo: linha.due_at, responsavel: responsavel.nome, contato: contato ? contato.name : null } },
  };
}

async function concluirTarefa(contexto, entrada) {
  const { db, user, empresa, agora } = contexto;
  const termo = termoDeBusca(entrada.tarefa);
  if (termo.length < 2) throw new ToolError("Diga qual tarefa (o título ou parte dele).");
  const contato = vazio(entrada.busca) ? null : (await acharPessoa(contexto, entrada.busca)).contato;
  if (!vazio(entrada.busca) && !contato) throw new ToolError("Essa pessoa não está no CRM, então não tem tarefa ligada a ela.");
  const pendentes = await db.select(`/rest/v1/tasks?select=id,title,due_at,contact_id&${org(empresa.id)}&deleted_at=is.null&completed=eq.false&title=ilike.${encodeURIComponent(`*${termo}*`)}${contato ? `&contact_id=${eq(contato.id)}` : ""}&order=due_at.asc.nullslast&limit=10`);
  const achadas = pendentes || [];
  const exatas = achadas.filter((t) => semAcento(t.title) === semAcento(entrada.tarefa));
  const escolhidas = exatas.length === 1 ? exatas : achadas;
  if (!escolhidas.length) throw new ToolError(`Não achei tarefa pendente com "${entrada.tarefa}". Pergunte com tarefas para ver a lista.`);
  if (escolhidas.length > 1) {
    const rotulos = escolhidas.map((t) => `"${t.title}"${t.due_at ? ` (${dataCurta(t.due_at)} ${hora(t.due_at)})` : ""}`);
    throw new ToolError(`Achei ${escolhidas.length} tarefas pendentes com "${entrada.tarefa}": ${rotulos.join("; ")}. Qual?`);
  }
  const tarefa = escolhidas[0];
  const linhas = await gravando("concluir tarefas", () => db.update(
    `/rest/v1/tasks?id=${eq(tarefa.id)}&${org(empresa.id)}`,
    { completed: true, completed_at: agora.toISOString(), updated_by: user.id },
  ));
  if (!(linhas || []).length) throw new ToolError(`Não consegui concluir "${tarefa.title}": sua conta não tem permissão.`);
  await registrarEvento(contexto, { contactId: tarefa.contact_id, tipo: "task.updated", entidadeTipo: "tarefa", entidadeId: tarefa.id, carga: { campos: ["concluida"] } });
  return { text: `Feito. Tarefa "${tarefa.title}" concluída.`, data: { tarefa: { id: tarefa.id, titulo: tarefa.title, concluida: true } } };
}

async function anotar(contexto, entrada) {
  const { db, user, empresa, agora } = contexto;
  const corpo = texto(entrada.texto);
  if (!corpo) throw new ToolError("Diga o que anotar.");
  if (corpo.length > 5000) throw new ToolError("A nota passou de 5.000 caracteres. Resuma.");
  const { contato } = await contatoDoCandidato(contexto, await acharPessoa(contexto, entrada.busca));

  const desde = new Date(agora.getTime() - JANELA_DE_REPETICAO_MS);
  const recentes = await db.select(`/rest/v1/notes?select=id,body&contact_id=${eq(contato.id)}&${org(empresa.id)}&deleted_at=is.null&created_by=${eq(user.id)}&created_at=gte.${iso(desde)}`);
  if ((recentes || []).some((n) => texto(n.body) === corpo)) {
    return { text: `Essa nota já estava na ficha de ${rotuloDoContato(contato)}. Não anotei de novo.`, data: { criada: false } };
  }
  let autor = "";
  try {
    const perfis = await db.select(`/rest/v1/profiles?select=full_name&id=${eq(user.id)}`);
    autor = texto(perfis?.[0]?.full_name);
  } catch {
    // Sem o nome, a nota fica com `created_by`; o rótulo é só para a tela.
  }
  const linha = await gravando("anotar", () => db.insert("notes", {
    organization_id: empresa.id,
    contact_id: contato.id,
    body: corpo,
    author_label: autor,
    created_by: user.id,
    updated_by: user.id,
  }));
  await registrarEvento(contexto, { contactId: contato.id, tipo: "note.created", entidadeTipo: "nota", entidadeId: linha.id });
  return { text: `Feito. Nota na ficha de ${rotuloDoContato(contato)}: "${cortar(corpo, 120)}".`, data: { criada: true, nota: { id: linha.id }, contato: { id: contato.id, nome: contato.name } } };
}

/* ───────────────────────── agenda ───────────────────────── */

function horarioDoEvento(evento) {
  if (evento.all_day) return `${diaDaSemana(evento.starts_at)}, dia todo`;
  return `${diaDaSemana(evento.starts_at)}, ${hora(evento.starts_at)}–${hora(evento.ends_at)}`;
}

async function marcarCompromisso(contexto, entrada) {
  const { db, user, empresa } = contexto;
  const titulo = texto(entrada.titulo);
  if (!titulo) throw new ToolError("Diga o título do compromisso.");
  if (titulo.length > 240) throw new ToolError("O título passou de 240 caracteres.");
  const inicio = instanteEmBrasilia(entrada.inicio, "o início");
  const diaTodo = entrada.dia_todo === true || inicio.soDia;
  let comeca = inicio.data;
  let termina;
  if (diaTodo) {
    comeca = new Date(`${inicio.dia}T00:00:00-03:00`);
    termina = new Date(comeca.getTime() + DIA_MS);
  } else if (!vazio(entrada.fim)) {
    const fim = instanteEmBrasilia(entrada.fim, "o fim");
    termina = fim.soDia ? new Date(`${fim.dia}T23:59:00-03:00`) : fim.data;
  } else {
    const minutos = Math.min(Math.max(Number(entrada.duracao_minutos) || 60, 5), 24 * 60);
    termina = new Date(comeca.getTime() + minutos * MINUTO_MS);
  }
  if (termina <= comeca) throw new ToolError("O fim precisa ser depois do início.");

  const contato = await contatoOpcional(contexto, entrada.busca);
  const repetidos = await db.select(`/rest/v1/calendar_events?select=id,title,starts_at,ends_at,all_day,status&${org(empresa.id)}&owner_id=${eq(user.id)}&starts_at=eq.${iso(comeca)}&title=${eq(titulo)}`);
  const repetido = (repetidos || []).find((e) => e.status !== "cancelled");
  if (repetido) return { text: `"${titulo}" já está na agenda em ${horarioDoEvento(repetido)}. Não marquei de novo.`, data: { criado: false, compromisso: { id: repetido.id } } };

  const categorias = await db.select(`/rest/v1/calendar_categories?select=id&${org(empresa.id)}&active=eq.true&order=position.asc&limit=1`);
  const categoria = (categorias || [])[0]?.id;
  if (!categoria) throw new ToolError("A agenda desta empresa não tem nenhuma categoria ativa. Crie uma na tela Agenda.");
  const paraAEmpresa = entrada.para_a_empresa === true;
  const linha = await gravando("marcar compromissos", () => db.insert("calendar_events", {
    organization_id: empresa.id,
    owner_id: user.id,
    created_by: user.id,
    updated_by: user.id,
    title: titulo,
    description: texto(entrada.descricao),
    starts_at: comeca.toISOString(),
    ends_at: termina.toISOString(),
    all_day: diaTodo,
    kind: "appointment",
    visibility: paraAEmpresa ? "organization" : "personal",
    contact_id: contato?.id || null,
    category_id: categoria,
    location: texto(entrada.local).slice(0, 500),
    tags: [],
    status: "scheduled",
    reminder_minutes: diaTodo ? [] : [30],
  }));
  await registrarEvento(contexto, { contactId: contato?.id, tipo: "calendar.created", entidadeTipo: "compromisso", entidadeId: linha.id, carga: { titulo } });
  const extras = [contato && `com ${rotuloDoContato(contato)}`, linha.location && `em ${linha.location}`, paraAEmpresa ? "visível para a equipe" : "só na sua agenda"].filter(Boolean);
  return {
    text: `Feito. "${titulo}" marcado para ${horarioDoEvento(linha)} (${extras.join(", ")}).`,
    data: { criado: true, compromisso: { id: linha.id, titulo, inicio: linha.starts_at, fim: linha.ends_at, diaTodo, paraAEmpresa } },
  };
}

/**
 * Remarca ou cancela um compromisso que a própria pessoa criou. A policy
 * deixaria a gestão mexer nos dos outros, mas pelo Claude fica só o que é
 * seu: é o que foi decidido, e mexer na agenda de um colega pelo celular,
 * sem ver a tela, é o engano mais caro daqui.
 */
async function remarcarCompromisso(contexto, entrada) {
  const { db, user, empresa, agora } = contexto;
  const termo = termoDeBusca(entrada.compromisso);
  if (termo.length < 2) throw new ToolError("Diga qual compromisso (o título ou parte dele).");
  const cancelar = entrada.cancelar === true;
  if (!cancelar && vazio(entrada.novo_inicio)) throw new ToolError("Diga o novo_inicio, ou cancelar=true.");

  let desde = new Date(agora.getTime() - DIA_MS);
  let ate = new Date(agora.getTime() + 90 * DIA_MS);
  if (!vazio(entrada.dia)) {
    const dia = instanteEmBrasilia(entrada.dia, "o dia");
    desde = new Date(`${dia.dia}T00:00:00-03:00`);
    ate = new Date(desde.getTime() + DIA_MS);
  }
  const achados = await db.select(`/rest/v1/calendar_events?select=id,title,starts_at,ends_at,all_day,status,contact_id&${org(empresa.id)}&created_by=${eq(user.id)}&starts_at=gte.${iso(desde)}&starts_at=lt.${iso(ate)}&title=ilike.${encodeURIComponent(`*${termo}*`)}&order=starts_at.asc&limit=10`);
  const ativos = (achados || []).filter((e) => e.status !== "cancelled");
  if (!ativos.length) throw new ToolError(`Não achei compromisso seu com "${entrada.compromisso}" ${vazio(entrada.dia) ? "de ontem em diante" : "nesse dia"}. Só dá para remarcar ou cancelar o que você mesmo marcou.`);
  if (ativos.length > 1) throw new ToolError(`Achei ${ativos.length} compromissos com "${entrada.compromisso}": ${ativos.map((e) => `"${e.title}" ${horarioDoEvento(e)}`).join("; ")}. Qual? Pode dizer o dia.`);
  const evento = ativos[0];

  let patch;
  let feito;
  if (cancelar) {
    patch = { status: "cancelled", updated_by: user.id };
    feito = `"${evento.title}" de ${horarioDoEvento(evento)} foi cancelado`;
  } else {
    const novo = instanteEmBrasilia(entrada.novo_inicio, "o novo início");
    const duracao = Date.parse(evento.ends_at) - Date.parse(evento.starts_at);
    const diaTodo = evento.all_day || novo.soDia;
    const comeca = diaTodo ? new Date(`${novo.dia}T00:00:00-03:00`) : novo.data;
    let termina = new Date(comeca.getTime() + (diaTodo ? DIA_MS : duracao));
    if (!vazio(entrada.novo_fim)) {
      const fim = instanteEmBrasilia(entrada.novo_fim, "o novo fim");
      termina = fim.data;
    }
    if (termina <= comeca) throw new ToolError("O fim precisa ser depois do início.");
    patch = { starts_at: comeca.toISOString(), ends_at: termina.toISOString(), all_day: diaTodo, updated_by: user.id };
    feito = `"${evento.title}" saiu de ${horarioDoEvento(evento)} e foi para ${horarioDoEvento({ ...evento, ...patch })}`;
  }
  const linhas = await gravando("mexer na agenda", () => db.update(`/rest/v1/calendar_events?id=${eq(evento.id)}&${org(empresa.id)}`, patch));
  if (!(linhas || []).length) throw new ToolError(`Não consegui mudar "${evento.title}": sua conta não tem permissão.`);
  await registrarEvento(contexto, { contactId: evento.contact_id, tipo: "calendar.updated", entidadeTipo: "compromisso", entidadeId: evento.id, carga: { campos: Object.keys(patch).filter((c) => c !== "updated_by") } });
  return { text: `Feito. ${feito}.`, data: { compromisso: { id: evento.id, titulo: evento.title, cancelado: cancelar, inicio: patch.starts_at || evento.starts_at } } };
}

/* ───────────────────────── catálogo ───────────────────────── */

const EMPRESA = { type: "string", description: "Nome (ou parte do nome) da empresa. Só é preciso quando a pessoa participa de mais de uma." };
const BUSCA = { type: "string", description: "Nome (ou parte), número de WhatsApp ou os últimos dígitos de quem se trata." };
const INSTANTE_DESC = "AAAA-MM-DD HH:MM no horário de Brasília (ex.: 2026-10-30 14:00); só AAAA-MM-DD vale o dia.";

function ferramenta(name, title, description, properties, required = [], { destrutiva = false, idempotente = false } = {}) {
  return {
    name,
    title,
    description,
    inputSchema: { type: "object", properties: { empresa: EMPRESA, ...properties }, ...(required.length ? { required } : {}), additionalProperties: false },
    annotations: { title, readOnlyHint: false, destructiveHint: destrutiva, idempotentHint: idempotente, openWorldHint: false },
  };
}

export const TOOLS_ESCRITA = [
  ferramenta(
    "criar_contato",
    "Criar lead ou contato",
    "Cadastra uma pessoa no CRM, como lead (padrão) ou só como contato. Se o número já existir, não cria outro e diz quem é.",
    {
      nome: { type: "string", description: "Nome da pessoa." },
      telefone: { type: "string", description: "WhatsApp com DDD, como a pessoa disser." },
      email: { type: "string" },
      empresa_do_contato: { type: "string", description: "Empresa onde a pessoa trabalha." },
      cargo: { type: "string" },
      origem: { type: "string", description: "De onde veio: Instagram, indicação, site..." },
      lead: { type: "boolean", description: "true (padrão) entra como lead; false, só como contato." },
    },
    ["nome"],
  ),
  ferramenta(
    "editar_contato",
    "Editar lead ou contato",
    "Muda dados de uma pessoa do CRM ou a marca como lead (lead=true) ou contato (lead=false). Quem só está no WhatsApp entra no CRM nessa hora.",
    {
      busca: BUSCA,
      nome: { type: "string" },
      email: { type: "string" },
      empresa_do_contato: { type: "string" },
      cargo: { type: "string" },
      origem: { type: "string" },
      lead: { type: "boolean", description: "true transforma em lead; false volta a ser contato (o banco recusa se houver negócio)." },
    },
    ["busca"],
    { idempotente: true },
  ),
  ferramenta(
    "criar_negocio",
    "Criar negócio no Funil",
    "Abre um negócio no Funil para uma pessoa (que vira lead), na etapa pedida ou na primeira. Se ela já tiver negócio aberto, avisa em vez de duplicar.",
    {
      busca: BUSCA,
      etapa: { type: "string", description: "Nome da etapa (ex.: Lead, Qualificação, Proposta). Sem ela, a primeira." },
      titulo: { type: "string", description: "Título do negócio, opcional." },
      valor: { type: "number", description: "Valor em reais, opcional." },
      outro_negocio: { type: "boolean", description: "true para abrir mesmo havendo um negócio aberto." },
    },
    ["busca"],
  ),
  ferramenta(
    "mover_negocio",
    "Mover negócio no Funil",
    "Muda a etapa do negócio de uma pessoa, marca como ganho ou perdido (com o motivo), reabre ou muda o valor.",
    {
      busca: BUSCA,
      etapa: { type: "string", description: "Etapa de destino (ex.: Proposta)." },
      situacao: { type: "string", enum: SITUACOES, description: "ganho, perdido ou aberto (reabrir)." },
      motivo_da_perda: { type: "string", description: "Por que perdeu; só com situacao=perdido." },
      valor: { type: "number", description: "Novo valor em reais." },
      negocio: { type: "string", description: "Título do negócio, quando a pessoa tem mais de um." },
    },
    ["busca"],
    { destrutiva: true, idempotente: true },
  ),
  ferramenta(
    "criar_tarefa",
    "Criar tarefa",
    "Cria uma tarefa com prazo e responsável (padrão: quem pediu), ligada ou não a uma pessoa do CRM.",
    {
      titulo: { type: "string" },
      prazo: { type: "string", description: `${INSTANTE_DESC} Só o dia: às 9h.` },
      busca: { ...BUSCA, description: "A pessoa do CRM ligada à tarefa (opcional)." },
      responsavel: { type: "string", description: "Nome de quem da equipe cuida. Sem ele, quem pediu." },
    },
    ["titulo"],
  ),
  ferramenta(
    "concluir_tarefa",
    "Concluir tarefa",
    "Marca como concluída uma tarefa pendente, achada pelo título.",
    {
      tarefa: { type: "string", description: "Título da tarefa, ou parte dele." },
      busca: { ...BUSCA, description: "A pessoa ligada à tarefa, para desempatar (opcional)." },
    },
    ["tarefa"],
    { idempotente: true },
  ),
  ferramenta(
    "anotar",
    "Anotar na ficha",
    "Escreve uma nota na ficha de uma pessoa (quem só está no WhatsApp entra no CRM).",
    { busca: BUSCA, texto: { type: "string", description: "O que anotar." } },
    ["busca", "texto"],
  ),
  ferramenta(
    "marcar_compromisso",
    "Marcar compromisso",
    "Marca um compromisso na agenda de quem pediu, com ou sem pessoa do CRM. Por padrão fica só na sua agenda; para_a_empresa=true deixa visível para a equipe.",
    {
      titulo: { type: "string" },
      inicio: { type: "string", description: INSTANTE_DESC },
      fim: { type: "string", description: `${INSTANTE_DESC} Sem ele, vale duracao_minutos.` },
      duracao_minutos: { type: "integer", minimum: 5, maximum: 1440, description: "Duração quando não há fim (padrão 60)." },
      dia_todo: { type: "boolean" },
      busca: { ...BUSCA, description: "A pessoa do CRM do compromisso (opcional)." },
      local: { type: "string" },
      descricao: { type: "string" },
      para_a_empresa: { type: "boolean", description: "true: a equipe vê. Padrão: só na agenda de quem pediu." },
    },
    ["titulo", "inicio"],
  ),
  ferramenta(
    "remarcar_compromisso",
    "Remarcar ou cancelar compromisso",
    "Muda o horário de um compromisso que a própria pessoa marcou, ou o cancela (cancelar=true). Não apaga.",
    {
      compromisso: { type: "string", description: "Título do compromisso, ou parte dele." },
      dia: { type: "string", description: "Dia atual do compromisso (AAAA-MM-DD), para desempatar." },
      novo_inicio: { type: "string", description: `${INSTANTE_DESC} Mantém a duração.` },
      novo_fim: { type: "string", description: INSTANTE_DESC },
      cancelar: { type: "boolean" },
    },
    ["compromisso"],
    { destrutiva: true },
  ),
];

const FAZER = {
  criar_contato: criarContato,
  editar_contato: editarContato,
  criar_negocio: criarNegocio,
  mover_negocio: moverNegocio,
  criar_tarefa: criarTarefa,
  concluir_tarefa: concluirTarefa,
  anotar,
  marcar_compromisso: marcarCompromisso,
  remarcar_compromisso: remarcarCompromisso,
};

/** `contexto` = `{ db, user, agora, empresa }`; a empresa já vem escolhida e liberada. */
export async function rodarEscrita(name, entrada, contexto) {
  return FAZER[name](contexto, entrada);
}
