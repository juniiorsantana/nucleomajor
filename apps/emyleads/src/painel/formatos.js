/**
 * Como o painel da plataforma lê o que o banco devolve. Tudo aqui é puro e
 * testado: é onde "cancelada" vira "pago até 21/12 · sem renovação", e um
 * rótulo errado neste arquivo é o dono decidindo em cima de informação errada.
 */

const FUSO = "America/Sao_Paulo";
const DIA_MS = 86_400_000;

export function formatarData(valor) {
  if (!valor) return "—";
  return new Date(valor).toLocaleDateString("pt-BR", { timeZone: FUSO });
}

export function formatarDataHora(valor) {
  if (!valor) return "—";
  return new Date(valor).toLocaleString("pt-BR", { timeZone: FUSO, dateStyle: "short", timeStyle: "short" });
}

/** Dias inteiros até `fim`, arredondando para cima; negativo se já passou. */
export function diasAte(fim, agora = Date.now()) {
  if (!fim) return null;
  return Math.ceil((new Date(fim).getTime() - agora) / DIA_MS);
}

/**
 * A situação da empresa numa frase e num tom.
 *
 * `estado` é o que o banco calcula (`ok`, `past_due`, `blocked`) e é ele que
 * decide se o cliente entra. `status` só explica o porquê: `canceled` com
 * data futura é o "pago até, sem renovação" da liberação por prazo; `active`
 * não bloqueia por data.
 */
export function situacao(empresa, agora = Date.now()) {
  if (empresa.estado === "blocked") {
    if (!empresa.status) return { rotulo: "Sem assinatura", tom: "perigo" };
    return { rotulo: empresa.fimDoPeriodo ? `Bloqueada desde ${formatarData(empresa.fimDoPeriodo)}` : "Bloqueada", tom: "perigo" };
  }
  if (empresa.estado === "past_due") return { rotulo: "Pagamento em atraso", tom: "atencao" };
  if (empresa.status === "canceled" && empresa.fimDoPeriodo) {
    const dias = diasAte(empresa.fimDoPeriodo, agora);
    return {
      rotulo: `Pago até ${formatarData(empresa.fimDoPeriodo)} · sem renovação`,
      tom: dias !== null && dias <= 7 ? "atencao" : "ok",
    };
  }
  if (empresa.status === "trialing") return { rotulo: "Em teste", tom: "ok" };
  return { rotulo: "Ativa", tom: "ok" };
}

/** O alerta da lista: acesso que acaba sozinho em até 7 dias. */
export function venceEmBreve(empresa, agora = Date.now()) {
  if (empresa.estado === "blocked" || empresa.status !== "canceled") return false;
  const dias = diasAte(empresa.fimDoPeriodo, agora);
  return dias !== null && dias >= 0 && dias <= 7;
}

export const ORIGEM = {
  manual: "Liberação manual",
  payment: "Asaas",
  migration: "Casa (Major)",
  partner: "Parceiro",
};

export function ehDoAsaas(empresa, vendas = []) {
  return empresa?.origem === "payment" || vendas.some((venda) => ["active", "past_due"].includes(venda.status));
}

// Do menor para o maior. Plano desconhecido fica no meio, para nunca passar
// sem o aviso de rebaixamento.
const ORDEM_DOS_PLANOS = { base: 1, atendimento: 2, completo: 3, full: 4 };

export function ehRebaixamento(de, para) {
  const origem = ORDEM_DOS_PLANOS[de] ?? 2.5;
  const destino = ORDEM_DOS_PLANOS[para] ?? 2.5;
  return destino < origem;
}

/**
 * A nova data de fim para "+N dias". Conta a partir do fim atual quando ele
 * ainda está no futuro — estender 30 dias um acesso que vai até dia 20 leva
 * ao dia 20 do mês seguinte, e não a 30 dias de hoje — e termina às 23:59 de
 * Brasília, que é como o dono pensa "até o dia X".
 */
export function fimMaisDias(fimAtual, dias, agora = Date.now()) {
  const base = fimAtual && new Date(fimAtual).getTime() > agora ? new Date(fimAtual).getTime() : agora;
  const alvo = new Date(base + dias * DIA_MS);
  return fimDoDia(alvo.toLocaleDateString("en-CA", { timeZone: FUSO }));
}

/** `AAAA-MM-DD` (o valor de um `<input type="date">`) às 23:59:59 de Brasília. */
export function fimDoDia(data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ""))) return null;
  return `${data}T23:59:59-03:00`;
}

const ligadaOuNao = (valor) => (valor === true ? "ligada" : valor === false ? "desligada" : "—");

export function descreverValor(item, valor) {
  if (item?.kind === "limit") {
    if (valor === null || valor === undefined) return "sem limite";
    return item.key === "connections" ? `${valor} ${valor === 1 ? "número" : "números"}` : String(valor);
  }
  return ligadaOuNao(valor);
}

/** Uma linha do histórico em português. */
export function descreverAcao(linha) {
  const antes = linha.antes || {};
  const depois = linha.depois || {};
  switch (linha.acao) {
    case "entitlement.set": {
      const valor = depois.limit_value !== undefined && depois.enabled === null
        ? `limite ${depois.limit_value ?? "sem limite"}`
        : ligadaOuNao(depois.enabled);
      const prazo = depois.expires_at ? ` até ${formatarData(depois.expires_at)}` : "";
      return `${linha.alvo}: ${valor}${prazo}`;
    }
    case "entitlement.clear":
      return `${linha.alvo}: voltou ao plano`;
    case "subscription.set_period":
      return depois.status === "active"
        ? `Período até ${formatarData(depois.current_period_ends_at)}, com renovação`
        : `Pago até ${formatarData(depois.current_period_ends_at)}, sem renovação`;
    case "subscription.end_now":
      return "Acesso encerrado";
    case "subscription.set_plan":
      return `Plano: ${antes.plan_code || "?"} → ${depois.plan_code || linha.alvo}`;
    default:
      return linha.acao;
  }
}
