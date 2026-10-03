/**
 * As derivações da tela de Conhecimento.
 *
 * A tela antiga navegava pelo escopo técnico do banco — Organização, Equipe,
 * Meu espaço. Quem escreve não pensa assim: pensa em QUEM vai poder usar o
 * texto e SE ele já está no ar. Os dois eixos daqui em diante são público e
 * situação; o `scope_type` continua no banco, só deixa de ser a porta.
 *
 * Nada aqui inventa campo. Público sai de `audiencia` + `escopo`, situação sai
 * de `publicadoEm`, e a revisão sai de `atualizadoEm` — tudo já vem do
 * `mapDocument` do provider.
 */

export const PUBLICOS = [
  {
    id: "clientes",
    rotulo: "Clientes",
    // O texto que aparece ao lado da escolha. Diz a consequência, não a
    // categoria: "externo" não significa nada para quem nunca configurou IA.
    consequencia: "O assistente de atendimento pode repetir isto para quem escrever no WhatsApp.",
  },
  {
    id: "equipe",
    rotulo: "Equipe",
    consequencia: "Fica disponível para os profissionais autorizados da empresa. O assistente de cliente não usa.",
  },
  {
    id: "pessoal",
    rotulo: "Somente eu",
    consequencia: "Só você vê e só o seu assistente usa. Nem administradores leem.",
  },
];

export const PUBLICO_POR_ID = new Map(PUBLICOS.map((item) => [item.id, item]));

/** Dias sem alteração a partir dos quais o documento entra em "precisa de revisão". */
export const DIAS_PARA_REVISAR = 30;

const DIA_EM_MS = 86400000;

export function publicoDoDocumento(documento) {
  if (!documento) return "equipe";
  if (documento.escopo === "personal") return "pessoal";
  return documento.audiencia === "external" ? "clientes" : "equipe";
}

/**
 * Rascunho é `publicadoEm` nulo — e vale para os três públicos.
 *
 * Antes desta tela, `published_at` era escrito como função da audiência: todo
 * documento externo nascia publicado e todo interno nascia nulo. Publicar e
 * "ser externo" eram a mesma coisa. Aqui os dois eixos se separam, e é por
 * isso que a migration que acompanha esta tela preenche `published_at` no
 * acervo interno que já existe — senão tudo que está no ar hoje apareceria
 * como rascunho de um dia para o outro.
 */
export function situacaoDoDocumento(documento) {
  return documento?.publicadoEm ? "publicado" : "rascunho";
}

export function diasSemAlteracao(documento, agora = Date.now()) {
  const marca = Date.parse(documento?.atualizadoEm || "");
  if (Number.isNaN(marca)) return 0;
  return Math.floor((agora - marca) / DIA_EM_MS);
}

/**
 * Só documento publicado precisa de revisão.
 *
 * Rascunho parado não está sendo usado por ninguém, então cobrar revisão dele
 * seria barulho: a lista encheria de aviso vermelho para texto que ainda nem
 * entrou no ar.
 */
export function precisaRevisao(documento, agora = Date.now(), dias = DIAS_PARA_REVISAR) {
  if (situacaoDoDocumento(documento) !== "publicado") return false;
  return diasSemAlteracao(documento, agora) >= dias;
}

export function resumo(documentos = [], agora = Date.now()) {
  const total = { clientes: 0, equipe: 0, pessoal: 0, rascunhos: 0, publicados: 0, revisao: 0, todos: 0 };
  for (const documento of documentos) {
    total.todos += 1;
    total[publicoDoDocumento(documento)] += 1;
    if (situacaoDoDocumento(documento) === "rascunho") total.rascunhos += 1;
    else total.publicados += 1;
    if (precisaRevisao(documento, agora)) total.revisao += 1;
  }
  return total;
}

/** Os filtros da barra, na ordem em que aparecem. */
export const FILTROS = [
  { id: "todos", rotulo: "Todos" },
  { id: "clientes", rotulo: "Clientes" },
  { id: "equipe", rotulo: "Equipe" },
  { id: "pessoal", rotulo: "Pessoal" },
  { id: "rascunhos", rotulo: "Rascunhos" },
  { id: "publicados", rotulo: "Publicados" },
  { id: "revisao", rotulo: "Precisam de revisão" },
];

function atendeAoFiltro(documento, filtro, agora) {
  if (filtro === "todos") return true;
  if (filtro === "rascunhos") return situacaoDoDocumento(documento) === "rascunho";
  if (filtro === "publicados") return situacaoDoDocumento(documento) === "publicado";
  if (filtro === "revisao") return precisaRevisao(documento, agora);
  return publicoDoDocumento(documento) === filtro;
}

export function filtrar(documentos = [], { filtro = "todos", busca = "", agora = Date.now() } = {}) {
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  return documentos.filter((documento) => {
    if (!atendeAoFiltro(documento, filtro, agora)) return false;
    if (!termo) return true;
    const alvo = `${documento.titulo} ${documento.caminho} ${documento.conteudo}`;
    return alvo.toLocaleLowerCase("pt-BR").includes(termo);
  });
}

/**
 * A linha de apoio embaixo do título.
 *
 * `knowledge_documents` não tem campo de descrição, e inventar um exigiria
 * migration para algo que o próprio texto já responde. Então vem do conteúdo:
 * a primeira linha que não é título nem marcação de lista.
 */
export function resumoDoConteudo(conteudo = "", limite = 92) {
  for (const bruta of String(conteudo).split("\n")) {
    const linha = bruta.trim();
    if (!linha || linha.startsWith("#") || linha.startsWith(">") || linha.startsWith("---")) continue;
    const limpa = linha.replace(/^[-*+]\s+/, "").replace(/[*_`]/g, "").trim();
    if (!limpa) continue;
    return limpa.length > limite ? `${limpa.slice(0, limite).trimEnd()}…` : limpa;
  }
  return "";
}

/**
 * "há 3 dias", "ontem", "há 1 semana" — o formato que a lista usa.
 *
 * Data absoluta obriga a pessoa a calcular; o que ela quer saber olhando a
 * lista é se o texto é recente ou está encostado.
 */
export function tempoRelativo(iso, agora = Date.now()) {
  const marca = Date.parse(iso || "");
  if (Number.isNaN(marca)) return "";
  const segundos = Math.max(0, Math.floor((agora - marca) / 1000));
  if (segundos < 60) return "agora";
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} ${horas === 1 ? "hora" : "horas"}`;
  const dias = Math.floor(horas / 24);
  if (dias === 1) return "ontem";
  if (dias < 14) return `há ${dias} dias`;
  const semanas = Math.floor(dias / 7);
  if (dias < 30) return `há ${semanas} semanas`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return `há ${meses} ${meses === 1 ? "mês" : "meses"}`;
  const anos = Math.floor(dias / 365);
  return `há ${anos} ${anos === 1 ? "ano" : "anos"}`;
}
