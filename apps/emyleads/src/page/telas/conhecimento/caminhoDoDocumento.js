/**
 * O caminho do arquivo, derivado do título.
 *
 * Até aqui a etapa de revisão pedia o caminho num campo monoespaçado com
 * `empresa/sobre.md` de exemplo. É detalhe de armazenamento: quem escreve um
 * texto sobre a empresa não tem por que saber que existe um caminho, e sete
 * dos oito modelos já traziam o campo preenchido — o oitavo obrigava a
 * inventar um, sem nenhuma regra explicada. Era o único erro que a pessoa
 * podia cometer sozinha, e o banco recusava com o texto cru do Postgres.
 *
 * As regras aqui não são estéticas: são as constraints de
 * `knowledge_documents` (20260823010000, corrigidas em 20260829150000).
 * O caminho não pode começar com `/`, precisa terminar em `.md`, não pode
 * conter `..` nem `//`, e tem de caber entre 4 e 500 caracteres. O slug produz
 * apenas `[a-z0-9-]`, então as três primeiras são satisfeitas por construção —
 * não por validação depois do fato.
 *
 * TEM GÊMEO: `slug()` em `web/intelligenceProvider.js` faz a mesma
 * normalização para nomes de coleção e skill. As duas raízes de build não se
 * importam, então não dá para compartilhar. Mudou aqui, veja lá.
 */

import { MODELO_POR_ID } from "./modelosConhecimento";

/** Sem o `.md`, o limite de 500 do banco não fecha. */
const LIMITE_DO_CAMINHO = 500;
const NOME_QUANDO_VAZIO = "documento";

/**
 * Título vira nome de arquivo.
 *
 * `Preços & Condições (2026)` vira `precos-condicoes-2026`. Acento sai pela
 * decomposição NFD, e tudo que não é letra ou dígito vira hífen — inclusive a
 * barra, que separaria pasta e criaria um nível que ninguém pediu.
 */
export function slugDoTitulo(titulo) {
  const limpo = String(titulo || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return limpo || NOME_QUANDO_VAZIO;
}

/**
 * A pasta que o modelo sugere.
 *
 * Sai do próprio `caminho` do modelo — `comercial/servicos.md` vira
 * `comercial`. Guardar a pasta num campo separado duplicaria a informação e
 * deixaria os dois divergirem na primeira edição.
 */
export function pastaDoModelo(modeloId) {
  const caminho = MODELO_POR_ID.get(modeloId)?.caminho || "";
  const corte = caminho.lastIndexOf("/");
  return corte > 0 ? caminho.slice(0, corte) : "";
}

/** Normaliza para comparação: o índice único do banco é sobre `lower(path)`. */
const chave = (caminho) => String(caminho || "").trim().toLowerCase();

/**
 * O caminho livre mais próximo do desejado.
 *
 * A colisão é resolvida aqui e não pelo banco porque o erro do banco chega
 * como violação de índice único, três telas depois de a pessoa ter digitado o
 * título — e a saída que ela teria seria adivinhar um título diferente.
 *
 * `ocupados` são os caminhos que já existem na organização. `exceto` é o
 * caminho do próprio documento quando se está editando: sem ele, salvar um
 * documento em cima dele mesmo empurraria o caminho para `-2` a cada gravação.
 */
export function caminhoDisponivel(desejado, ocupados = [], { exceto = null } = {}) {
  const tomados = new Set(
    ocupados.map(chave).filter((item) => item && item !== chave(exceto)),
  );
  const base = String(desejado || "").replace(/\.md$/i, "");
  for (let sufixo = 1; sufixo < 1000; sufixo += 1) {
    const tentativa = `${base}${sufixo === 1 ? "" : `-${sufixo}`}.md`;
    if (!tomados.has(chave(tentativa))) return tentativa;
  }
  // Mil documentos com o mesmo título é cenário de importação em massa, não de
  // alguém escrevendo. O carimbo garante saída em vez de laço infinito.
  return `${base}-${Date.now()}.md`;
}

/**
 * O caminho que o sistema escolhe sozinho, a partir do que a pessoa escreveu.
 *
 * Corta antes do limite do banco preservando o `.md`: cortar depois faria o
 * documento ser recusado por um título longo, que é uma escolha legítima.
 */
export function derivarCaminho({ titulo, modeloId, ocupados = [], exceto = null } = {}) {
  const pasta = pastaDoModelo(modeloId);
  const nome = slugDoTitulo(titulo);
  const prefixo = pasta ? `${pasta}/` : "";
  const espaco = LIMITE_DO_CAMINHO - prefixo.length - ".md".length - "-999".length;
  const desejado = `${prefixo}${nome.slice(0, Math.max(1, espaco))}`;
  return caminhoDisponivel(desejado, ocupados, { exceto });
}
