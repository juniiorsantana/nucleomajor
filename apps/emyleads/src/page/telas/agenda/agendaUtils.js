export const PASSO_MINUTOS = 30;
export const ALTURA_HORA = 64;

export function inicioDoDia(valor) {
  const data = new Date(valor);
  data.setHours(0, 0, 0, 0);
  return data;
}

export function inicioDaSemana(valor) {
  const data = inicioDoDia(valor);
  data.setDate(data.getDate() - ((data.getDay() + 6) % 7));
  return data;
}

export function inicioDoMes(valor) {
  const data = inicioDoDia(valor);
  data.setDate(1);
  return data;
}

export function adicionarDias(valor, quantidade) {
  const data = new Date(valor);
  data.setDate(data.getDate() + quantidade);
  return data;
}

export function chaveDia(valor) {
  const data = new Date(valor);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

export function dataLocal(valor) {
  return chaveDia(valor);
}

export function horaLocal(valor) {
  const data = new Date(valor);
  return `${String(data.getHours()).padStart(2, "0")}:${String(data.getMinutes()).padStart(2, "0")}`;
}

export function isoLocal(data, hora) {
  const [ano, mes, dia] = String(data).split("-").map(Number);
  const [horas, minutos] = String(hora).split(":").map(Number);
  return new Date(ano, mes - 1, dia, horas, minutos, 0, 0).toISOString();
}

export function arredondarMinutos(minutos, passo = PASSO_MINUTOS) {
  return Math.max(0, Math.min(24 * 60, Math.round(minutos / passo) * passo));
}

export function horarioDeMinutos(minutos) {
  const seguro = Math.max(0, Math.min(24 * 60 - 1, minutos));
  return `${String(Math.floor(seguro / 60)).padStart(2, "0")}:${String(seguro % 60).padStart(2, "0")}`;
}

export function minutosDoHorario(horario) {
  const [hora, minuto] = String(horario || "00:00").split(":").map(Number);
  return hora * 60 + minuto;
}

export function intervaloDaVisao(visualizacao, referencia) {
  if (visualizacao === "day") {
    const de = inicioDoDia(referencia);
    return { de, ate: adicionarDias(de, 1) };
  }
  if (visualizacao === "month") {
    const primeiro = inicioDoMes(referencia);
    const de = inicioDaSemana(primeiro);
    return { de, ate: adicionarDias(de, 42) };
  }
  const de = inicioDaSemana(referencia);
  return { de, ate: adicionarDias(de, 7) };
}

export function diasDoIntervalo(de, ate) {
  const dias = [];
  for (let atual = inicioDoDia(de); atual < ate; atual = adicionarDias(atual, 1)) dias.push(atual);
  return dias;
}

export function rotuloPeriodo(visualizacao, referencia) {
  const mes = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
  if (visualizacao === "month") return mes.format(referencia);
  if (visualizacao === "day") {
    return new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(referencia);
  }
  const inicio = inicioDaSemana(referencia);
  const fim = adicionarDias(inicio, 6);
  const curto = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
  return `${curto.format(inicio)} – ${curto.format(fim)}`.replaceAll(".", "");
}

export function navegarReferencia(visualizacao, referencia, direcao) {
  if (direcao === 0) return new Date();
  const data = new Date(referencia);
  if (visualizacao === "month") data.setMonth(data.getMonth() + direcao);
  else data.setDate(data.getDate() + direcao * (visualizacao === "week" ? 7 : 1));
  return data;
}

export function eventoParaFormulario(evento, abertura = {}) {
  const inicio = evento?.inicio ? new Date(evento.inicio) : abertura.inicio ? new Date(abertura.inicio) : new Date();
  const fim = evento?.fim ? new Date(evento.fim) : abertura.fim ? new Date(abertura.fim) : new Date(inicio.getTime() + 60 * 60 * 1000);
  const duracao = Math.max(PASSO_MINUTOS, Math.round((fim - inicio) / 60000));
  return {
    titulo: evento?.titulo || "",
    descricao: evento?.descricao || "",
    data: dataLocal(inicio),
    inicio: horaLocal(inicio),
    duracao,
    diaInteiro: Boolean(evento?.diaInteiro),
    tipo: evento?.tipo === "block" ? "block" : evento?.tipo === "event" ? "event" : "appointment",
    visibilidade: evento?.visibilidade === "organization" ? "organization" : "personal",
    categoryId: evento?.categoryId || abertura.categoryId || "",
    contactId: evento?.contactId || abertura.contactId || "",
    local: evento?.local || "",
    tags: Array.isArray(evento?.tags) ? evento.tags.join(", ") : "",
    status: evento?.status === "tentative" ? "tentative" : "scheduled",
    lembretes: Array.isArray(evento?.lembretes) ? evento.lembretes : abertura.lembretes || [30],
  };
}

export function eventoEditavel(evento, usuarioId, papel) {
  if (!evento || evento.sourceType === "task" || evento.titulo === "Indisponível") return false;
  if (evento.visibilidade === "organization") return papel === "owner" || papel === "admin";
  return evento.ownerId === usuarioId;
}

export function eventoVisivelNoFiltro(evento, filtro, usuarioId) {
  if (filtro === "team") return true;
  if (filtro && filtro !== "mine") return evento.ownerId === filtro || evento.visibilidade === "organization";
  return evento.ownerId === usuarioId || evento.visibilidade === "organization";
}

export function segmentosDoDia(eventos, dia) {
  const inicioDia = inicioDoDia(dia);
  const fimDia = adicionarDias(inicioDia, 1);
  const segmentos = eventos
    .filter((evento) => !evento.diaInteiro && new Date(evento.inicio) < fimDia && new Date(evento.fim) > inicioDia)
    .map((evento) => {
      const inicio = new Date(Math.max(new Date(evento.inicio).getTime(), inicioDia.getTime()));
      const fim = new Date(Math.min(new Date(evento.fim).getTime(), fimDia.getTime()));
      return {
        evento,
        inicioMinutos: (inicio - inicioDia) / 60000,
        fimMinutos: (fim - inicioDia) / 60000,
        coluna: 0,
        colunas: 1,
      };
    })
    .sort((a, b) => a.inicioMinutos - b.inicioMinutos || b.fimMinutos - a.fimMinutos);

  let grupo = [];
  let fimGrupo = -1;
  const fecharGrupo = () => {
    if (!grupo.length) return;
    const finais = [];
    for (const segmento of grupo) {
      let coluna = finais.findIndex((fim) => fim <= segmento.inicioMinutos);
      if (coluna < 0) coluna = finais.length;
      finais[coluna] = segmento.fimMinutos;
      segmento.coluna = coluna;
    }
    const total = Math.max(1, finais.length);
    grupo.forEach((segmento) => { segmento.colunas = total; });
    grupo = [];
  };

  for (const segmento of segmentos) {
    if (grupo.length && segmento.inicioMinutos >= fimGrupo) fecharGrupo();
    grupo.push(segmento);
    fimGrupo = Math.max(fimGrupo, segmento.fimMinutos);
  }
  fecharGrupo();
  return segmentos;
}

export function minutosVisiveis(evento) {
  return Math.max(0, (new Date(evento.fim) - new Date(evento.inicio)) / 60000);
}

export function somarPorCategoria(eventos) {
  const mapa = new Map();
  eventos.filter((evento) => evento.sourceType !== "task" && !evento.diaInteiro).forEach((evento) => {
    const chave = evento.titulo === "Indisponível" ? "Indisponível" : evento.categoryName || "Atividade";
    const atual = mapa.get(chave) || { nome: chave, cor: evento.titulo === "Indisponível" ? "#CBD5E1" : evento.categoryColor, minutos: 0 };
    atual.minutos += minutosVisiveis(evento);
    mapa.set(chave, atual);
  });
  return [...mapa.values()].sort((a, b) => b.minutos - a.minutos);
}

export function formatarDuracao(minutos) {
  const horas = Math.floor(minutos / 60);
  const resto = Math.round(minutos % 60);
  if (!horas) return `${resto}min`;
  return resto ? `${horas}h ${resto}min` : `${horas}h`;
}
