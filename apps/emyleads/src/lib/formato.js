/** Formatação de data, hora e dinheiro. Sempre pt-BR. */

const DIA = 24 * 60 * 60 * 1000;

/**
 * Aceita tanto o número em milissegundos quanto o texto ISO do Supabase.
 *
 * O modelo local guarda data como número; o que vem direto do Postgres (por
 * exemplo `organization_members.joined_at`) chega como texto ISO. Sem esta
 * conversão a subtração vira `NaN` e a tela mostra "há NaN anos" — que foi
 * exatamente o que apareceu na primeira vez que a tela de Equipe renderizou.
 */
const instante = (valor) => {
  if (typeof valor === "number") return valor;
  const parseado = Date.parse(valor);
  return Number.isNaN(parseado) ? null : parseado;
};

export function fmtRelativo(entrada, agora = Date.now()) {
  const ts = entrada == null ? null : instante(entrada);
  if (ts == null) return "—";
  const delta = ts - agora;
  if (delta > 0) return "agora";
  const distancia = Math.max(0, agora - ts);
  if (distancia < 60 * 1000) return "agora";
  const minutos = Math.floor(distancia / (60 * 1000));
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  if (dias < 30) return `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return `há ${meses} ${meses === 1 ? "mês" : "meses"}`;
  const anos = Math.floor(meses / 12);
  return `há ${anos} ${anos === 1 ? "ano" : "anos"}`;
}

export const fmtMoeda = (v) =>
  v == null
    ? ""
    : v.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        maximumFractionDigits: v % 1 === 0 ? 0 : 2,
      });

export const fmtData = (ts) =>
  ts == null
    ? ""
    : new Date(ts).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
      });

export const fmtDataHora = (ts) =>
  ts == null
    ? ""
    : new Date(ts).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });

const mesmoDia = (a, b) =>
  a.getDate() === b.getDate() &&
  a.getMonth() === b.getMonth() &&
  a.getFullYear() === b.getFullYear();

/**
 * Vencimento em linguagem de gente: "hoje", "amanhã", "atrasada".
 *
 * Data crua obriga quem lê a fazer a conta mentalmente toda vez — e o ponto
 * de uma lista de tarefas é justamente não ter que fazer conta.
 */
export function fmtVencimento(ts, agora = Date.now()) {
  if (ts == null) return { texto: "sem data", tom: "faint" };

  const hoje = new Date(agora);
  const alvo = new Date(ts);

  if (ts < agora && !mesmoDia(hoje, alvo))
    return { texto: `atrasada · ${fmtData(ts)}`, tom: "danger" };

  if (mesmoDia(hoje, alvo)) {
    const hora = alvo.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return {
      texto: ts < agora ? `hoje · ${hora}` : `hoje, ${hora}`,
      tom: ts < agora ? "danger" : "warning",
    };
  }

  if (mesmoDia(new Date(agora + DIA), alvo))
    return { texto: "amanhã", tom: "warning" };

  return { texto: fmtData(ts), tom: "sub" };
}

/**
 * Última interação como se lê numa lista: "Hoje, 09:41", "Ontem, 17:22",
 * "12/05/2025". Data absoluta para algo de hoje obriga quem lê a fazer a conta.
 */
export function fmtInteracao(ts, agora = Date.now()) {
  if (ts == null) return "—";

  const d = new Date(ts);
  const hoje = new Date(agora);
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  if (mesmoDia(hoje, d)) return `Hoje, ${hora}`;
  if (mesmoDia(new Date(agora - DIA), d)) return `Ontem, ${hora}`;

  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export const TONS = {
  faint: "text-faint",
  sub: "text-sub",
  warning: "text-warning",
  danger: "text-danger",
  success: "text-success",
};
