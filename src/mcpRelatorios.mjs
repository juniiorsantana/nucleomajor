/**
 * Relatórios e qualidade do atendimento pelo MCP (pacote 3).
 *
 * - `relatorio_de_vendas` faz as contas da tela Relatórios com o mesmo
 *   código (`relatorios/metricas.js`): período, comparação, funil da safra,
 *   origem e motivos de perda. Os números batem com a tela porque são as
 *   mesmas funções.
 * - `qualidade_do_atendimento` lê as análises de conversa que já existem:
 *   a nota de uma pessoa ou a média da empresa no período.
 * - `pedir_analise` dispara uma análise nova, que gasta crédito. O dono
 *   decidiu em 29/10/2026: antes, o modelo diz o custo e o saldo e espera o
 *   sim. A ferramenta exige `confirmado: true` para isso não depender só da
 *   boa vontade do modelo.
 */

import { variantesBR } from "../apps/emyleads/src/lib/phone.js";
import { funilDaSafra, metricasDoPeriodo, porOrigem } from "../apps/emyleads/src/page/telas/relatorios/metricas.js";
import { RELATORIO_V1, NOME_DO_TIPO, creditosDoTipo, creditosEmTexto, motivoDaFalha, resumoParaCopiar, semCreditos } from "../apps/emyleads/src/domain/analiseDaConversa.js";
import {
  PERIODOS,
  ToolError,
  buscarPessoas,
  comparacao,
  dataCurta,
  escolherPessoa,
  intervaloDoDia,
  nomeDoContato,
  periodoPedido,
  telefoneMascarado,
  tempoDesde,
  validarDia,
} from "./mcpTools.mjs";

const org = (id) => `organization_id=eq.${encodeURIComponent(id)}`;
const iso = (data) => encodeURIComponent(data.toISOString());
const lista = (valores) => `(${valores.map((v) => encodeURIComponent(v)).join(",")})`;
const ms = (valor) => (valor ? Date.parse(valor) : null);
const vazio = (valor) => valor === undefined || valor === null || String(valor).trim() === "";
const porcento = (fracao) => (fracao == null ? "—" : `${Math.round(fracao * 100)}%`);
const reais = (valor) => `R$ ${Number(valor || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;

/* ───────────────────────── período ───────────────────────── */

/** O período de `periodoPedido`, ou de/até (os dois dias entram), com o anterior do mesmo tamanho. */
function periodoDoRelatorio(entrada, agora, padrao) {
  if (!vazio(entrada.de) || !vazio(entrada.ate)) {
    if (vazio(entrada.de) || vazio(entrada.ate)) throw new ToolError("Para um intervalo, mande de e ate (AAAA-MM-DD).");
    const de = validarDia(entrada.de);
    const ate = validarDia(entrada.ate);
    const inicio = intervaloDoDia(de < ate ? de : ate).inicio;
    const fim = intervaloDoDia(de < ate ? ate : de).fim;
    const tamanho = fim.getTime() - inicio.getTime();
    return {
      inicio,
      fim,
      rotulo: `de ${dataCurta(inicio)} a ${dataCurta(new Date(fim.getTime() - 1))}`,
      anterior: { inicio: new Date(inicio.getTime() - tamanho), fim: inicio, rotulo: "no período anterior" },
    };
  }
  return periodoPedido({ dia: entrada.dia, periodo: vazio(entrada.periodo) && vazio(entrada.dia) ? padrao : entrada.periodo }, agora);
}

/* ───────────────────────── vendas ───────────────────────── */

/** As linhas do banco no formato das contas da tela (`web/dataProvider.js`). */
async function dadosDoFunil(db, empresa) {
  const [contatos, negocios, etapas, historico] = await Promise.all([
    db.selectAll(`/rest/v1/contacts?select=id,created_at,lead_at,source,owner_label&${org(empresa.id)}&deleted_at=is.null`),
    db.selectAll(`/rest/v1/deals?select=id,contact_id,stage_id,status,value,created_at,updated_at,closed_at,loss_reason&${org(empresa.id)}&deleted_at=is.null`),
    db.select(`/rest/v1/stages?select=id,name,position&${org(empresa.id)}&deleted_at=is.null&order=position.asc`),
    db.selectAll(`/rest/v1/deal_stage_history?select=deal_id,to_stage_id,to_status&${org(empresa.id)}`).catch(() => []),
  ]);
  return {
    dados: {
      contatos: contatos.map((c) => ({ id: c.id, criadoEm: ms(c.created_at), leadEm: ms(c.lead_at), origem: c.source || "", responsavel: c.owner_label || "" })),
      negocios: negocios.map((n) => ({
        id: n.id,
        contactId: n.contact_id,
        stageId: n.stage_id,
        status: n.status,
        valor: n.value == null ? 0 : Number(n.value),
        criadoEm: ms(n.created_at),
        atualizadoEm: ms(n.updated_at),
        fechadoEm: n.closed_at === undefined ? undefined : ms(n.closed_at),
        motivoPerda: n.loss_reason || "",
      })),
      estagios: (etapas || []).map((e) => ({ id: e.id, nome: e.name, ordem: e.position ?? 0 })),
    },
    historico: (historico || []).map((h) => ({ negocioId: h.deal_id, paraEtapa: h.to_stage_id, paraStatus: h.to_status })),
  };
}

async function relatorioDeVendas({ db, empresa, agora }, entrada) {
  const periodo = periodoDoRelatorio(entrada, agora, "mes");
  const janela = { inicio: periodo.inicio.getTime(), fim: periodo.fim.getTime() };
  const anterior = { inicio: periodo.anterior.inicio.getTime(), fim: periodo.anterior.fim.getTime() };
  const { dados, historico } = await dadosDoFunil(db, empresa);
  const atual = metricasDoPeriodo(dados, janela);
  const antes = metricasDoPeriodo(dados, anterior);
  const safra = funilDaSafra(dados, historico, janela);
  const origens = porOrigem(dados, janela).slice(0, 5);

  const linhas = [`Vendas ${periodo.rotulo}:`];
  linhas.push(atual.leadsNovos == null
    ? `Contatos novos: ${atual.contatosNovos}; ${comparacao(atual.contatosNovos, antes.contatosNovos, periodo.anterior.rotulo)}.`
    : `Leads novos: ${atual.leadsNovos}; ${comparacao(atual.leadsNovos, antes.leadsNovos, periodo.anterior.rotulo)}. Contatos novos: ${atual.contatosNovos}.`);
  linhas.push(`Negócios abertos no período: ${atual.negociosNovos}${atual.valorCriado ? ` (${reais(atual.valorCriado)})` : ""}.`);
  linhas.push(`Fechados: ${atual.ganhos} ganho(s)${atual.valorGanho ? ` (${reais(atual.valorGanho)})` : ""} e ${atual.perdidos} perdido(s); taxa de ganho ${porcento(atual.taxaDeGanho)}. ${comparacao(atual.ganhos, antes.ganhos, `Ganhos ${periodo.anterior.rotulo}`)}.${atual.fechamentoAproximado ? " (Data de fechamento aproximada em negócios antigos.)" : ""}`);
  if (atual.motivosDePerda.length) linhas.push(`Motivos de perda: ${atual.motivosDePerda.slice(0, 5).map((m) => `${m.motivo} (${m.total})`).join(", ")}.`);
  if (safra.length > 1) {
    linhas.push(`Funil de quem chegou ${periodo.rotulo}, até hoje: ${safra.map((d) => `${d.rotulo} ${d.total}${d.doAnterior == null ? "" : ` (${porcento(d.doAnterior)})`}`).join(" → ")}.`);
  }
  if (origens.length) linhas.push(`Por origem: ${origens.map((o) => `${o.origem} ${o.leads}${o.ganhos ? ` (${o.ganhos} fechou)` : ""}`).join("; ")}.`);
  return {
    text: linhas.join("\n"),
    data: { periodo: periodo.rotulo, de: periodo.inicio.toISOString(), ate: periodo.fim.toISOString(), atual, anterior: antes, safra, porOrigem: origens },
  };
}

/* ───────────────────────── qualidade do atendimento ───────────────────────── */

const COLUNAS = "id,kind,status,error_code,requested_at,completed_at,saved_at,service_score,contact_id,contact_phone";

async function creditos(db, empresa) {
  try {
    return await db.rpc("conversation_analysis_credits", { target_organization: empresa.id });
  } catch {
    return null;
  }
}

function saldoEmTexto(saldo) {
  return creditosEmTexto(saldo) || "saldo indisponível agora";
}

const CUSTOS = "a de atendimento e a de lead usam 1 crédito; a completa, 2";

async function analisesDaPessoa(db, empresa, candidato) {
  if (candidato.contato) {
    return db.select(`/rest/v1/conversation_analyses?select=${COLUNAS}&${org(empresa.id)}&contact_id=eq.${encodeURIComponent(candidato.contato.id)}&order=requested_at.desc&limit=5`);
  }
  const telefone = candidato.conversa?.contact_phone;
  const formas = variantesBR(telefone);
  const telefones = formas.length ? formas : [String(telefone || "").replace(/\D/g, "")].filter(Boolean);
  if (!telefones.length) return [];
  return db.select(`/rest/v1/conversation_analyses?select=${COLUNAS}&${org(empresa.id)}&contact_phone=in.${lista(telefones)}&order=requested_at.desc&limit=5`);
}

async function qualidadeDeUmaPessoa({ db, empresa, agora }, busca) {
  const candidato = escolherPessoa(await buscarPessoas(db, empresa, busca), busca);
  const nome = nomeDoContato(candidato.contato?.name || candidato.conversa?.contact_name, candidato.contato?.phone || candidato.conversa?.contact_phone);
  const quem = `${nome} (${telefoneMascarado(candidato.contato?.phone || candidato.conversa?.contact_phone)})`;
  const analises = (await analisesDaPessoa(db, empresa, candidato)) || [];
  const andando = analises.find((a) => a.status === "pending" || a.status === "running");
  const pronta = analises.find((a) => a.status === "done");

  if (!pronta) {
    const saldo = await creditos(db, empresa);
    const linhas = [];
    if (andando) {
      linhas.push(`A análise ${NOME_DO_TIPO[andando.kind] ? `de ${NOME_DO_TIPO[andando.kind].toLowerCase()} ` : ""}da conversa com ${quem} está em andamento (pedida há ${tempoDesde(andando.requested_at, agora)}). Pergunte de novo em alguns minutos.`);
    } else {
      const falhou = analises.find((a) => a.status === "failed" || a.status === "expired");
      linhas.push(`Ainda não há análise da conversa com ${quem}.${falhou ? ` A última tentativa falhou: ${motivoDaFalha(falhou.error_code || falhou.status)}` : ""}`);
      linhas.push(`Uma análise nova gasta crédito (${CUSTOS}). Saldo: ${saldoEmTexto(saldo)}.`);
      linhas.push("Pergunte à pessoa se quer pedir uma; só com o sim, use pedir_analise com confirmado=true.");
    }
    return { text: linhas.join("\n"), data: { pessoa: nome, temAnalise: false, emAndamento: Boolean(andando), creditos: saldo } };
  }

  let completa = null;
  try {
    completa = await db.rpc("conversation_analysis_status", { target_organization: empresa.id, target_analysis: pronta.id });
  } catch {
    // Sem o relatório completo, fica a nota da lista.
  }
  const relatorio = completa?.report || null;
  const tipo = NOME_DO_TIPO[pronta.kind] || pronta.kind;
  const cabecalho = `Análise ${tipo ? `de ${tipo.toLowerCase()} ` : ""}de ${dataCurta(pronta.completed_at || pronta.requested_at)}${pronta.saved_at ? "" : " (rascunho, não salva na ficha)"}.`;
  let corpo;
  if (relatorio?.schema_version === RELATORIO_V1 || relatorio?.atendimento_score || relatorio?.diagnosis) {
    corpo = resumoParaCopiar({ nome, relatorio });
  } else {
    const nota = pronta.service_score ?? completa?.serviceScore ?? null;
    corpo = `Análise do atendimento · ${nome}\nNota: ${nota == null ? "ainda não avaliável" : `${nota}/100`}`;
    const resumo = completa?.result?.summary || completa?.result?.resumo;
    if (resumo) corpo += `\n\n${String(resumo).slice(0, 800)}`;
  }
  const extra = andando ? `\nHá outra análise em andamento, pedida há ${tempoDesde(andando.requested_at, agora)}.` : "";
  return {
    text: `${cabecalho}\n${corpo}${extra}`,
    data: { pessoa: nome, temAnalise: true, analise: { id: pronta.id, tipo: pronta.kind, nota: pronta.service_score ?? null, em: pronta.completed_at, salva: Boolean(pronta.saved_at) }, relatorio },
  };
}

async function qualidadeDaEmpresa({ db, empresa, agora }, entrada) {
  const periodo = periodoDoRelatorio(entrada, agora, "30dias");
  const [analises, saldo] = await Promise.all([
    db.selectAll(`/rest/v1/conversation_analyses?select=${COLUNAS}&${org(empresa.id)}&status=eq.done&requested_at=gte.${iso(periodo.inicio)}&requested_at=lt.${iso(periodo.fim)}&order=requested_at.desc`),
    creditos(db, empresa),
  ]);
  const comNota = analises.filter((a) => a.service_score != null);
  const ids = [...new Set(comNota.map((a) => a.contact_id).filter(Boolean))];
  const contatos = ids.length ? await db.select(`/rest/v1/contacts?select=id,name,phone&id=in.${lista(ids)}`) : [];
  const porId = new Map((contatos || []).map((c) => [c.id, c]));
  // Uma linha por pessoa: a análise mais nova de cada uma.
  const vistas = new Set();
  const pessoas = [];
  for (const a of comNota) {
    const chave = a.contact_id || a.contact_phone;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    const contato = porId.get(a.contact_id);
    pessoas.push({ nome: nomeDoContato(contato?.name, contato?.phone || a.contact_phone), nota: Number(a.service_score), em: a.completed_at || a.requested_at });
  }
  const media = comNota.length ? Math.round(comNota.reduce((s, a) => s + Number(a.service_score), 0) / comNota.length) : null;
  const ordenadas = [...pessoas].sort((a, b) => a.nota - b.nota);
  const linhas = [`Qualidade do atendimento ${periodo.rotulo}:`];
  if (!analises.length) {
    linhas.push("Nenhuma análise de conversa feita no período.");
  } else {
    linhas.push(`${analises.length} análise(s) feitas; ${comNota.length} com nota${media == null ? "" : `, média ${media}/100`}.`);
    if (ordenadas.length) linhas.push(`Notas mais baixas: ${ordenadas.slice(0, 3).map((p) => `${p.nome} ${p.nota}`).join("; ")}.`);
    if (ordenadas.length > 3) linhas.push(`Mais altas: ${ordenadas.slice(-3).reverse().map((p) => `${p.nome} ${p.nota}`).join("; ")}.`);
  }
  linhas.push(`Saldo de análises: ${saldoEmTexto(saldo)}. Para ver uma pessoa, passe busca.`);
  return {
    text: linhas.join("\n"),
    data: { periodo: periodo.rotulo, analises: analises.length, comNota: comNota.length, media, pessoas: ordenadas, creditos: saldo },
  };
}

/* ───────────────────────── pedir análise ───────────────────────── */

const TIPOS = ["atendimento", "lead", "completa"];

async function pedirAnalise({ db, empresa }, entrada) {
  const tipo = vazio(entrada.tipo) ? "atendimento" : String(entrada.tipo);
  if (!TIPOS.includes(tipo)) throw new ToolError(`Tipo desconhecido: ${tipo}. Use atendimento, lead ou completa.`);
  const custo = creditosDoTipo(tipo);
  const saldo = await creditos(db, empresa);
  if (entrada.confirmado !== true) {
    throw new ToolError(`Antes de pedir: a análise ${NOME_DO_TIPO[tipo].toLowerCase()} usa ${custo} crédito(s); saldo: ${saldoEmTexto(saldo)}. Diga isso à pessoa e só chame de novo com confirmado=true depois do sim dela.`);
  }
  if (semCreditos(saldo, custo)) throw new ToolError(`Sem crédito para a análise ${NOME_DO_TIPO[tipo].toLowerCase()} (precisa de ${custo}; ${saldoEmTexto(saldo)}).`);

  if (vazio(entrada.busca)) throw new ToolError("Diga de quem é a conversa a analisar.");
  const candidato = escolherPessoa(await buscarPessoas(db, empresa, entrada.busca), entrada.busca);
  const telefone = candidato.contato?.phone || candidato.conversa?.contact_phone;
  const nome = nomeDoContato(candidato.contato?.name || candidato.conversa?.contact_name, telefone);
  const formas = variantesBR(telefone);
  const telefones = formas.length ? formas : [String(telefone || "").replace(/\D/g, "")].filter(Boolean);
  const conversas = telefones.length
    ? await db.select(`/rest/v1/whatsapp_conversations?select=connection_id,contact_phone,last_message_at&${org(empresa.id)}&chat_kind=eq.direto&contact_phone=in.${lista(telefones)}&order=last_message_at.desc.nullslast&limit=1`)
    : [];
  const conversa = (conversas || [])[0];
  if (!conversa) throw new ToolError(`${nome} não tem conversa no WhatsApp para analisar.`);

  let pedido;
  try {
    pedido = await db.rpc("conversation_analysis_request", {
      target_organization: empresa.id,
      target_connection: conversa.connection_id,
      target_chat: conversa.contact_phone,
      analysis_kind: tipo,
    });
  } catch (erro) {
    if (erro?.status === 401) throw erro;
    const motivo = String(erro?.mensagemDoBanco || "").slice(0, 160);
    throw new ToolError(`O banco não aceitou o pedido de análise${motivo ? `: ${motivo}` : "."} Nenhum crédito foi gasto.`);
  }
  const depois = pedido?.credits || (await creditos(db, empresa));
  return {
    text: `Pedida a análise ${NOME_DO_TIPO[tipo].toLowerCase()} da conversa com ${nome} (${telefoneMascarado(telefone)}). Fica pronta em alguns minutos: pergunte de novo com qualidade_do_atendimento. Saldo agora: ${saldoEmTexto(depois)}.`,
    data: { analise: { id: pedido?.analysisId || pedido?.id || null, tipo, situacao: pedido?.status || "pending" }, creditos: depois },
  };
}

/* ───────────────────────── catálogo ───────────────────────── */

const EMPRESA = { type: "string", description: "Nome (ou parte do nome) da empresa. Só é preciso quando a pessoa participa de mais de uma." };
const PERIODO = { type: "string", enum: PERIODOS, description: "hoje, ontem, semana, 7dias, mes ou 30dias. Vem comparado com o período anterior." };
const DE = { type: "string", description: "Primeiro dia de um intervalo (AAAA-MM-DD), junto com ate." };
const ATE = { type: "string", description: "Último dia do intervalo (AAAA-MM-DD), incluído." };

function ferramenta(name, title, description, properties, required = [], leitura = true) {
  return {
    name,
    title,
    description,
    inputSchema: { type: "object", properties: { empresa: EMPRESA, ...properties }, ...(required.length ? { required } : {}), additionalProperties: false },
    annotations: { title, readOnlyHint: leitura, destructiveHint: false, idempotentHint: leitura, openWorldHint: false },
  };
}

export const TOOLS_RELATORIOS = [
  ferramenta(
    "relatorio_de_vendas",
    "Relatório de vendas",
    "Os números da tela Relatórios: leads e contatos novos, negócios abertos, ganhos e perdidos com valor e taxa de ganho, motivos de perda, funil da safra e leads por origem, comparados com o período anterior. Padrão: este mês.",
    { periodo: PERIODO, dia: { type: "string", description: "Um dia só (AAAA-MM-DD)." }, de: DE, ate: ATE },
  ),
  ferramenta(
    "qualidade_do_atendimento",
    "Qualidade do atendimento",
    "Com busca: a análise mais recente da conversa com uma pessoa (nota, gargalo, o que fazer agora); se não houver, diz o custo e o saldo para pedir uma. Sem busca: quantas análises, nota média e as mais baixas e altas do período (padrão 30 dias).",
    { busca: { type: "string", description: "Nome, número ou últimos dígitos da pessoa." }, periodo: PERIODO, de: DE, ate: ATE },
  ),
  ferramenta(
    "pedir_analise",
    "Pedir análise de conversa",
    "Pede uma análise nova da conversa de WhatsApp com uma pessoa. Gasta crédito do plano: antes, diga à pessoa o custo e o saldo, e só chame com confirmado=true depois do sim dela.",
    {
      busca: { type: "string", description: "Nome, número ou últimos dígitos da pessoa." },
      tipo: { type: "string", enum: TIPOS, description: "atendimento (padrão, 1 crédito), lead (1) ou completa (2)." },
      confirmado: { type: "boolean", description: "true só depois que a pessoa disse sim ao custo." },
    },
    ["busca", "confirmado"],
    false,
  ),
];

/** `contexto` = `{ db, user, agora, empresa }`; a empresa já vem escolhida e liberada. */
export async function rodarRelatorio(name, entrada, contexto) {
  if (name === "relatorio_de_vendas") return relatorioDeVendas(contexto, entrada);
  if (name === "pedir_analise") return pedirAnalise(contexto, entrada);
  return vazio(entrada.busca) ? qualidadeDaEmpresa(contexto, entrada) : qualidadeDeUmaPessoa(contexto, entrada.busca);
}
