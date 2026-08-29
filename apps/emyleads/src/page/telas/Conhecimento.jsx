import { useEffect, useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { api } from "../../data/client";
import AssistenteConhecimento from "./conhecimento/AssistenteConhecimento";
import EditorDocumento from "./conhecimento/EditorDocumento";
import ListaConhecimento from "./conhecimento/ListaConhecimento";
import PrimeiroAcesso from "./conhecimento/PrimeiroAcesso";
import ResumoConhecimento from "./conhecimento/ResumoConhecimento";
import { filtrar, resumo, situacaoDoDocumento } from "./conhecimento/conhecimentoDados";
import { exigeColecaoExterna, motivoParaNaoPublicar } from "./conhecimento/conhecimentoRegras";

export default function Conhecimento({ sessao, inteligencia = null, embedded = false }) {
  const [documentos, setDocumentos] = useState([]);
  const [filtro, setFiltro] = useState("todos");
  const [busca, setBusca] = useState("");
  const [rascunho, setRascunho] = useState(null);
  // `null` = fechado; string = aberto no assunto que o primeiro acesso escolheu;
  // "" = aberto na etapa 1, sem assunto ainda.
  const [assistente, setAssistente] = useState(null);
  const [versoes, setVersoes] = useState(null);
  const [membros, setMembros] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [salvoEm, setSalvoEm] = useState(null);
  const [rascunhoAlterado, setRascunhoAlterado] = useState(false);
  const [inteligenciaLocal, setInteligenciaLocal] = useState(null);
  const [erro, setErro] = useState("");

  const dadosInteligencia = inteligencia || inteligenciaLocal;
  const papel = sessao?.organizacaoAtual?.papel;
  const ehAdmin = ["owner", "admin"].includes(papel);
  const podeCriar = Boolean(papel);
  // Conhecimento pessoal é de quem escreve; o da empresa é de quem administra.
  const podeEscrever = rascunho ? (rascunho.escopo === "personal" || ehAdmin) : ehAdmin;

  const carregar = async () => {
    const dados = await api.conhecimento.listar();
    setDocumentos(dados || []);
    return dados || [];
  };

  useEffect(() => { carregar().catch((e) => setErro(e.message)).finally(() => setCarregando(false)); }, []);
  useEffect(() => {
    if (!inteligencia) api.inteligencia.carregar().then(setInteligenciaLocal).catch(() => {});
  }, [inteligencia]);
  useEffect(() => {
    // Só para trocar id por nome na coluna "Atualizado". Falhar aqui não pode
    // derrubar a tela: sem os nomes a lista ainda diz quando mudou.
    api.organizacoes.membros().then(setMembros).catch(() => {});
  }, []);

  // O relógio avança quando a lista recarrega, não a cada render: com
  // `Date.now()` solto no corpo, a dependência mudava sempre e os dois useMemo
  // abaixo recalculavam em toda renderização — memo que não memoriza nada.
  const agora = useMemo(() => Date.now(), [documentos]);
  const total = useMemo(() => resumo(documentos, agora), [documentos, agora]);
  const visiveis = useMemo(() => filtrar(documentos, { filtro, busca, agora }), [documentos, filtro, busca, agora]);

  const nomePorId = useMemo(() => {
    const mapa = new Map();
    for (const membro of membros || []) {
      const nome = membro?.profile?.full_name || membro?.perfil?.full_name;
      if (membro?.user_id && nome) mapa.set(membro.user_id, String(nome).split(" ")[0]);
    }
    return mapa;
  }, [membros]);

  const colecoesPorDocumento = useMemo(() => {
    const nomes = new Map((dadosInteligencia?.collections || []).map((item) => [item.id, item.name]));
    const mapa = new Map();
    for (const vinculo of dadosInteligencia?.documentCollections || []) {
      const nome = nomes.get(vinculo.collection_id);
      if (!nome) continue;
      mapa.set(vinculo.document_id, [...(mapa.get(vinculo.document_id) || []), nome]);
    }
    return mapa;
  }, [dadosInteligencia]);

  const impedimento = motivoParaNaoPublicar(rascunho, dadosInteligencia?.collections);
  const exigeColecao = exigeColecaoExterna(rascunho);

  const podeDescartar = () => !rascunhoAlterado || confirm("Descartar as alterações que ainda não foram salvas?");

  const abrir = (documento, { forcar = false } = {}) => {
    if (!forcar && !podeDescartar()) return;
    const colecoesIds = Array.isArray(documento.colecoesIds)
      ? documento.colecoesIds
      : (dadosInteligencia?.documentCollections || [])
        .filter((item) => item.document_id === documento.id)
        .map((item) => item.collection_id);
    setRascunho({ ...documento, colecoesIds });
    setRascunhoAlterado(false);
    setSalvoEm(documento.atualizadoEm || null);
    setVersoes(null);
    setErro("");
  };

  const criar = (modeloId = "") => {
    if (!podeDescartar()) return;
    setAssistente(modeloId); setRascunho(null); setRascunhoAlterado(false); setVersoes(null); setErro("");
  };
  const voltar = () => {
    if (!podeDescartar()) return;
    setRascunho(null); setRascunhoAlterado(false); setSalvoEm(null); setVersoes(null); setErro("");
  };

  const mudarRascunho = (proximo) => {
    setRascunho(proximo);
    setRascunhoAlterado(true);
  };

  /** A única porta de gravação: o editor e o assistente passam os dois por aqui. */
  const persistir = async (documento, publicar) => {
    const caminho = String(documento.caminho || "").trim();
    if (!String(documento.titulo || "").trim() || !caminho) {
      setErro("Informe o título e o caminho do documento.");
      return;
    }
    setSalvando(true); setErro("");
    try {
      const salvo = await api.conhecimento.salvar({
        id: documento.id,
        escopo: documento.escopo,
        caminho: caminho.endsWith(".md") ? caminho : `${caminho}.md`,
        titulo: documento.titulo,
        conteudo: documento.conteudo,
        audiencia: documento.escopo === "personal" ? "internal" : documento.audiencia,
        colecoesIds: documento.colecoesIds,
        publicado: publicar,
      });
      await carregar();
      setAssistente(null);
      abrir({ ...salvo, colecoesIds: documento.colecoesIds }, { forcar: true });
      setSalvoEm(salvo.atualizadoEm || new Date().toISOString());
    } catch (e) { setErro(e.message); }
    finally { setSalvando(false); }
  };

  const salvar = (publicar) => {
    // A coleção externa só é exigida para publicar. Guardar rascunho de
    // conteúdo de cliente sem coleção é legítimo: ele ainda não está no ar.
    if (publicar && impedimento) { setErro(impedimento); return; }
    return persistir(rascunho, publicar);
  };

  const verHistorico = async () => {
    if (!rascunho?.id) return;
    try { setVersoes(await api.conhecimento.versoes({ id: rascunho.id })); }
    catch (e) { setErro(e.message); }
  };

  const arquivar = async () => {
    if (!rascunho?.id || !confirm(`Arquivar “${rascunho.titulo}”?`)) return;
    try { await api.conhecimento.arquivar({ id: rascunho.id }); await carregar(); voltar(); }
    catch (e) { setErro(e.message); }
  };

  const botaoAdicionar = (
    <button
      type="button"
      onClick={() => criar("")}
      disabled={!podeCriar}
      className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-accent px-4 text-[13px] font-semibold text-white disabled:opacity-35"
    >
      <Plus size={16} /> Adicionar conhecimento
    </button>
  );

  return (
    <div className="flex min-h-0 min-w-0 w-full max-w-full flex-1 flex-col overflow-x-hidden bg-surface">
      {!embedded && (
        <header className="flex flex-none flex-wrap items-center gap-4 border-b border-line bg-bg px-4 py-3 md:px-8 md:py-4">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold tracking-tight text-fg">Base de conhecimento</h1>
            <p className="mt-0.5 text-[12px] text-sub">
              Ensine seus assistentes a responder usando informações confiáveis da sua empresa.
            </p>
          </div>
          <label className="order-3 flex h-10 w-full items-center gap-2 rounded-[10px] border border-line px-3 text-sub focus-within:border-accent md:order-none md:ml-auto md:w-72">
            <Search size={16} />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar no conhecimento…"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-faint"
            />
          </label>
          {botaoAdicionar}
        </header>
      )}
      {embedded && (
        <div className="flex flex-none flex-wrap items-center gap-3 border-b border-line bg-bg px-4 py-3 md:px-7">
          <label className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-[9px] border border-line px-3 text-sub focus-within:border-accent md:max-w-md">
            <Search size={15} />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar no conhecimento…"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-faint"
            />
          </label>
          {botaoAdicionar}
        </div>
      )}

      {erro && <div role="alert" className="mx-4 mt-4 rounded-[9px] bg-danger/10 px-4 py-3 text-[12.5px] text-danger md:mx-8">{erro}</div>}

      {/* O editor governa a própria altura: as três colunas rolam de forma
          independente, o que não funciona dentro de um pai que já rola. */}
      {rascunho ? (
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3 md:px-6">
          <EditorDocumento
            rascunho={rascunho}
            aoMudar={mudarRascunho}
            podeEscrever={podeEscrever}
            podeGerenciarEmpresa={ehAdmin}
            inteligencia={dadosInteligencia}
            impedimento={impedimento}
            exigeColecao={exigeColecao}
            salvando={salvando}
            salvoEm={salvoEm}
            alterado={rascunhoAlterado}
            documentos={documentos}
            aoAbrir={abrir}
            aoSalvar={salvar}
            aoVerHistorico={verHistorico}
            aoArquivar={arquivar}
            aoVoltar={voltar}
          />
        </div>
      ) : (
        <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          {carregando ? (
            <p className="p-5 text-[12.5px] text-sub">Carregando…</p>
          ) : documentos.length === 0 ? (
            <PrimeiroAcesso onCriar={criar} podeEscrever={podeCriar} />
          ) : (
            <div className="mx-auto max-w-6xl">
              <ResumoConhecimento total={total} filtro={filtro} onFiltrar={setFiltro} />
              <div className="mt-5">
                <ListaConhecimento
                  documentos={visiveis}
                  total={total}
                  filtro={filtro}
                  onFiltrar={setFiltro}
                  onAbrir={abrir}
                  skillsDoDocumento={(documento) => colecoesPorDocumento.get(documento.id) || []}
                  nomeDoAutor={(id) => nomePorId.get(id) || ""}
                  agora={agora}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {assistente !== null && (
        <AssistenteConhecimento
          modeloId={assistente || null}
          inteligencia={dadosInteligencia}
          salvando={salvando}
          aoFechar={() => setAssistente(null)}
          aoSalvar={persistir}
          somentePessoal={!ehAdmin}
        />
      )}

      {versoes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" onMouseDown={(e) => e.target === e.currentTarget && setVersoes(null)}>
          <section className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-[14px] border border-line bg-bg shadow-2xl">
            <header className="flex items-center border-b border-line px-5 py-4">
              <div>
                <h2 className="text-[15px] font-semibold text-fg">Histórico de versões</h2>
                <p className="text-[11px] text-sub">Cada salvamento preserva a versão anterior.</p>
              </div>
              <button onClick={() => setVersoes(null)} className="ml-auto rounded-[8px] p-2 text-sub hover:bg-surface-hover"><X size={17} /></button>
            </header>
            <div className="scrollbar-fina max-h-[60vh] overflow-y-auto">
              {versoes.map((versao) => (
                <div key={versao.id} className="border-b border-line px-5 py-4">
                  <div className="flex items-center gap-2">
                    <strong className="text-[12.5px] text-fg">Versão {versao.version}</strong>
                    <span className="text-[10.5px] text-faint">{new Date(versao.created_at).toLocaleString("pt-BR")}</span>
                    <span className="ml-auto text-[10.5px] text-faint">
                      {situacaoDoDocumento({ publicadoEm: versao.published_at }) === "publicado" ? "publicado" : "rascunho"}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[10.5px] text-sub">{versao.path}</p>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-[8px] bg-surface p-3 text-[10.5px] text-sub">{versao.content_markdown}</pre>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
