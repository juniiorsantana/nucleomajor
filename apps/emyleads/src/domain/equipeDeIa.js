/**
 * Equipe de IA: o playbook comercial e o que o Jev diz de cada agente.
 *
 * O playbook é da empresa, um só, com rascunho e versões publicadas
 * (`organization_playbooks`, migration 20261001100000). O formato é conferido
 * no banco por `private.playbook_problema`; `problemaDoPlaybook` repete as
 * mesmas regras aqui para a tela avisar antes de salvar, e os testes prendem
 * as duas listas de limite juntas.
 *
 * O Jev usa só a parte que decide: as chaves e os nomes das objeções e dos
 * próximos passos, e os critérios próprios. Oferta, cliente ideal e as
 * respostas esperadas servem para quem lê o playbook e, numa próxima etapa,
 * para o agente responder.
 */

import { CONFIANCA_MINIMA, itemDaLeitura } from "./leituraDaConversa";

export const LIMITES = { oferta: 20, objecoes: 12, proximosPassos: 6, criterios: 8, clienteIdeal: 10, texto: 600 };

const CHAVE_RE = /^[a-z][a-z0-9_]{1,30}$/;

/** Uma chave estável a partir do nome: "Aula experimental" → "aula_experimental". */
export function chaveDe(nome) {
  const base = String(nome || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    .slice(0, 31);
  if (!base) return "";
  const chave = (/^[a-z]/.test(base) ? base : `x_${base}`).slice(0, 31).replace(/_+$/, "");
  return chave.length >= 2 ? chave : "";
}

/** Chave única dentro da lista: repete com sufixo numérico. */
export function chaveUnica(nome, existentes) {
  const base = chaveDe(nome) || "item";
  if (!existentes.includes(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidata = `${base.slice(0, 28)}_${i}`;
    if (!existentes.includes(candidata)) return candidata;
  }
  return `${base.slice(0, 24)}_${Date.now() % 100000}`;
}

export const playbookVazio = () => ({
  segmento: "",
  oferta: [],
  clienteIdeal: { atende: [], naoAtende: [] },
  objecoes: [],
  proximosPassos: [],
  criterios: [],
});

const lista = (valor) => (Array.isArray(valor) ? valor : []);
const texto = (valor) => String(valor ?? "");

/** O playbook como a tela edita: sempre com todas as partes. */
export function normalizarPlaybook(bruto) {
  const pb = bruto && typeof bruto === "object" ? bruto : {};
  return {
    segmento: texto(pb.segmento),
    oferta: lista(pb.oferta).map((i) => ({ nome: texto(i?.nome), preco: texto(i?.preco), inclui: texto(i?.inclui) })),
    clienteIdeal: {
      atende: lista(pb.clienteIdeal?.atende).map(texto),
      naoAtende: lista(pb.clienteIdeal?.naoAtende).map(texto),
    },
    objecoes: lista(pb.objecoes).map((i) => ({ chave: texto(i?.chave), nome: texto(i?.nome), resposta: texto(i?.resposta) })),
    proximosPassos: lista(pb.proximosPassos).map((i) => ({ chave: texto(i?.chave), nome: texto(i?.nome), quando: texto(i?.quando) })),
    criterios: lista(pb.criterios).map((i) => ({ chave: texto(i?.chave), pergunta: texto(i?.pergunta), sim: texto(i?.sim) })),
  };
}

/**
 * O playbook pronto para gravar: sem linhas em branco, com chave em quem não
 * tem e sem espaço sobrando. É o que vai para `playbook_save`.
 */
export function limparPlaybook(pb) {
  const n = normalizarPlaybook(pb);
  const comChave = (itens, campoNome) => {
    const usadas = [];
    return itens.map((item) => {
      const chave = CHAVE_RE.test(item.chave) && !usadas.includes(item.chave)
        ? item.chave
        : chaveUnica(item[campoNome], usadas);
      usadas.push(chave);
      return { ...item, chave };
    });
  };
  const aparar = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
  return {
    segmento: n.segmento.trim(),
    oferta: n.oferta.map(aparar).filter((i) => i.nome),
    clienteIdeal: {
      atende: n.clienteIdeal.atende.map((t) => t.trim()).filter(Boolean),
      naoAtende: n.clienteIdeal.naoAtende.map((t) => t.trim()).filter(Boolean),
    },
    objecoes: comChave(n.objecoes.map(aparar).filter((i) => i.nome), "nome"),
    proximosPassos: comChave(n.proximosPassos.map(aparar).filter((i) => i.nome), "nome"),
    criterios: comChave(n.criterios.map(aparar).filter((i) => i.pergunta), "pergunta"),
  };
}

/** O motivo de o banco recusar este playbook, ou "" se ele passa. */
export function problemaDoPlaybook(pb) {
  const n = normalizarPlaybook(pb);
  if (n.segmento.length > 40) return "O segmento passou de 40 caracteres.";
  const partes = [
    ["oferta", "Oferta"],
    ["objecoes", "Objeções"],
    ["proximosPassos", "Próximos passos"],
    ["criterios", "Critérios próprios"],
  ];
  for (const [parte, rotulo] of partes) {
    if (n[parte].length > LIMITES[parte]) return `${rotulo}: no máximo ${LIMITES[parte]}.`;
    for (const item of n[parte]) {
      if (Object.values(item).some((v) => v.length > LIMITES.texto)) return `${rotulo}: algum texto passou de ${LIMITES.texto} caracteres.`;
    }
  }
  if (n.oferta.some((i) => !i.nome.trim() || i.nome.length > 120)) return "Oferta: todo item precisa de nome (até 120 caracteres).";
  for (const [parte, rotulo] of partes.slice(1)) {
    const chaves = [];
    for (const item of n[parte]) {
      if (!CHAVE_RE.test(item.chave)) return `${rotulo}: chave inválida em "${item.nome || item.pergunta}".`;
      if (chaves.includes(item.chave)) return `${rotulo}: dois itens com a mesma chave (${item.chave}).`;
      chaves.push(item.chave);
      if (parte === "criterios") {
        if (item.pergunta.trim().length < 5 || item.pergunta.length > 300) return "Critérios próprios: toda pergunta precisa de 5 a 300 caracteres.";
      } else if (!item.nome.trim() || item.nome.length > 120) {
        return `${rotulo}: todo item precisa de nome (até 120 caracteres).`;
      }
    }
  }
  if (n.clienteIdeal.atende.length > LIMITES.clienteIdeal || n.clienteIdeal.naoAtende.length > LIMITES.clienteIdeal) {
    return `Cliente ideal: no máximo ${LIMITES.clienteIdeal} frases em cada lista.`;
  }
  return "";
}

/**
 * Pontos de partida por segmento. São sugestões para o dono apagar e
 * completar, nunca o playbook dele: por isso não trazem preço nem oferta.
 */
export const MODELOS = {
  academia: {
    nome: "Academia e estúdio",
    objecoes: [["preco", "Preço", "Mostre o que está incluso e ofereça a aula experimental."], ["horario", "Horário", "Mostre a grade e os horários de menor movimento."], ["falta_de_tempo", "Falta de tempo", "Sugira treinos curtos e os horários alternativos."], ["localizacao", "Localização", "Fale do estacionamento e do acesso."]],
    passos: [["aula_experimental", "Aula experimental", "Quando o lead demonstra interesse ou fala de preço."], ["avaliacao_fisica", "Avaliação física", "Quando o lead fala de objetivo ou de saúde."]],
    criterios: [["ofereceu_aula", "A empresa ofereceu a aula experimental com dia e horário?", "Ofereceu, com data."]],
  },
  clinica: {
    nome: "Clínica e consultório",
    objecoes: [["preco", "Preço", "Explique o que a consulta inclui e as formas de pagamento."], ["convenio", "Convênio", "Diga quais convênios atende e como funciona o reembolso."], ["agenda", "Agenda cheia", "Ofereça o primeiro horário livre e a lista de espera."], ["confianca", "Confiança", "Fale da experiência do profissional e de casos parecidos."]],
    passos: [["agendar_consulta", "Agendar consulta", "Quando o paciente descreve o problema."], ["avaliacao", "Avaliação inicial", "Quando ainda há dúvida sobre o tratamento."]],
    criterios: [["perguntou_queixa", "A empresa perguntou qual é a queixa antes de falar de valor?", "Perguntou a queixa primeiro."]],
  },
  estetica: {
    nome: "Estética e beleza",
    objecoes: [["preco", "Preço", "Mostre o resultado esperado e os pacotes."], ["medo_do_resultado", "Medo do resultado", "Mostre antes e depois e explique o procedimento."], ["horario", "Horário", "Ofereça os horários livres da semana."]],
    passos: [["avaliacao_gratuita", "Avaliação gratuita", "Quando a cliente pergunta preço."], ["agendar_procedimento", "Agendar procedimento", "Quando a cliente já decidiu."]],
    criterios: [["mostrou_resultado", "A empresa mostrou resultados de outras clientes?", "Mostrou fotos ou depoimentos."]],
  },
  agencia: {
    nome: "Agência e serviços B2B",
    objecoes: [["preco", "Preço", "Mostre o retorno esperado e o escopo."], ["ja_tem_fornecedor", "Já tem fornecedor", "Pergunte o que falta no fornecedor atual."], ["decisor", "Precisa consultar o sócio", "Ofereça uma reunião com quem decide."], ["prazo", "Prazo", "Mostre o cronograma e o primeiro entregável."]],
    passos: [["reuniao_diagnostico", "Reunião de diagnóstico", "Quando o lead descreve o problema."], ["enviar_proposta", "Enviar proposta", "Depois do diagnóstico."]],
    criterios: [["fez_diagnostico", "A empresa entendeu o problema do cliente antes de oferecer o serviço?", "Fez perguntas de diagnóstico antes da oferta."]],
  },
  imobiliaria: {
    nome: "Imobiliária",
    objecoes: [["preco", "Preço", "Mostre opções na faixa e as condições de financiamento."], ["localizacao", "Localização", "Ofereça imóveis em bairros parecidos."], ["financiamento", "Financiamento", "Explique a simulação e ofereça o correspondente."]],
    passos: [["agendar_visita", "Agendar visita", "Quando o lead gosta de um imóvel."], ["simular_financiamento", "Simular financiamento", "Quando o lead fala de entrada ou parcela."]],
    criterios: [["perguntou_perfil", "A empresa perguntou faixa de preço, região e número de quartos?", "Perguntou o perfil do imóvel."]],
  },
};

/** Junta o modelo ao playbook atual sem apagar nada do que já foi escrito. */
export function aplicarModelo(pb, segmento) {
  const modelo = MODELOS[segmento];
  const atual = normalizarPlaybook(pb);
  if (!modelo) return atual;
  const juntar = (itens, novos, montar) => {
    const chaves = itens.map((i) => i.chave);
    return [...itens, ...novos.filter(([chave]) => !chaves.includes(chave)).map(montar)];
  };
  return {
    ...atual,
    segmento: atual.segmento || segmento,
    objecoes: juntar(atual.objecoes, modelo.objecoes, ([chave, nome, resposta]) => ({ chave, nome, resposta })).slice(0, LIMITES.objecoes),
    proximosPassos: juntar(atual.proximosPassos, modelo.passos, ([chave, nome, quando]) => ({ chave, nome, quando })).slice(0, LIMITES.proximosPassos),
    criterios: juntar(atual.criterios, modelo.criterios, ([chave, pergunta, sim]) => ({ chave, pergunta, sim })).slice(0, LIMITES.criterios),
  };
}

/* ------------------------------------------------------------------------ *
 * O que o Jev diz.
 * ------------------------------------------------------------------------ */

const resposta = (resumo, chave) => {
  const item = resumo?.[chave];
  if (!item || typeof item.a !== "string") return null;
  return { valor: item.a, chance: typeof item.p === "number" ? item.p : null };
};
const confiavel = (r) => r && r.chance != null && r.chance >= CONFIANCA_MINIMA;

/**
 * As perguntas que vêm do playbook e do jeito do agente, que a leitura da
 * conversa não conhece: "seguiu o jeito?", "qual próximo passo ofereceu?" e
 * os critérios próprios (`pb_*`). Nomes vêm do playbook; o que ele não
 * nomeia não aparece.
 */
export function itensDoPlaybook(resumo, playbook) {
  const pb = normalizarPlaybook(playbook);
  const itens = [];
  const jeito = resposta(resumo, "segue_o_jeito");
  if (jeito) {
    itens.push(confiavel(jeito)
      ? { chave: "segue_o_jeito", rotulo: "Seguiu o jeito do agente", valor: jeito.valor === "sim" ? "Sim" : "Não", tom: jeito.valor === "sim" ? "success" : "warning", incerto: false, chance: jeito.chance }
      : { chave: "segue_o_jeito", rotulo: "Seguiu o jeito do agente", valor: "Incerto", tom: "faint", incerto: true, chance: jeito.chance });
  }
  const passo = resposta(resumo, "proximo_passo_oferecido");
  if (passo) {
    const nome = passo.valor === "nenhum" ? "Nenhum" : pb.proximosPassos.find((p) => p.chave === passo.valor)?.nome;
    if (nome) {
      itens.push(confiavel(passo)
        ? { chave: "proximo_passo_oferecido", rotulo: "Próximo passo oferecido", valor: nome, tom: passo.valor === "nenhum" ? "warning" : "success", incerto: false, chance: passo.chance }
        : { chave: "proximo_passo_oferecido", rotulo: "Próximo passo oferecido", valor: "Incerto", tom: "faint", incerto: true, chance: passo.chance });
    }
  }
  for (const criterio of pb.criterios) {
    const r = resposta(resumo, `pb_${criterio.chave}`);
    if (!r) continue;
    itens.push(confiavel(r)
      ? { chave: `pb_${criterio.chave}`, rotulo: criterio.pergunta, valor: r.valor === "sim" ? "Sim" : "Não", tom: r.valor === "sim" ? "success" : "warning", incerto: false, chance: r.chance }
      : { chave: `pb_${criterio.chave}`, rotulo: criterio.pergunta, valor: "Incerto", tom: "faint", incerto: true, chance: r.chance });
  }
  return itens;
}

/** A avaliação de teste (`{ r: { pergunta: [resposta, chance] } }`) no formato do resumo. */
export function resumoDaAvaliacao(resultado) {
  const r = resultado?.r;
  if (!r || typeof r !== "object") return {};
  return Object.fromEntries(
    Object.entries(r)
      .filter(([, par]) => Array.isArray(par) && typeof par[0] === "string")
      .map(([chave, [a, p]]) => [chave, { a, p: typeof p === "number" ? p : null }]),
  );
}

/** A avaliação de teste agrupada para a tela, com os rótulos da leitura. */
export function avaliacaoParaTela(resultado, playbook) {
  const resumo = resumoDaAvaliacao(resultado);
  const grupo = (titulo, chaves) => ({ titulo, itens: chaves.map((c) => itemDaLeitura(resumo, c)).filter(Boolean) });
  return [
    { titulo: "Jeito e playbook", itens: itensDoPlaybook(resumo, playbook) },
    grupo("O atendimento", ["pergunta_sem_resposta", "propos_proximo_passo", "promessa_pendente", "tom_empresa"]),
    grupo("O lead", ["temperatura", "intencao", "objecao_principal", "prazo"]),
  ].filter((g) => g.itens.length > 0);
}

const pct = (parte, total) => (total ? Math.round((parte / total) * 100) : null);

/**
 * O Desempenho de um agente a partir das leituras em vigor dos últimos dias.
 *
 * Cada taxa conta só as respostas confiáveis (chance ≥ 60%) e diz sobre
 * quantas conversas foi calculada. Leituras sem agente (de antes de
 * 01/10/2026, ou de conversa que ninguém soube atribuir) entram na porta de
 * entrada quando `incluirSemAgente` for verdadeiro.
 */
export function desempenhoDoAgente(leituras, agentId, { incluirSemAgente = false } = {}) {
  const dele = (leituras || []).filter((l) => l.assistant_profile_id === agentId || (incluirSemAgente && !l.assistant_profile_id));
  const taxa = (chave, valorBom) => {
    let total = 0;
    let sim = 0;
    for (const l of dele) {
      const r = resposta(l.summary, chave);
      if (!confiavel(r)) continue;
      total += 1;
      if (r.valor === valorBom) sim += 1;
    }
    return { total, sim, pct: pct(sim, total) };
  };
  const temperatura = { frio: 0, morno: 0, quente: 0 };
  for (const l of dele) {
    const r = resposta(l.summary, "temperatura");
    if (confiavel(r) && r.valor in temperatura) temperatura[r.valor] += 1;
  }
  const quemAtendeu = { soIa: 0, soEquipe: 0, ambos: 0, ninguem: 0 };
  for (const l of dele) {
    const ia = Number(l.ai_messages) || 0;
    const equipe = Number(l.team_messages) || 0;
    if (ia && equipe) quemAtendeu.ambos += 1;
    else if (ia) quemAtendeu.soIa += 1;
    else if (equipe) quemAtendeu.soEquipe += 1;
    else quemAtendeu.ninguem += 1;
  }
  return {
    conversas: dele.length,
    semAgente: dele.filter((l) => !l.assistant_profile_id).length,
    perguntaSemResposta: taxa("pergunta_sem_resposta", "sim"),
    proposProximoPasso: taxa("propos_proximo_passo", "sim"),
    promessaPendente: taxa("promessa_pendente", "sim"),
    seguiuOJeito: taxa("segue_o_jeito", "sim"),
    insatisfeito: taxa("insatisfeito", "sim"),
    pediuPessoa: taxa("pediu_humano", "sim"),
    temperatura,
    quemAtendeu,
  };
}

/**
 * O que as leituras dizem para o playbook: as objeções que mais aparecem e as
 * conversas cuja objeção não está na lista ("outra"). Jev não escreve texto,
 * então a sugestão é "leia estas conversas e acrescente o que se repete".
 */
export function sinaisParaOPlaybook(leituras, playbook) {
  const nomes = Object.fromEntries(normalizarPlaybook(playbook).objecoes.map((o) => [o.chave, o.nome]));
  const contagem = {};
  const outras = [];
  for (const l of leituras || []) {
    const r = resposta(l.summary, "objecao_principal");
    if (!confiavel(r) || r.valor === "nenhuma") continue;
    contagem[r.valor] = (contagem[r.valor] || 0) + 1;
    if (r.valor === "outra") outras.push({ telefone: l.contact_phone, quando: l.created_at });
  }
  const objecoes = Object.entries(contagem)
    .filter(([chave]) => chave !== "outra")
    .map(([chave, qtd]) => ({ chave, nome: nomes[chave] || ROTULO_DA_BASE[chave] || chave, qtd, doPlaybook: chave in nomes }))
    .sort((a, b) => b.qtd - a.qtd);
  return { objecoes, outras: outras.slice(0, 10), totalOutras: outras.length };
}

const ROTULO_DA_BASE = {
  preco: "Preço",
  horario_tempo: "Horário ou tempo",
  confianca: "Confiança",
  concorrente: "Concorrente",
  nao_e_o_momento: "Não é o momento",
  decisor_ausente: "Precisa consultar alguém",
  localizacao: "Localização",
};
