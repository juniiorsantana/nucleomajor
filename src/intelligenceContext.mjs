/**
 * O que do contexto de inteligência entra no prompt do assistente web.
 *
 * `intelligence_internal_context` devolve o payload completo da Fase H, e o
 * servidor o despejava inteiro com `JSON.stringify` no bloco `system`. Dentro
 * dele vem `skillsPermitidos`, com o `spec` integral de TODAS as skills
 * habilitadas — incluindo o `instructionsMarkdown` de cada uma — mais o `spec`
 * da skill ativa repetido em `skillAtivo`. São dezenas de KB por mensagem,
 * reenviados a cada rodada de ferramenta, mesmo quando nenhuma skill é usada.
 *
 * O assistente web não executa skill: as ferramentas dele são `ler_documento`
 * e `propor_evento`, e mais nenhuma. As instruções operacionais das skills
 * descrevem fluxos de WhatsApp que ele não conduz — além de caras, elas
 * confundem. O que sobra aqui é o que muda a resposta: quem ele é, em que
 * contexto comercial está, que limites respeita e o que tem permissão de
 * alcançar.
 *
 * A poda é do lado do servidor de propósito. Podar no banco mudaria o formato
 * que `nucleo_intelligence_context_resolve_v2` entrega ao runtime da VPS, que
 * é outro repositório e outro ciclo de implantação. Aqui o efeito é local,
 * imediato e reversível.
 */

/** Só as chaves com valor: `null` e `[]` no prompt são bytes que não informam. */
function comValor(objeto) {
  const saida = {};
  for (const [chave, valor] of Object.entries(objeto)) {
    if (valor === null || valor === undefined || valor === "") continue;
    if (Array.isArray(valor) && valor.length === 0) continue;
    saida[chave] = valor;
  }
  return Object.keys(saida).length ? saida : null;
}

const texto = (valor) => (typeof valor === "string" && valor.trim() ? valor.trim() : null);

const listaDeTextos = (valor) =>
  Array.isArray(valor) ? valor.filter((item) => typeof item === "string" && item.trim()) : [];

/**
 * A skill ativa, sem o corpo que só o runtime de WhatsApp usa.
 *
 * `guardrails` e `handoff` ficam porque são limites de comportamento e valem
 * em qualquer canal. `instructionsMarkdown` e `workflow` saem: descrevem
 * etapas, ferramentas e transições que este assistente não tem como executar.
 */
function skillAtivaParaPrompt(skill) {
  if (!skill || typeof skill !== "object") return null;
  return comValor({
    nome: texto(skill.nome),
    objetivo: texto(skill.spec?.objective),
    limites: listaDeTextos(skill.spec?.guardrails),
    transferirQuando: listaDeTextos(skill.spec?.handoff),
  });
}

/**
 * A campanha, sem o `configuracao`.
 *
 * `configuration` é um jsonb livre, usado pelo runtime para parâmetros
 * operacionais. Não há garantia de que seja pequeno nem de que signifique algo
 * para o modelo.
 */
function campanhaParaPrompt(campanha) {
  if (!campanha || typeof campanha !== "object") return null;
  return comValor({
    nome: texto(campanha.nome),
    objetivo: texto(campanha.objetivo),
    oferta: texto(campanha.oferta),
    publico: texto(campanha.publico),
    resultadoEsperado: texto(campanha.resultadoEsperado),
  });
}

/**
 * O contexto que vai para o prompt.
 *
 * Devolve `null` quando não há nada de útil: o servidor então omite a linha
 * inteira, em vez de escrever "Contexto de inteligência autorizado: {}".
 */
export function contextoParaPrompt(payload) {
  if (!payload || typeof payload !== "object") return null;

  const assistente = comValor({
    nome: texto(payload.assistente?.nome),
    tom: texto(payload.assistente?.tom),
  });

  // Só os nomes. A instrução do sistema diz "use somente os skills listados", e
  // uma lista de nomes cumpre isso; o `spec` de cada uma não muda a resposta de
  // um assistente que não executa nenhuma delas.
  const skillsDisponiveis = Array.isArray(payload.skillsPermitidos)
    ? payload.skillsPermitidos.map((item) => texto(item?.nome)).filter(Boolean)
    : [];

  const colecoes = Array.isArray(payload.colecoesPermitidas)
    ? payload.colecoesPermitidas.map((item) => texto(item?.nome)).filter(Boolean)
    : [];

  return comValor({
    audiencia: texto(payload.audiencia),
    assistente,
    campanha: campanhaParaPrompt(payload.campanha),
    skillAtiva: skillAtivaParaPrompt(payload.skillAtivo),
    skillsDisponiveis,
    conhecimentoAlcancavel: colecoes,
    politicas: payload.politicas && typeof payload.politicas === "object" ? payload.politicas : null,
  });
}
