/**
 * O link do e-mail de ativação: `/app/ativar?codigo=NM..&email=..`.
 *
 * Quem pagou chega por ele sem conta ainda. O código precisa sobreviver a três
 * passos — criar a conta, confirmar o e-mail, ativar a empresa — e o segundo
 * pode abrir em outra aba. Por isso ele vai para o `sessionStorage` desta aba E
 * volta no endereço de retorno da confirmação (`linkDeRetorno`).
 *
 * O `sessionStorage` pode não existir (janela anônima, armazenamento
 * bloqueado): aí o código vive só no endereço, e tudo continua funcionando na
 * mesma aba.
 */

const CHAVE_ATIVACAO = "emyleads.ativacao.pendente";

export function normalizarCodigo(valor) {
  const compacto = String(valor || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^NM[0-9A-F]{12}$/.test(compacto)) return "";
  return `${compacto.slice(0, 4)}-${compacto.slice(4, 8)}-${compacto.slice(8, 12)}-${compacto.slice(12, 14)}`;
}

function janelaPadrao() {
  return typeof window !== "undefined" ? window : null;
}

export function lerAtivacaoDaUrl(janela = janelaPadrao()) {
  const local = janela?.location;
  if (!local || !/\/ativar\/?$/.test(local.pathname || "")) return null;
  const parametros = new URLSearchParams(local.search || "");
  const codigo = normalizarCodigo(parametros.get("codigo"));
  if (!codigo) return null;
  const email = String(parametros.get("email") || "").trim().toLowerCase();
  const ativacao = { codigo, email };
  try {
    janela.sessionStorage.setItem(CHAVE_ATIVACAO, JSON.stringify(ativacao));
  } catch {
    // Sem armazenamento: segue só com o que está em memória.
  }
  try {
    // Tira o código da barra de endereço e do histórico desta aba.
    janela.history.replaceState(null, "", local.pathname.replace(/ativar\/?$/, ""));
  } catch {
    // Sem history (teste, extensão): o endereço fica como está.
  }
  return ativacao;
}

export function ativacaoGuardada(janela = janelaPadrao()) {
  try {
    const bruto = janela?.sessionStorage?.getItem(CHAVE_ATIVACAO);
    if (!bruto) return null;
    const salvo = JSON.parse(bruto);
    const codigo = normalizarCodigo(salvo?.codigo);
    return codigo ? { codigo, email: String(salvo?.email || "").trim().toLowerCase() } : null;
  } catch {
    return null;
  }
}

export function esquecerAtivacao(janela = janelaPadrao()) {
  try {
    janela?.sessionStorage?.removeItem(CHAVE_ATIVACAO);
  } catch {
    // Nada guardado, nada a esquecer.
  }
}

export function linkDeRetorno(ativacao, janela = janelaPadrao()) {
  const origem = janela?.location?.origin;
  if (!ativacao?.codigo || !/^https?:\/\//.test(origem || "")) return "";
  const url = new URL(`${origem}/app/ativar`);
  url.searchParams.set("codigo", ativacao.codigo);
  if (ativacao.email) url.searchParams.set("email", ativacao.email);
  return url.toString();
}

// O Link de Pagamento do Asaas, publicado pelo servidor em /api/config.
export function linkDeCompra() {
  const url = String(globalThis.__NUCLEO_CONFIG__?.checkoutUrl || "").trim();
  return /^https:\/\//i.test(url) ? url : "";
}
