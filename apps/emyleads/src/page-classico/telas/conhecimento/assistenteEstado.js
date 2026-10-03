/**
 * A máquina de estados do assistente de criação.
 *
 * Fica fora do componente porque é aqui que mora a regra que importa: o que
 * cada etapa exige para deixar avançar. Dentro do JSX ela viraria uma
 * sequência de `disabled={...}` que ninguém consegue testar sem montar a
 * árvore inteira.
 */

import { derivarCaminho } from "./caminhoDoDocumento";
import { colecaoAutomatica, motivoParaNaoPublicar } from "./conhecimentoRegras";
import { MODELO_POR_ID, montarMarkdown } from "./modelosConhecimento";

/**
 * Quatro etapas, não cinco.
 *
 * A etapa "Onde" só tinha conteúdo quando o público era Clientes: para Equipe
 * e Somente eu, `escolherPublico` já forçava "em qualquer lugar" e
 * `documentoDoEstado` zerava as coleções de novo. Em dois dos três públicos
 * era uma tela inteira que não escrevia nada.
 *
 * Onde ela tinha conteúdo, a pergunta não era de organização e sim de
 * autorização: sem coleção externa o documento é salvo, aparece na lista de
 * quem escreveu, e o atendimento nunca o encontra. Isso pertence à mesma
 * decisão de "quem pode usar", e é onde ela agora mora.
 */
export const ETAPAS = [
  { numero: 1, rotulo: "O quê" },
  { numero: 2, rotulo: "Conteúdo" },
  { numero: 3, rotulo: "Quem usa" },
  { numero: 4, rotulo: "Revisar" },
];

export const ULTIMA_ETAPA = ETAPAS.length;

export const CAMINHOS_DE_ESCRITA = [
  {
    id: "guiado",
    rotulo: "Usar modelo guiado",
    descricao: "Campos prontos: você preenche e pronto.",
    recomendado: true,
  },
  {
    id: "texto",
    rotulo: "Escrever ou colar texto",
    descricao: "Um campo em branco. Cole de um documento que já existe, se preferir.",
  },
  {
    id: "arquivo",
    rotulo: "Enviar arquivo Markdown",
    descricao: "Já tem um .md pronto? Escolha o arquivo.",
  },
  {
    id: "perguntas",
    rotulo: "Criar perguntas e respostas",
    descricao: "Uma pergunta por vez, com a resposta ao lado. Bom para dúvidas repetidas.",
  },
];

export function estadoInicial(modeloId = null) {
  const modelo = modeloId ? MODELO_POR_ID.get(modeloId) : null;
  return {
    etapa: modeloId ? 2 : 1,
    modeloId: modeloId || null,
    caminhoDeEscrita: modelo?.perguntasERespostas ? "perguntas" : null,
    titulo: modelo?.rotulo || "",
    // Derivado do título por `sincronizarCaminho`. Fica vazio aqui e não com o
    // caminho do modelo porque dois documentos do mesmo assunto colidiriam:
    // todo "Sobre a empresa" queria ser `empresa/sobre.md`.
    caminho: "",
    // Vira `true` no instante em que alguém digita no campo avançado. A partir
    // daí o título deixa de mandar no caminho — trocar o título não pode
    // apagar uma escolha explícita.
    caminhoManual: false,
    // Preserve `lista`, `importante` e futuros metadados do modelo. Sem isso,
    // um campo "um item por linha" virava parágrafo corrido no Markdown.
    blocos: (modelo?.blocos || []).map((bloco) => ({ ...bloco, texto: "" })),
    perguntas: [{ pergunta: "", resposta: "" }],
    texto: "",
    publico: null,
    ondeTodos: true,
    colecoesIds: [],
  };
}

/**
 * O conteúdo final, venha ele de qual caminho vier.
 *
 * Os quatro caminhos desembocam no mesmo Markdown: é o que a etapa 2 promete
 * quando diz "todos os caminhos chegam no mesmo lugar".
 */
export function conteudoDoEstado(estado) {
  if (!estado) return "";
  if (estado.caminhoDeEscrita === "perguntas") {
    return montarMarkdown({
      titulo: estado.titulo,
      blocos: (estado.perguntas || [])
        .filter((item) => item.pergunta.trim() && item.resposta.trim())
        .map((item) => ({ rotulo: item.pergunta.trim(), texto: item.resposta.trim() })),
    });
  }
  if (estado.caminhoDeEscrita === "guiado") {
    return montarMarkdown({ titulo: estado.titulo, blocos: estado.blocos });
  }
  return estado.texto || "";
}

export function temConteudo(estado) {
  return conteudoDoEstado(estado).replace(/^#.*$/gm, "").trim().length > 0;
}

/**
 * Mantém o caminho colado no título, enquanto ninguém o tiver escolhido à mão.
 *
 * Passa por aqui toda mudança de estado do assistente. É de propósito: se a
 * derivação acontecesse só ao salvar, a etapa de revisão mostraria um caminho
 * e o banco receberia outro depois de a pessoa corrigir o título.
 */
export function sincronizarCaminho(estado, ocupados = []) {
  if (!estado || estado.caminhoManual) return estado;
  const caminho = derivarCaminho({
    titulo: estado.titulo,
    modeloId: estado.modeloId,
    ocupados,
  });
  return caminho === estado.caminho ? estado : { ...estado, caminho };
}

const PUBLICO_PARA_DOCUMENTO = {
  clientes: { escopo: "organization", audiencia: "external" },
  equipe: { escopo: "organization", audiencia: "internal" },
  pessoal: { escopo: "personal", audiencia: "internal" },
};

/** O rascunho no formato que `conhecimento.salvar` espera. */
export function documentoDoEstado(estado) {
  const destino = PUBLICO_PARA_DOCUMENTO[estado?.publico] || PUBLICO_PARA_DOCUMENTO.equipe;
  const caminho = String(estado?.caminho || "").trim();
  return {
    id: null,
    ...destino,
    titulo: String(estado?.titulo || "").trim(),
    caminho: caminho.endsWith(".md") ? caminho : `${caminho}.md`,
    conteudo: conteudoDoEstado(estado),
    // Escopo pessoal nunca entra em coleção: a coleção é o que expõe o
    // documento para fora, e pessoal por definição não sai.
    colecoesIds: estado?.publico === "pessoal" || (estado?.ondeTodos && estado?.publico !== "clientes")
      ? []
      : (estado?.colecoesIds || []),
    versao: 1,
    publicadoEm: null,
  };
}

/**
 * Por que esta etapa ainda não deixa avançar — ou `null` se deixa.
 *
 * Devolve o motivo em vez de um booleano porque a tela mostra a frase: um
 * botão apagado sem explicação faz a pessoa procurar o que ela esqueceu.
 */
export function motivoParaNaoAvancar(estado) {
  if (!estado) return "Comece escolhendo o assunto.";
  switch (estado.etapa) {
    case 1:
      return estado.modeloId ? null : "Escolha o assunto para continuar.";
    case 2:
      if (!estado.caminhoDeEscrita) return "Escolha como você quer escrever.";
      // Escrever acontece aqui, logo abaixo da escolha. Deixar passar vazio
      // só adiaria a mesma reclamação para a etapa 4, duas telas depois.
      return temConteudo(estado) ? null : "Escreva o conteúdo antes de continuar.";
    case 3:
      // A coleção externa NÃO trava o avanço, embora trave a publicação.
      // Guardar rascunho de conteúdo de cliente sem coleção é legítimo — ele
      // ainda não está no ar — e é o que `nucleo_knowledge_save` permite. A
      // versão de cinco etapas travava aqui e por isso esse caminho nunca era
      // alcançável pelo assistente, só pelo editor.
      if (!estado.publico) return "Escolha quem poderá usar este conteúdo.";
      return null;
    case 4:
      if (!String(estado.titulo || "").trim()) return "Dê um título ao documento.";
      if (!String(estado.caminho || "").trim()) return "Informe o caminho do arquivo.";
      if (!temConteudo(estado)) return "O documento está vazio.";
      return null;
    default:
      return null;
  }
}

/**
 * Por que ainda não dá para publicar — separado do avançar de propósito.
 *
 * Salvar como rascunho não exige coleção externa; publicar exige. É a mesma
 * regra da tela: sem coleção, o documento entra no ar e nenhum atendimento o
 * encontra, o que é pior do que continuar rascunho.
 */
export function motivoParaNaoPublicarAgora(estado, colecoes = []) {
  const pendente = motivoParaNaoAvancar({ ...estado, etapa: ULTIMA_ETAPA });
  if (pendente) return pendente;
  return motivoParaNaoPublicar(documentoDoEstado(estado), colecoes);
}

export function avancar(estado) {
  return { ...estado, etapa: Math.min(ULTIMA_ETAPA, estado.etapa + 1) };
}

export function voltar(estado) {
  return { ...estado, etapa: Math.max(1, estado.etapa - 1) };
}

export function estadoFoiAlterado(atual, inicial) {
  return JSON.stringify(atual) !== JSON.stringify(inicial);
}

/**
 * Troca o público mantendo a regra de coleção no mesmo lugar que os testes.
 * Conteúdo de cliente nunca usa “em qualquer lugar”: ele precisa de uma
 * coleção externa para o runtime saber em qual atendimento ou campanha entra.
 */
export function escolherPublico(estado, publico, colecoes = []) {
  if (publico === "clientes") {
    return {
      ...estado,
      publico,
      ondeTodos: false,
      colecoesIds: colecaoAutomatica("external", colecoes),
    };
  }
  return { ...estado, publico, ondeTodos: true, colecoesIds: [] };
}

/**
 * Trocar de assunto reescreve os campos que vieram do modelo anterior.
 *
 * Sem isto, escolher "Sobre a empresa", voltar e escolher "Suporte" deixaria
 * os blocos da empresa na tela — e o documento sairia com as perguntas
 * erradas embaixo do título certo.
 */
export function escolherModelo(estado, modeloId) {
  const modelo = MODELO_POR_ID.get(modeloId);
  if (!modelo) return estado;
  const tocouNoTitulo = estado.titulo && estado.modeloId && estado.titulo !== MODELO_POR_ID.get(estado.modeloId)?.rotulo;
  return {
    ...estado,
    modeloId,
    titulo: tocouNoTitulo ? estado.titulo : modelo.rotulo,
    // O caminho não vem mais do modelo: `sincronizarCaminho` o recalcula a
    // partir do título e da pasta do novo assunto. Copiar aqui faria todo
    // documento de "Sobre a empresa" disputar `empresa/sobre.md`.
    blocos: modelo.blocos.map((bloco) => ({ ...bloco, texto: "" })),
    caminhoDeEscrita: modelo.perguntasERespostas
      ? "perguntas"
      : modelo.blocos.length ? estado.caminhoDeEscrita : null,
  };
}
