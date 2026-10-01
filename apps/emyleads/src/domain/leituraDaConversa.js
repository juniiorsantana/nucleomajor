/**
 * A leitura automática de uma conversa, feita pelo coordenador da VPS com o
 * Jev, no formato que a ficha lateral mostra.
 *
 * O banco guarda, por conversa, a leitura em vigor (`conversation_insight_runs`
 * com `is_latest`) e as respostas compactas em `summary`:
 * `{ "temperatura": { "a": "morno", "p": 0.71 }, ... }`. As chaves e as opções
 * são as do framework `major-v1` (`whatsapp-assistant/jev_framework.py`, no
 * runtime). Pergunta ou opção que este arquivo não conhece não aparece: o
 * framework pode crescer antes do portal, e mostrar a chave crua seria pior
 * que esconder.
 *
 * O Jev responde com uma chance de estar certo. Abaixo de `CONFIANCA_MINIMA`
 * a resposta aparece como "incerto", e não vira selo: um "cliente
 * insatisfeito" com 55% de chance é mais ruído do que aviso.
 */

export const CONFIANCA_MINIMA = 0.6;

const SIM_NAO = { sim: "Sim", nao: "Não" };

const PERGUNTAS = {
  temperatura: {
    rotulo: "Temperatura",
    opcoes: { frio: "Frio", morno: "Morno", quente: "Quente" },
    tons: { frio: "sub", morno: "warning", quente: "success" },
  },
  intencao: {
    rotulo: "Intenção",
    opcoes: {
      comprar_agora: "Quer comprar agora",
      pesquisando: "Pesquisando",
      curiosidade: "Só curiosidade",
      ja_cliente: "Já é cliente",
      fora_do_perfil: "Fora do perfil",
    },
    tons: { comprar_agora: "success" },
  },
  objecao_principal: {
    rotulo: "Objeção",
    opcoes: {
      nenhuma: "Nenhuma",
      preco: "Preço",
      horario_tempo: "Horário ou tempo",
      confianca: "Confiança",
      concorrente: "Concorrente",
      nao_e_o_momento: "Não é o momento",
      decisor_ausente: "Precisa consultar alguém",
      localizacao: "Localização",
      outra: "Outra",
    },
    tons: {},
  },
  prazo: {
    rotulo: "Prazo",
    opcoes: { agora: "Agora", este_mes: "Este mês", sem_prazo: "Sem pressa", nao_falou: "Não falou" },
    tons: { agora: "success" },
  },
  pergunta_sem_resposta: {
    rotulo: "Pergunta sem resposta",
    opcoes: SIM_NAO,
    tons: { sim: "danger" },
  },
  propos_proximo_passo: {
    rotulo: "Propôs próximo passo",
    opcoes: SIM_NAO,
    tons: { sim: "success", nao: "warning" },
  },
  promessa_pendente: {
    rotulo: "Promessa pendente",
    opcoes: SIM_NAO,
    tons: { sim: "danger" },
  },
  tom_empresa: {
    rotulo: "Tom da empresa",
    opcoes: { frio: "Frio", adequado: "Adequado", caloroso: "Caloroso" },
    tons: { frio: "warning", caloroso: "success" },
  },
};

const GRUPOS = [
  { titulo: "O lead", chaves: ["temperatura", "intencao", "objecao_principal", "prazo"] },
  { titulo: "O atendimento", chaves: ["pergunta_sem_resposta", "propos_proximo_passo", "promessa_pendente", "tom_empresa"] },
];

// Os sinais viram selo só quando a resposta é "sim" e a chance passa do corte.
const SINAIS = [
  { chave: "insatisfeito", texto: "Cliente insatisfeito", tom: "danger" },
  { chave: "pediu_humano", texto: "Pediu uma pessoa", tom: "warning" },
  { chave: "precisa_resposta", texto: "Esperando resposta", tom: "warning" },
];

function resposta(resumo, chave) {
  const item = resumo?.[chave];
  if (!item || typeof item !== "object" || typeof item.a !== "string") return null;
  const chance = typeof item.p === "number" && Number.isFinite(item.p) ? item.p : null;
  return { valor: item.a, chance };
}

const confiavel = (chance) => chance != null && chance >= CONFIANCA_MINIMA;

/** Um item da ficha: rótulo, valor em português, tom e se é incerto. */
export function itemDaLeitura(resumo, chave) {
  const pergunta = PERGUNTAS[chave];
  const r = resposta(resumo, chave);
  if (!pergunta || !r || !(r.valor in pergunta.opcoes)) return null;
  if (!confiavel(r.chance)) {
    return { chave, rotulo: pergunta.rotulo, valor: "Incerto", tom: "faint", incerto: true, chance: r.chance };
  }
  return {
    chave,
    rotulo: pergunta.rotulo,
    valor: pergunta.opcoes[r.valor],
    tom: pergunta.tons[r.valor] || "",
    incerto: false,
    chance: r.chance,
  };
}

/**
 * A leitura pronta para a tela, ou `null` quando não há leitura (empresa sem
 * a função, conversa ainda não lida, banco antes da migration).
 */
export function leituraDaConversa(linha) {
  const resumo = linha?.summary;
  if (!resumo || typeof resumo !== "object") return null;
  const grupos = GRUPOS.map((grupo) => ({
    titulo: grupo.titulo,
    itens: grupo.chaves.map((chave) => itemDaLeitura(resumo, chave)).filter(Boolean),
  })).filter((grupo) => grupo.itens.length > 0);
  const sinais = SINAIS.filter((sinal) => {
    const r = resposta(resumo, sinal.chave);
    return r && r.valor === "sim" && confiavel(r.chance);
  }).map(({ chave, texto, tom }) => ({ chave, texto, tom }));
  if (grupos.length === 0 && sinais.length === 0) return null;
  const temperatura = itemDaLeitura(resumo, "temperatura");
  return {
    lidaEm: linha.created_at || null,
    ate: linha.analyzed_until || null,
    mensagens: Number(linha.messages_count) || 0,
    grupos,
    sinais,
    temperatura: temperatura && !temperatura.incerto ? temperatura : null,
  };
}
