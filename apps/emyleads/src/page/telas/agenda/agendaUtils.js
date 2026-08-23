export const PASSO_MINUTOS = 30;

/**
 * Níveis de zoom em pixels por hora.
 *
 * 64 continua sendo o padrão histórico e por isso é o índice inicial: quem já
 * usava a agenda não percebe mudança até mexer no zoom. Os extremos existem
 * para dois usos reais e opostos - 32 cabe o dia inteiro numa tela sem rolar,
 * e 144 deixa uma reunião de 15 minutos legível.
 */
export const NIVEIS_ZOOM = [32, 44, 64, 96, 144];
export const ZOOM_PADRAO = 2;
export const ALTURA_HORA = NIVEIS_ZOOM[ZOOM_PADRAO];

/**
 * Paleta de identidade por pessoa.
 *
 * Separada da cor de categoria de propósito: um evento tem as duas dimensões
 * e o usuário escolhe qual delas quer ver pintada. Os valores foram escolhidos
 * para manter contraste aceitável tanto sobre o fundo claro quanto o escuro,
 * já que o bloco é preenchido e a cor do texto é calculada por luminância.
 */
export const CORES_PESSOA = [
  "#4F3CFC",
  "#0EA5E9",
  "#059669",
  "#D97706",
  "#DC2626",
  "#DB2777",
  "#7C3AED",
  "#0891B2",
  "#65A30D",
  "#EA580C",
];

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

/**
 * Passo de arraste proporcional ao zoom.
 *
 * Com 32px por hora, meia hora ocupa 16 pixels: manter o passo em 30 minutos é
 * o que impede o ponteiro de escorregar uma reunião inteira. Já com 144px por
 * hora sobra resolução para 15 e até 5 minutos, e travar em 30 vira limitação
 * artificial - o mesmo gesto passa a permitir o ajuste fino que o zoom prometeu.
 */
export function passoParaAltura(alturaHora) {
  if (alturaHora >= 144) return 5;
  if (alturaHora >= 96) return 15;
  return PASSO_MINUTOS;
}

/**
 * Quanto o bloco consegue mostrar na altura que sobrou.
 *
 * Concentrar a regra aqui evita o que existia antes: comparações soltas com 38
 * e 58 dentro do JSX, que com zoom variável passariam a esconder o título de
 * uma reunião de uma hora só porque o usuário afastou a régua.
 */
export function densidadeDoBloco(altura) {
  if (altura >= 56) return "completa";
  if (altura >= 30) return "media";
  return "minima";
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

/**
 * Recorta os eventos do dia em segmentos com minutos relativos à meia-noite.
 *
 * Separado do empacotamento porque a visão por pessoa precisa do recorte, mas
 * NÃO do empacotamento global: lá as colunas nascem dentro da faixa de cada
 * profissional, e empacotar antes misturaria a agenda de gente diferente na
 * mesma disputa por largura.
 */
export function recortarSegmentosDoDia(eventos, dia) {
  const inicioDia = inicioDoDia(dia);
  const fimDia = adicionarDias(inicioDia, 1);
  return eventos
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
}

/**
 * Distribui segmentos sobrepostos em colunas lado a lado.
 *
 * Muta e devolve a mesma lista: o chamador já ordenou e só quer `coluna` e
 * `colunas` preenchidos.
 */
export function empacotarEmColunas(segmentos) {
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

export function segmentosDoDia(eventos, dia) {
  return empacotarEmColunas(recortarSegmentosDoDia(eventos, dia));
}

export function idDoResponsavel(evento) {
  return evento?.ownerId || evento?.owner_id || "";
}

/**
 * Agrupa o dia em uma faixa por profissional.
 *
 * É o que torna a visão de equipe utilizável: sem isto, quatro pessoas em
 * reunião às 10h viram quatro tiras de 25% de largura na MESMA coluna do dia,
 * indistinguíveis sem ler a legenda em 10px. Com faixas, a sobreposição só
 * disputa espaço dentro da agenda de quem é dona dela, e o espaço em branco de
 * uma faixa passa a significar algo: aquela pessoa está livre naquele horário.
 *
 * Membros sem evento continuam aparecendo de propósito - a faixa vazia é
 * justamente a informação que se procura ao marcar uma reunião.
 */
export function faixasPorPessoa(eventos, dia, membros = [], { incluirVazias = true } = {}) {
  const recortados = recortarSegmentosDoDia(eventos, dia);
  const porPessoa = new Map();
  for (const segmento of recortados) {
    const chave = idDoResponsavel(segmento.evento) || "sem-responsavel";
    if (!porPessoa.has(chave)) porPessoa.set(chave, []);
    porPessoa.get(chave).push(segmento);
  }

  const faixas = [];
  const vistos = new Set();
  for (const membro of membros) {
    const chave = membro?.id || "";
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    const segmentos = porPessoa.get(chave) || [];
    if (!segmentos.length && !incluirVazias) continue;
    faixas.push({
      id: chave,
      nome: membro?.name || membro?.nome || "Sem nome",
      segmentos: empacotarEmColunas(segmentos),
    });
  }

  // Quem tem evento no dia mas não está na lista de membros (saiu da equipe,
  // ou o contexto veio recortado) não pode simplesmente sumir da tela.
  for (const [chave, segmentos] of porPessoa) {
    if (vistos.has(chave)) continue;
    faixas.push({
      id: chave,
      nome: segmentos[0]?.evento?.ownerName || "Sem responsável",
      segmentos: empacotarEmColunas(segmentos),
    });
  }

  return faixas;
}

export function iniciaisDoNome(nome) {
  const partes = String(nome || "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return `${partes[0][0]}${partes[partes.length - 1][0]}`.toUpperCase();
}

/**
 * Cor estável por pessoa, derivada do id.
 *
 * Estável entre sessões e entre máquinas porque sai do id, não da posição na
 * lista: se fosse pelo índice, entrar um membro novo repintaria a agenda
 * inteira e a memória visual de quem já usa o produto iria junto.
 */
export function corDaPessoa(id) {
  const texto = String(id || "");
  if (!texto) return CORES_PESSOA[0];
  let hash = 0;
  for (let i = 0; i < texto.length; i += 1) {
    hash = (hash * 31 + texto.charCodeAt(i)) >>> 0;
  }
  return CORES_PESSOA[hash % CORES_PESSOA.length];
}

/**
 * Cor do bloco conforme a dimensão que o usuário escolheu ver.
 *
 * "Indisponível" ignora o modo: um bloqueio de agenda alheia não tem categoria
 * legível nem deve tomar a identidade da pessoa - ele é ausência, e é cinza.
 */
export function corDoEvento(evento, modo = "categoria") {
  if (!evento) return "#8B7CFF";
  if (evento.titulo === "Indisponível") return "#CBD5E1";
  if (modo === "pessoa") return corDaPessoa(idDoResponsavel(evento));
  if (evento.sourceType === "task") return evento.categoryColor || "#F59E0B";
  return evento.categoryColor || "#8B7CFF";
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

/**
 * Total ocupado por profissional, para o resumo da visão de equipe.
 */
export function somarPorPessoa(eventos) {
  const mapa = new Map();
  eventos.filter((evento) => !evento.diaInteiro).forEach((evento) => {
    const chave = idDoResponsavel(evento) || "sem-responsavel";
    const atual = mapa.get(chave) || {
      id: chave,
      nome: evento.ownerName || "Sem responsável",
      cor: corDaPessoa(chave),
      minutos: 0,
    };
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
