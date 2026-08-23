/**
 * Telefone em formato canônico: só dígitos, com DDI, sem "+".
 * Ex.: (65) 99217-8164 → "5565992178164"
 */

export function normalizePhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return null;
  d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = "55" + d; // veio sem DDI
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return d;
  if (d.length >= 11 && d.length <= 15) return d; // internacional
  return null;
}

export function formatPhone(p) {
  if (p && p.startsWith("55") && (p.length === 12 || p.length === 13)) {
    const ddd = p.slice(2, 4);
    const resto = p.slice(4);
    return `(${ddd}) ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`;
  }
  return "+" + p;
}

/**
 * As duas formas que um celular brasileiro pode ter dentro do WhatsApp.
 *
 * O nono dígito é a maior fonte de falso negativo em qualquer CRM de WhatsApp
 * no Brasil: o número que se escreve (65) 99217-8164 pode viver na conta como
 * `556592178164`, sem o 9 — e uma busca pelo que o usuário digitou nunca
 * acharia. Em vez de escolher uma forma e torcer, geramos as duas e casamos
 * por qualquer uma.
 *
 * Isto é para BUSCA. O que se grava continua sendo o que `normalizePhone`
 * devolveu — inventar dígito no dado guardado seria pior que o problema.
 *
 * @returns {string[]} formas possíveis, sem repetição, a canônica primeiro
 */
export function variantesBR(telefone) {
  const p = normalizePhone(telefone);
  if (!p) return [];
  if (!p.startsWith("55")) return [p];

  const ddd = p.slice(2, 4);
  const local = p.slice(4);
  const formas = new Set([p]);

  // 9 dígitos começando com 9 → também existe a forma antiga, de 8
  if (local.length === 9 && local.startsWith("9")) {
    formas.add("55" + ddd + local.slice(1));
  }

  // 8 dígitos em faixa de celular (6 a 9) → também existe a forma com o 9
  if (local.length === 8 && /^[6-9]/.test(local)) {
    formas.add("55" + ddd + "9" + local);
  }

  return [...formas];
}
