import { useEffect, useMemo, useState } from "react";
import { Archive, BookOpen, Building2, Clock3, FileText, Plus, Save, Search, UsersRound, UserRound, X } from "lucide-react";
import { api } from "../../data/client";
import { colecaoAutomatica, colecoesExternasDisponiveis, exigeColecaoExterna, motivoParaNaoPublicar } from "./conhecimentoRegras";

const scopes = [
  { id: "organization", label: "Organização", note: "Identidade e regras", icon: Building2 },
  { id: "team", label: "Equipe", note: "Processos compartilhados", icon: UsersRound },
  { id: "personal", label: "Meu espaço", note: "Referências privadas", icon: UserRound },
];

const emptyDraft = (scope = "organization") => ({ id: null, escopo: scope, titulo: "", caminho: "", conteudo: "", versao: 1, audiencia: "internal", colecoesIds: [] });

export default function Conhecimento({ sessao, inteligencia = null, embedded = false }) {
  const [documents, setDocuments] = useState([]);
  const [scope, setScope] = useState("organization");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(null);
  const [versions, setVersions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [localIntelligence, setLocalIntelligence] = useState(null);
  const [error, setError] = useState("");
  const intelligenceData = inteligencia || localIntelligence;
  const role = sessao?.organizacaoAtual?.papel;
  const canWrite = scope === "personal" || ["owner", "admin"].includes(role);

  const load = async () => {
    const data = await api.conhecimento.listar();
    setDocuments(data || []);
    return data || [];
  };

  useEffect(() => { load().catch((e) => setError(e.message)).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    if (!inteligencia) api.inteligencia.carregar().then(setLocalIntelligence).catch(() => {});
  }, [inteligencia]);
  useEffect(() => {
    setSelected(null); setDraft(null); setVersions(null);
  }, [scope]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return documents.filter((item) => item.escopo === scope && (!term || `${item.titulo} ${item.caminho} ${item.conteudo}`.toLocaleLowerCase("pt-BR").includes(term)));
  }, [documents, scope, search]);

  const counts = useMemo(() => Object.fromEntries(scopes.map((item) => [item.id, documents.filter((doc) => doc.escopo === item.id).length])), [documents]);

  /**
   * Marcar "Atendimento a clientes" NÃO basta para o cliente ler.
   *
   * `nucleo_contextual_knowledge_search` só encontra um documento externo se
   * ele estiver numa `knowledge_collections` ativa e externa — e, se a coleção
   * for de campanha, se houver o vínculo em `campaign_knowledge_collections`
   * com a campanha daquele contexto. Sem coleção, o documento é publicado,
   * aparece na lista, e a Recepção nunca o encontra: some sem erro nenhum.
   *
   * Por isso a coleção deixou de ser opcional quando o público é externo.
   */
  const colecoesExternas = useMemo(
    () => colecoesExternasDisponiveis(intelligenceData?.collections),
    [intelligenceData],
  );
  const exigeColecao = exigeColecaoExterna(draft);
  const impedimento = motivoParaNaoPublicar(draft, intelligenceData?.collections);

  const open = (document) => {
    const colecoesIds = Array.isArray(document.colecoesIds)
      ? document.colecoesIds
      : (intelligenceData?.documentCollections || []).filter((item) => item.document_id === document.id).map((item) => item.collection_id);
    setSelected(document); setDraft({ ...document, colecoesIds }); setVersions(null); setError("");
  };
  const create = () => { setSelected(null); setDraft(emptyDraft(scope)); setVersions(null); setError(""); };

  const save = async () => {
    if (!draft?.titulo.trim() || !draft?.caminho.trim()) { setError("Informe o título e o caminho do documento."); return; }
    if (impedimento) { setError(impedimento); return; }
    const path = draft.caminho.trim().endsWith(".md") ? draft.caminho.trim() : `${draft.caminho.trim()}.md`;
    setSaving(true); setError("");
    try {
      const saved = await api.conhecimento.salvar({
        id: draft.id, escopo: draft.escopo, caminho: path, titulo: draft.titulo,
        conteudo: draft.conteudo, audiencia: draft.escopo === "personal" ? "internal" : draft.audiencia,
        colecoesIds: draft.colecoesIds,
      });
      await load(); open({ ...saved, colecoesIds: draft.colecoesIds });
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const history = async () => {
    if (!draft?.id) return;
    try { setVersions(await api.conhecimento.versoes({ id: draft.id })); }
    catch (e) { setError(e.message); }
  };

  const archive = async () => {
    if (!draft?.id || !confirm(`Arquivar “${draft.titulo}”?`)) return;
    try { await api.conhecimento.arquivar({ id: draft.id }); await load(); setDraft(null); setSelected(null); }
    catch (e) { setError(e.message); }
  };

  return (
    <div className="flex min-h-0 min-w-0 w-full max-w-full flex-1 flex-col overflow-x-hidden bg-surface">
      {!embedded && <header className="flex flex-none flex-wrap items-center gap-4 border-b border-line bg-bg px-4 py-3 md:px-8 md:py-4">
        <div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-accent">Biblioteca viva</p><h1 className="text-[22px] font-semibold tracking-tight text-fg">Núcleo de Conhecimento</h1></div>
        <label className="order-3 flex h-10 w-full items-center gap-2 rounded-[10px] border border-line px-3 text-sub focus-within:border-accent md:order-none md:ml-auto md:w-80"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar títulos, caminhos e conteúdo" className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-faint" /></label>
        <button type="button" onClick={create} disabled={!canWrite} className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-accent px-4 text-[13px] font-semibold text-white disabled:opacity-35"><Plus size={16} /> Novo documento</button>
      </header>}
      {embedded && <div className="flex flex-none flex-wrap items-center gap-3 border-b border-line bg-bg px-4 py-3 md:px-7">
        <label className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-[9px] border border-line px-3 text-sub focus-within:border-accent md:max-w-md"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar conhecimento" className="min-w-0 flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-faint" /></label>
        <button type="button" onClick={create} disabled={!canWrite} className="inline-flex h-9 items-center gap-2 rounded-[9px] bg-accent px-3.5 text-[11.5px] font-semibold text-white disabled:opacity-35"><Plus size={15} />Novo documento</button>
      </div>}

      {error && <div role="alert" className="mx-4 mt-4 rounded-[9px] bg-danger/10 px-4 py-3 text-[12.5px] text-danger md:mx-8">{error}</div>}

      <div className="grid min-h-0 min-w-0 w-full flex-1 lg:grid-cols-[230px_320px_minmax(0,1fr)]">
        <aside className="min-w-0 border-b border-line bg-bg p-4 lg:border-b-0 lg:border-r lg:p-5">
          <p className="mb-4 text-[10px] font-bold uppercase tracking-[.13em] text-faint">De onde vem</p>
          <div className="relative flex gap-2 overflow-x-auto lg:flex-col lg:gap-1.5">
            <div aria-hidden="true" className="absolute bottom-7 left-[19px] top-7 hidden w-px bg-gradient-to-b from-accent via-[#0f9f8f] to-[#e1a12d] lg:block" />
            {scopes.map(({ id, label, note, icon: Icon }, index) => (
              <button key={id} type="button" onClick={() => setScope(id)} className={`relative flex min-w-[175px] items-center gap-3 rounded-[11px] px-3 py-3 text-left lg:min-w-0 ${scope === id ? "bg-accent-soft text-accent-forte" : "text-sub hover:bg-surface-hover hover:text-fg"}`}>
                <span className={`z-10 flex h-9 w-9 items-center justify-center rounded-[10px] ${scope === id ? "bg-bg shadow-sm" : "bg-surface"}`}><Icon size={17} /></span>
                <span className="min-w-0 flex-1"><strong className="block text-[12.5px]">{label}</strong><small className="block truncate text-[10.5px] opacity-75">{note}</small></span><em className="text-[10px] not-italic tabular-nums">{counts[id] || 0}</em>
                {index < scopes.length - 1 && <span className="sr-only">herda para o próximo nível</span>}
              </button>
            ))}
          </div>
          <div className="mt-5 rounded-[11px] border border-line bg-surface p-3 text-[11px] leading-5 text-sub"><strong className="text-fg">Herança segura</strong><p className="mt-1">O assistente combina empresa, equipe e seu espaço sem mostrar documentos pessoais de colegas.</p></div>
        </aside>

        <section className="min-h-0 min-w-0 border-b border-line bg-bg lg:border-b-0 lg:border-r">
          <div className="flex h-12 items-center border-b border-line px-4"><h2 className="text-[12.5px] font-semibold text-fg">{scopes.find((item) => item.id === scope)?.label}</h2><span className="ml-auto text-[10.5px] text-faint">{filtered.length} documento(s)</span></div>
          <div className="scrollbar-fina max-h-64 overflow-y-auto lg:max-h-none lg:h-[calc(100vh-121px)]">
            {loading ? <p className="p-5 text-[12px] text-sub">Carregando…</p> : filtered.length === 0 ? <div className="p-8 text-center"><BookOpen size={28} className="mx-auto text-faint" /><p className="mt-3 text-[12.5px] font-medium text-fg">Nenhum documento neste espaço</p><p className="mt-1 text-[11px] text-sub">{canWrite ? "Crie o primeiro documento para orientar a equipe e o assistente." : "Somente administradores podem publicar aqui."}</p></div> : filtered.map((document) => (
              <button key={document.id} type="button" onClick={() => open(document)} className={`block w-full border-b border-line px-4 py-3 text-left ${selected?.id === document.id ? "bg-accent-soft" : "hover:bg-surface-hover"}`}><div className="flex items-start gap-2"><FileText size={15} className="mt-0.5 flex-none text-accent-forte" /><div className="min-w-0"><p className="truncate text-[12.5px] font-semibold text-fg">{document.titulo}</p><p className="mt-0.5 truncate font-mono text-[10.5px] text-faint">{document.caminho}</p><p className="mt-1 text-[10px] text-sub">v{document.versao} · {new Date(document.atualizadoEm).toLocaleDateString("pt-BR")}</p></div></div></button>
            ))}
          </div>
        </section>

        <main className="scrollbar-fina min-h-0 min-w-0 overflow-y-auto p-4 md:p-6">
          {!draft ? <div className="flex min-h-[420px] flex-col items-center justify-center text-center"><BookOpen size={38} strokeWidth={1.4} className="text-faint" /><h2 className="mt-4 text-[16px] font-semibold text-fg">Selecione um documento</h2><p className="mt-1 max-w-sm text-[12.5px] leading-5 text-sub">Leia, edite e acompanhe versões sem sair do contexto da organização.</p></div> : (
            <div className="mx-auto max-w-4xl">
              <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-accent-soft px-2.5 py-1 text-[10.5px] font-semibold text-accent-forte">{scopes.find((item) => item.id === draft.escopo)?.label}</span><span className="text-[10.5px] text-faint">Versão {draft.versao || 1}</span><div className="ml-auto flex gap-1">{draft.id && <button type="button" onClick={history} className="rounded-[8px] p-2 text-sub hover:bg-bg hover:text-fg" title="Histórico"><Clock3 size={16} /></button>}{draft.id && canWrite && <button type="button" onClick={archive} className="rounded-[8px] p-2 text-sub hover:bg-danger/10 hover:text-danger" title="Arquivar"><Archive size={16} /></button>}</div></div>
              <input value={draft.titulo} readOnly={!canWrite} onChange={(e) => setDraft({ ...draft, titulo: e.target.value })} placeholder="Título do documento" className="mt-4 w-full bg-transparent text-[24px] font-semibold tracking-tight text-fg outline-none placeholder:text-faint" />
              <input value={draft.caminho} readOnly={!canWrite} onChange={(e) => setDraft({ ...draft, caminho: e.target.value })} placeholder="processos/comercial.md" className="mt-2 w-full rounded-[8px] border border-line bg-bg px-3 py-2 font-mono text-[11.5px] text-sub outline-none focus:border-accent" />
              {draft.escopo !== "personal" && intelligenceData && <div className="mt-4 grid gap-3 rounded-[11px] border border-line bg-bg p-3 md:grid-cols-2">
                <label><span className="mb-1 block text-[10.5px] font-semibold text-sub">Quem pode usar</span><select disabled={!canWrite} value={draft.audiencia || "internal"} onChange={(e) => {
                  const audiencia = e.target.value;
                  // Com uma coleção externa só, escolher é cerimônia: já marca.
                  setDraft({ ...draft, audiencia, colecoesIds: colecaoAutomatica(audiencia, intelligenceData?.collections) });
                }} className="w-full rounded-[8px] border border-line bg-bg px-3 py-2 text-[12px]"><option value="internal">Somente equipe</option><option value="external">Atendimento a clientes</option></select></label>
                <div><span className="mb-1 block text-[10.5px] font-semibold text-sub">Coleções{exigeColecao && <span className="ml-1 font-normal text-danger">· obrigatória</span>}</span><div className="flex flex-wrap gap-1.5">{(intelligenceData.collections || []).filter((item) => item.audience === (draft.audiencia === "external" ? "external" : "internal") && item.scope_type !== "personal").map((collection) => <label key={collection.id} className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[10.5px] text-sub"><input type="checkbox" disabled={!canWrite} checked={(draft.colecoesIds || []).includes(collection.id)} onChange={(e) => setDraft({ ...draft, colecoesIds: e.target.checked ? [...(draft.colecoesIds || []), collection.id] : (draft.colecoesIds || []).filter((id) => id !== collection.id) })} />{collection.name}</label>)}</div>
                  {impedimento && <p className="mt-2 text-[10.5px] leading-4 text-danger">{impedimento}</p>}
                </div>
              </div>}
              <textarea value={draft.conteudo} readOnly={!canWrite} onChange={(e) => setDraft({ ...draft, conteudo: e.target.value })} placeholder="# Comece a documentar aqui…" className="mt-4 min-h-[430px] w-full resize-y rounded-[12px] border border-line bg-bg p-4 font-mono text-[12.5px] leading-6 text-fg outline-none focus:border-accent" />
              {canWrite && <div className="mt-3 flex justify-end"><button type="button" onClick={save} disabled={saving || Boolean(impedimento)} title={impedimento || undefined} className="inline-flex items-center gap-2 rounded-[9px] bg-accent px-4 py-2.5 text-[12.5px] font-semibold text-white disabled:opacity-40"><Save size={15} /> {saving ? "Salvando…" : "Salvar documento"}</button></div>}
            </div>
          )}
        </main>
      </div>

      {versions && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" onMouseDown={(e) => e.target === e.currentTarget && setVersions(null)}><section className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-[14px] border border-line bg-bg shadow-2xl"><header className="flex items-center border-b border-line px-5 py-4"><div><h2 className="text-[15px] font-semibold text-fg">Histórico de versões</h2><p className="text-[11px] text-sub">Cada salvamento preserva a versão anterior.</p></div><button onClick={() => setVersions(null)} className="ml-auto rounded-[8px] p-2 text-sub hover:bg-surface-hover"><X size={17} /></button></header><div className="scrollbar-fina max-h-[60vh] overflow-y-auto">{versions.map((version) => <div key={version.id} className="border-b border-line px-5 py-4"><div className="flex items-center gap-2"><strong className="text-[12.5px] text-fg">Versão {version.version}</strong><span className="text-[10.5px] text-faint">{new Date(version.created_at).toLocaleString("pt-BR")}</span></div><p className="mt-1 font-mono text-[10.5px] text-sub">{version.path}</p><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-[8px] bg-surface p-3 text-[10.5px] text-sub">{version.content_markdown}</pre></div>)}</div></section></div>}
    </div>
  );
}
