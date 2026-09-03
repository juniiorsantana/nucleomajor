import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  ContactRound,
  ListFilter,
  LockKeyhole,
  Minus,
  PanelRightClose,
  Plus,
  Rows3,
  Settings2,
  SquareCheckBig,
  Undo2,
  UserRound,
  X,
} from "lucide-react";
import { api } from "../../data/client";
import { BotaoPrimario, CabecalhoTela, CampoBusca, DialogoConfirmar } from "../ui";
import DialogoEvento from "./agenda/DialogoEvento";
import GradeAgenda from "./agenda/GradeAgenda";
import VisaoLista from "./agenda/VisaoLista";
import VisaoMes from "./agenda/VisaoMes";
import {
  NIVEIS_ZOOM,
  ZOOM_PADRAO,
  adicionarDias,
  chaveDia,
  coresDaEquipe,
  dataLocal,
  diasDoIntervalo,
  eventoEditavel,
  eventoPessoalDeOutro,
  eventoParaFormulario,
  eventoVisivelNoFiltro,
  faixaVisivel,
  formatarDuracao,
  horaLocal,
  idsDosResponsaveis,
  inicioDaSemana,
  intervaloDaVisao,
  isoLocal,
  minutosDoHorario,
  navegarReferencia,
  rotuloPeriodo,
  somarPorPessoa,
  somarPorTipo,
} from "./agenda/agendaUtils";

const VISUALIZACOES = [
  { id: "day", rotulo: "Dia", tecla: "d" },
  { id: "week", rotulo: "Semana", tecla: "s" },
  { id: "month", rotulo: "Mês", tecla: "m" },
];
const PAINEIS = {
  tasks: { titulo: "Tarefas", icone: SquareCheckBig },
  contacts: { titulo: "Contatos", icone: ContactRound },
  notifications: { titulo: "Notificações", icone: Bell },
  requests: { titulo: "Solicitações", icone: CalendarClock },
  settings: { titulo: "Preferências", icone: Settings2 },
};
const SEGUNDOS_DESFAZER = 9000;

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

function DetalheEvento({ evento, usuarioId, aoFechar }) {
  useEffect(() => {
    if (!evento) return undefined;
    const teclado = (e) => { if (e.key === "Escape") aoFechar(); };
    window.addEventListener("keydown", teclado);
    return () => window.removeEventListener("keydown", teclado);
  }, [aoFechar, evento]);
  if (!evento) return null;
  const pessoalDeOutro = eventoPessoalDeOutro(evento, usuarioId);
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
          {pessoalDeOutro ? (
            <div className="flex gap-2 rounded-[10px] border border-line bg-surface p-3 text-sub">
              <LockKeyhole size={15} className="mt-0.5 flex-none text-faint" />
              <div>
                <dt className="font-semibold text-fg">Evento pessoal protegido</dt>
                <dd className="mt-1 leading-5">Somente {evento.ownerName || "o profissional responsável"} pode editar horário, categoria, visibilidade ou transformar este item em evento da empresa.</dd>
              </div>
            </div>
          ) : <>
            {evento.categoryName && <div><dt className="text-faint">Categoria</dt><dd className="mt-0.5 font-medium text-fg">{evento.categoryName}</dd></div>}
            {evento.local && <div><dt className="text-faint">Local</dt><dd className="mt-0.5 text-fg">{evento.local}</dd></div>}
            {evento.descricao && <div><dt className="text-faint">Descrição</dt><dd className="mt-0.5 whitespace-pre-wrap text-fg">{evento.descricao}</dd></div>}
          </>}
        </dl>
      </section>
    </div>
  );
}

/**
 * Aviso flutuante junto da ação.
 *
 * Existe porque o erro de arraste vivia numa faixa no topo da grade: quem
 * movia um evento das 17h recebia a explicação fora da área visível. Também é
 * onde mora o Desfazer - arrastar é o gesto mais fácil de errar da agenda, e
 * era o único sem volta.
 */
function Aviso({ aviso, aoFechar }) {
  useEffect(() => {
    if (!aviso) return undefined;
    const relogio = setTimeout(aoFechar, aviso.acao ? SEGUNDOS_DESFAZER : 5000);
    return () => clearTimeout(relogio);
  }, [aviso, aoFechar]);
  if (!aviso) return null;
  const erro = aviso.tom === "erro";
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-auto flex max-w-[min(560px,100%)] items-center gap-3 rounded-[11px] border px-3.5 py-2.5 shadow-lg ${erro ? "border-danger/30 bg-danger/10 text-danger" : "border-line-strong bg-fg text-bg"}`}
      >
        <span className="min-w-0 flex-1 text-[12px] font-medium">{aviso.texto}</span>
        {aviso.acao && (
          <button
            type="button"
            onClick={() => { aviso.acao.executar(); aoFechar(); }}
            className={`flex flex-none cursor-pointer items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[11.5px] font-bold ${erro ? "hover:bg-danger/15" : "bg-bg/15 hover:bg-bg/25"}`}
          >
            <Undo2 size={13} />{aviso.acao.rotulo}
          </button>
        )}
        <button type="button" aria-label="Fechar aviso" onClick={aoFechar} className="flex-none cursor-pointer rounded-[6px] p-1 opacity-60 hover:opacity-100">
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

/**
 * Esqueleto no lugar de "Carregando agenda…".
 *
 * Trocar de semana apagava a tela inteira e devolvia uma frase centralizada:
 * a cada navegação o layout piscava do zero. O esqueleto preserva a forma da
 * grade, então a mudança de período parece atualização, não recarga.
 */
function EsqueletoAgenda() {
  return (
    <div className="min-h-0 flex-1 animate-pulse overflow-hidden rounded-[14px] border border-line bg-bg" aria-hidden="true">
      <div className="grid border-b border-line" style={{ gridTemplateColumns: "58px repeat(5, minmax(0, 1fr))" }}>
        <div className="border-r border-line py-3" />
        {[0, 1, 2, 3, 4].map((coluna) => (
          <div key={coluna} className="border-r border-line px-3 py-3 last:border-r-0">
            <div className="h-2.5 w-14 rounded-full bg-surface-hover" />
            <div className="mt-1.5 h-2 w-10 rounded-full bg-surface" />
          </div>
        ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: "58px repeat(5, minmax(0, 1fr))" }}>
        <div className="border-r border-line" />
        {[0, 1, 2, 3, 4].map((coluna) => (
          <div key={coluna} className="space-y-2 border-r border-line p-2 last:border-r-0">
            {[0, 1, 2].map((linha) => (
              <div
                key={linha}
                className="rounded-[7px] bg-surface-hover"
                style={{ height: 34 + ((coluna + linha) % 3) * 26, marginTop: linha === 0 ? (coluna % 3) * 22 : 0 }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ResumoHoras({ totais, modoCor }) {
  const [expandido, setExpandido] = useState(false);
  const total = totais.reduce((soma, item) => soma + item.minutos, 0);
  const visiveis = expandido ? totais : totais.slice(0, 6);
  const ocultos = totais.length - visiveis.length;
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 border-y border-line bg-bg px-4 py-2 text-[10.5px]">
      {totais.length ? visiveis.map((item) => (
        <span key={item.id || item.nome} className="flex items-center gap-1.5 text-sub">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.cor }} />
          {item.nome} <strong className="text-fg">{formatarDuracao(item.minutos)}</strong>
        </span>
      )) : <span className="text-faint">Nenhum horário ocupado neste período.</span>}
      {/* Antes o excedente era cortado em silêncio com um slice(0, 6): quem
          tinha sete categorias nunca soube que faltava uma na conta. */}
      {ocultos > 0 && (
        <button type="button" onClick={() => setExpandido(true)} className="cursor-pointer font-semibold text-accent-forte hover:underline">
          +{ocultos} {ocultos === 1 ? "outro" : "outros"}
        </button>
      )}
      {expandido && totais.length > 6 && (
        <button type="button" onClick={() => setExpandido(false)} className="cursor-pointer text-faint hover:text-fg">
          recolher
        </button>
      )}
      <span className="ml-auto font-semibold text-sub">
        {formatarDuracao(total)} agendado{modoCor === "pessoa" ? " · por pessoa" : ""}
      </span>
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
          {notificacoes.map((item) => {
            // Atribuição não tem horário para anunciar. Antes de `kind`, o
            // painel só sabia dizer "às 14:30", e um aviso de "você entrou
            // nesta tarefa" saía com o vencimento colado como se fosse a
            // hora do aviso.
            const atribuicao = item.tipo === "assignment";
            return (
              <button key={item.id} type="button" onClick={() => aoMarcarLida(item)} className={`w-full cursor-pointer rounded-[9px] border p-3 text-left ${item.lidaEm ? "border-line" : "border-accent/35 bg-accent-soft/45"}`}>
                {atribuicao && (
                  <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent-forte">
                    <UserRound size={9} />Colocaram você
                  </span>
                )}
                <span className="block text-[11.5px] font-medium text-fg">{item.titulo}</span>
                <span className="mt-1 block text-[10px] text-faint">
                  {item.canal === "whatsapp" ? "WhatsApp" : "EmyLeads"} · {formatarDataHora(item.lembrarEm)} · {item.erro ? `Falhou: ${item.erro}` : item.status}
                </span>
                {atribuicao && (
                  <span className="mt-1 block text-[10px] text-sub">Responda em Tarefas: assumir ou recusar.</span>
                )}
              </button>
            );
          })}
          {!notificacoes.length && <p className="py-8 text-center text-[11.5px] text-faint">Nenhum aviso neste período.</p>}
        </div>
      </section>
    </div>
  );
}

const ROTULOS_SOLICITACAO = {
  awaiting_customer_confirmation: "Aguardando cliente",
  awaiting_team_approval: "Aguardando aprovação",
  completed: "Aprovada",
  rejected: "Recusada",
  expired: "Expirada",
  failed: "Falhou",
  cancelled: "Cancelada",
};

function PainelSolicitacoes({ solicitacoes, ocupado, aoDecidir }) {
  const [motivos, setMotivos] = useState({});
  const pendentes = solicitacoes.filter((item) => item.status === "awaiting_team_approval");
  const historico = solicitacoes.filter((item) => item.status !== "awaiting_team_approval");
  const renderizar = (item) => (
    <article key={item.id} className="rounded-[10px] border border-line bg-bg p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-fg">{item.subject || "Reunião"}</p>
          <p className="mt-1 text-[10.5px] text-sub">{item.customer_name || "Cliente"} · {item.responsible_name || "Profissional"}</p>
          <p className="mt-1 text-[10.5px] text-faint">{formatarDataHora(item.starts_at)} até {formatarDataHora(item.ends_at)}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[9px] font-semibold ${item.status === "awaiting_team_approval" ? "bg-warning/10 text-warning" : item.status === "completed" ? "bg-success-soft text-success" : "bg-surface text-sub"}`}>
          {ROTULOS_SOLICITACAO[item.status] || item.status}
        </span>
      </div>
      {item.status === "awaiting_team_approval" && (
        <div className="mt-3">
          <input
            value={motivos[item.id] || ""}
            onChange={(e) => setMotivos((atual) => ({ ...atual, [item.id]: e.target.value }))}
            maxLength={500}
            className="w-full rounded-[8px] border border-line px-3 py-2 text-[10.5px] text-fg"
            placeholder="Motivo da recusa (opcional)"
          />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={ocupado === item.id} onClick={() => aoDecidir(item, "approve", "")} className="flex-1 cursor-pointer rounded-[8px] bg-success px-3 py-2 text-[10.5px] font-semibold text-white disabled:opacity-40">Aprovar</button>
            <button type="button" disabled={ocupado === item.id} onClick={() => aoDecidir(item, "reject", motivos[item.id] || "")} className="flex-1 cursor-pointer rounded-[8px] border border-danger/30 px-3 py-2 text-[10.5px] font-semibold text-danger disabled:opacity-40">Recusar</button>
          </div>
        </div>
      )}
      {item.decision_reason && <p className="mt-2 text-[10px] text-faint">Motivo: {item.decision_reason}</p>}
    </article>
  );
  return (
    <div className="p-4">
      <p className="text-[10.5px] text-sub">Pedidos de clientes bloqueiam o horário provisoriamente. A primeira decisão válida encerra a solicitação.</p>
      <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-faint">Aguardando ({pendentes.length})</h3>
      <div className="mt-2 space-y-2">{pendentes.map(renderizar)}{!pendentes.length && <p className="py-6 text-center text-[11px] text-faint">Nenhuma solicitação pendente.</p>}</div>
      <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-faint">Histórico</h3>
      <div className="mt-2 space-y-2">{historico.slice(0, 30).map(renderizar)}{!historico.length && <p className="py-6 text-center text-[11px] text-faint">O histórico aparecerá aqui.</p>}</div>
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
  const [solicitacoes, setSolicitacoes] = useState([]);
  const [solicitacaoOcupada, setSolicitacaoOcupada] = useState("");
  const [dialogo, setDialogo] = useState(null);
  const [detalhe, setDetalhe] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  // Erro de carga (faixa fixa no topo, some só quando a carga der certo) e erro
  // do formulário são coisas diferentes. Compartilhar um estado só fazia uma
  // falha de arraste reaparecer dentro do diálogo na vez seguinte que ele abria.
  const [erroCarga, setErroCarga] = useState("");
  const [erroDialogo, setErroDialogo] = useState("");
  const [aviso, setAviso] = useState(null);
  const [confirmacao, setConfirmacao] = useState(null);
  const [ajustes, setAjustes] = useState({});
  const [zoom, setZoom] = useState(() => lerLocal("agenda:zoom", ZOOM_PADRAO));
  const [modoCor, setModoCor] = useState(() => lerLocal("agenda:modoCor", "tipo"));
  const [agruparEquipe, setAgruparEquipe] = useState(() => lerLocal("agenda:agruparEquipe", true));
  const [estreito, setEstreito] = useState(false);
  const inicializado = useRef(false);

  const alturaHora = NIVEIS_ZOOM[zoom] ?? NIVEIS_ZOOM[ZOOM_PADRAO];
  const intervalo = useMemo(() => intervaloDaVisao(visualizacao, referencia), [referencia, visualizacao]);
  const dias = useMemo(() => diasDoIntervalo(intervalo.de, intervalo.ate), [intervalo]);

  useEffect(() => { gravarLocal("agenda:zoom", zoom); }, [zoom]);
  useEffect(() => { gravarLocal("agenda:modoCor", modoCor); }, [modoCor]);
  useEffect(() => { gravarLocal("agenda:agruparEquipe", agruparEquipe); }, [agruparEquipe]);

  // A grade precisa de 680px para não virar rolagem horizontal, e no toque a
  // rolagem horizontal briga com o arraste de criar. Abaixo disso a lista assume.
  //
  // `change` de matchMedia é o caminho certo e cobre o caso normal. O `resize`
  // vem junto como rede: o painel também roda embutido no WhatsApp Web, onde
  // quem mexe na largura é o layout hospedeiro, e nem toda WebView entrega o
  // `change` nessa situação. Ler a consulta nos dois custa uma linha.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const consulta = window.matchMedia("(max-width: 767px)");
    const aplicar = () => setEstreito(consulta.matches);
    aplicar();
    consulta.addEventListener("change", aplicar);
    window.addEventListener("resize", aplicar);
    return () => {
      consulta.removeEventListener("change", aplicar);
      window.removeEventListener("resize", aplicar);
    };
  }, []);

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
      if (["owner", "admin"].includes(proximoContexto?.papel)) {
        setSolicitacoes(await api.agenda.solicitacoes({ limite: 100 }));
      } else {
        setSolicitacoes([]);
      }
      if (!inicializado.current) {
        setVisualizacao(proximoContexto?.preference?.defaultView || "week");
        inicializado.current = true;
      }
      setErroCarga("");
    } catch (falha) {
      const mensagem = falha?.message || String(falha);
      setErroCarga(/calendar_context|calendar_categories|calendar_events_list/i.test(mensagem)
        ? "A migration da Fase D ainda não foi aplicada no Supabase. Aplique-a e recarregue a extensão."
        : mensagem);
    } finally { setCarregando(false); }
  }, [intervalo.ate, intervalo.de]);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!contexto || !["owner", "admin"].includes(contexto.papel)) return undefined;
    const atualizarSolicitacoes = () => api.agenda.solicitacoes({ limite: 100 })
      .then(setSolicitacoes)
      .catch(() => {});
    const intervaloAtualizacao = window.setInterval(atualizarSolicitacoes, 15000);
    return () => window.clearInterval(intervaloAtualizacao);
  }, [contexto]);

  const categorias = contexto?.categories || [];
  const membros = contexto?.members || [];
  // A cor de cada pessoa sai do perfil (`profiles.color`), montada uma vez
  // por carga: a grade pinta um bloco por vez e não pode consultar a lista
  // inteira de membros a cada desenho.
  const cores = useMemo(() => coresDaEquipe(membros), [membros]);
  const usuarioId = contexto?.userId;
  const papel = contexto?.papel || "member";
  const contatos = dados.contatos || [];
  const tarefas = dados.tarefas || [];

  /**
   * Eventos com o ajuste otimista já aplicado por cima do que veio do servidor.
   *
   * Sem isto o bloco arrastado voltava para a posição antiga e só pulava para a
   * nova depois do round-trip - em rede lenta, um piscar que dava a impressão
   * de que o arraste não pegou.
   */
  const eventosVisiveis = useMemo(
    () => eventos.map((evento) => (ajustes[evento.id] ? { ...evento, ...ajustes[evento.id] } : evento)),
    [ajustes, eventos],
  );

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return eventosVisiveis.filter((evento) => {
      if (!eventoVisivelNoFiltro(evento, filtroProfissional, usuarioId)) return false;
      if (filtroCategoria && evento.categoryId !== filtroCategoria && evento.sourceType !== "task") return false;
      if (filtroContato && evento.contactId !== filtroContato) return false;
      return !termo || `${evento.titulo} ${evento.descricao} ${evento.ownerName} ${evento.categoryName}`.toLowerCase().includes(termo);
    });
  }, [busca, eventosVisiveis, filtroCategoria, filtroContato, filtroProfissional, usuarioId]);

  // A legenda acompanha o que está pintado: colorindo por pessoa, somar por
  // categoria daria uma legenda que não explica nenhuma cor da tela.
  const totais = useMemo(
    () => (modoCor === "pessoa" ? somarPorPessoa(filtrados, cores, membros) : somarPorTipo(filtrados)),
    [cores, filtrados, membros, modoCor],
  );
  const naoLidas = notificacoes.filter((item) => !item.lidaEm && item.status === "sent").length;
  const solicitacoesPendentes = solicitacoes.filter((item) => item.status === "awaiting_team_approval").length;
  const inicioExpediente = minutosDoHorario(String(contexto?.preference?.dayStart || contexto?.calendar?.dayStart || "05:00").slice(0, 5));
  const fimExpediente = minutosDoHorario(String(contexto?.preference?.dayEnd || contexto?.calendar?.dayEnd || "23:59").slice(0, 5));
  // O expediente diz onde a atenção mora; a faixa desenhada precisa caber todo
  // evento do período. Enquanto os dois eram a mesma coisa, um compromisso
  // depois do fim do expediente sumia da grade e continuava contado no resumo.
  const faixa = useMemo(
    () => faixaVisivel(filtrados, inicioExpediente, fimExpediente),
    [fimExpediente, filtrados, inicioExpediente],
  );
  const inicioMinuto = faixa.inicio;
  const fimMinuto = faixa.fim;
  const contatoFiltrado = contatos.find((item) => item.id === filtroContato);
  const emEquipe = filtroProfissional === "team";
  const porPessoa = emEquipe && agruparEquipe && visualizacao === "day" && !estreito;

  const mostrarAviso = useCallback((proximo) => setAviso({ ...proximo, chave: Date.now() }), []);

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

  const abrirNovo = (dia = new Date(), inicio = 9 * 60, fim = 10 * 60, opcoes = {}) => {
    // O backend fixa owner_id no usuário da sessão (ver agendaProvider.criar):
    // criar arrastando na faixa de outra pessoa geraria um evento na agenda
    // errada, em silêncio. Melhor recusar e dizer por quê.
    if (opcoes.ownerId && usuarioId && opcoes.ownerId !== usuarioId) {
      const dono = membros.find((membro) => membro.id === opcoes.ownerId);
      mostrarAviso({
        tom: "erro",
        texto: `Só dá para criar eventos na sua própria agenda. Peça para ${dono?.name || "o profissional"} criar, ou marque na sua faixa.`,
      });
      return;
    }
    const comeco = dataComMinutos(dia, inicio);
    const termino = dataComMinutos(dia, fim);
    setErroDialogo("");
    setDialogo({ evento: null, abertura: { inicio: comeco.toISOString(), fim: termino.toISOString(), categoryId: categorias[0]?.id, lembretes: contexto?.preference?.defaultReminderMinutes || [30] } });
  };

  const abrirEvento = (evento) => {
    if (evento.sourceType === "task") {
      const tarefa = tarefas.find((item) => item.id === (evento.taskId || evento.id));
      if (tarefa) aoAbrirTarefa(tarefa); else setDetalhe(evento);
      return;
    }
    setErroDialogo("");
    if (eventoEditavel(evento, usuarioId, papel)) setDialogo({ evento, abertura: null }); else setDetalhe(evento);
  };

  const salvarEvento = async (payload) => {
    setSalvando(true); setErroDialogo("");
    try {
      if (dialogo?.evento?.id) await api.agenda.atualizar({ id: dialogo.evento.id, patch: payload });
      else await api.agenda.criar(payload);
      setDialogo(null);
      await carregar({ silencioso: true });
      mostrarAviso({ texto: dialogo?.evento?.id ? "Evento atualizado." : "Evento criado." });
    } catch (falha) { setErroDialogo(falha?.message || String(falha)); }
    finally { setSalvando(false); }
  };

  const excluirEvento = () => {
    const alvo = dialogo?.evento;
    if (!alvo?.id) return;
    setConfirmacao({
      titulo: "Excluir este evento?",
      descricao: `"${alvo.titulo}" sai da agenda de quem participa. Não dá para desfazer.`,
      rotulo: "Excluir",
      confirmar: async () => {
        setSalvando(true);
        try {
          await api.agenda.remover({ id: alvo.id });
          setDialogo(null);
          await carregar({ silencioso: true });
          mostrarAviso({ texto: "Evento excluído." });
        } catch (falha) { setErroDialogo(falha?.message || String(falha)); }
        finally { setSalvando(false); }
      },
    });
  };

  /**
   * Reposiciona um evento no tempo, aplicando primeiro e confirmando depois.
   *
   * `anterior` viaja junto para alimentar o Desfazer: sem ele, um arraste de
   * meio centímetro para o horário errado só se corrigia arrastando de volta
   * na mão, e nem sempre a pessoa lembra de onde veio.
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
    return aplicarIntervalo(
      payload,
      inicio.toISOString(),
      new Date(inicio.getTime() + duracao).toISOString(),
      { anterior: { inicio: payload.inicio, fim: payload.fim }, rotulo: "Evento movido." },
    );
  };

  const redimensionar = (evento, duracao) => aplicarIntervalo(
    evento,
    evento.inicio,
    new Date(new Date(evento.inicio).getTime() + duracao * 60000).toISOString(),
    { anterior: { inicio: evento.inicio, fim: evento.fim }, rotulo: `Duração alterada para ${formatarDuracao(duracao)}.` },
  );

  const marcarLida = async (item) => { if (!item.lidaEm) await api.agenda.notificacaoLida({ id: item.id }); await carregar({ silencioso: true }); };
  const decidirSolicitacao = async (item, decisao, motivo) => {
    setSolicitacaoOcupada(item.id);
    try {
      await api.agenda.solicitacaoDecidir({ id: item.id, decisao, motivo });
      await carregar({ silencioso: true });
      mostrarAviso({ texto: decisao === "approve" ? "Solicitação aprovada. O cliente será avisado." : "Solicitação recusada. O cliente será avisado." });
    } catch (falha) {
      mostrarAviso({ tom: "erro", texto: falha?.message || String(falha) });
    } finally { setSolicitacaoOcupada(""); }
  };
  const alternarPainel = (tipo) => setPainel((atual) => atual === tipo ? null : tipo);

  /**
   * Atalhos de teclado.
   *
   * Numa ferramenta que se abre de manhã e fica aberta o dia inteiro, trocar de
   * semana pelo mouse é o gesto mais repetido do dia.
   */
  useEffect(() => {
    const teclado = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const alvo = e.target;
      if (alvo?.isContentEditable) return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(alvo?.tagName)) return;
      if (dialogo || detalhe || confirmacao) return;

      const tecla = e.key.toLowerCase();
      const visao = VISUALIZACOES.find((item) => item.tecla === tecla);
      if (visao) { e.preventDefault(); setVisualizacao(visao.id); return; }
      if (tecla === "t" || tecla === "h") { e.preventDefault(); setReferencia(new Date()); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); setReferencia((atual) => navegarReferencia(visualizacao, atual, -1)); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); setReferencia((atual) => navegarReferencia(visualizacao, atual, 1)); return; }
      if (tecla === "n") { e.preventDefault(); abrirNovo(); return; }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); ajustarZoom(1); return; }
      if (e.key === "-" || e.key === "_") { e.preventDefault(); ajustarZoom(-1); }
    };
    window.addEventListener("keydown", teclado);
    return () => window.removeEventListener("keydown", teclado);
  });

  const botaoBarra = "cursor-pointer rounded-[8px] border border-line px-3 py-2 text-[11.5px] font-semibold text-sub hover:border-line-strong hover:text-fg";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <CabecalhoTela
        titulo="Agenda"
        busca={<CampoBusca valor={busca} aoMudar={setBusca} placeholder="Buscar na agenda..." />}
        acao={(
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Notificações" onClick={() => alternarPainel("notifications")} className="relative cursor-pointer rounded-[9px] border border-line p-2.5 text-sub hover:border-line-strong hover:text-fg">
              <Bell size={17} />
              {naoLidas > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[8px] font-bold text-white">{naoLidas}</span>}
            </button>
            <BotaoPrimario onClick={() => abrirNovo()} title="Novo evento (N)"><Plus size={17} />Novo evento</BotaoPrimario>
          </div>
        )}
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-bg px-3 py-3 md:px-5">
        <button type="button" onClick={() => setReferencia(new Date())} className={botaoBarra} title="Ir para hoje (T)">Hoje</button>
        <div className="flex overflow-hidden rounded-[8px] border border-line">
          <button type="button" aria-label="Período anterior" title="Período anterior (←)" onClick={() => setReferencia((atual) => navegarReferencia(visualizacao, atual, -1))} className="cursor-pointer border-r border-line p-2 text-sub hover:bg-surface-hover"><ChevronLeft size={15} /></button>
          <button type="button" aria-label="Próximo período" title="Próximo período (→)" onClick={() => setReferencia((atual) => navegarReferencia(visualizacao, atual, 1))} className="cursor-pointer p-2 text-sub hover:bg-surface-hover"><ChevronRight size={15} /></button>
        </div>
        <span className="min-w-[185px] text-[13px] font-semibold text-fg first-letter:uppercase">{rotuloPeriodo(visualizacao, referencia)}</span>

        <div className="flex rounded-[8px] bg-surface p-1">
          {VISUALIZACOES.map((item) => (
            <button
              key={item.id}
              type="button"
              title={`${item.rotulo} (${item.tecla.toUpperCase()})`}
              onClick={() => setVisualizacao(item.id)}
              className={`cursor-pointer rounded-[6px] px-3 py-1.5 text-[10.5px] font-semibold ${visualizacao === item.id ? "bg-bg text-fg shadow-sm" : "text-sub hover:text-fg"}`}
            >
              {item.rotulo}
            </button>
          ))}
        </div>

        <span className="mx-1 h-5 border-l border-line" />

        <select value={filtroProfissional} onChange={(e) => setFiltroProfissional(e.target.value)} className="cursor-pointer rounded-[8px] border border-line bg-bg px-2.5 py-2 text-[11px] text-sub">
          <option value="mine">Minha agenda</option>
          <option value="team">Toda a equipe</option>
          {membros.filter((membro) => membro.id !== usuarioId).map((membro) => <option key={membro.id} value={membro.id}>{membro.name}</option>)}
        </select>
        <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)} className="cursor-pointer rounded-[8px] border border-line bg-bg px-2.5 py-2 text-[11px] text-sub">
          <option value="">Todas as categorias</option>
          {categorias.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.name}</option>)}
        </select>

        {/* O filtro de contato só se anunciava por um X de limpar: dava para
            ficar com a agenda recortada sem saber por quem. */}
        {contatoFiltrado && (
          <span className="flex items-center gap-1.5 rounded-[8px] border border-accent/30 bg-accent-soft px-2.5 py-1.5 text-[11px] font-medium text-accent-forte">
            <ContactRound size={13} />
            {nomeContato(contatoFiltrado)}
            <button type="button" aria-label="Remover filtro de contato" onClick={() => setFiltroContato("")} className="cursor-pointer opacity-70 hover:opacity-100"><X size={12} /></button>
          </span>
        )}
        {(filtroCategoria || filtroContato || filtroProfissional !== "mine") && (
          <button type="button" onClick={() => { setFiltroCategoria(""); setFiltroContato(""); setFiltroProfissional("mine"); }} className="cursor-pointer rounded-[7px] p-2 text-faint hover:bg-surface-hover hover:text-fg" title="Limpar filtros"><X size={14} /></button>
        )}

        <div className="ml-auto flex items-center gap-1">
          {emEquipe && visualizacao === "day" && !estreito && (
            <button
              type="button"
              onClick={() => setAgruparEquipe((atual) => !atual)}
              title={agruparEquipe ? "Voltar para uma coluna só" : "Uma faixa por profissional"}
              className={`cursor-pointer rounded-[8px] p-2 ${agruparEquipe ? "bg-accent-soft text-accent-forte" : "text-sub hover:bg-surface-hover"}`}
            >
              <Rows3 size={16} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setModoCor((atual) => (atual === "pessoa" ? "categoria" : "pessoa"))}
            title={modoCor === "pessoa" ? "Colorindo por pessoa" : "Colorindo por tipo de evento"}
            className={`cursor-pointer rounded-[8px] p-2 ${modoCor === "pessoa" ? "bg-accent-soft text-accent-forte" : "text-sub hover:bg-surface-hover"}`}
          >
            <UserRound size={16} />
          </button>

          {visualizacao !== "month" && !estreito && (
            <div className="flex items-center overflow-hidden rounded-[8px] border border-line" title="Zoom da régua (+ / −, ou Ctrl + roda)">
              <button type="button" aria-label="Diminuir zoom" disabled={zoom === 0} onClick={() => ajustarZoom(-1)} className="cursor-pointer border-r border-line p-2 text-sub hover:bg-surface-hover disabled:opacity-30"><Minus size={14} /></button>
              <span className="px-2 text-[10px] font-semibold tabular-nums text-faint">{alturaHora}px</span>
              <button type="button" aria-label="Aumentar zoom" disabled={zoom === NIVEIS_ZOOM.length - 1} onClick={() => ajustarZoom(1)} className="cursor-pointer border-l border-line p-2 text-sub hover:bg-surface-hover disabled:opacity-30"><Plus size={14} /></button>
            </div>
          )}

          <span className="mx-0.5 h-5 border-l border-line" />
          {["owner", "admin"].includes(papel) && (
            <button type="button" onClick={() => alternarPainel("requests")} className={`relative cursor-pointer rounded-[8px] p-2 ${painel === "requests" ? "bg-accent-soft text-accent-forte" : "text-sub hover:bg-surface-hover"}`} title="Solicitações de clientes">
              <CalendarClock size={16} />
              {solicitacoesPendentes > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[8px] font-bold text-white">{solicitacoesPendentes}</span>}
            </button>
          )}
          <button type="button" onClick={() => alternarPainel("tasks")} className={`cursor-pointer rounded-[8px] p-2 ${painel === "tasks" ? "bg-accent-soft text-accent-forte" : "text-sub hover:bg-surface-hover"}`} title="Tarefas"><SquareCheckBig size={16} /></button>
          <button type="button" onClick={() => alternarPainel("contacts")} className={`cursor-pointer rounded-[8px] p-2 ${painel === "contacts" ? "bg-accent-soft text-accent-forte" : "text-sub hover:bg-surface-hover"}`} title="Contatos"><ContactRound size={16} /></button>
          <button type="button" onClick={() => alternarPainel("settings")} className={`cursor-pointer rounded-[8px] p-2 ${painel === "settings" ? "bg-accent-soft text-accent-forte" : "text-sub hover:bg-surface-hover"}`} title="Preferências"><Settings2 size={16} /></button>
        </div>
      </div>

      <ResumoHoras totais={totais} modoCor={modoCor} />

      <div className="flex min-h-0 flex-1 flex-col bg-surface p-2 md:p-4">
        {erroCarga && (
          <div className="mb-3 flex items-start gap-2 rounded-[9px] border border-danger/25 bg-danger/10 px-3 py-2 text-[11.5px] text-danger">
            <ListFilter size={14} className="mt-0.5 flex-none" />{erroCarga}
          </div>
        )}
        {carregando ? (
          <EsqueletoAgenda />
        ) : estreito && visualizacao !== "month" ? (
          <VisaoLista dias={visualizacao === "day" ? [referencia] : dias.slice(0, 7)} eventos={filtrados} modoCor={modoCor} cores={cores} aoAbrir={abrirEvento} aoCriar={abrirNovo} />
        ) : visualizacao === "month" ? (
          <VisaoMes dias={dias} referencia={referencia} eventos={filtrados} aoAbrir={abrirEvento} aoCriar={abrirNovo} aoVerDia={(dia) => { setReferencia(dia); setVisualizacao("day"); }} modoCor={modoCor} cores={cores} />
        ) : (
          <GradeAgenda
            dias={visualizacao === "day" ? [referencia] : dias.slice(0, 7)}
            eventos={filtrados}
            inicioMinuto={inicioMinuto}
            fimMinuto={fimMinuto}
            inicioExpediente={inicioExpediente}
            fimExpediente={fimExpediente}
            alturaHora={alturaHora}
            modoCor={modoCor}
            cores={cores}
            agruparPorPessoa={porPessoa}
            membros={membros}
            podeMover={(evento) => evento.sourceType === "task"
              ? idsDosResponsaveis(evento).includes(usuarioId)
              : eventoEditavel(evento, usuarioId, papel)}
            aoAbrir={abrirEvento}
            aoCriar={abrirNovo}
            aoMover={mover}
            aoRedimensionar={redimensionar}
            aoAjustarZoom={ajustarZoom}
            aoVerDia={(dia) => { setReferencia(dia); setVisualizacao("day"); }}
          />
        )}
      </div>

      <Aviso aviso={aviso} aoFechar={() => setAviso(null)} />

      <PainelLateral tipo={painel} aoFechar={() => setPainel(null)}>
        {painel === "tasks" && <PainelTarefas tarefas={tarefas} contatos={contatos} aoAbrir={(tarefa) => { setPainel(null); aoAbrirTarefa(tarefa); }} />}
        {painel === "contacts" && <PainelContatos contatos={contatos} selecionado={filtroContato} aoFiltrar={(id) => { setFiltroContato(id); setPainel(null); }} aoAbrir={aoAbrirContato} />}
        {painel === "notifications" && <PainelNotificacoes contexto={contexto} notificacoes={notificacoes} aoAtualizar={async () => carregar({ silencioso: true })} aoMarcarLida={marcarLida} />}
        {painel === "requests" && <PainelSolicitacoes solicitacoes={solicitacoes} ocupado={solicitacaoOcupada} aoDecidir={decidirSolicitacao} />}
        {painel === "settings" && <PainelPreferencias contexto={contexto} visualizacao={visualizacao} aoSalvar={async (form) => { await api.agenda.preferenciasAtualizar(form); await carregar({ silencioso: true }); }} aoSalvarCategoria={async (categoria) => { await api.agenda.categoriaSalvar(categoria); await carregar({ silencioso: true }); }} />}
      </PainelLateral>

      <DialogoEvento
        aberto={Boolean(dialogo)}
        evento={dialogo?.evento}
        abertura={dialogo?.abertura}
        categorias={categorias}
        contatos={contatos}
        papel={papel}
        lembretesPadrao={contexto?.preference?.defaultReminderMinutes || [30]}
        salvando={salvando}
        erro={erroDialogo}
        aoFechar={() => { setDialogo(null); setErroDialogo(""); }}
        aoSalvar={salvarEvento}
        aoExcluir={excluirEvento}
      />
      <DetalheEvento evento={detalhe} usuarioId={usuarioId} aoFechar={() => setDetalhe(null)} />
      <DialogoConfirmar pedido={confirmacao} aoFechar={() => setConfirmacao(null)} />
    </div>
  );
}

export const agendaInternals = { inicioDaSemana, chaveDia, dataLocal, horaLocal, isoLocal, eventoParaFormulario, intervaloDaVisao, somarPorTipo, adicionarDias };
