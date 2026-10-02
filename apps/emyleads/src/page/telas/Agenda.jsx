import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Minus,
  MoreHorizontal,
  PanelLeft,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  SquareCheckBig,
  X,
} from "lucide-react";
import { api } from "../../data/client";
import { nomeCurto } from "../../ui/perfil";
import { BotaoPrimario, CabecalhoTela, CampoBusca, DialogoConfirmar } from "../ui";
import BarraLateral from "./agenda/BarraLateral";
import CriacaoRapida from "./agenda/CriacaoRapida";
import DetalheEvento from "./agenda/DetalheEvento";
import DialogoEvento from "./agenda/DialogoEvento";
import GradeAgenda from "./agenda/GradeAgenda";
import MiniCalendario, { marcasDosEventos } from "./agenda/MiniCalendario";
import VisaoLista from "./agenda/VisaoLista";
import VisaoMes from "./agenda/VisaoMes";
import { Aviso, Folha, Segmentado, useEstreito } from "./agenda/componentes";
import {
  PainelFiltros,
  PainelNotificacoes,
  PainelPreferencias,
  PainelSolicitacoes,
  VISUALIZACOES,
  contarFiltros,
} from "./agenda/Paineis";
import FormularioTarefa from "./tarefas/FormularioTarefa";
import {
  NIVEIS_ZOOM,
  ZOOM_PADRAO,
  adicionarDias,
  chaveDia,
  coresDaEquipe,
  corDoEvento,
  dataLocal,
  diasDoIntervalo,
  eventoEditavel,
  eventoParaFormulario,
  eventoVisivelNoFiltro,
  faixaVisivel,
  formatarDuracao,
  horaLocal,
  idsDosResponsaveis,
  inicioDaSemana,
  inicioDoDia,
  intervaloDaVisao,
  isoLocal,
  minutosDoHorario,
  navegarReferencia,
  proximoHorarioLivre,
  rotuloPeriodo,
  somarPorPessoa,
  somarPorTipo,
} from "./agenda/agendaUtils";

const TITULOS_PAINEL = {
  notifications: { titulo: "Avisos", icone: Bell },
  requests: { titulo: "Pedidos de horário", icone: CalendarClock },
  settings: { titulo: "Preferências da agenda", icone: Settings2 },
  filters: { titulo: "Filtros", icone: SlidersHorizontal },
};
const COR_TAREFA = "#D97706";

function lerLocal(chave, padrao) {
  // O painel também roda dentro da extensão, onde localStorage pode estar
  // indisponível por política da página. Preferência visual nunca pode ser
  // motivo de tela branca.
  try {
    const bruto = window.localStorage.getItem(chave);
    return bruto === null ? padrao : JSON.parse(bruto);
  } catch { return padrao; }
}

function gravarLocal(chave, valor) {
  try { window.localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* preferência é opcional */ }
}

function dataComMinutos(dia, minutos) {
  return new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), Math.floor(minutos / 60), minutos % 60, 0, 0);
}

function idsDaTarefa(tarefa) {
  if (tarefa?.responsaveis?.length) return tarefa.responsaveis;
  return tarefa?.ownerId ? [tarefa.ownerId] : [];
}

/** Rótulo curto do período para o cabeçalho do telefone. */
function rotuloCurto(visualizacao, referencia) {
  if (visualizacao === "month") return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(referencia);
  if (visualizacao === "day") {
    const hoje = chaveDia(new Date());
    const chave = chaveDia(referencia);
    const prefixo = chave === hoje ? "Hoje" : chave === chaveDia(adicionarDias(new Date(), 1)) ? "Amanhã" : chave === chaveDia(adicionarDias(new Date(), -1)) ? "Ontem" : null;
    const data = new Intl.DateTimeFormat("pt-BR", { weekday: prefixo ? undefined : "short", day: "numeric", month: "short" }).format(referencia).replaceAll(".", "");
    return prefixo ? `${prefixo}, ${data}` : data;
  }
  return rotuloPeriodo("week", referencia);
}

/**
 * Esqueleto no lugar de "Carregando agenda…": trocar de semana não pisca a
 * tela inteira, parece atualização e não recarga.
 */
function Esqueleto({ lista }) {
  if (lista) {
    return (
      <div className="min-h-0 flex-1 animate-pulse space-y-px overflow-hidden rounded-none border border-line bg-bg" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((linha) => (
          <div key={linha} className="flex items-center gap-3 px-4 py-4">
            <div className="h-3 w-10 rounded-full bg-surface-hover" />
            <div className="h-9 w-1 rounded-full bg-surface-hover" />
            <div className="flex-1 space-y-2"><div className="h-3 w-2/3 rounded-full bg-surface-hover" /><div className="h-2.5 w-1/3 rounded-full bg-surface" /></div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 animate-pulse overflow-hidden rounded-none border border-line bg-bg" aria-hidden="true">
      <div className="grid border-b border-line" style={{ gridTemplateColumns: "62px repeat(5, minmax(0, 1fr))" }}>
        <div className="border-r border-line py-3" />
        {[0, 1, 2, 3, 4].map((coluna) => (
          <div key={coluna} className="border-r border-line px-3 py-3 last:border-r-0">
            <div className="h-2.5 w-14 rounded-full bg-surface-hover" />
            <div className="mt-1.5 h-2 w-10 rounded-full bg-surface" />
          </div>
        ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: "62px repeat(5, minmax(0, 1fr))" }}>
        <div className="border-r border-line" />
        {[0, 1, 2, 3, 4].map((coluna) => (
          <div key={coluna} className="space-y-2 border-r border-line p-2 last:border-r-0">
            {[0, 1, 2].map((linha) => (
              <div key={linha} className="rounded-ctl bg-surface-hover" style={{ height: 34 + ((coluna + linha) % 3) * 26, marginTop: linha === 0 ? (coluna % 3) * 22 : 0 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Soma de horas do período, numa linha discreta abaixo da grade. */
function ResumoHoras({ totais, modoCor }) {
  const [expandido, setExpandido] = useState(false);
  const total = totais.reduce((soma, item) => soma + item.minutos, 0);
  if (!totais.length) return null;
  const visiveis = expandido ? totais : totais.slice(0, 5);
  const ocultos = totais.length - visiveis.length;
  return (
    <div className="mt-2 hidden flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11.5px] md:flex">
      {visiveis.map((item) => (
        <span key={item.id || item.nome} className="flex items-center gap-1.5 text-sub">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.cor }} />
          {item.nome} <strong className="font-semibold text-fg">{formatarDuracao(item.minutos)}</strong>
        </span>
      ))}
      {ocultos > 0 && <button type="button" onClick={() => setExpandido(true)} className="cursor-pointer font-semibold text-accent-forte hover:underline">+{ocultos}</button>}
      {expandido && totais.length > 5 && <button type="button" onClick={() => setExpandido(false)} className="cursor-pointer text-faint hover:text-fg">recolher</button>}
      <span className="ml-auto font-semibold text-sub">{formatarDuracao(total)} marcado{modoCor === "pessoa" ? " · por pessoa" : ""}</span>
    </div>
  );
}

/**
 * Menu "⋯": o que se usa de vez em quando, com o nome escrito.
 *
 * Eram quatro ícones soltos na barra — Solicitações, Tarefas, Contatos,
 * Preferências — que se explicavam por dica de mouse.
 */
function MenuMais({ itens }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef(null);
  const alerta = itens.reduce((soma, item) => soma + (item.contador || 0), 0);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (!raiz.current?.contains(e.target)) setAberto(false); };
    const teclado = (e) => { if (e.key === "Escape") setAberto(false); };
    window.addEventListener("pointerdown", fora);
    window.addEventListener("keydown", teclado);
    return () => { window.removeEventListener("pointerdown", fora); window.removeEventListener("keydown", teclado); };
  }, [aberto]);
  return (
    <div ref={raiz} className="relative">
      <button
        type="button"
        aria-label="Mais opções"
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => setAberto((atual) => !atual)}
        className="relative flex h-11 w-11 cursor-pointer items-center justify-center rounded-ctl text-sub hover:bg-surface-hover hover:text-fg md:h-9 md:w-9"
      >
        <MoreHorizontal size={20} />
        {alerta > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[9px] font-bold text-white">{alerta}</span>}
      </button>
      {aberto && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-64 overflow-hidden rounded-none border border-line bg-bg py-1 ">
          {itens.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => { setAberto(false); item.acao(); }}
              className="flex min-h-12 w-full cursor-pointer items-center gap-3 px-4 text-left text-[15px] text-fg hover:bg-surface-hover md:min-h-10 md:text-[13px]"
            >
              <item.icone size={17} className="flex-none text-sub" />
              <span className="flex-1">{item.rotulo}</span>
              {item.contador > 0 && <span className="rounded-full bg-warning px-1.5 text-[11px] font-bold leading-5 text-white">{item.contador}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Faixa da semana no topo do telefone: um toque troca o dia, e os pontos dizem
 * onde há compromisso antes de alguém precisar abrir o dia para descobrir.
 */
function FaixaDias({ referencia, marcas, aoEscolher }) {
  const inicio = inicioDaSemana(referencia);
  const hoje = chaveDia(new Date());
  const escolhido = chaveDia(referencia);
  return (
    <div className="grid grid-cols-7 gap-0.5 px-2 pb-2" role="group" aria-label="Dias da semana">
      {Array.from({ length: 7 }, (_, i) => adicionarDias(inicio, i)).map((dia) => {
        const chave = chaveDia(dia);
        const ehEscolhido = chave === escolhido;
        const ehHoje = chave === hoje;
        const cores = marcas.get(chave) || [];
        return (
          <button
            key={chave}
            type="button"
            onClick={() => aoEscolher(dia)}
            aria-pressed={ehEscolhido}
            aria-label={new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric" }).format(dia)}
            className={`flex min-h-[58px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-none ${ehEscolhido ? "bg-accent text-white" : "text-fg active:bg-surface-hover"}`}
          >
            <span className={`text-[11px] font-semibold uppercase ${ehEscolhido ? "text-white/80" : ehHoje ? "text-accent-forte" : "text-faint"}`}>
              {new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(dia).replace(".", "").slice(0, 3)}
            </span>
            <span className={`text-[17px] font-semibold tabular-nums ${!ehEscolhido && ehHoje ? "text-accent-forte" : ""}`}>{dia.getDate()}</span>
            <span className="flex h-1.5 gap-[2px]" aria-hidden="true">
              {cores.slice(0, 3).map((cor, i) => <span key={i} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ehEscolhido ? "rgba(255,255,255,.85)" : cor }} />)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function Agenda({ dados = {}, sessao, aoAbrirContato = () => {}, aoRecarregarDados = async () => {}, aoIrParaTarefas = () => {} }) {
  const estreito = useEstreito();
  const [visualizacao, setVisualizacao] = useState(() => (estreito ? "day" : "week"));
  const [referencia, setReferencia] = useState(new Date());
  const [eventos, setEventos] = useState([]);
  const [eventosHoje, setEventosHoje] = useState([]);
  const [contexto, setContexto] = useState(null);
  const [notificacoes, setNotificacoes] = useState([]);
  const [solicitacoes, setSolicitacoes] = useState([]);
  const [solicitacaoOcupada, setSolicitacaoOcupada] = useState("");
  const [filtros, setFiltros] = useState(() => ({
    profissional: "mine",
    categoria: "",
    contato: "",
    modoCor: lerLocal("agenda:modoCor", "tipo"),
    agrupar: lerLocal("agenda:agruparEquipe", true),
  }));
  const [busca, setBusca] = useState("");
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [painel, setPainel] = useState(null);
  const [dialogo, setDialogo] = useState(null);
  const [detalhe, setDetalhe] = useState(null);
  const [rapida, setRapida] = useState(null);
  // `undefined` fechado; `null` tarefa nova; objeto, a tarefa (ou o rascunho).
  const [tarefaAberta, setTarefaAberta] = useState(undefined);
  const [equipe, setEquipe] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  // Erro de carga (faixa no topo, some só quando a carga der certo) e erro do
  // formulário são coisas diferentes: dividir o estado fazia uma falha de
  // arraste reaparecer dentro do diálogo na vez seguinte.
  const [erroCarga, setErroCarga] = useState("");
  const [erroDialogo, setErroDialogo] = useState("");
  const [aviso, setAviso] = useState(null);
  const [confirmacao, setConfirmacao] = useState(null);
  const [ajustes, setAjustes] = useState({});
  const [zoom, setZoom] = useState(() => lerLocal("agenda:zoom", ZOOM_PADRAO));
  const [lateral, setLateral] = useState(() => lerLocal("agenda:lateral", true));
  const inicializado = useRef(false);
  const toque = useRef(null);
  const estreitoRef = useRef(estreito);
  estreitoRef.current = estreito;

  const alturaHora = NIVEIS_ZOOM[zoom] ?? NIVEIS_ZOOM[ZOOM_PADRAO];
  const intervalo = useMemo(() => intervaloDaVisao(visualizacao, referencia), [referencia, visualizacao]);
  const dias = useMemo(() => diasDoIntervalo(intervalo.de, intervalo.ate), [intervalo]);

  useEffect(() => { gravarLocal("agenda:zoom", zoom); }, [zoom]);
  useEffect(() => { gravarLocal("agenda:modoCor", filtros.modoCor); }, [filtros.modoCor]);
  useEffect(() => { gravarLocal("agenda:agruparEquipe", filtros.agrupar); }, [filtros.agrupar]);
  useEffect(() => { gravarLocal("agenda:lateral", lateral); }, [lateral]);

  const carregar = useCallback(async ({ silencioso = false } = {}) => {
    if (!silencioso) setCarregando(true);
    try {
      const hoje = inicioDoDia(new Date());
      const amanha = adicionarDias(hoje, 1);
      const hojeNoIntervalo = intervalo.de <= hoje && intervalo.ate >= amanha;
      const [lista, proximoContexto, proximasNotificacoes, listaHoje] = await Promise.all([
        api.agenda.listar({ de: intervalo.de.toISOString(), ate: intervalo.ate.toISOString() }),
        api.agenda.contexto(),
        api.agenda.notificacoes({ limite: 60 }),
        // O "Hoje" da coluna lateral vale para qualquer semana aberta; quando
        // hoje já está no período, a mesma lista serve e poupa a consulta.
        hojeNoIntervalo ? Promise.resolve(null) : api.agenda.listar({ de: hoje.toISOString(), ate: amanha.toISOString() }).catch(() => []),
      ]);
      setEventos(lista);
      setEventosHoje(listaHoje ?? lista.filter((evento) => new Date(evento.inicio) < amanha && new Date(evento.fim) > hoje));
      setContexto(proximoContexto);
      setNotificacoes(proximasNotificacoes);
      if (["owner", "admin"].includes(proximoContexto?.papel)) {
        // Pedidos de horário são um extra da gestão: se falharem, a agenda
        // continua de pé em vez de virar uma faixa de erro.
        setSolicitacoes(await api.agenda.solicitacoes({ limite: 100 }).catch(() => []));
      } else {
        setSolicitacoes([]);
      }
      if (!inicializado.current) {
        // No telefone a agenda abre sempre no dia: a semana em lista é longa
        // demais para ser a primeira coisa que alguém vê de manhã.
        if (!estreitoRef.current) setVisualizacao(proximoContexto?.preference?.defaultView || "week");
        inicializado.current = true;
      }
      setErroCarga("");
    } catch (falha) {
      const mensagem = falha?.message || String(falha);
      setErroCarga(/calendar_context|calendar_categories|calendar_events_list/i.test(mensagem)
        ? "A agenda ainda não está configurada para esta empresa. Fale com o suporte da Núcleo Major."
        : `Não foi possível carregar a agenda. ${/fetch|network|rede/i.test(mensagem) ? "Confira a internet e tente de novo." : mensagem}`);
    } finally { setCarregando(false); }
  }, [intervalo.ate, intervalo.de]);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!contexto || !["owner", "admin"].includes(contexto.papel)) return undefined;
    const atualizarSolicitacoes = () => api.agenda.solicitacoes({ limite: 100 }).then(setSolicitacoes).catch(() => {});
    const relogio = window.setInterval(atualizarSolicitacoes, 15000);
    return () => window.clearInterval(relogio);
  }, [contexto]);

  // A equipe no formato do formulário de tarefa (`user_id` + `profile`) só
  // quando alguém abre uma tarefa: a agenda em si vive de `contexto.members`.
  useEffect(() => {
    if (tarefaAberta === undefined || equipe.length) return undefined;
    let vivo = true;
    api.organizacoes.membros()
      .then((lista) => { if (vivo) setEquipe(lista.filter((m) => m.status === "active")); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [equipe.length, tarefaAberta]);

  const categorias = contexto?.categories || [];
  const membros = contexto?.members || [];
  // A cor de cada pessoa sai do perfil, montada uma vez por carga: a grade
  // pinta um bloco por vez e não pode consultar a equipe a cada desenho.
  const cores = useMemo(() => coresDaEquipe(membros), [membros]);
  const usuarioId = contexto?.userId || sessao?.usuario?.id || null;
  const papel = contexto?.papel || "member";
  const gerencial = ["owner", "admin"].includes(papel);
  const contatos = dados.contatos || [];
  const tarefas = dados.tarefas || [];
  const { profissional, categoria, contato: filtroContato, modoCor, agrupar } = filtros;
  const mudarFiltros = (parcial) => setFiltros((atual) => ({ ...atual, ...parcial }));

  /**
   * Eventos com o ajuste otimista por cima do que veio do servidor. Sem isto o
   * bloco arrastado voltava para o lugar antigo até o servidor responder.
   */
  const eventosVisiveis = useMemo(
    () => eventos.map((evento) => (ajustes[evento.id] ? { ...evento, ...ajustes[evento.id] } : evento)),
    [ajustes, eventos],
  );

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return eventosVisiveis.filter((evento) => {
      // Tarefa concluída agora some na hora, antes de o servidor confirmar.
      if (evento.oculto) return false;
      if (!eventoVisivelNoFiltro(evento, profissional, usuarioId)) return false;
      if (categoria && evento.categoryId !== categoria && evento.sourceType !== "task") return false;
      if (filtroContato && evento.contactId !== filtroContato) return false;
      return !termo || `${evento.titulo} ${evento.descricao} ${evento.ownerName} ${evento.categoryName}`.toLowerCase().includes(termo);
    });
  }, [busca, categoria, eventosVisiveis, filtroContato, profissional, usuarioId]);

  // A legenda acompanha o que está pintado: colorindo por pessoa, somar por
  // categoria daria uma legenda que não explica nenhuma cor da tela.
  const totais = useMemo(
    () => (modoCor === "pessoa" ? somarPorPessoa(filtrados, cores, membros) : somarPorTipo(filtrados)),
    [cores, filtrados, membros, modoCor],
  );
  const marcas = useMemo(() => marcasDosEventos(filtrados, (evento) => corDoEvento(evento, modoCor, cores)), [cores, filtrados, modoCor]);

  const naoLidas = notificacoes.filter((item) => !item.lidaEm && item.status === "sent").length;
  const solicitacoesPendentes = solicitacoes.filter((item) => item.status === "awaiting_team_approval").length;
  const inicioExpediente = minutosDoHorario(String(contexto?.preference?.dayStart || contexto?.calendar?.dayStart || "05:00").slice(0, 5));
  const fimExpediente = minutosDoHorario(String(contexto?.preference?.dayEnd || contexto?.calendar?.dayEnd || "23:59").slice(0, 5));
  // O expediente diz onde a atenção mora; a faixa desenhada precisa caber todo
  // evento do período, senão o compromisso depois do expediente sumia.
  const faixa = useMemo(() => faixaVisivel(filtrados, inicioExpediente, fimExpediente), [fimExpediente, filtrados, inicioExpediente]);
  const emEquipe = profissional === "team";
  const porPessoa = emEquipe && agrupar && visualizacao === "day" && !estreito;
  const quantosFiltros = contarFiltros(filtros);

  // O que é meu hoje, para a coluna lateral: compromissos que me tocam e as
  // tarefas com prazo hoje que estão comigo, em ordem de horário.
  const hojeChave = chaveDia(new Date());
  const minhasTarefasAbertas = useMemo(
    () => tarefas.filter((tarefa) => !tarefa.concluida && usuarioId && idsDaTarefa(tarefa).includes(usuarioId)),
    [tarefas, usuarioId],
  );
  const itensHoje = useMemo(() => {
    const compromissos = eventosHoje
      .filter((evento) => evento.sourceType !== "task" && eventoVisivelNoFiltro(evento, "mine", usuarioId))
      .map((evento) => ({ chave: `e-${evento.id}`, titulo: evento.titulo, cor: corDoEvento(evento, modoCor, cores), evento, ordem: evento.diaInteiro ? 0 : new Date(evento.inicio).getTime() }));
    const deHoje = minhasTarefasAbertas
      .filter((tarefa) => tarefa.venceEm != null && chaveDia(tarefa.venceEm) === hojeChave)
      .map((tarefa) => ({ chave: `t-${tarefa.id}`, titulo: tarefa.titulo || "Tarefa sem título", cor: COR_TAREFA, tarefa, hora: horaLocal(tarefa.venceEm), ordem: tarefa.venceEm }));
    return [...compromissos, ...deHoje].sort((a, b) => a.ordem - b.ordem);
  }, [cores, eventosHoje, hojeChave, minhasTarefasAbertas, modoCor, usuarioId]);
  const atrasadas = useMemo(
    () => minhasTarefasAbertas.filter((tarefa) => tarefa.venceEm != null && tarefa.venceEm < inicioDoDia(new Date()).getTime()).length,
    [minhasTarefasAbertas],
  );

  const mostrarAviso = useCallback((proximo) => setAviso({ ...proximo, chave: Date.now() }), []);
  const fecharAviso = useCallback(() => setAviso(null), []);

  const ajustarZoom = useCallback((direcao) => {
    const alvo = Math.min(NIVEIS_ZOOM.length - 1, Math.max(0, zoom + direcao));
    setZoom(alvo);
    return NIVEIS_ZOOM[alvo];
  }, [zoom]);

  const limparAjuste = useCallback((id) => setAjustes((atual) => {
    if (!(id in atual)) return atual;
    const proximo = { ...atual };
    delete proximo[id];
    return proximo;
  }), []);

  const navegar = useCallback((direcao) => setReferencia((atual) => navegarReferencia(visualizacao, atual, direcao)), [visualizacao]);

  const tarefaDoEvento = (evento) => tarefas.find((item) => item.id === (evento.taskId || evento.id)) || null;

  /** Abre o formulário completo de compromisso, no próximo horário livre do dia. */
  const abrirFormulario = ({ dia = referencia, inicio, fim, titulo = "" } = {}) => {
    const sugestao = inicio == null
      ? proximoHorarioLivre(eventosVisiveis.filter((evento) => eventoVisivelNoFiltro(evento, "mine", usuarioId)), dia, { inicioExpediente: Math.max(inicioExpediente, 8 * 60), fimExpediente: Math.min(fimExpediente, 20 * 60) })
      : { inicio, fim };
    setErroDialogo("");
    setDialogo({
      evento: null,
      abertura: {
        inicio: dataComMinutos(dia, sugestao.inicio).toISOString(),
        fim: dataComMinutos(dia, sugestao.fim).toISOString(),
        categoryId: categorias[0]?.id,
        lembretes: contexto?.preference?.defaultReminderMinutes || [30],
        titulo,
      },
    });
  };

  const abrirNovo = (dia = referencia, inicio, fim, opcoes = {}) => {
    // O backend fixa o dono no usuário da sessão: criar na faixa de outra
    // pessoa geraria um evento na agenda errada, em silêncio.
    if (opcoes.ownerId && usuarioId && opcoes.ownerId !== usuarioId) {
      const dono = membros.find((membro) => membro.id === opcoes.ownerId);
      mostrarAviso({ tom: "erro", texto: `Só dá para marcar na sua própria agenda. Peça para ${dono?.name || "a pessoa"} marcar, ou use a sua coluna.` });
      return;
    }
    // Da grade, com o ponteiro: criação rápida ao lado do horário.
    if (opcoes.x != null && !estreito) {
      setRapida({ inicio: dataComMinutos(dia, inicio).toISOString(), fim: dataComMinutos(dia, fim).toISOString(), x: opcoes.x, y: opcoes.y });
      return;
    }
    abrirFormulario({ dia, inicio, fim });
  };

  const abrirEvento = (evento) => setDetalhe(evento);

  const salvarEvento = async (payload) => {
    setSalvando(true); setErroDialogo("");
    try {
      if (dialogo?.evento?.id) await api.agenda.atualizar({ id: dialogo.evento.id, patch: payload });
      else await api.agenda.criar(payload);
      setDialogo(null);
      await carregar({ silencioso: true });
      mostrarAviso({ texto: dialogo?.evento?.id ? "Compromisso atualizado." : "Compromisso marcado." });
    } catch (falha) { setErroDialogo(falha?.message || String(falha)); }
    finally { setSalvando(false); }
  };

  const excluirEvento = (alvo) => {
    if (!alvo?.id) return;
    setConfirmacao({
      titulo: "Excluir este compromisso?",
      descricao: `"${alvo.titulo}" sai da agenda de quem participa. Não dá para desfazer.`,
      rotulo: "Excluir",
      confirmar: async () => {
        setSalvando(true);
        try {
          await api.agenda.remover({ id: alvo.id });
          setDialogo(null);
          setDetalhe(null);
          await carregar({ silencioso: true });
          mostrarAviso({ texto: "Compromisso excluído." });
        } catch (falha) { mostrarAviso({ tom: "erro", texto: falha?.message || String(falha) }); }
        finally { setSalvando(false); }
      },
    });
  };

  /**
   * Reposiciona no tempo, aplicando primeiro e confirmando depois. `anterior`
   * alimenta o Desfazer: arrastar é o gesto mais fácil de errar da agenda.
   */
  const aplicarIntervalo = useCallback(async (payload, inicio, fim, { anterior, rotulo }) => {
    setAjustes((atual) => ({ ...atual, [payload.id]: { inicio, fim } }));
    try {
      if (payload.sourceType === "task") {
        await api.agenda.reagendarTarefa({ id: payload.id, inicio });
        await aoRecarregarDados();
      } else {
        await api.agenda.atualizar({ id: payload.id, patch: { inicio, fim } });
      }
      await carregar({ silencioso: true });
      limparAjuste(payload.id);
      mostrarAviso({
        texto: rotulo,
        acao: anterior && {
          rotulo: "Desfazer",
          executar: () => aplicarIntervalo(payload, anterior.inicio, anterior.fim, { rotulo: "Alteração desfeita." }),
        },
      });
    } catch (falha) {
      limparAjuste(payload.id);
      mostrarAviso({ tom: "erro", texto: falha?.message || String(falha) });
      await carregar({ silencioso: true });
    }
  }, [aoRecarregarDados, carregar, limparAjuste, mostrarAviso]);

  const mover = (payload, dia, minutos) => {
    const inicio = dataComMinutos(dia, minutos);
    const duracao = new Date(payload.fim) - new Date(payload.inicio);
    return aplicarIntervalo(payload, inicio.toISOString(), new Date(inicio.getTime() + duracao).toISOString(), { anterior: { inicio: payload.inicio, fim: payload.fim }, rotulo: "Horário alterado." });
  };

  const redimensionar = (evento, duracao) => aplicarIntervalo(
    evento,
    evento.inicio,
    new Date(new Date(evento.inicio).getTime() + duracao * 60000).toISOString(),
    { anterior: { inicio: evento.inicio, fim: evento.fim }, rotulo: `Duração alterada para ${formatarDuracao(duracao)}.` },
  );

  const reagendar = (evento, delta, rotulo) => {
    setDetalhe(null);
    const inicio = new Date(new Date(evento.inicio).getTime() + delta).toISOString();
    const fim = new Date(new Date(evento.fim).getTime() + delta).toISOString();
    const novo = new Date(inicio);
    const dia = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "numeric" }).format(novo).replaceAll(".", "").replace(",", "");
    return aplicarIntervalo(
      { id: evento.id, sourceType: evento.sourceType },
      inicio,
      fim,
      { anterior: { inicio: evento.inicio, fim: evento.fim }, rotulo: `${evento.sourceType === "task" ? "Prazo" : "Horário"} mudado para ${dia} às ${horaLocal(novo)}.` },
    );
  };

  const concluirTarefa = async (tarefaOuEvento) => {
    const id = tarefaOuEvento.taskId || tarefaOuEvento.id;
    const titulo = tarefaOuEvento.titulo || "Tarefa";
    setDetalhe(null);
    setAjustes((atual) => ({ ...atual, [id]: { oculto: true } }));
    try {
      await api.tarefas.concluir({ id, concluida: true });
      await Promise.all([aoRecarregarDados(), carregar({ silencioso: true })]);
      mostrarAviso({
        texto: `“${titulo}” concluída.`,
        acao: {
          rotulo: "Desfazer",
          executar: async () => {
            try {
              await api.tarefas.concluir({ id, concluida: false });
              await Promise.all([aoRecarregarDados(), carregar({ silencioso: true })]);
            } catch (falha) { mostrarAviso({ tom: "erro", texto: falha?.message || String(falha) }); }
          },
        },
      });
    } catch (falha) {
      mostrarAviso({ tom: "erro", texto: falha?.message || String(falha) });
    } finally {
      limparAjuste(id);
    }
  };

  const salvarRapida = async ({ titulo, tipo }) => {
    setSalvando(true);
    try {
      if (tipo === "tarefa") {
        const eu = membros.find((membro) => membro.id === usuarioId);
        await api.tarefas.criar({
          titulo,
          venceEm: new Date(rapida.inicio).getTime(),
          responsaveis: usuarioId ? [usuarioId] : [],
          responsavel: eu ? (eu.displayName || eu.name || "") : nomeCurto(sessao?.usuario?.perfil, ""),
          contactId: null,
        });
        await aoRecarregarDados();
      } else {
        await api.agenda.criar({
          titulo,
          inicio: rapida.inicio,
          fim: rapida.fim,
          tipo: "appointment",
          visibilidade: "personal",
          categoryId: categorias[0]?.id,
          lembretes: contexto?.preference?.defaultReminderMinutes || [30],
        });
      }
      setRapida(null);
      await carregar({ silencioso: true });
      mostrarAviso({ texto: tipo === "tarefa" ? "Tarefa criada." : "Compromisso marcado." });
    } catch (falha) {
      mostrarAviso({ tom: "erro", texto: falha?.message || String(falha) });
    } finally { setSalvando(false); }
  };

  const maisOpcoesRapida = ({ titulo, tipo }) => {
    const abertura = rapida;
    setRapida(null);
    if (tipo === "tarefa") {
      setTarefaAberta({ titulo, venceEm: new Date(abertura.inicio).getTime() });
      return;
    }
    const inicio = new Date(abertura.inicio);
    const fim = new Date(abertura.fim);
    abrirFormulario({ dia: inicio, inicio: inicio.getHours() * 60 + inicio.getMinutes(), fim: fim.getHours() * 60 + fim.getMinutes() || 24 * 60, titulo });
  };

  const marcarLida = async (item) => { if (!item.lidaEm) await api.agenda.notificacaoLida({ id: item.id }); await carregar({ silencioso: true }); };
  const decidirSolicitacao = async (item, decisao, motivo) => {
    setSolicitacaoOcupada(item.id);
    try {
      await api.agenda.solicitacaoDecidir({ id: item.id, decisao, motivo });
      await carregar({ silencioso: true });
      mostrarAviso({ texto: decisao === "approve" ? "Pedido aprovado. O cliente será avisado." : "Pedido recusado. O cliente será avisado." });
    } catch (falha) {
      mostrarAviso({ tom: "erro", texto: falha?.message || String(falha) });
    } finally { setSolicitacaoOcupada(""); }
  };
  const alternarPainel = (tipo) => setPainel((atual) => (atual === tipo ? null : tipo));
  const irParaDia = (dia) => { setReferencia(dia); setVisualizacao("day"); };

  const podeMover = (evento) => (evento.sourceType === "task"
    ? Boolean(usuarioId) && idsDosResponsaveis(evento).includes(usuarioId)
    : eventoEditavel(evento, usuarioId, papel));
  const podeConcluir = (evento) => evento.sourceType === "task" && Boolean(tarefaDoEvento(evento));

  const algoAberto = Boolean(dialogo || detalhe || confirmacao || rapida || painel || tarefaAberta !== undefined);

  /**
   * Atalhos de teclado. Numa ferramenta aberta o dia inteiro, trocar de semana
   * pelo mouse é o gesto mais repetido do dia.
   */
  useEffect(() => {
    const teclado = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const alvo = e.target;
      if (alvo?.isContentEditable) return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(alvo?.tagName)) return;
      if (algoAberto) return;
      const tecla = e.key.toLowerCase();
      const visao = VISUALIZACOES.find((item) => item.tecla === tecla);
      if (visao) { e.preventDefault(); setVisualizacao(visao.id); return; }
      if (tecla === "t" || tecla === "h") { e.preventDefault(); setReferencia(new Date()); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); navegar(-1); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); navegar(1); return; }
      if (tecla === "n") { e.preventDefault(); abrirFormulario(); return; }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); ajustarZoom(1); return; }
      if (e.key === "-" || e.key === "_") { e.preventDefault(); ajustarZoom(-1); }
    };
    window.addEventListener("keydown", teclado);
    return () => window.removeEventListener("keydown", teclado);
  });

  /**
   * Deslizar para os lados troca de dia, semana ou mês no telefone. Só conta
   * gesto claramente horizontal: rolar a lista com o dedo um pouco torto não
   * pode pular de dia.
   */
  const aoTocar = (e) => {
    const ponto = e.touches[0];
    toque.current = { x: ponto.clientX, y: ponto.clientY, t: Date.now() };
  };
  const aoSoltar = (e) => {
    const inicio = toque.current;
    toque.current = null;
    if (!inicio) return;
    const ponto = e.changedTouches[0];
    const dx = ponto.clientX - inicio.x;
    const dy = ponto.clientY - inicio.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - inicio.t > 700) return;
    navegar(dx < 0 ? 1 : -1);
  };

  const ehHojeNaTela = visualizacao === "day"
    ? chaveDia(referencia) === hojeChave
    : intervalo.de <= new Date() && intervalo.ate > new Date() && (visualizacao !== "month" || referencia.getMonth() === new Date().getMonth());

  const itensMenu = [
    { id: "filtros", rotulo: "Filtros", icone: SlidersHorizontal, contador: 0, acao: () => setPainel("filters"), soCelular: true },
    { id: "tarefas", rotulo: "Ver todas as tarefas", icone: SquareCheckBig, acao: aoIrParaTarefas },
    ...(gerencial ? [{ id: "pedidos", rotulo: "Pedidos de horário", icone: CalendarClock, contador: solicitacoesPendentes, acao: () => setPainel("requests") }] : []),
    { id: "prefs", rotulo: "Preferências", icone: Settings2, acao: () => setPainel("settings") },
  ];

  const botaoIcone = "relative flex h-11 w-11 flex-none cursor-pointer items-center justify-center rounded-ctl text-sub hover:bg-surface-hover hover:text-fg md:h-9 md:w-9";

  const conteudoPrincipal = carregando ? (
    <Esqueleto lista={estreito} />
  ) : estreito && visualizacao === "month" ? (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="rounded-none border border-line bg-bg px-2 pb-1 pt-2">
        <MiniCalendario
          grande
          mes={referencia}
          selecionado={referencia}
          marcas={marcas}
          aoEscolher={(dia) => setReferencia(dia)}
          aoMudarMes={(direcao) => navegar(direcao)}
        />
      </div>
      <VisaoLista dias={[referencia]} eventos={filtrados} modoCor={modoCor} cores={cores} aoAbrir={abrirEvento} aoCriar={(dia) => abrirNovo(dia)} aoConcluir={concluirTarefa} podeConcluir={podeConcluir} />
    </div>
  ) : estreito ? (
    <VisaoLista
      dias={visualizacao === "day" ? [referencia] : dias.slice(0, 7)}
      eventos={filtrados}
      modoCor={modoCor}
      cores={cores}
      rotuloDia={visualizacao !== "day"}
      aoAbrir={abrirEvento}
      aoCriar={(dia) => abrirNovo(dia)}
      aoConcluir={concluirTarefa}
      podeConcluir={podeConcluir}
    />
  ) : visualizacao === "month" ? (
    <VisaoMes dias={dias} referencia={referencia} eventos={filtrados} aoAbrir={abrirEvento} aoCriar={(dia) => abrirNovo(dia)} aoVerDia={irParaDia} modoCor={modoCor} cores={cores} />
  ) : (
    <GradeAgenda
      dias={visualizacao === "day" ? [referencia] : dias.slice(0, 7)}
      eventos={filtrados}
      inicioMinuto={faixa.inicio}
      fimMinuto={faixa.fim}
      inicioExpediente={inicioExpediente}
      fimExpediente={fimExpediente}
      alturaHora={alturaHora}
      modoCor={modoCor}
      cores={cores}
      agruparPorPessoa={porPessoa}
      membros={membros}
      podeMover={podeMover}
      aoAbrir={abrirEvento}
      aoCriar={abrirNovo}
      aoMover={mover}
      aoRedimensionar={redimensionar}
      aoAjustarZoom={ajustarZoom}
      aoVerDia={irParaDia}
    />
  );

  const painelInfo = painel && TITULOS_PAINEL[painel];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Computador: título, busca e as duas criações à vista. */}
      <div className="hidden md:block">
        <CabecalhoTela
          titulo="Agenda"
          busca={<CampoBusca valor={busca} aoMudar={setBusca} placeholder="Buscar na agenda…" />}
          acao={(
            <div className="flex items-center gap-2">
              <button type="button" aria-label={`Avisos${naoLidas ? ` (${naoLidas} novos)` : ""}`} onClick={() => alternarPainel("notifications")} className="relative flex h-11 w-11 cursor-pointer items-center justify-center rounded-ctl border border-line text-sub hover:border-line-strong hover:text-fg">
                <Bell size={18} />
                {naoLidas > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">{naoLidas}</span>}
              </button>
              <button type="button" onClick={() => setTarefaAberta(null)} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-ctl border border-line px-4 text-[14px] font-semibold text-fg hover:border-line-strong">
                <SquareCheckBig size={17} />Nova tarefa
              </button>
              <BotaoPrimario onClick={() => abrirFormulario()} title="Novo compromisso (N)"><Plus size={17} />Novo compromisso</BotaoPrimario>
            </div>
          )}
        />
      </div>

      {/* Telefone: uma linha de cabeçalho e o seletor de vista. A barra antiga
          quebrava em quatro linhas de botões antes do primeiro compromisso. */}
      <header className="flex-none border-b border-line bg-bg md:hidden">
        {buscaAberta ? (
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="relative min-w-0 flex-1">
              <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar na agenda…" aria-label="Buscar na agenda" className="min-h-11 w-full rounded-ctl border border-line bg-bg pl-10 pr-3 text-[16px] text-fg outline-none focus:border-accent" />
            </div>
            <button type="button" onClick={() => { setBusca(""); setBuscaAberta(false); }} className="min-h-11 cursor-pointer px-2 text-[15px] font-medium text-accent-forte">Fechar</button>
          </div>
        ) : (
          <div className="flex items-center gap-1 px-2 py-2">
            <button type="button" onClick={() => setPainel("periodo")} aria-label="Escolher data" className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-ctl px-2 text-left">
              <span className="truncate text-[19px] font-semibold first-letter:uppercase text-fg">{rotuloCurto(visualizacao, referencia)}</span>
              <ChevronDown size={18} className="flex-none text-sub" />
            </button>
            <button type="button" aria-label="Buscar" onClick={() => setBuscaAberta(true)} className={botaoIcone}><Search size={20} /></button>
            <button type="button" aria-label={`Avisos${naoLidas ? ` (${naoLidas} novos)` : ""}`} onClick={() => setPainel("notifications")} className={botaoIcone}>
              <Bell size={20} />
              {naoLidas > 0 && <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">{naoLidas}</span>}
            </button>
            <MenuMais itens={itensMenu.map((item) => (item.id === "filtros" ? { ...item, rotulo: quantosFiltros ? `Filtros (${quantosFiltros})` : "Filtros" } : item))} />
          </div>
        )}
        <div className="flex items-center gap-2 px-3 pb-2">
          <Segmentado rotulo="Visualização" className="flex-1" valor={visualizacao} aoMudar={setVisualizacao} opcoes={VISUALIZACOES} />
          {!ehHojeNaTela && (
            <button type="button" onClick={() => setReferencia(new Date())} className="min-h-11 flex-none cursor-pointer rounded-ctl border border-line px-3 text-[14px] font-semibold text-fg">Hoje</button>
          )}
        </div>
        {visualizacao !== "month" && <FaixaDias referencia={referencia} marcas={marcas} aoEscolher={(dia) => { setReferencia(dia); setVisualizacao("day"); }} />}
        {(quantosFiltros > 0 || busca) && (
          <div className="flex items-center gap-2 border-t border-line bg-accent-soft/40 px-4 py-1.5 text-[13px] text-accent-forte">
            <SlidersHorizontal size={14} />
            <span className="flex-1 truncate">{busca ? `Buscando “${busca}”` : `${quantosFiltros} ${quantosFiltros === 1 ? "filtro ativo" : "filtros ativos"}`}</span>
            <button type="button" onClick={() => { setBusca(""); mudarFiltros({ profissional: "mine", categoria: "", contato: "" }); }} className="min-h-9 cursor-pointer px-1 font-semibold">Limpar</button>
          </div>
        )}
      </header>

      {/* Computador: uma linha só. Navegação à esquerda, vista no meio,
          filtros e o resto à direita, com o nome escrito. */}
      <div className="hidden flex-none flex-wrap items-center gap-2 border-b border-line bg-bg px-4 py-2.5 md:flex lg:px-5">
        <button type="button" onClick={() => setLateral((atual) => !atual)} aria-pressed={lateral} title={lateral ? "Esconder a coluna de hoje" : "Mostrar a coluna de hoje"} aria-label="Coluna de hoje" className={`hidden lg:flex ${botaoIcone} ${lateral ? "bg-accent-soft text-accent-forte" : ""}`}>
          <PanelLeft size={18} />
        </button>
        <button type="button" onClick={() => setReferencia(new Date())} title="Ir para hoje (T)" className="min-h-9 cursor-pointer rounded-ctl border border-line px-3 text-[12.5px] font-semibold text-fg hover:border-line-strong">Hoje</button>
        <div className="flex">
          <button type="button" aria-label="Período anterior" title="Período anterior (←)" onClick={() => navegar(-1)} className={botaoIcone}><ChevronLeft size={18} /></button>
          <button type="button" aria-label="Próximo período" title="Próximo período (→)" onClick={() => navegar(1)} className={botaoIcone}><ChevronRight size={18} /></button>
        </div>
        <h2 className="min-w-[170px] text-[15px] font-semibold text-fg first-letter:uppercase">{rotuloPeriodo(visualizacao, referencia)}</h2>

        <Segmentado rotulo="Visualização" className="ml-auto" valor={visualizacao} aoMudar={setVisualizacao} opcoes={VISUALIZACOES.map((item) => ({ ...item, dica: `${item.rotulo} (${item.tecla.toUpperCase()})` }))} />

        <button
          type="button"
          onClick={() => alternarPainel("filters")}
          className={`flex min-h-9 cursor-pointer items-center gap-1.5 rounded-ctl border px-3 text-[12.5px] font-semibold ${quantosFiltros ? "border-accent bg-accent-soft text-accent-forte" : "border-line text-fg hover:border-line-strong"}`}
        >
          <SlidersHorizontal size={15} />Filtros{quantosFiltros > 0 && <span className="rounded-full bg-accent px-1.5 text-[10.5px] leading-4 text-white">{quantosFiltros}</span>}
        </button>

        {visualizacao !== "month" && (
          <div className="flex items-center rounded-ctl border border-line" title="Zoom da régua (+ / −, ou Ctrl + roda)">
            <button type="button" aria-label="Diminuir zoom" disabled={zoom === 0} onClick={() => ajustarZoom(-1)} className="flex h-9 w-8 cursor-pointer items-center justify-center text-sub hover:text-fg disabled:opacity-30"><Minus size={14} /></button>
            <span className="px-1 text-[11px] font-semibold tabular-nums text-sub">{Math.round((alturaHora / NIVEIS_ZOOM[ZOOM_PADRAO]) * 100)}%</span>
            <button type="button" aria-label="Aumentar zoom" disabled={zoom === NIVEIS_ZOOM.length - 1} onClick={() => ajustarZoom(1)} className="flex h-9 w-8 cursor-pointer items-center justify-center text-sub hover:text-fg disabled:opacity-30"><Plus size={14} /></button>
          </div>
        )}
        <MenuMais itens={itensMenu.filter((item) => !item.soCelular)} />
      </div>

      <div className="flex min-h-0 flex-1">
        {lateral && !estreito && (
          <BarraLateral
            referencia={referencia}
            visualizacao={visualizacao}
            marcas={marcas}
            itensHoje={itensHoje.filter((item) => !(item.tarefa && ajustes[item.tarefa.id]?.oculto))}
            atrasadas={atrasadas}
            aoEscolherDia={(dia) => setReferencia(dia)}
            aoAbrirEvento={abrirEvento}
            aoAbrirTarefa={(tarefa) => setTarefaAberta(tarefa)}
            aoConcluirTarefa={concluirTarefa}
            aoNovaTarefa={() => setTarefaAberta({ venceEm: dataComMinutos(new Date(), 18 * 60).getTime() > Date.now() ? dataComMinutos(new Date(), 18 * 60).getTime() : null })}
            aoIrParaTarefas={aoIrParaTarefas}
          />
        )}
        <div
          className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface p-2 md:p-4"
          onTouchStart={estreito ? aoTocar : undefined}
          onTouchEnd={estreito ? aoSoltar : undefined}
        >
          {erroCarga && (
            <div role="alert" className="mb-3 flex items-center gap-2 rounded-ctl border border-danger/25 bg-danger/10 px-3 py-2 text-[14px] text-danger md:text-[12px]">
              <span className="flex-1">{erroCarga}</span>
              <button type="button" onClick={() => carregar()} className="flex min-h-9 flex-none cursor-pointer items-center gap-1.5 rounded-ctl px-2 font-semibold hover:bg-danger/10"><RefreshCw size={14} />Tentar de novo</button>
            </div>
          )}
          {conteudoPrincipal}
          {!carregando && !estreito && <ResumoHoras totais={totais} modoCor={modoCor} />}
        </div>
      </div>

      {/* "+" do telefone, acima do dock. */}
      <button type="button" onClick={() => setPainel("novo")} aria-label="Criar" className="botao-novo-flutuante h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-accent text-white  active:scale-95">
        <Plus size={26} strokeWidth={2.4} />
      </button>

      <Aviso aviso={aviso} aoFechar={fecharAviso} />

      {painelInfo && (
        <Folha titulo={painelInfo.titulo} icone={painelInfo.icone} lado="direita" aoFechar={() => setPainel(null)} rodape={painel === "filters" ? (
          <>
            {quantosFiltros > 0 && <button type="button" onClick={() => mudarFiltros({ profissional: "mine", categoria: "", contato: "" })} className="min-h-11 cursor-pointer rounded-ctl px-3 text-[14px] font-medium text-sub hover:text-fg md:min-h-9 md:text-[13px]">Limpar</button>}
            <BotaoPrimario type="button" onClick={() => setPainel(null)} className="!min-h-11 ml-auto !flex-1 !py-2 md:!min-h-9 md:!flex-none">Ver agenda</BotaoPrimario>
          </>
        ) : null}
        >
          {painel === "filters" && (
            <PainelFiltros
              filtros={filtros}
              aoMudar={mudarFiltros}
              membros={membros}
              usuarioId={usuarioId}
              categorias={categorias}
              contatos={contatos}
              podeAgrupar={!estreito}
            />
          )}
          {painel === "notifications" && <PainelNotificacoes contexto={contexto} notificacoes={notificacoes} aoAtualizar={async () => carregar({ silencioso: true })} aoMarcarLida={marcarLida} />}
          {painel === "requests" && <PainelSolicitacoes solicitacoes={solicitacoes} ocupado={solicitacaoOcupada} aoDecidir={decidirSolicitacao} />}
          {painel === "settings" && <PainelPreferencias contexto={contexto} visualizacao={visualizacao} aoSalvar={async (form) => { await api.agenda.preferenciasAtualizar(form); await carregar({ silencioso: true }); }} aoSalvarCategoria={async (item) => { await api.agenda.categoriaSalvar(item); await carregar({ silencioso: true }); }} />}
        </Folha>
      )}

      {painel === "periodo" && (
        <Folha titulo="Ir para a data" icone={CalendarDays} aoFechar={() => setPainel(null)}>
          <div className="p-4">
            <MiniCalendario
              grande
              mes={referencia}
              selecionado={referencia}
              marcas={marcas}
              aoEscolher={(dia) => { setReferencia(dia); setPainel(null); }}
              aoMudarMes={(direcao) => setReferencia((atual) => new Date(atual.getFullYear(), atual.getMonth() + direcao, 1))}
            />
            <button type="button" onClick={() => { setReferencia(new Date()); setPainel(null); }} className="mt-3 min-h-11 w-full cursor-pointer rounded-ctl border border-line text-[15px] font-semibold text-fg">Voltar para hoje</button>
          </div>
        </Folha>
      )}

      {painel === "novo" && (
        <Folha titulo="Criar" aoFechar={() => setPainel(null)}>
          <div className="grid gap-2 p-4">
            <button type="button" onClick={() => { setPainel(null); abrirFormulario(); }} className="flex min-h-16 cursor-pointer items-center gap-3 rounded-none border border-line px-4 text-left hover:border-accent">
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-none bg-accent-soft text-accent-forte"><CalendarDays size={21} /></span>
              <span><span className="block text-[16px] font-semibold text-fg">Compromisso</span><span className="block text-[13px] text-sub">Com dia e hora marcados, na agenda.</span></span>
            </button>
            <button type="button" onClick={() => { setPainel(null); setTarefaAberta(chaveDia(referencia) === hojeChave ? null : { venceEm: dataComMinutos(referencia, 9 * 60).getTime() }); }} className="flex min-h-16 cursor-pointer items-center gap-3 rounded-none border border-line px-4 text-left hover:border-accent">
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-none bg-[#D97706]/10 text-[#B45309]"><SquareCheckBig size={21} /></span>
              <span><span className="block text-[16px] font-semibold text-fg">Tarefa</span><span className="block text-[13px] text-sub">Algo a fazer, com prazo e responsável.</span></span>
            </button>
          </div>
        </Folha>
      )}

      {rapida && <CriacaoRapida abertura={rapida} salvando={salvando} aoSalvar={salvarRapida} aoMaisOpcoes={maisOpcoesRapida} aoFechar={() => setRapida(null)} />}

      {detalhe && (
        <DetalheEvento
          evento={detalhe}
          usuarioId={usuarioId}
          contato={contatos.find((item) => item.id === detalhe.contactId) || null}
          podeEditar={detalhe.sourceType === "task" ? Boolean(tarefaDoEvento(detalhe)) : eventoEditavel(detalhe, usuarioId, papel)}
          podeMover={podeMover(detalhe)}
          podeConcluir={podeConcluir(detalhe)}
          aoEditar={() => {
            const alvo = detalhe;
            setDetalhe(null);
            if (alvo.sourceType === "task") { setTarefaAberta(tarefaDoEvento(alvo)); return; }
            setErroDialogo("");
            setDialogo({ evento: alvo, abertura: null });
          }}
          aoExcluir={() => excluirEvento(detalhe)}
          aoReagendar={(delta, rotulo) => reagendar(detalhe, delta, rotulo)}
          aoConcluir={() => concluirTarefa(detalhe)}
          aoAbrirContato={(item) => { setDetalhe(null); aoAbrirContato(item); }}
          aoFechar={() => setDetalhe(null)}
        />
      )}

      <DialogoEvento
        aberto={Boolean(dialogo)}
        evento={dialogo?.evento}
        abertura={dialogo?.abertura}
        categorias={categorias}
        contatos={contatos}
        lembretesPadrao={contexto?.preference?.defaultReminderMinutes || [30]}
        salvando={salvando}
        erro={erroDialogo}
        aoFechar={() => { setDialogo(null); setErroDialogo(""); }}
        aoSalvar={salvarEvento}
        aoExcluir={() => excluirEvento(dialogo?.evento)}
      />

      {tarefaAberta !== undefined && (
        <FormularioTarefa
          key={tarefaAberta?.id || "nova"}
          tarefa={tarefaAberta}
          contatoIdInicial={tarefaAberta?.contactId}
          contatos={contatos}
          equipe={equipe}
          usuarioId={usuarioId}
          aoFechar={() => setTarefaAberta(undefined)}
          aoSalvo={(texto) => mostrarAviso({ texto })}
          recarregar={async () => { await Promise.all([aoRecarregarDados(), carregar({ silencioso: true })]); }}
        />
      )}

      <DialogoConfirmar pedido={confirmacao} aoFechar={() => setConfirmacao(null)} />
    </div>
  );
}

export const agendaInternals = { inicioDaSemana, chaveDia, dataLocal, horaLocal, isoLocal, eventoParaFormulario, intervaloDaVisao, somarPorTipo, adicionarDias };
