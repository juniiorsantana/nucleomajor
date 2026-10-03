/**
 * A chave entre o painel antigo e o painel novo (Sistema Grafite).
 *
 * Cada pessoa escolhe no próprio navegador; a escolha fica guardada e vale
 * até ela trocar de novo. `?painel=novo` (ou `antigo`) na URL escolhe também,
 * para mandar o link de teste a alguém.
 *
 * Desde 03/10/2026 (etapa A) o padrão é o NOVO, e o antigo virou a rede de
 * segurança do botão "Voltar ao painel antigo". A chave mudou de nome junto:
 * quem tinha guardado "antigo" na chave de antes (`nucleo.painel`) também
 * passa para o novo, em vez de ficar preso no antigo sem saber que o padrão
 * mudou. Etapa B: apagar o painel antigo, esta chave e o botão.
 *
 * O painel antigo é a cópia congelada do portal de 02/10/2026
 * (src/page-classico). Correção nova vai só no painel novo; quando todos
 * migrarem, apaga-se a pasta e esta chave.
 */

export const CHAVE_DO_PAINEL = "nucleo.painel.v2";
export const PAINEIS = ["antigo", "novo"];
export const PAINEL_PADRAO = "novo";

const valido = (valor) => (PAINEIS.includes(valor) ? valor : null);

/** O painel desta visita: o da URL, senão o guardado, senão o padrão. */
export function painelEscolhido({ url = globalThis.location?.href, armazenamento = globalThis.localStorage } = {}) {
  let daUrl = null;
  try {
    daUrl = valido(new URL(url).searchParams.get("painel"));
  } catch {
    daUrl = null;
  }
  if (daUrl) {
    guardarPainel(daUrl, armazenamento);
    return daUrl;
  }
  try {
    return valido(armazenamento?.getItem(CHAVE_DO_PAINEL)) || PAINEL_PADRAO;
  } catch {
    return PAINEL_PADRAO;
  }
}

/** Guarda a escolha. Navegador que não guarda (aba anônima bloqueada) só não lembra. */
export function guardarPainel(painel, armazenamento = globalThis.localStorage) {
  try {
    armazenamento?.setItem(CHAVE_DO_PAINEL, painel);
  } catch {
    // Sem armazenamento, a escolha vale só pela URL.
  }
}

/** O outro painel: o que o botão oferece. */
export const outroPainel = (painel) => (painel === "novo" ? "antigo" : "novo");
