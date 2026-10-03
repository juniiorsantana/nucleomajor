import { nomeCurto } from "../../../ui/perfil";

const DIA = 24 * 60 * 60 * 1000;

/**
 * Hora que a tarefa ganha quando alguém escolhe só o dia.
 *
 * Continua 09:00 porque é quando o lembrete dela sai: mudar o padrão mudaria
 * em silêncio a hora da mensagem de quem já usa. A diferença é que agora a
 * hora aparece no formulário e se troca ali.
 */
export const HORA_PADRAO = "09:00";

function dois(n) {
  return String(n).padStart(2, "0");
}

function inicioDoDia(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function dataInput(ts) {
  if (ts == null) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

export function horaInput(ts) {
  if (ts == null) return "";
  const d = new Date(ts);
  return `${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

/**
 * Data e hora do formulário para o instante gravado.
 *
 * Antes o formulário só tinha o dia e gravava sempre 09:00: uma tarefa
 * arrastada para 15h na agenda voltava para 9h na primeira vez que alguém a
 * abria para corrigir o título. Agora a hora viaja junto, e só cai no padrão
 * quando está vazia.
 */
export function dataHoraParaTimestamp(data, hora) {
  if (!data) return null;
  const [ano, mes, dia] = data.split("-").map(Number);
  const [h, m] = String(hora || HORA_PADRAO).split(":").map(Number);
  const d = new Date(ano, mes - 1, dia, h || 0, m || 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** Atalhos de prazo do formulário e do "adicionar rápido". */
export function prazoDoAtalho(atalho, agora = Date.now()) {
  const hoje = new Date(agora);
  const em = (dias, hora = 9) => new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + dias, hora, 0, 0, 0).getTime();
  if (atalho === "hoje") {
    // Hoje depois das 18h ainda é hoje: a tarefa fica para a próxima hora
    // cheia, em vez de nascer atrasada.
    const fimDoDia = em(0, 18);
    if (agora < fimDoDia) return fimDoDia;
    const proxima = new Date(agora);
    proxima.setMinutes(0, 0, 0);
    return Math.min(proxima.getTime() + 60 * 60 * 1000, em(0, 23) + 59 * 60 * 1000);
  }
  if (atalho === "amanha") return em(1);
  if (atalho === "semana") {
    // Próxima segunda-feira.
    const semana = hoje.getDay();
    const faltam = ((8 - semana) % 7) || 7;
    return em(faltam);
  }
  return null;
}

/**
 * Onde a tarefa cai na lista.
 *
 * "Próximas" juntava amanhã e daqui a três meses no mesmo balaio; agora o
 * horizonte é a semana, que é como a equipe planeja.
 */
export function grupoDaTarefa(tarefa, agora = Date.now()) {
  if (tarefa.concluida) return "concluidas";
  if (tarefa.venceEm == null) return "sem-data";
  const hoje = inicioDoDia(agora);
  const dia = inicioDoDia(tarefa.venceEm);
  if (dia < hoje) return "atrasadas";
  if (dia === hoje) return "hoje";
  if (dia === inicioDoDia(hoje + DIA + 2 * 60 * 60 * 1000)) return "amanha";
  if (dia < hoje + 7 * DIA) return "semana";
  return "depois";
}

export const GRUPOS = [
  { id: "atrasadas", rotulo: "Atrasadas" },
  { id: "hoje", rotulo: "Hoje" },
  { id: "amanha", rotulo: "Amanhã" },
  { id: "semana", rotulo: "Próximos 7 dias" },
  { id: "depois", rotulo: "Mais adiante" },
  { id: "sem-data", rotulo: "Sem prazo" },
  { id: "concluidas", rotulo: "Concluídas" },
];

/**
 * O prazo como se lê numa linha: "hoje, 15:00", "amanhã, 09:00", "qui, 14:00".
 *
 * Tom de perigo só quando venceu de verdade. A tarefa de hoje às 09:00 ficava
 * vermelha às 10h mesmo sendo "para hoje"; agora ela passa a "atrasada" só
 * depois do horário que alguém escolheu, e esse horário está à vista.
 */
export function rotuloPrazo(ts, agora = Date.now()) {
  if (ts == null) return { texto: "Sem prazo", tom: "faint" };
  const hora = horaInput(ts);
  const hoje = inicioDoDia(agora);
  const dia = inicioDoDia(ts);
  const venceu = ts < agora;
  if (dia === hoje) return { texto: venceu ? `Hoje, ${hora} · atrasada` : `Hoje, ${hora}`, tom: venceu ? "danger" : "warning" };
  if (dia < hoje) {
    const dias = Math.round((hoje - dia) / DIA);
    return { texto: dias === 1 ? `Ontem, ${hora}` : `Há ${dias} dias`, tom: "danger" };
  }
  if (dia === inicioDoDia(hoje + DIA + 2 * 60 * 60 * 1000)) return { texto: `Amanhã, ${hora}`, tom: "sub" };
  const data = new Date(ts);
  const opcoes = dia < hoje + 7 * DIA
    ? { weekday: "short" }
    : { day: "2-digit", month: "short", ...(data.getFullYear() !== new Date(agora).getFullYear() ? { year: "numeric" } : {}) };
  const texto = new Intl.DateTimeFormat("pt-BR", opcoes).format(data).replaceAll(".", "");
  return { texto: `${texto.charAt(0).toUpperCase()}${texto.slice(1)}, ${hora}`, tom: "sub" };
}

/** Os ids de quem responde pela tarefa, com o principal como reserva. */
export function idsDosResponsaveis(tarefa) {
  if (tarefa.responsaveis?.length) return tarefa.responsaveis;
  return tarefa.ownerId ? [tarefa.ownerId] : [];
}

/**
 * Assumiu, recusou, ou ainda não respondeu.
 *
 * Devolve `null` quando a tarefa não carrega `respostas` — é o caso da
 * extensão, que não sincroniza os vínculos. Ali a tela não pode afirmar
 * "aguardando": ninguém está aguardando nada, o dado é que não veio.
 */
export function respostaDoResponsavel(tarefa, id) {
  if (!tarefa.respostas) return null;
  const resposta = tarefa.respostas[id];
  if (!resposta) return null;
  if (resposta.recusadoEm) return { estado: "recusou", motivo: resposta.motivo };
  if (resposta.aceitoEm) return { estado: "assumiu", motivo: "" };
  return { estado: "aguardando", motivo: "" };
}

/**
 * Quem responde, resolvido pelo id contra a equipe de hoje.
 *
 * Só cai no `owner_label` gravado quando o id não é de ninguém da equipe —
 * tarefa antiga, do tempo do texto livre, ou de alguém que já saiu.
 */
export function pessoasDaTarefa(tarefa, porId) {
  const pessoas = idsDosResponsaveis(tarefa)
    .map((id) => porId.get(id))
    .filter(Boolean)
    .map((membro) => ({ id: membro.user_id, nome: nomeCurto(membro.profile), perfil: membro.profile }));
  if (pessoas.length) return pessoas;
  return tarefa.responsavel ? [{ id: null, nome: tarefa.responsavel, perfil: null }] : [];
}

/** O que ainda espera alguém: recusas primeiro, porque pedem decisão. */
export function pendenciasDaTarefa(tarefa, porId) {
  const abertas = [];
  for (const id of idsDosResponsaveis(tarefa)) {
    const resposta = respostaDoResponsavel(tarefa, id);
    if (!resposta || resposta.estado === "assumiu") continue;
    const nome = nomeCurto(porId.get(id)?.profile, "alguém");
    abertas.push({
      estado: resposta.estado,
      texto: resposta.estado === "recusou"
        ? `${nome} recusou${resposta.motivo ? `: ${resposta.motivo}` : ""}`
        : `Aguardando ${nome}`,
    });
  }
  return abertas.sort((a, b) => Number(b.estado === "recusou") - Number(a.estado === "recusou"));
}
