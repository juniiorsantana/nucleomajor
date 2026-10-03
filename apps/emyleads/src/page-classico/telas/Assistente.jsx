import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, CalendarCheck, Check, LoaderCircle, MessageSquarePlus, Send, Sparkles, X } from "lucide-react";
import { api } from "../../data/client";
import { Marca } from "../ui";

const sugestoes = [
  "Como está minha agenda hoje?",
  "Resuma as prioridades da organização.",
  "Agende uma reunião amanhã às 13h por uma hora.",
];

function Bolha({ message, aoDecidir, decidindo }) {
  const pending = message.metadata?.pendingToolRunId;
  const proposal = message.metadata?.proposal;
  const proposalDate = proposal?.starts_at
    ? new Date(proposal.starts_at).toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short" })
    : null;
  return (
    <div className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[760px] rounded-[16px] px-4 py-3 text-[13.5px] leading-6 ${message.role === "user" ? "rounded-br-[5px] bg-accent text-white" : "rounded-bl-[5px] border border-line bg-bg text-fg"}`}>
        <p className="whitespace-pre-wrap">{message.content}</p>
        {pending && (
          <div className="mt-3 border-t border-line pt-3">
            {proposal && (
              <div className="mb-3 rounded-[10px] bg-surface px-3 py-2 text-[12px] leading-5 text-sub">
                <span className="block font-semibold text-fg">{proposal.title || "Novo compromisso"}</span>
                {proposalDate && <span className="block">{proposalDate}</span>}
                {proposal.location && <span className="block">{proposal.location}</span>}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={decidindo} onClick={() => aoDecidir(pending, "confirm")} className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40">
                <Check size={14} /> Confirmar na agenda
              </button>
              <button type="button" disabled={decidindo} onClick={() => aoDecidir(pending, "reject")} className="inline-flex items-center gap-1.5 rounded-[8px] border border-line px-3 py-2 text-[12px] font-semibold text-sub disabled:opacity-40">
                <X size={14} /> Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Assistente() {
  const [threads, setThreads] = useState([]);
  const [threadId, setThreadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef(null);

  const loadThreads = async () => {
    const result = await api.assistente.conversas();
    setThreads(result.threads || []);
    return result.threads || [];
  };

  const loadMessages = async (id) => {
    if (!id) { setMessages([]); return; }
    const result = await api.assistente.mensagens({ threadId: id });
    setMessages(result.messages || []);
  };

  useEffect(() => {
    loadThreads().then(async (items) => {
      const first = items[0]?.id || null;
      setThreadId(first);
      await loadMessages(first);
    }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

  const send = async (event) => {
    event?.preventDefault();
    const content = text.trim();
    if (!content || sending) return;
    setText(""); setError(""); setSending(true);
    const optimistic = { id: `local-${Date.now()}`, role: "user", content, metadata: {} };
    setMessages((current) => [...current, optimistic]);
    try {
      setProgressText("Preparando contexto…");
      const result = await api.assistente.enviar({ threadId, content, onProgress: setProgressText });
      setThreadId(result.threadId);
      await Promise.all([loadMessages(result.threadId), loadThreads()]);
    } catch (e) {
      setError(e.message);
      setMessages((current) => current.filter((item) => item.id !== optimistic.id));
      setText(content);
    } finally { setSending(false); setProgressText(""); }
  };

  const decide = async (toolRunId, decision) => {
    setDeciding(true); setError("");
    try {
      await api.assistente.decidir({ toolRunId, decision });
      await loadMessages(threadId);
    } catch (e) { setError(e.message); }
    finally { setDeciding(false); }
  };

  const title = useMemo(() => threads.find((item) => item.id === threadId)?.title || "Nova conversa", [threads, threadId]);

  return (
    <div className="flex min-h-0 flex-1 bg-surface">
      <aside className="hidden w-72 flex-none border-r border-line bg-bg lg:flex lg:flex-col">
        <div className="border-b border-line p-4">
          <button type="button" onClick={() => { setThreadId(null); setMessages([]); }} className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-accent px-4 py-2.5 text-[13px] font-semibold text-white"><MessageSquarePlus size={16} /> Nova conversa</button>
        </div>
        <div className="scrollbar-fina flex-1 overflow-y-auto p-2">
          {threads.map((thread) => (
            <button key={thread.id} type="button" onClick={() => { setThreadId(thread.id); loadMessages(thread.id).catch((e) => setError(e.message)); }} className={`mb-1 w-full rounded-[9px] px-3 py-2.5 text-left text-[12.5px] ${thread.id === threadId ? "bg-accent-soft font-semibold text-accent-forte" : "text-sub hover:bg-surface-hover"}`}>
              <span className="line-clamp-2">{thread.title}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[72px] flex-none items-center gap-3 border-b border-line bg-bg px-5 md:px-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-accent-soft text-accent-forte"><Sparkles size={19} /></div>
          <div className="min-w-0"><h1 className="truncate text-[18px] font-semibold text-fg">{title}</h1><p className="text-[11.5px] text-sub">Contexto individual · agenda e conhecimento da organização</p></div>
          <span className="ml-auto hidden items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[11px] font-semibold text-sub sm:flex"><CalendarCheck size={13} /> Escritas exigem confirmação</span>
        </header>

        <div className="scrollbar-fina flex-1 overflow-y-auto px-4 py-6 md:px-8">
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            {loading ? <div className="flex justify-center py-16 text-sub"><LoaderCircle className="animate-spin" /></div> : messages.length === 0 ? (
              <div className="mx-auto flex max-w-2xl flex-col items-center py-12 text-center">
                <Marca tamanho={48} texto={false} />
                <h2 className="mt-5 text-[24px] font-semibold tracking-tight text-fg">O que precisa avançar agora?</h2>
                <p className="mt-2 max-w-lg text-[13.5px] leading-6 text-sub">Converse com o Núcleo usando seu contexto profissional. Consultas são imediatas; qualquer alteração será mostrada para sua confirmação.</p>
                <div className="mt-7 grid w-full gap-2 sm:grid-cols-3">{sugestoes.map((item) => <button key={item} onClick={() => setText(item)} className="rounded-[12px] border border-line bg-bg p-3 text-left text-[12px] leading-5 text-sub hover:border-accent hover:text-fg">{item}</button>)}</div>
              </div>
            ) : messages.map((message) => <Bolha key={message.id} message={message} aoDecidir={decide} decidindo={deciding} />)}
            {sending && <div className="flex justify-start"><div className="flex items-center gap-2 rounded-[14px] border border-line bg-bg px-4 py-3 text-[12.5px] text-sub"><LoaderCircle size={15} className="animate-spin" /> {progressText || "Consultando seu contexto…"}</div></div>}
            <div ref={bottom} />
          </div>
        </div>

        <div className="flex-none border-t border-line bg-bg px-4 py-4 md:px-8">
          <form onSubmit={send} className="mx-auto max-w-4xl">
            {error && <div role="alert" className="mb-2 rounded-[8px] bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}
            <div className="flex items-end gap-2 rounded-[14px] border border-line bg-bg p-2 shadow-[0_8px_30px_rgba(18,23,48,.06)] focus-within:border-accent">
              <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} rows={1} placeholder="Peça uma consulta, resumo ou compromisso…" className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-[14px] text-fg outline-none placeholder:text-faint" />
              <button type="submit" disabled={!text.trim() || sending} aria-label="Enviar mensagem" className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-accent text-white disabled:opacity-35"><Send size={17} /></button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
