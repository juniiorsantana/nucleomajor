import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  ContactRound,
  ListFilter,
  PanelRightClose,
  Plus,
  Settings2,
  SquareCheckBig,
  X,
} from "lucide-react";
import { api } from "../../data/client";
import { BotaoPrimario, CabecalhoTela, CampoBusca } from "../ui";
import DialogoEvento from "./agenda/DialogoEvento";
import GradeAgenda from "./agenda/GradeAgenda";
import VisaoMes from "./agenda/VisaoMes";
import {
  adicionarDias,
  chaveDia,
  dataLocal,
  diasDoIntervalo,
  eventoEditavel,
  eventoParaFormulario,
  eventoVisivelNoFiltro,
  formatarDuracao,
  horaLocal,
  inicioDaSemana,
  intervaloDaVisao,
  isoLocal,
  minutosDoHorario,
  navegarReferencia,
  rotuloPeriodo,
  somarPorCategoria,
} from "./agenda/agendaUtils";

const VISUALIZACOES = [
  { id: "day", rotulo: "Dia" },
  { id: "week", rotulo: "Semana" },
  { id: "month", rotulo: "Mês" },
];
const PAINEIS = {
  tasks: { titulo: "Tarefas", icone: SquareCheckBig },
  contacts: { titulo: "Contatos", icone: ContactRound },
  notifications: { titulo: "Notificações", icone: Bell },
  settings: { titulo: "Preferências", icone: Settings2 },
};

function dataComMinutos(dia, minutos) {
  return new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), Math.floor(minutos / 60), minutos % 60, 0, 0);
}

function formatarDataHora(valor) {
  if (!valor) return "";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(valor)).replaceAll(".", "");
}

function nomeContato(contato) {
  return contato?.nome || contato?.name || "Sem nome";
}

function tituloTarefa(tarefa) {
  return tarefa?.titulo || tarefa?.title || "Tarefa sem título";
}

function idContatoDaTarefa(tarefa) {
  return tarefa?.contatoId || tarefa?.contactId || tarefa?.contact_id || null;
}

function DetalheEvento({ evento, aoFechar }) {
  useEffect(() => {
    if (!evento) return undefined;
    const teclado = (e) => { if (e.key === "Escape") aoFechar(); };
    window.addEventListener("keydown", teclado);
    return () => window.removeEventListener("keydown", teclado);
  }, [aoFechar, evento]);
  if (!evento) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f1424]/55 p-4 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="agenda-detalhe-titulo" className="w-full max-w-md rounded-[15px] border border-line bg-bg p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="mt-1 h-3 w-3 flex-none rounded-full" style={{ backgroundColor: evento.categoryColor || "#8B7CFF" }} />
          <div className="min-w-0 flex-1">
            <h2 id="agenda-detalhe-titulo" className="text-[16px] font-semibold text-fg">{evento.titulo}</h2>
            <p className="mt-1 text-[12px] text-sub">{evento.diaInteiro ? "Dia inteiro" : `${formatarDataHora(evento.inicio)}–${horaLocal(evento.fim)}`}</p>
          </div>
          <button type="button" onClick={aoFechar} className="cursor-pointer rounded-[8px] p-1.5 text-sub hover:bg-surface-hover"><X size={16} /></button>
        </div>
        <dl className="mt-5 grid gap-3 text-[12px]">
          <div><dt className="text-faint">Responsável</dt><dd className="mt-0.5 font-medium text-fg">{evento.ownerName || "Não informado"}</dd></div>
          {evento.categoryName && <div><dt className="text-faint">Categoria</dt><dd className="mt-0.5 font-medium text-fg">{evento.categoryName}</dd></div>}
          {evento.local && <div><dt className="text-faint">Local</dt><dd className="mt-0.5 text-fg">{evento.local}</dd></div>}
          {evento.descricao && <div><dt className="text-faint">Descrição</dt><dd className="mt-0.5 whitespace-pre-wrap text-fg">{evento.descricao}</dd></div>}
        </dl>
      </section>
    </div>
  );
}

function ResumoHoras({ totais }) {
  const total = totais.reduce((soma, item) => soma + item.minutos, 0);
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 border-y border-line bg-bg px-4 py-2 text-[10.5px]">
      {totais.length ? totais.slice(0, 6).map((item) => (
        <span key={item.nome} className="flex items-center gap-1.5 text-sub"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.cor }} />{item.nome} <strong className="text-fg">{formatarDuracao(item.minutos)}</strong></span>
      )) : <span className="text-faint">Nenhum horário ocupado neste período.</span>}
      <span className="ml-auto font-semibold text-sub">{formatarDuracao(total)} agendado</span>
    </div>
  );
}

function PainelLateral({ tipo, aoFechar, children }) {
  if (!tipo) return null;
  const painel = PAINEIS[tipo];
  const Icone = painel.icone;
  return (
    <aside className="absolute inset-y-0 right-0 z-30 flex w-[min(380px,94vw)] flex-col border-l border-line bg-bg shadow-2xl">
      <header className="flex items-center gap-2 border-b border-line px-4 py-4">
        <Icone size={17} className="text-accent-forte" />
        <h2 className="text-[14px] font-semibold text-fg">{painel.titulo}</h2>
        <button type="button" aria-label="Fechar painel" onClick={aoFechar} className="ml-auto cursor-pointer rounded-[8px] p-1.5 text-sub hover:bg-surface-hover"><PanelRightClose size={17} /></button>
      </header>
      <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}

function PainelTarefas({ tarefas, contatos, aoAbrir }) {
  const [busca, setBusca] = useState("");
  const visiveis = tarefas.filter((tarefa) => !tarefa.concluida && !tarefa.completed && (!busca.trim() || tituloTarefa(tarefa).toLowerCase().includes(busca.trim().toLowerCase())));
  return (
    <div className="p-4">
      <input value={busca} onChange={(e) => setBusca(e.target.value)} className="w-full rounded-[9px] border border-line bg-bg px-3 py-2 text-[12px] text-fg outline-none focus:border-accent" placeholder="Buscar tarefas…" />
      <p className="mt-3 text-[10.5px] text-faint">Tarefas com prazo aparecem automaticamente na agenda, sem criar uma cópia.</p>
      <div className="mt-4 space-y-2">
        {visiveis.map((tarefa) => {
          const contato = contatos.find((item) => item.id === idContatoDaTarefa(tarefa));
          return (
            <button key={tarefa.id} type="button" onClick={() => aoAbrir(tarefa)} className="group flex w-full cursor-pointer items-start gap-3 rounded-[10px] border border-line p-3 text-left hover:border-line-strong hover:bg-surface/60">
              <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border border-line-strong text-transparent group-hover:border-accent group-hover:text-accent"><Check size={12} /></span>
              <span className="min-w-0 flex-1"><span className="block text-[12px] font-medium text-fg">{tituloTarefa(tarefa)}</span><span className="mt-1 block truncate text-[10.5px] text-faint">{contato ? nomeContato(contato) : "Sem contato"}{tarefa.prazo || tarefa.dueAt ? ` · ${formatarDataHora(tarefa.prazo || tarefa.dueAt)}` : " · sem prazo"}</span></span>
            </button>
          );
        })}
        {!visiveis.length && <p className="py-10 text-center text-[12px] text-faint">Nenhuma tarefa corresponde à busca.</p>}
      </div>
    </div>
  );
}

function PainelContatos({ contatos, selecionado, aoFiltrar, aoAbrir }) {
  const [busca, setBusca] = useState("");
  const visiveis = contatos.filter((contato) => !busca.trim() || `${nomeContato(contato)} ${contato.empresa || ""}`.toLowerCase().includes(busca.trim().toLowerCase()));
  return (
    <div className="p-4">
      <input value={busca} onChange={(e) => setBusca(e.target.value)} className="w-full rounded-[9px] border border-line bg-bg px-3 py-2 text-[12px] text-fg outline-none focus:border-accent" placeholder="Buscar contatos…" />
      <div className="mt-4 space-y-2">
        {visiveis.map((contato) => (
          <div key={contato.id} className={`flex items-center gap-3 rounded-[10px] border p-3 ${selecionado === contato.id ? "border-accent bg-accent-soft" : "border-line"}`}>
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-surface text-[11px] font-bold text-sub">{nomeContato(contato).split(/\s+/).slice(0, 2).map((parte) => parte[0]).join("").toUpperCase()}</span>
            <button type="button" onClick={() => aoFiltrar(contato.id)} className="min-w-0 flex-1 cursor-pointer text-left"><span className="block truncate text-[12px] font-medium text-fg">{nomeContato(contato)}</span><span className="block truncate text-[10.5px] text-faint">{contato.empresa || contato.telefone || "Contato do CRM"}</span></button>
            <button type="button" onClick={() => aoAbrir(contato)} className="cursor-pointer rounded-[7px] p-1.5 text-sub hover:bg-surface-hover" title="Abrir ficha"><ChevronRight size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PainelNotificacoes({ contexto, notificacoes, aoAtualizar, aoMarcarLida }) {
  const [telefone, setTelefone] = useState("");
  const [verificacaoId, setVerificacaoId] = useState(null);
  const [codigo, setCodigo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const preferencia = contexto?.preference || {};
  const solicitar = async (e) => {
    e.preventDefault(); setOcupado(true); setErro("");
    try { const resposta = await api.agenda.telefoneSolicitar({ telefone }); setVerificacaoId(resposta.verificacaoId); }
    catch (falha) { setErro(falha?.message || String(falha)); }
    finally { setOcupado(false); }
  };
  const confirmar = async (e) => {
    e.preventDefault(); setOcupado(true); setErro("");
    try { await api.agenda.telefoneConfirmar({ verificacaoId, codigo }); setVerificacaoId(null); setCodigo(""); await aoAtualizar(); }
    catch (falha) { setErro(falha?.message || String(falha)); }
    finally { setOcupado(false); }
  };
  return (
    <div>
      <section className="border-b border-line p-4">
        <h3 className="text-[12px] font-semibold text-fg">WhatsApp do profissional</h3>
        {preferencia.phoneVerified ? (
          <div className="mt-3 flex items-center gap-2 rounded-[9px] border border-success/25 bg-success-soft px-3 py-2 text-[11.5px] text-success"><Check size={14} />Número terminado em {preferencia.phoneLast4} verificado</div>
        ) : verificacaoId ? (
          <form onSubmit={confirmar} className="mt-3"><p className="text-[10.5px] text-sub">Digite o código enviado pelo número da empresa.</p><div className="mt-2 flex gap-2"><input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} className="min-w-0 flex-1 rounded-[8px] border border-line px-3 py-2 text-[13px] tracking-[0.2em] text-fg" placeholder="000000" /><button disabled={ocupado} className="cursor-pointer rounded-[8px] bg-accent px-3 text-[11px] font-semibold text-white disabled:opacity-40">Confirmar</button></div></form>
        ) : (
          <form onSubmit={solicitar} className="mt-3"><p className="text-[10.5px] text-sub">O número corporativo enviará os lembretes ao seu telefone pessoal.</p><div className="mt-2 flex gap-2"><input required value={telefone} onChange={(e) => setTelefone(e.target.value)} className="min-w-0 flex-1 rounded-[8px] border border-line px-3 py-2 text-[12px] text-fg" placeholder="+55 65 99999-9999" /><button disabled={ocupado} className="cursor-pointer rounded-[8px] bg-accent px-3 text-[11px] font-semibold text-white disabled:opacity-40">Verificar</button></div></form>
        )}
        {erro && <p className="mt-2 text-[10.5px] text-danger">{erro}</p>}
      </section>
      <section className="p-4">
        <h3 className="text-[12px] font-semibold text-fg">Histórico</h3>
        <div className="mt-3 space-y-2">
          {notificacoes.map((item) => (
            <button key={item.id} type="button" onClick={() => aoMarcarLida(item)} className={`w-full cursor-pointer rounded-[9px] border p-3 text-left ${item.lidaEm ? "border-line" : "border-accent/35 bg-accent-soft/45"}`}>
              <span className="block text-[11.5px] font-medium text-fg">{item.titulo}</span>
              <span className="mt-1 block text-[10px] text-faint">{item.canal === "whatsapp" ? "WhatsApp" : "EmyLeads"} · {formatarDataHora(item.lembrarEm)} · {item.erro ? `Falhou: ${item.erro}` : item.status}</span>
            </button>
          ))}
          {!notificacoes.length && <p className="py-8 text-center text-[11.5px] text-faint">Nenhum lembrete neste período.</p>}
        </div>
      </section>
    </div>
  );
}

function LinhaCategoria({ categoria, aoSalvar }) {
  const [nome, setNome] = useState(categoria.name);
  const [cor, setCor] = useState(categoria.color);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { setNome(categoria.name); setCor(categoria.color); }, [categoria.color, categoria.name]);
  return (
    <div className="flex items-center gap-2">
      <input type="color" aria-label={`Cor de ${categoria.name}`} value={cor} onChange={(e) => setCor(e.target.value.toUpperCase())} className="h-9 w-10 cursor-pointer rounded-[7px] border border-line bg-bg p-1" />
      <input value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} className="min-w-0 flex-1 rounded-[8px] border border-line bg-bg px-3 py-2 text-[11.5px] text-fg" />
      <button type="button" disabled={ocupado || !nome.trim()} onClick={async () => { setOcupado(true); try { await aoSalvar({ id: categoria.id, nome, cor }); } finally { setOcupado(false); } }} className="cursor-pointer rounded-[8px] border border-line px-2.5 py-2 text-[10.5px] font-semibold text-sub hover:border-line-strong disabled:opacity-40">Salvar</button>
    </div>
  );
}

function PainelPreferencias({ contexto, visualizacao, aoSalvar, aoSalvarCategoria }) {
  const preferencia = contexto?.preference || {};
  const categorias = contexto?.categories || [];
  const podeCategorias = ["owner", "admin"].includes(contexto?.papel);
  const [form, setForm] = useState(() => ({
    visualizacao: preferencia.defaultView || visualizacao,
    inicioDia: String(preferencia.dayStart || "08:00").slice(0, 5),
    fimDia: String(preferencia.dayEnd || "18:00").slice(0, 5),
    notificacaoInterna: preferencia.inAppEnabled !== false,
    whatsapp: Boolean(preferencia.whatsappEnabled),
  }));
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [novaCategoria, setNovaCategoria] = useState("");
  const [novaCor, setNovaCor] = useState("#8B7CFF");
  const enviar = async (e) => {
    e.preventDefault(); setSalvando(true); setMensagem("");
    try { await aoSalvar({ ...form, lembretes: preferencia.defaultReminderMinutes || [30] }); setMensagem("Preferências salvas."); }
    catch (erro) { setMensagem(erro?.message || String(erro)); }
    finally { setSalvando(false); }
  };
  const salvarCategoria = async (categoria) => {
    setMensagem("");
    try {
      await aoSalvarCategoria(categoria);
      setNovaCategoria("");
      setMensagem("Categorias atualizadas.");
    } catch (erro) { setMensagem(erro?.message || String(erro)); }
  };
  const entrada = "mt-1 w-full rounded-[8px] border border-line bg-bg px-3 py-2 text-[12px] text-fg";
  return (
    <div>
      <form onSubmit={enviar} className="space-y-4 p-4">
        <label className="block text-[11px] font-semibold text-sub">Visualização inicial<select className={entrada} value={form.visualizacao} onChange={(e) => setForm({ ...form, visualizacao: e.target.value })}>{VISUALIZACOES.map((item) => <option key={item.id} value={item.id}>{item.rotulo}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-[11px] font-semibold text-sub">Início do dia<input type="time" className={entrada} value={form.inicioDia} onChange={(e) => setForm({ ...form, inicioDia: e.target.value })} /></label><label className="text-[11px] font-semibold text-sub">Fim do dia<input type="time" className={entrada} value={form.fimDia} onChange={(e) => setForm({ ...form, fimDia: e.target.value })} /></label></div>
        <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-sub"><input type="checkbox" checked={form.notificacaoInterna} onChange={(e) => setForm({ ...form, notificacaoInterna: e.target.checked })} className="accent-accent" />Notificar dentro do EmyLeads</label>
        <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-sub"><input type="checkbox" disabled={!preferencia.phoneVerified} checked={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.checked })} className="accent-accent" />Enviar também pelo WhatsApp</label>
        {!preferencia.phoneVerified && <p className="text-[10px] text-faint">Verifique seu telefone em Notificações para habilitar o WhatsApp.</p>}
        <button disabled={salvando} className="w-full cursor-pointer rounded-[9px] bg-accent px-4 py-2.5 text-[12px] font-semibold text-white disabled:opacity-40">{salvando ? "Salvando…" : "Salvar preferências"}</button>
      </form>
      {podeCategorias && <section className="border-t border-line p-4">
        <h3 className="text-[12px] font-semibold text-fg">Categorias da empresa</h3>
        <p className="mt-1 text-[10.5px] text-faint">Cores e nomes aparecem para toda a organização.</p>
        <div className="mt-3 space-y-2">{categorias.map((categoria) => <LinhaCategoria key={categoria.id} categoria={categoria} aoSalvar={salvarCategoria} />)}</div>
        <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
          <input type="color" aria-label="Cor da nova categoria" value={novaCor} onChange={(e) => setNovaCor(e.target.value.toUpperCase())} className="h-9 w-10 cursor-pointer rounded-[7px] border border-line bg-bg p-1" />
          <input value={novaCategoria} maxLength={60} onChange={(e) => setNovaCategoria(e.target.value)} placeholder="Nova categoria" className="min-w-0 flex-1 rounded-[8px] border border-line bg-bg px-3 py-2 text-[11.5px] text-fg" />
          <button type="button" disabled={!novaCategoria.trim()} onClick={() => salvarCategoria({ nome: novaCategoria, cor: novaCor })} className="cursor-pointer rounded-[8px] bg-accent px-3 py-2 text-[10.5px] font-semibold text-white disabled:opacity-40"><Plus size={13} /></button>
        </div>
      </section>}
      {mensagem && <p className="px-4 pb-4 text-[10.5px] text-sub">{mensagem}</p>}
    </div>
  );
}

export default function Agenda({ dados = {}, aoAbrirContato = () => {}, aoAbrirTarefa = () => {}, aoRecarregarDados = async () => {} }) {
  const [visualizacao, setVisualizacao] = useState("week");
  const [referencia, setReferencia] = useState(new Date());
  const [eventos, setEventos] = useState([]);
  const [contexto, setContexto] = useState(null);
  const [notificacoes, setNotificacoes] = useState([]);
  const [filtroProfissional, setFiltroProfissional] = useState("mine");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroContato, setFiltroContato] = useState("");
  const [busca, setBusca] = useState("");
  const [painel, setPainel] = useState(null);
  const [dialogo, setDialogo] = useState(null);
  const [detalhe, setDetalhe] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const inicializado = useRef(false);

  const intervalo = useMemo(() => intervaloDaVisao(visualizacao, referencia), [referencia, visualizacao]);
  const dias = useMemo(() => diasDoIntervalo(intervalo.de, intervalo.ate), [intervalo]);

  const carregar = useCallback(async ({ silencioso = false } = {}) => {
    if (!silencioso) setCarregando(true);
    try {
      const [lista, proximoContexto, proximasNotificacoes] = await Promise.all([
        api.agenda.listar({ de: intervalo.de.toISOString(), ate: intervalo.ate.toISOString() }),
        api.agenda.contexto(),
        api.agenda.notificacoes({ limite: 60 }),
      ]);
      setEventos(lista);
      setContexto(proximoContexto);
      setNotificacoes(proximasNotificacoes);
      if (!inicializado.current) {
        setVisualizacao(proximoContexto?.preference?.defaultView || "week");
        inicializado.current = true;
      }
      setErro("");
    } catch (falha) {
      const mensagem = falha?.message || String(falha);
      setErro(/calendar_context|calendar_categories|calendar_events_list/i.test(mensagem)
        ? "A migration da Fase D ainda não foi aplicada no Supabase. Aplique-a e recarregue a extensão."
        : mensagem);
    } finally { setCarregando(false); }
  }, [intervalo.ate, intervalo.de]);

  useEffect(() => { carregar(); }, [carregar]);

  const categorias = contexto?.categories || [];
  const membros = contexto?.members || [];
  const usuarioId = contexto?.userId;
  const papel = contexto?.papel || "member";
  const contatos = dados.contatos || [];
  const tarefas = dados.tarefas || [];
  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return eventos.filter((evento) => {
      if (!eventoVisivelNoFiltro(evento, filtroProfissional, usuarioId)) return false;
      if (filtroCategoria && evento.categoryId !== filtroCategoria && evento.sourceType !== "task") return false;
      if (filtroContato && evento.contactId !== filtroContato) return false;
      return !termo || `${evento.titulo} ${evento.descricao} ${evento.ownerName} ${evento.categoryName}`.toLowerCase().includes(termo);
    });
  }, [busca, eventos, filtroCategoria, filtroContato, filtroProfissional, usuarioId]);

  const totais = useMemo(() => somarPorCategoria(filtrados), [filtrados]);
  const naoLidas = notificacoes.filter((item) => !item.lidaEm && item.status === "sent").length;
  const inicioMinuto = minutosDoHorario(String(contexto?.preference?.dayStart || contexto?.calendar?.dayStart || "05:00").slice(0, 5));
  const fimMinuto = minutosDoHorario(String(contexto?.preference?.dayEnd || contexto?.calendar?.dayEnd || "23:59").slice(0, 5));

  const abrirNovo = (dia = new Date(), inicio = 9 * 60, fim = 10 * 60) => {
    const comeco = dataComMinutos(dia, inicio);
    const termino = dataComMinutos(dia, fim);
    setDialogo({ evento: null, abertura: { inicio: comeco.toISOString(), fim: termino.toISOString(), categoryId: categorias[0]?.id, lembretes: contexto?.preference?.defaultReminderMinutes || [30] } });
  };
  const abrirEvento = (evento) => {
    if (evento.sourceType === "task") {
      const tarefa = tarefas.find((item) => item.id === (evento.taskId || evento.id));
      if (tarefa) aoAbrirTarefa(tarefa); else setDetalhe(evento);
      return;
    }
    if (eventoEditavel(evento, usuarioId, papel)) setDialogo({ evento, abertura: null }); else setDetalhe(evento);
  };
  const salvarEvento = async (payload) => {
    setSalvando(true); setErro("");
    try {
      if (dialogo?.evento?.id) await api.agenda.atualizar({ id: dialogo.evento.id, patch: payload }); else await api.agenda.criar(payload);
      setDialogo(null); await carregar({ silencioso: true });
    } catch (falha) { setErro(falha?.message || String(falha)); }
    finally { setSalvando(false); }
  };
  const excluirEvento = async () => {
    if (!dialogo?.evento?.id || !confirm("Excluir este evento da agenda?")) return;
    setSalvando(true);
    try { await api.agenda.remover({ id: dialogo.evento.id }); setDialogo(null); await carregar({ silencioso: true }); }
    catch (falha) { setErro(falha?.message || String(falha)); }
    finally { setSalvando(false); }
  };
  const mover = async (payload, dia, minutos) => {
    const inicio = dataComMinutos(dia, minutos);
    const duracao = new Date(payload.fim) - new Date(payload.inicio);
    try {
      if (payload.sourceType === "task") { await api.agenda.reagendarTarefa({ id: payload.id, inicio: inicio.toISOString() }); await aoRecarregarDados(); }
      else await api.agenda.atualizar({ id: payload.id, patch: { inicio: inicio.toISOString(), fim: new Date(inicio.getTime() + duracao).toISOString() } });
      await carregar({ silencioso: true });
    } catch (falha) { setErro(falha?.message || String(falha)); await carregar({ silencioso: true }); }
  };
  const redimensionar = async (evento, duracao) => {
    try { await api.agenda.atualizar({ id: evento.id, patch: { inicio: evento.inicio, fim: new Date(new Date(evento.inicio).getTime() + duracao * 60000).toISOString() } }); await carregar({ silencioso: true }); }
    catch (falha) { setErro(falha?.message || String(falha)); await carregar({ silencioso: true }); }
  };
  const marcarLida = async (item) => { if (!item.lidaEm) await api.agenda.notificacaoLida({ id: item.id }); await carregar({ silencioso: true }); };
  const alternarPainel = (tipo) => setPainel((atual) => atual === tipo ? null : tipo);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <CabecalhoTela titulo="Agenda" busca={<CampoBusca valor={busca} aoMudar={setBusca} placeholder="Buscar na agenda..." />} acao={<div className="flex items-center gap-2"><button type="button" aria-label="Notificações" onClick={() => alternarPainel("notifications")} className="relative cursor-pointer rounded-[9px] border border-line p-2.5 text-sub hover:border-line-strong hover:text-fg"><Bell size={17} />{naoLidas > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[8px] font-bold text-white">{naoLidas}</span>}</button><BotaoPrimario onClick={() => abrirNovo()}><Plus size={17} />Novo evento</BotaoPrimario></div>} />
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-bg px-3 py-3 md:px-5">
        <button type="button" onClick={() => setReferencia(new Date())} className="cursor-pointer rounded-[8px] border border-line px-3 py-2 text-[11.5px] font-semibold text-sub hover:border-line-strong hover:text-fg">Hoje</button>
        <div className="flex overflow-hidden rounded-[8px] border border-line"><button type="button" aria-label="Período anterior" onClick={() => setReferencia((atual) => navegarReferencia(visualizacao, atual, -1))} className="cursor-pointer border-r border-line p-2 text-sub hover:bg-surface-hover"><ChevronLeft size={15} /></button><button type="button" aria-label="Próximo período" onClick={() => setReferencia((atual) => navegarReferencia(visualizacao, atual, 1))} className="cursor-pointer p-2 text-sub hover:bg-surface-hover"><ChevronRight size={15} /></button></div>
        <span className="min-w-[185px] text-[13px] font-semibold capitalize text-fg">{rotuloPeriodo(visualizacao, referencia)}</span>
        <div className="flex rounded-[8px] bg-surface p-1">{VISUALIZACOES.map((item) => <button key={item.id} type="button" onClick={() => setVisualizacao(item.id)} className={`cursor-pointer rounded-[6px] px-3 py-1.5 text-[10.5px] font-semibold ${visualizacao === item.id ? "bg-bg text-fg shadow-sm" : "text-sub hover:text-fg"}`}>{item.rotulo}</button>)}</div>
        <span className="mx-1 h-5 border-l border-line" />
        <select value={filtroProfissional} onChange={(e) => setFiltroProfissional(e.target.value)} className="cursor-pointer rounded-[8px] border border-line bg-bg px-2.5 py-2 text-[11px] text-sub"><option value="mine">Minha agenda</option><option value="team">Toda a equipe</option>{membros.filter((membro) => membro.id !== usuarioId).map((membro) => <option key={membro.id} value={membro.id}>{membro.name}</option>)}</select>
        <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)} className="cursor-pointer rounded-[8px] border border-line bg-bg px-2.5 py-2 text-[11px] text-sub"><option value="">Todas as categorias</option>{categorias.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.name}</option>)}</select>
        {(filtroCategoria || filtroContato || filtroProfissional !== "mine") && <button type="button" onClick={() => { setFiltroCategoria(""); setFiltroContato(""); setFiltroProfissional("mine"); }} className="cursor-pointer rounded-[7px] p-2 text-faint hover:bg-surface-hover hover:text-fg" title="Limpar filtros"><X size={14} /></button>}
        <div className="ml-auto flex items-center gap-1"><button type="button" onClick={() => alternarPainel("tasks")} className={`cursor-pointer rounded-[8px] p-2 ${painel === "tasks" ? "bg-accent-soft text-accent-forte" : "text-sub hover:bg-surface-hover"}`} title="Tarefas"><SquareCheckBig size={16} /></button><button type="button" onClick={() => alternarPainel("contacts")} className={`cursor-pointer rounded-[8px] p-2 ${painel === "contacts" ? "bg-accent-soft text-accent-forte" : "text-sub hover:bg-surface-hover"}`} title="Contatos"><ContactRound size={16} /></button><button type="button" onClick={() => alternarPainel("settings")} className={`cursor-pointer rounded-[8px] p-2 ${painel === "settings" ? "bg-accent-soft text-accent-forte" : "text-sub hover:bg-surface-hover"}`} title="Preferências"><Settings2 size={16} /></button></div>
      </div>
      <ResumoHoras totais={totais} />
      <div className="flex min-h-0 flex-1 flex-col bg-surface p-2 md:p-4">
        {erro && <div className="mb-3 flex items-start gap-2 rounded-[9px] border border-danger/25 bg-danger/10 px-3 py-2 text-[11.5px] text-danger"><ListFilter size={14} className="mt-0.5 flex-none" />{erro}</div>}
        {carregando ? <div className="flex flex-1 items-center justify-center text-[12px] text-sub">Carregando agenda…</div> : visualizacao === "month" ? <VisaoMes dias={dias} referencia={referencia} eventos={filtrados} aoAbrir={abrirEvento} aoCriar={abrirNovo} aoVerDia={(dia) => { setReferencia(dia); setVisualizacao("day"); }} /> : <GradeAgenda dias={visualizacao === "day" ? [referencia] : dias.slice(0, 7)} eventos={filtrados} inicioMinuto={inicioMinuto} fimMinuto={fimMinuto} podeMover={(evento) => evento.sourceType === "task" ? evento.ownerId === usuarioId : eventoEditavel(evento, usuarioId, papel)} aoAbrir={abrirEvento} aoCriar={abrirNovo} aoMover={mover} aoRedimensionar={redimensionar} />}
      </div>
      <PainelLateral tipo={painel} aoFechar={() => setPainel(null)}>
        {painel === "tasks" && <PainelTarefas tarefas={tarefas} contatos={contatos} aoAbrir={(tarefa) => { setPainel(null); aoAbrirTarefa(tarefa); }} />}
        {painel === "contacts" && <PainelContatos contatos={contatos} selecionado={filtroContato} aoFiltrar={(id) => { setFiltroContato(id); setPainel(null); }} aoAbrir={aoAbrirContato} />}
        {painel === "notifications" && <PainelNotificacoes contexto={contexto} notificacoes={notificacoes} aoAtualizar={async () => carregar({ silencioso: true })} aoMarcarLida={marcarLida} />}
        {painel === "settings" && <PainelPreferencias contexto={contexto} visualizacao={visualizacao} aoSalvar={async (form) => { await api.agenda.preferenciasAtualizar(form); await carregar({ silencioso: true }); }} aoSalvarCategoria={async (categoria) => { await api.agenda.categoriaSalvar(categoria); await carregar({ silencioso: true }); }} />}
      </PainelLateral>
      <DialogoEvento aberto={Boolean(dialogo)} evento={dialogo?.evento} abertura={dialogo?.abertura} categorias={categorias} contatos={contatos} papel={papel} lembretesPadrao={contexto?.preference?.defaultReminderMinutes || [30]} salvando={salvando} erro={erro} aoFechar={() => { setDialogo(null); setErro(""); }} aoSalvar={salvarEvento} aoExcluir={excluirEvento} />
      <DetalheEvento evento={detalhe} aoFechar={() => setDetalhe(null)} />
    </div>
  );
}

export const agendaInternals = { inicioDaSemana, chaveDia, dataLocal, horaLocal, isoLocal, eventoParaFormulario, intervaloDaVisao, somarPorCategoria, adicionarDias };
