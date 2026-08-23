/**
 * Respostas rápidas com variáveis.
 *
 * Portado do major-contacts-v2. O sorteio por baralho continua aqui mesmo sem
 * disparo em massa: variar a abordagem tem valor em atendimento também, e é o
 * mesmo código.
 */

export const primeiroNome = (nome) => {
  const n = String(nome || "").trim().split(/\s+/)[0] || "";
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : "";
};

export function renderizar(texto, contato = {}) {
  return String(texto || "")
    .replace(/\{nome\}/gi, primeiroNome(contato.nome))
    .replace(/\{empresa\}/gi, contato.empresa || "")
    .replace(/ {2,}/g, " ")
    .trim();
}

/**
 * Sorteio "baralho embaralhado": tira uma variação entre as ainda não usadas e
 * a remove; quando o baralho esvazia, volta com todas. Evita repetir a mesma
 * variação em sequência sem virar um rodízio previsível.
 *
 * Devolve também o próximo baralho, para quem chamou persistir — a função não
 * guarda estado.
 */
export function sortearVariacao(modelo) {
  const ids = modelo.variacoes.map((v) => v.id);
  let baralho = (modelo.baralho || []).filter((id) => ids.includes(id));
  if (!baralho.length) baralho = ids;
  const escolhido = baralho[Math.floor(Math.random() * baralho.length)];
  return {
    variacao: modelo.variacoes.find((v) => v.id === escolhido),
    baralho: baralho.filter((id) => id !== escolhido),
  };
}
