import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bot, BotOff, Check, ChevronDown, ChevronRight, Copy, Headphones, Inbox, Pause, Pencil, Play, Plus, Power, RotateCcw, Trash2 } from "lucide-react";
import { api } from "../../data/client";
import { handoffGroup, maskPhone } from "../../domain/customerAssistant";
import { fmtDataHora, fmtRelativo } from "../../lib/formato";
import { useAutomacao } from "../../ui/useAutomacao";
import { textoDoMotivo, useDiario } from "../../ui/useDiario";
import { BotaoPrimario, CabecalhoTela, CampoBusca } from "../ui";
import { EstadoVazio } from "./gestaoCompartilhados";

const tipoPasso = {
  enviar_mensagem: "Mensagem",
  editar_etiquetas: "Etiquetas",
};

/**
 * O mesmo freio da faixa do painel, visto de cima.
 *
 * Importa estar aqui porque a coluna "Status" mente sozinha: um bot marcado
 * como Ativo não responde nada enquanto a automação geral está pausada. Sem
 * este aviso, alguém passaria a tarde depurando um bot que está certo.
 */
function AvisoAutomacao() {
  const { estado, salvando, definirPausa } = useAutomacao();
  if (estado === undefined) return null;
  const pausada = !!estado?.pausada;

  return (
    <div
      className={`mb-4 flex items-center gap-3 rounded-[10px] border px-4 py-3 text-[13px] ${
        pausada ? "border-danger/30 bg-danger/10 text-danger" : "border-line bg-bg text-sub"
      }`}
    >
      {pausada ? <BotOff size={16} /> : <Bot size={16} />}
      <span className="flex-1">
        {pausada ? (
          <>
            <strong className="font-semibold">Respostas automáticas pausadas nesta máquina.</strong>{" "}
            Nenhum chatbot responde sozinho, mesmo os marcados como Ativo.
          </>
        ) : (
          "Respostas automáticas ativas. Chatbots marcados como Ativo respondem sozinhos."
        )}
      </span>
      <button
        type="button"
        onClick={() => definirPausa(!pausada)}
        disabled={salvando}
        className={`flex flex-none cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold transition-colors disabled:opacity-40 ${
          pausada
            ? "bg-danger text-white hover:brightness-110"
            : "border border-line text-sub hover:border-danger/50 hover:text-danger"
        }`}
      >
        {pausada ? <Play size={13} /> : <Pause size={13} />}
        {pausada ? "Retomar" : "Pausar tudo"}
      </button>
    </div>
  );
}

const TOM_RESULTADO = {
  enviado: "bg-success-soft text-success",
  erro: "bg-danger/10 text-danger",
  ignorado: "bg-surface-hover text-faint",
};

/**
 * O diário da automação — a resposta para "por que o bot não respondeu?".
 *
 * Fica recolhido por padrão: é ferramenta de investigação, e no dia a dia a
 * lista de chatbots é o que interessa. Aberto, mostra a decisão tomada para
 * cada mensagem recebida, com o ID da mensagem — que é por onde se cruza com
 * a conversa real quando o atendente reclama de um caso específico.
 */
function DiarioAutomacao({ diario, entradas }) {
  const [aberto, setAberto] = useState(false);

  if (diario === undefined) return null;

  const erros = entradas.filter((e) => e.resultado === "erro").length;

  return (
    <div className="mt-6 overflow-hidden rounded-[14px] border border-line bg-bg">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 px-5 py-3 text-left transition-colors hover:bg-surface-hover"
      >
        {aberto ? <ChevronDown size={16} className="text-faint" /> : <ChevronRight size={16} className="text-faint" />}
        <span className="text-[13.5px] font-semibold text-fg">Diário da automação</span>
        <span className="text-[12.5px] text-faint">
          {entradas.length === 0
            ? "nenhuma mensagem avaliada ainda"
            : `${entradas.length} ${entradas.length === 1 ? "decisão registrada" : "decisões registradas"}`}
        </span>
        {erros > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-[11.5px] font-semibold text-danger">
            <AlertTriangle size={12} />
            {erros} {erros === 1 ? "erro" : "erros"}
          </span>
        )}
      </button>

      {aberto && entradas.length > 0 && (
        <div className="max-h-[420px] overflow-y-auto border-t border-line">
          <div className="grid grid-cols-[150px_120px_minmax(160px,1fr)_minmax(160px,1.2fr)_minmax(140px,1fr)] gap-4 border-b border-line px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
            <span>Quando</span><span>Resultado</span><span>Chatbot</span><span>Motivo</span><span>Mensagem</span>
          </div>
          {entradas.map((entrada, indice) => (
            <div
              key={`${entrada.messageId || "sem-id"}:${entrada.em}:${indice}`}
              className="grid grid-cols-[150px_120px_minmax(160px,1fr)_minmax(160px,1.2fr)_minmax(140px,1fr)] items-center gap-4 border-b border-line px-5 py-2.5 text-[12.5px] last:border-b-0"
            >
              <span className="tabular-nums text-sub" title={fmtDataHora(entrada.em)}>
                {fmtRelativo(entrada.em)}
              </span>
              <span>
                <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${TOM_RESULTADO[entrada.resultado] || TOM_RESULTADO.ignorado}`}>
                  {entrada.resultado}
                </span>
              </span>
              <span className="truncate text-sub">{entrada.chatbotNome || "—"}</span>
              <span className="truncate text-fg" title={entrada.erro || ""}>
                {textoDoMotivo(entrada.motivo)}
                {entrada.erro && <span className="ml-1 text-danger">· {entrada.erro}</span>}
              </span>
              <span className="truncate font-mono text-[11.5px] text-faint" title={entrada.messageId || ""}>
                {entrada.messageId || "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const HANDOFF_REASON = {
  requested_human: "Cliente pediu uma pessoa",
  low_confidence: "Baixa confiança",
  sensitive_topic: "Assunto sensível",
  commercial_exception: "Exceção comercial",
  tool_unavailable: "Ferramenta indisponível",
  skill_limit: "Limite da habilidade",
};

function HandoffQueue({ canManage, onError }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(null);
  const load = async () => {
    if (!canManage) return;
    try { setItems(await api.inteligencia.listarAtendimentos()); }
    catch (error) { onError(error?.message || "Não foi possível consultar a fila."); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 8000);
    return () => window.clearInterval(timer);
  }, [canManage]);
  const act = async (requestId, action) => {
    setWorking(`${requestId}:${action}`); onError("");
    try { await api.inteligencia.transicionarAtendimento({ requestId, action }); await load(); }
    catch (error) { onError(error?.message || "Não foi possível atualizar o atendimento."); }
    finally { setWorking(null); }
  };
  if (!canManage) return <EstadoVazio titulo="Fila restrita" descricao="Somente donos e administradores podem assumir atendimentos." />;
  if (loading) return <div className="flex min-h-72 items-center justify-center text-[12px] text-sub">Carregando atendimentos…</div>;
  const columns = [
    ["waiting", "Aguardando atendimento", "Pedidos que precisam de uma pessoa"],
    ["active", "Em atendimento", "Conversas assumidas pela equipe"],
    ["finished", "Concluídos", "Histórico recente"],
  ];
  return <div className="grid gap-4 xl:grid-cols-3">{columns.map(([group, title, description]) => { const grouped = items.filter((item) => handoffGroup(item.status) === group); return <section key={group} className="min-w-0 rounded-[14px] border border-line bg-bg"><header className="flex items-start gap-3 border-b border-line px-4 py-3.5"><span className={`flex h-9 w-9 items-center justify-center rounded-[10px] ${group === "waiting" ? "bg-[#fff5e8] text-[#b56a15]" : group === "active" ? "bg-accent-soft text-accent-forte" : "bg-success-soft text-success"}`}>{group === "waiting" ? <Inbox size={17} /> : group === "active" ? <Headphones size={17} /> : <Check size={17} />}</span><div className="min-w-0"><h2 className="text-[12.5px] font-semibold">{title}</h2><p className="mt-0.5 text-[9.5px] text-sub">{description}</p></div><span className="ml-auto rounded-full bg-surface px-2 py-1 text-[9px] font-semibold text-sub">{grouped.length}</span></header><div className="grid gap-2 p-3">{grouped.length ? grouped.map((item) => { const contact = Array.isArray(item.contact) ? item.contact[0] : item.contact; const pending = working?.startsWith(`${item.id}:`) || ["completing", "returning"].includes(item.status); return <article key={item.id} className="rounded-[11px] border border-line bg-surface/50 p-3"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><strong className="block truncate text-[11.5px]">{contact?.name || "Contato do WhatsApp"}</strong><span className="mt-0.5 block text-[9.5px] text-sub">{contact?.company || maskPhone(contact?.phone || contact?.whatsapp_id)}</span></div><time className="text-[8.5px] text-faint">{fmtRelativo(item.requested_at)}</time></div><p className="mt-2 text-[9.5px] font-semibold text-sub">{HANDOFF_REASON[item.reason_code] || item.reason_code}</p>{item.summary && <p className="mt-1 line-clamp-3 text-[9.5px] leading-4 text-sub">{item.summary}</p>}{item.last_error_code && <p className="mt-2 text-[9px] text-danger">Falha temporária: {item.last_error_code}</p>}<div className="mt-3 flex flex-wrap gap-1.5">{item.status === "requested" && <button disabled={pending} onClick={() => act(item.id, "accept")} className="rounded-[8px] bg-accent px-3 py-1.5 text-[9.5px] font-semibold text-white disabled:opacity-40">Assumir</button>}{item.status === "accepted" && <><button disabled={pending} onClick={() => act(item.id, "complete")} className="rounded-[8px] bg-success px-3 py-1.5 text-[9.5px] font-semibold text-white disabled:opacity-40">Concluir</button><button disabled={pending} onClick={() => act(item.id, "return_to_ai")} className="inline-flex items-center gap-1 rounded-[8px] border border-line bg-bg px-3 py-1.5 text-[9.5px] font-semibold text-sub disabled:opacity-40"><RotateCcw size={11} />Devolver à IA</button></>}{pending && <span className="text-[9px] text-sub">Aplicando na VPS…</span>}</div></article>; }) : <p className="px-3 py-10 text-center text-[10px] text-faint">Nenhum atendimento nesta etapa.</p>}</div></section>; })}</div>;
}

export default function Chatbots({ chatbots = [], recarregar, aoEditar, sessao }) {
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");
  const [view, setView] = useState("flows");
  const canManage = ["owner", "admin"].includes(sessao?.organizacaoAtual?.papel);
  // Uma leitura só do diário, compartilhada pela lista e pelo painel de baixo.
  const { diario, entradas, porChatbot } = useDiario();
  const resumoPorBot = useMemo(
    () => new Map(porChatbot.map((resumo) => [resumo.chatbotId, resumo])),
    [porChatbot]
  );

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return [...chatbots]
      .filter((bot) => !termo || bot.nome.toLowerCase().includes(termo))
      .sort((a, b) => a.criadoEm - b.criadoEm || a.id.localeCompare(b.id));
  }, [chatbots, busca]);

  const duplicar = async (bot) => {
    try {
      await api.chatbots.duplicar({ id: bot.id });
      await recarregar();
    } catch (err) {
      setErro(err?.message || "Não foi possível duplicar o chatbot.");
    }
  };

  const alternar = async (bot) => {
    try {
      await api.chatbots.atualizar({ id: bot.id, patch: { ativo: !bot.ativo } });
      await recarregar();
    } catch (err) {
      setErro(err?.message || "Não foi possível alterar o chatbot.");
    }
  };

  const remover = async (bot) => {
    if (!window.confirm(`Excluir o chatbot “${bot.nome}”?`)) return;
    try {
      await api.chatbots.remover({ id: bot.id });
      await recarregar();
    } catch (err) {
      setErro(err?.message || "Não foi possível remover o chatbot.");
    }
  };

  return (
    <>
      <CabecalhoTela
        titulo="Chatbots"
        busca={view === "flows" ? <CampoBusca valor={busca} aoMudar={setBusca} placeholder="Buscar chatbot" /> : <span />}
        acao={view === "flows" ? <BotaoPrimario onClick={() => aoEditar(null)}><Plus size={17} />Novo chatbot</BotaoPrimario> : <span />}
      />
      <div className="scrollbar-fina flex-1 overflow-y-auto px-8 py-6">
        <nav className="mb-4 flex w-fit rounded-[10px] border border-line bg-bg p-1" aria-label="Áreas de chatbots"><button onClick={() => { setErro(""); setView("flows"); }} className={`rounded-[7px] px-3 py-2 text-[11px] font-semibold ${view === "flows" ? "bg-accent text-white" : "text-sub"}`}>Fluxos</button><button onClick={() => { setErro(""); setView("handoffs"); }} className={`inline-flex items-center gap-1.5 rounded-[7px] px-3 py-2 text-[11px] font-semibold ${view === "handoffs" ? "bg-accent text-white" : "text-sub"}`}><Headphones size={13} />Atendimentos</button></nav>
        <div className={view === "flows" ? "" : "hidden"}>
        <AvisoAutomacao />
        {erro && <div className="mb-4 rounded-[10px] border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger">{erro}</div>}
        {filtrados.length === 0 ? (
          <EstadoVazio titulo={busca ? "Nenhum chatbot encontrado" : "Nenhum chatbot criado"} descricao={busca ? "Tente outro termo de busca." : "Crie o primeiro fluxo de resposta automática."} />
        ) : (
          <div className="overflow-hidden rounded-[14px] border border-line bg-bg">
            <div className="grid grid-cols-[minmax(240px,1.8fr)_150px_110px_130px_170px_150px] gap-4 border-b border-line px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-faint">
              <span>Chatbot</span><span>Passos</span><span>Execuções</span><span>Status</span><span>Criado</span><span>Atualizado</span>
            </div>
            {filtrados.map((bot) => (
              <div key={bot.id} className="grid grid-cols-[minmax(240px,1.8fr)_150px_110px_130px_170px_150px] items-center gap-4 border-b border-line px-5 py-4 last:border-b-0">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-accent-soft text-accent-forte"><Bot size={18} /></div>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-fg">{bot.nome}</p>
                    <p className="truncate text-[11.5px] text-faint">{bot.id}</p>
                    {/* Só aparece quando há o que contar — linha vazia em toda
                        linha da tabela vira ruído e some no meio. */}
                    {(() => {
                      const resumo = resumoPorBot.get(bot.id);
                      if (!resumo) return null;
                      if (resumo.ultimoErro) {
                        return (
                          <p
                            className="truncate text-[11.5px] font-medium text-danger"
                            title={resumo.ultimoErro.erro || ""}
                          >
                            {textoDoMotivo(resumo.ultimoErro.motivo)} {fmtRelativo(resumo.ultimoErro.em)}
                          </p>
                        );
                      }
                      if (resumo.ultimoDisparo) {
                        return (
                          <p className="truncate text-[11.5px] text-success">
                            Respondeu {fmtRelativo(resumo.ultimoDisparo.em)}
                          </p>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(bot.passos || []).map((passo) => <span key={passo.id} className="rounded-full bg-surface-hover px-2 py-1 text-[11px] text-sub">{tipoPasso[passo.tipo] || passo.tipo}</span>)}
                  {!bot.passos?.length && <span className="text-[12px] text-faint">Sem passos</span>}
                </div>
                <span className="text-[13.5px] tabular-nums text-sub">{bot.execucoes || 0}</span>
                <button type="button" onClick={() => alternar(bot)} className={`flex w-fit cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${bot.ativo ? "bg-success-soft text-success" : "bg-surface-hover text-faint"}`}><Power size={13} />{bot.ativo ? "Ativo" : "Inativo"}</button>
                <span className="text-[12.5px] text-sub">{fmtRelativo(bot.criadoEm)}</span>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] text-sub">{fmtRelativo(bot.atualizadoEm)}</span>
                  <div className="flex items-center gap-0.5">
                    <button type="button" onClick={() => aoEditar(bot)} title="Editar" className="cursor-pointer rounded-[7px] p-1.5 text-sub hover:bg-surface-hover hover:text-fg"><Pencil size={15} /></button>
                    <button type="button" onClick={() => duplicar(bot)} title="Duplicar" className="cursor-pointer rounded-[7px] p-1.5 text-sub hover:bg-surface-hover hover:text-fg"><Copy size={15} /></button>
                    <button type="button" onClick={() => remover(bot)} title="Remover" className="cursor-pointer rounded-[7px] p-1.5 text-sub hover:bg-danger/10 hover:text-danger"><Trash2 size={15} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <DiarioAutomacao diario={diario} entradas={entradas} />
        </div>
        {view === "handoffs" && <HandoffQueue canManage={canManage} onError={setErro} />}
      </div>
    </>
  );
}
