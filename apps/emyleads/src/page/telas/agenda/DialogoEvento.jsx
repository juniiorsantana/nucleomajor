import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, BriefcaseBusiness, CalendarDays, Clock3, MapPin, Tag, Trash2, X } from "lucide-react";
import { BotaoPrimario } from "../../ui";
import { eventoParaFormulario, formatarDuracao, isoLocal } from "./agendaUtils";

const GERENCIAIS = new Set(["owner", "admin"]);
const OPCOES_DURACAO = [30, 60, 90, 120, 180, 240, 360, 480, 720];
const OPCOES_LEMBRETE = [0, 5, 10, 30, 60, 1440];

const campo = "mt-1 min-h-10 w-full rounded-[9px] border border-line bg-bg px-3 text-[13px] text-fg outline-none transition-colors focus:border-accent";
const rotulo = "text-[11.5px] font-semibold text-sub";

function textoLembrete(minutos) {
  if (minutos === 0) return "Na hora";
  if (minutos < 60) return `${minutos} min`;
  if (minutos === 60) return "1 hora";
  if (minutos === 1440) return "1 dia";
  return formatarDuracao(minutos);
}

export default function DialogoEvento({
  aberto,
  evento,
  abertura,
  categorias,
  contatos,
  papel,
  lembretesPadrao,
  salvando,
  erro,
  aoFechar,
  aoSalvar,
  aoExcluir,
}) {
  const [form, setForm] = useState(() => eventoParaFormulario(evento, { ...abertura, lembretes: lembretesPadrao }));
  const dialogoRef = useRef(null);
  const podeEmpresa = GERENCIAIS.has(papel);
  const editando = Boolean(evento?.id);

  useEffect(() => {
    if (aberto) setForm(eventoParaFormulario(evento, { ...abertura, lembretes: lembretesPadrao }));
  }, [aberto, evento, abertura, lembretesPadrao]);

  useEffect(() => {
    if (!aberto) return undefined;
    const teclado = (e) => {
      if (e.key === "Escape") { e.preventDefault(); aoFechar(); return; }
      if (e.key !== "Tab") return;
      const focaveis = [...(dialogoRef.current?.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])") || [])];
      if (!focaveis.length) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    };
    window.addEventListener("keydown", teclado);
    return () => window.removeEventListener("keydown", teclado);
  }, [aberto, aoFechar]);

  const duracoes = useMemo(() => [...new Set([...OPCOES_DURACAO, form.duracao])].sort((a, b) => a - b), [form.duracao]);
  if (!aberto) return null;

  const mudar = (chave, valor) => setForm((atual) => ({ ...atual, [chave]: valor }));
  const alternarLembrete = (minutos) => setForm((atual) => ({
    ...atual,
    lembretes: atual.lembretes.includes(minutos)
      ? atual.lembretes.filter((item) => item !== minutos)
      : [...atual.lembretes, minutos].sort((a, b) => a - b),
  }));

  const enviar = (e) => {
    e.preventDefault();
    const inicio = form.diaInteiro ? isoLocal(form.data, "00:00") : isoLocal(form.data, form.inicio);
    const fim = new Date(new Date(inicio).getTime() + (form.diaInteiro ? 24 * 60 : form.duracao) * 60000).toISOString();
    aoSalvar({
      titulo: form.titulo,
      descricao: form.descricao,
      inicio,
      fim,
      diaInteiro: form.diaInteiro,
      tipo: form.visibilidade === "organization" && form.tipo === "block" ? "event" : form.tipo,
      visibilidade: form.visibilidade,
      categoryId: form.categoryId || categorias[0]?.id,
      contactId: form.contactId || null,
      local: form.local,
      tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      status: form.status,
      lembretes: form.lembretes,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f1424]/55 p-3 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <form ref={dialogoRef} role="dialog" aria-modal="true" aria-labelledby="agenda-evento-titulo" onSubmit={enviar} className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-[16px] border border-line bg-bg shadow-2xl">
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-[11px] bg-accent-soft text-accent-forte"><CalendarDays size={19} /></div>
          <div className="min-w-0 flex-1">
            <h2 id="agenda-evento-titulo" className="text-[16px] font-semibold text-fg">{editando ? "Editar evento" : "Novo evento"}</h2>
            <p className="mt-0.5 text-[11.5px] text-sub">Compromissos pessoais preservam seus detalhes; eventos da empresa ficam visíveis para a equipe.</p>
          </div>
          <button type="button" onClick={aoFechar} aria-label="Fechar" className="cursor-pointer rounded-[8px] p-2 text-sub hover:bg-surface-hover hover:text-fg"><X size={17} /></button>
        </header>

        <div className="scrollbar-fina min-h-0 overflow-y-auto px-5 py-4">
          <label className={rotulo}>Título
            <input autoFocus required maxLength={240} className={`${campo} text-[14px] font-medium`} value={form.titulo} onChange={(e) => mudar("titulo", e.target.value)} placeholder="Ex.: Reunião de alinhamento" />
          </label>

          <section className="mt-4 rounded-[12px] border border-accent/20 bg-accent-soft/45 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-[12px] font-semibold text-accent-forte"><Clock3 size={14} /> Horário</h3>
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-sub"><input type="checkbox" checked={form.diaInteiro} onChange={(e) => mudar("diaInteiro", e.target.checked)} className="accent-accent" />Dia inteiro</label>
            </div>
            <div className={`grid gap-3 ${form.diaInteiro ? "sm:grid-cols-1" : "sm:grid-cols-3"}`}>
              <label className={rotulo}>Data<input required type="date" className={campo} value={form.data} onChange={(e) => mudar("data", e.target.value)} /></label>
              {!form.diaInteiro && <>
                <label className={rotulo}>Começa às<input required type="time" step="1800" className={campo} value={form.inicio} onChange={(e) => mudar("inicio", e.target.value)} /></label>
                <label className={rotulo}>Duração<select className={`${campo} cursor-pointer`} value={form.duracao} onChange={(e) => mudar("duracao", Number(e.target.value))}>{duracoes.map((minutos) => <option key={minutos} value={minutos}>{formatarDuracao(minutos)}</option>)}</select></label>
              </>}
            </div>
          </section>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className={rotulo}>Categoria
              <select required className={`${campo} cursor-pointer`} value={form.categoryId} onChange={(e) => mudar("categoryId", e.target.value)}>
                <option value="" disabled>Escolha uma categoria</option>
                {categorias.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.name}</option>)}
              </select>
            </label>
            <label className={rotulo}>Contato
              <select className={`${campo} cursor-pointer`} value={form.contactId} onChange={(e) => mudar("contactId", e.target.value)}>
                <option value="">Sem contato</option>
                {contatos.map((contato) => <option key={contato.id} value={contato.id}>{contato.nome || contato.name || "Sem nome"}</option>)}
              </select>
            </label>
            <label className={rotulo}>Tipo
              <select className={`${campo} cursor-pointer`} value={form.tipo} onChange={(e) => mudar("tipo", e.target.value)}>
                <option value="appointment">Compromisso</option>
                <option value="block" disabled={form.visibilidade === "organization"}>Bloqueio de horário</option>
                <option value="event">Evento</option>
              </select>
            </label>
            <label className={rotulo}>Status
              <select className={`${campo} cursor-pointer`} value={form.status} onChange={(e) => mudar("status", e.target.value)}>
                <option value="scheduled">Confirmado</option>
                <option value="tentative">Provisório</option>
              </select>
            </label>
          </div>

          <section className="mt-4 rounded-[12px] border border-line p-4">
            <h3 className="flex items-center gap-2 text-[12px] font-semibold text-fg"><BriefcaseBusiness size={14} /> Visibilidade</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => mudar("visibilidade", "personal")} className={`cursor-pointer rounded-[9px] border p-3 text-left ${form.visibilidade === "personal" ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong"}`}>
                <span className="block text-[12px] font-semibold text-fg">Pessoal</span><span className="mt-0.5 block text-[10.5px] text-sub">Colegas veem apenas “Indisponível”.</span>
              </button>
              <button type="button" disabled={!podeEmpresa} onClick={() => setForm((atual) => ({ ...atual, visibilidade: "organization", tipo: atual.tipo === "block" ? "event" : atual.tipo }))} className={`cursor-pointer rounded-[9px] border p-3 text-left disabled:cursor-not-allowed disabled:opacity-45 ${form.visibilidade === "organization" ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong"}`}>
                <span className="block text-[12px] font-semibold text-fg">Empresa</span><span className="mt-0.5 block text-[10.5px] text-sub">Todos leem; donos e administradores editam.</span>
              </button>
            </div>
          </section>

          <section className="mt-4 rounded-[12px] border border-line p-4">
            <h3 className="flex items-center gap-2 text-[12px] font-semibold text-fg"><Bell size={14} /> Lembretes</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {OPCOES_LEMBRETE.map((minutos) => <button key={minutos} type="button" onClick={() => alternarLembrete(minutos)} className={`cursor-pointer rounded-full border px-3 py-1.5 text-[11px] font-medium ${form.lembretes.includes(minutos) ? "border-accent bg-accent-soft text-accent-forte" : "border-line text-sub hover:border-line-strong"}`}>{textoLembrete(minutos)}</button>)}
              {form.lembretes.length === 0 && <span className="py-1.5 text-[11px] text-faint">Sem lembretes</span>}
            </div>
          </section>

          <details className="mt-4 rounded-[12px] border border-line">
            <summary className="flex min-h-11 cursor-pointer items-center px-4 text-[12px] font-semibold text-sub">Adicionar detalhes</summary>
            <div className="grid gap-3 border-t border-line p-4 sm:grid-cols-2">
              <label className={rotulo}><span className="flex items-center gap-1"><MapPin size={12} />Local</span><input className={campo} value={form.local} onChange={(e) => mudar("local", e.target.value)} placeholder="Google Meet, escritório…" /></label>
              <label className={rotulo}><span className="flex items-center gap-1"><Tag size={12} />Tags</span><input className={campo} value={form.tags} onChange={(e) => mudar("tags", e.target.value)} placeholder="cliente, retorno" /></label>
              <label className={`${rotulo} sm:col-span-2`}>Descrição<textarea className={`${campo} min-h-24 resize-y py-2`} value={form.descricao} onChange={(e) => mudar("descricao", e.target.value)} placeholder="Pauta, observações ou contexto" /></label>
            </div>
          </details>

          {erro && <p role="alert" className="mt-4 rounded-[9px] border border-danger/25 bg-danger/10 px-3 py-2 text-[12px] text-danger">{erro}</p>}
        </div>

        <footer className="flex items-center gap-2 border-t border-line bg-surface/55 px-5 py-3">
          {editando && <button type="button" onClick={aoExcluir} disabled={salvando} className="flex cursor-pointer items-center gap-1.5 rounded-[8px] px-2 py-2 text-[12px] font-medium text-danger hover:bg-danger/10 disabled:opacity-40"><Trash2 size={14} />Excluir</button>}
          <button type="button" onClick={aoFechar} className="ml-auto cursor-pointer rounded-[8px] px-3 py-2 text-[12px] font-medium text-sub hover:text-fg">Cancelar</button>
          <BotaoPrimario type="submit" disabled={salvando || (form.visibilidade === "organization" && !podeEmpresa)} className="!py-2">{salvando ? "Salvando…" : editando ? "Salvar alterações" : "Criar evento"}</BotaoPrimario>
        </footer>
      </form>
    </div>
  );
}
