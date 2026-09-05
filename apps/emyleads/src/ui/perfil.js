/**
 * Como uma pessoa se chama e de que cor ela é.
 *
 * Espelha as colunas de `public.profiles` (`20260829120000_perfil_pessoal.sql`)
 * e existe para que nenhuma tela precise decidir sozinha o que fazer quando o
 * perfil vem incompleto — que é o caso de todo mundo que entrou antes desta
 * tela existir. Se cada tela improvisar o seu fallback, a mesma pessoa aparece
 * com nome e cor diferentes em lugares diferentes, que é justamente o defeito
 * que a identidade única deveria acabar.
 */

/**
 * As oito cores oferecidas na escolha.
 *
 * Saem de `CORES_SUGERIDAS` em Configurações, e de propósito: a paleta do
 * produto já é essa, e inventar uma segunda faria a agenda pintada por pessoa
 * brigar com o funil pintado por estágio.
 *
 * Com UMA troca. Lá o verde é `#16a34a`, que aqui não serve por dois motivos
 * medidos: contra o branco das iniciais ele dá 3.30:1, abaixo do mínimo de
 * 4.5:1 — as outras sete ficam entre 4.83 e 6.20 —, e ele é o token
 * `--el-success`, então um avatar verde-sucesso diria "deu certo" em vez de
 * dizer "é o Lucas". `#15803d` fecha 5.02:1 e continua sendo verde.
 *
 * O contraste importa porque avatar colorido tem a letra em branco por cima
 * (ver `Iniciais`), e não é decoração: é como se reconhece de relance quem
 * está naquela linha.
 */
export const CORES_DE_PESSOA = [
  "#4f3cfc",
  "#0369a1",
  "#15803d",
  "#b45309",
  "#dc2626",
  "#7c3aed",
  "#0f766e",
  "#667085",
];

/**
 * O cinza fica fora do sorteio.
 *
 * Ele continua escolhível para quem quer discrição, mas cor derivada é a que a
 * pessoa recebe sem ter pedido: um avatar cinza parece desativado, e ninguém
 * associa "desativado" a uma escolha que não fez.
 */
const CORES_SORTEAVEIS = CORES_DE_PESSOA.slice(0, 7);

/**
 * Cor estável a partir do id.
 *
 * Determinística porque o mesmo rosto precisa ter a mesma cor em toda sessão,
 * em toda máquina e para todo mundo da equipe — cor sorteada em memória mudaria
 * a cada recarga e não serviria para reconhecer ninguém.
 *
 * Exportada porque `domain/agents.js` reusa exatamente este algoritmo para o
 * avatar dos agentes (`corDoAgent`, a partir do `id` do agente): um agente não
 * tem coluna de cor escolhida — é sempre derivada —, mas precisa da MESMA
 * garantia de estabilidade que uma pessoa tem, e duplicar o hash aqui
 * divergiria da paleta na primeira mudança de uma das duas.
 */
export function corDerivada(id) {
  const texto = String(id || "");
  if (!texto) return CORES_SORTEAVEIS[0];
  let soma = 0;
  for (let i = 0; i < texto.length; i++) soma = (soma * 31 + texto.charCodeAt(i)) >>> 0;
  return CORES_SORTEAVEIS[soma % CORES_SORTEAVEIS.length];
}

/** A cor escolhida, ou a derivada do id enquanto ninguém escolheu. */
export const corDaPessoa = (perfil) => {
  const escolhida = String(perfil?.color || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(escolhida)) return escolhida.toLowerCase();
  return corDerivada(perfil?.id);
};

/**
 * O primeiro nome, que é o que serve de apelido quando ninguém escreveu um.
 *
 * Desiste diante de um e-mail em vez de tentar limpá-lo. Quem entrou por
 * convite sem preencher o perfil pode ter o endereço no lugar do nome, e
 * arrancar os caracteres proibidos de "junior@majorhub.com" produz
 * "juniormajorhubcom" — uma palavra que não é o nome de ninguém e é pior que o
 * e-mail inteiro, que ao menos é verdade. Sem primeiro nome, `nomeCurto` cai
 * para o texto original.
 */
function primeiroNome(nomeCompleto) {
  const texto = String(nomeCompleto || "").trim();
  if (!texto || texto.includes("@")) return "";
  const partes = texto
    .split(/\s+/)
    .map((parte) => parte.replace(/[^\p{L}\p{M}'-]/gu, ""))
    .filter(Boolean);
  return partes[0] || "";
}

/**
 * O nome curto — o que aparece no cartão do lead, na bolha do chat e no bloco
 * da agenda, onde `full_name` não cabe.
 *
 * A ordem do fallback é escolha, primeiro nome, nome completo, e só então o
 * genérico: cada degrau é mais impreciso que o anterior, mas todos são melhores
 * que um espaço vazio onde deveria haver gente.
 */
export const nomeCurto = (perfil, vazio = "Sem nome") => {
  const escolhido = String(perfil?.display_name || "").trim();
  if (escolhido) return escolhido;
  return primeiroNome(perfil?.full_name) || String(perfil?.full_name || "").trim() || vazio;
};

/** O nome por extenso, para a Equipe e os registros. */
export const nomeCompleto = (perfil, vazio = "Sem nome no perfil") =>
  String(perfil?.full_name || "").trim() || vazio;

/** Limite de `profiles_display_name_length`, para a tela avisar antes do banco. */
export const LIMITE_NOME_CURTO = 40;
