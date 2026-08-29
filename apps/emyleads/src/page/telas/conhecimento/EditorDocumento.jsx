import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Archive, ArrowLeft, Clock3, Download, FileUp, Loader2,
  Plus, Save, Search, Send, Trash2,
} from "lucide-react";
import { api } from "../../../data/client";
import PreviaMarkdown from "./PreviaMarkdown";
import {
  PUBLICOS, PUBLICO_POR_ID, publicoDoDocumento, situacaoDoDocumento, tempoRelativo,
} from "./conhecimentoDados";
import { colecaoAutomatica } from "./conhecimentoRegras";
import { lerBlocos, montarMarkdown } from "./modelosConhecimento";
import { PALAVRAS_CONFORTAVEIS, contarPalavras, folegoDoDocumento } from "./markdown";

const FOLEGO = {
  folgado: { rotulo: "folgado", cor: "var(--el-success)" },
  atento: { rotulo: "ficando longo", cor: "var(--el-warning)" },
  longo: { rotulo: "longo demais", cor: "var(--el-danger)" },
};

const normalizar = (texto) => String(texto || "").replace(/\r/g, "").replace(/\n{2,}/g, "\n\n").trim();

function Painel({ titulo, children, acao }) {
  return (
    <section className="border-t border-line px-4 py-3.5 first:border-t-0">
      <div className="flex items-center gap-2">
        <h3 className="text-[9.5px] font-bold uppercase tracking-[.07em] text-faint">{titulo}</h3>
        {acao}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export default function EditorDocumento({
  rascunho, aoMudar, podeEscrever, podeGerenciarEmpresa = false, inteligencia, impedimento, exigeColecao,
  salvando, salvoEm, alterado = false, aoSalvar, aoVerHistorico, aoArquivar, aoVoltar,
  documentos = [], aoAbrir,
}) {
  const [modo, setModo] = useState("simples");
  const [confirmandoExterno, setConfirmandoExterno] = useState(false);
  const [reescritaAceita, setReescritaAceita] = useState(false);
  const [pergunta, setPergunta] = useState("");
  const [previa, setPrevia] = useState(null);
  const [testando, setTestando] = useState(false);
  const arquivoRef = useRef(null);

  const publico = publicoDoDocumento(rascunho);
  const situacao = situacaoDoDocumento(rascunho);
  const palavras = contarPalavras(rascunho.conteudo);
  const folego = FOLEGO[folegoDoDocumento(palavras)];

  const blocos = useMemo(() => lerBlocos(rascunho.conteudo), [rascunho.conteudo]);

  /**
   * O editor simples reescreve o documento a partir dos blocos.
   *
   * Tabela, bloco de código, citação e lista aninhada não viram bloco — eles
   * sobrevivem à leitura como texto solto e voltam achatados na remontagem.
   * Sem este aviso, abrir o modo simples num documento assim e digitar uma
   * vírgula apagaria a formatação inteira sem nada na tela dizendo que houve
   * perda. Comparo a ida e a volta: se não bate, aviso antes de deixar editar.
   */
  const perdeFormatacao = useMemo(() => {
    if (!rascunho.conteudo.trim()) return false;
    const volta = montarMarkdown({ titulo: rascunho.titulo, blocos });
    return normalizar(volta) !== normalizar(rascunho.conteudo);
  }, [rascunho.conteudo, rascunho.titulo, blocos]);

  const simplesBloqueado = modo === "simples" && perdeFormatacao && !reescritaAceita;

  const escreverBlocos = (proximos) => {
    aoMudar({ ...rascunho, conteudo: montarMarkdown({ titulo: rascunho.titulo, blocos: proximos }) });
  };

  const colecoes = (inteligencia?.collections || []).filter(
    (item) => item.audience === (rascunho.audiencia === "external" ? "external" : "internal")
      && item.scope_type !== "personal" && item.status !== "archived",
  );

  const aplicarPublico = (id) => {
    setConfirmandoExterno(false);
    if (id === "pessoal") return aoMudar({ ...rascunho, escopo: "personal", audiencia: "internal", colecoesIds: [] });
    const audiencia = id === "clientes" ? "external" : "internal";
    aoMudar({
      ...rascunho,
      escopo: rascunho.escopo === "personal" ? "organization" : rascunho.escopo,
      audiencia,
      // Com uma coleção externa só, escolher é cerimônia: já marca.
      colecoesIds: colecaoAutomatica(audiencia, inteligencia?.collections),
    });
  };

  /**
   * Abrir para clientes é o único caminho que tira conteúdo de dentro da
   * empresa, e num documento que já existe — escrito para a equipe, talvez com
   * preço de custo ou nome de cliente — esse clique não pode valer sozinho.
   * Documento novo não pergunta: não há nada escrito antes para vazar.
   */
  const trocarPublico = (id) => {
    if (id === "clientes" && publico !== "clientes" && rascunho.id) return setConfirmandoExterno(true);
    aplicarPublico(id);
  };

  const importar = async (arquivo) => {
    if (!arquivo) return;
    const texto = await arquivo.text();
    aoMudar({ ...rascunho, conteudo: texto });
    setReescritaAceita(false);
  };

  const exportar = () => {
    const nome = (rascunho.caminho || "documento.md").split("/").pop();
    const url = URL.createObjectURL(new Blob([rascunho.conteudo], { type: "text/markdown;charset=utf-8" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: nome });
    link.click();
    URL.revokeObjectURL(url);
  };

  const testar = async () => {
    if (!pergunta.trim()) return;
    setTestando(true); setPrevia(null);
    try {
      setPrevia(await api.conhecimento.testar({
        titulo: rascunho.titulo, caminho: rascunho.caminho, conteudo: rascunho.conteudo, pergunta,
      }));
    } catch (e) { setPrevia({ erro: e.message }); }
    finally { setTestando(false); }
  };

  const porPublico = useMemo(() => PUBLICOS.map((item) => ({
    ...item,
    itens: documentos.filter((documento) => publicoDoDocumento(documento) === item.id),
  })).filter((grupo) => grupo.itens.length), [documentos]);
  const publicosDisponiveis = !podeEscrever
    ? PUBLICOS.filter((item) => item.id === publico)
    : podeGerenciarEmpresa
      ? PUBLICOS
      : PUBLICOS.filter((item) => item.id === "pessoal");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
        <button type="button" onClick={aoVoltar} className="inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-[12px] text-sub hover:bg-surface-hover hover:text-fg">
          <ArrowLeft size={15} /> Base de conhecimento
        </button>
        <span
          className="rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
          style={{
            backgroundColor: `color-mix(in srgb, var(--el-${situacao === "publicado" ? "success" : "warning"}) 14%, var(--el-bg))`,
            color: `var(--el-${situacao === "publicado" ? "success" : "warning"})`,
          }}
        >
          {situacao === "publicado" ? "Publicado" : "Rascunho"}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-[9px] border border-line p-0.5" role="tablist" aria-label="Modo do editor">
            {[["simples", "Editor simples"], ["markdown", "Markdown"]].map(([id, rotulo]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={modo === id}
                onClick={() => setModo(id)}
                className={`rounded-[7px] px-2.5 py-1.5 text-[11.5px] font-semibold ${
                  modo === id ? "bg-accent text-white" : "text-sub hover:text-fg"
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>
          <span className={`text-[10.5px] ${alterado ? "font-semibold text-warning" : "text-faint"}`} role="status">
            {salvando
              ? "salvando…"
              : alterado
                ? "alterações não salvas"
                : salvoEm ? `salvo ${tempoRelativo(salvoEm)}` : "não salvo ainda"}
          </span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[210px_minmax(0,1fr)_260px]">
        <aside className="hidden min-h-0 overflow-y-auto border-r border-line py-3 pr-3 lg:block">
          {porPublico.map((grupo) => (
            <div key={grupo.id} className="mb-3">
              <p className="px-2 text-[9.5px] font-bold uppercase tracking-[.07em] text-faint">{grupo.rotulo}</p>
              <div className="mt-1 grid">
                {grupo.itens.map((documento) => (
                  <button
                    key={documento.id}
                    type="button"
                    onClick={() => aoAbrir?.(documento)}
                    className={`truncate rounded-[7px] px-2 py-1.5 text-left text-[11.5px] ${
                      documento.id === rascunho.id ? "bg-accent-soft font-semibold text-accent-forte" : "text-sub hover:bg-surface-hover hover:text-fg"
                    }`}
                  >
                    {documento.titulo}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        <main className="scrollbar-fina min-h-0 overflow-y-auto px-0 py-4 lg:px-5">
          <input
            value={rascunho.titulo}
            readOnly={!podeEscrever}
            onChange={(e) => aoMudar({ ...rascunho, titulo: e.target.value })}
            placeholder="Título do documento"
            className="w-full bg-transparent text-[22px] font-semibold tracking-tight text-fg outline-none placeholder:text-faint"
          />
          <input
            value={rascunho.caminho}
            readOnly={!podeEscrever}
            onChange={(e) => aoMudar({ ...rascunho, caminho: e.target.value })}
            placeholder="processos/comercial.md"
            className="mt-1.5 w-full rounded-[8px] border border-line bg-bg px-3 py-1.5 font-mono text-[11px] text-sub outline-none focus:border-accent"
          />

          {simplesBloqueado && (
            <div className="mt-4 rounded-[10px] border border-warning/40 bg-warning/10 p-3">
              <p className="flex items-start gap-2 text-[12px] font-semibold text-warning">
                <AlertTriangle size={15} className="mt-px flex-none" />
                Este documento tem formatação que o editor simples não representa.
              </p>
              <p className="mt-1.5 text-[11.5px] leading-4 text-sub">
                Tabela, bloco de código, citação ou lista dentro de lista. Editar por aqui reescreve o texto em
                títulos e parágrafos, e essa formatação se perde. No modo Markdown nada muda.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button type="button" onClick={() => setModo("markdown")} className="rounded-[8px] bg-accent px-3 py-1.5 text-[11.5px] font-semibold text-white">
                  Editar em Markdown
                </button>
                <button type="button" onClick={() => setReescritaAceita(true)} className="rounded-[8px] px-3 py-1.5 text-[11.5px] font-semibold text-sub hover:bg-surface-hover">
                  Reescrever mesmo assim
                </button>
              </div>
            </div>
          )}

          {modo === "simples" && !simplesBloqueado && (
            <>
              <p className="mt-4 text-[11.5px] leading-4 text-sub">
                Você não precisa saber Markdown. Preencha os campos abaixo — nós formatamos o texto que vai para o
                assistente.
              </p>
              <div className="mt-3 grid gap-3">
                {blocos.map((bloco, indice) => (
                  <div key={indice} className="rounded-[10px] border border-line p-3">
                    <div className="flex items-center gap-2">
                      <input
                        value={bloco.rotulo}
                        readOnly={!podeEscrever}
                        onChange={(e) => escreverBlocos(blocos.map((item, i) => (i === indice ? { ...item, rotulo: e.target.value } : item)))}
                        placeholder="Sobre o quê é este trecho?"
                        className="min-w-0 flex-1 bg-transparent text-[12.5px] font-semibold text-fg outline-none placeholder:font-normal placeholder:text-faint"
                      />
                      {podeEscrever && blocos.length > 1 && (
                        <button
                          type="button"
                          aria-label="Remover bloco"
                          onClick={() => escreverBlocos(blocos.filter((_, i) => i !== indice))}
                          className="rounded-[7px] p-1.5 text-faint hover:bg-danger/10 hover:text-danger"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                    <textarea
                      value={bloco.texto}
                      readOnly={!podeEscrever}
                      onChange={(e) => escreverBlocos(blocos.map((item, i) => (i === indice ? { ...item, texto: e.target.value } : item)))}
                      rows={3}
                      placeholder="Escreva aqui, do jeito que você explicaria para alguém."
                      className="mt-1.5 w-full resize-y bg-transparent text-[12.5px] leading-5 text-fg outline-none placeholder:text-faint"
                    />
                  </div>
                ))}
                {podeEscrever && (
                  <button
                    type="button"
                    onClick={() => escreverBlocos([...blocos, { rotulo: "", texto: "" }])}
                    className="inline-flex items-center gap-1.5 self-start rounded-[9px] border border-dashed border-line-strong px-3 py-2 text-[12px] font-semibold text-sub hover:bg-surface-hover hover:text-fg"
                  >
                    <Plus size={14} /> Adicionar outro bloco
                  </button>
                )}
              </div>
            </>
          )}

          {modo === "markdown" && (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div>
                <p className="mb-1.5 text-[9.5px] font-bold uppercase tracking-[.07em] text-faint">Markdown · o que é salvo</p>
                <textarea
                  value={rascunho.conteudo}
                  readOnly={!podeEscrever}
                  onChange={(e) => aoMudar({ ...rascunho, conteudo: e.target.value })}
                  placeholder="# Comece a documentar aqui…"
                  className="min-h-[420px] w-full resize-y rounded-[10px] border border-line bg-bg p-3 font-mono text-[12px] leading-6 text-fg outline-none focus:border-accent"
                />
              </div>
              <div>
                <p className="mb-1.5 text-[9.5px] font-bold uppercase tracking-[.07em] text-faint">Pré-visualização · como fica lido</p>
                <div className="scrollbar-fina min-h-[420px] overflow-y-auto rounded-[10px] border border-line bg-bg p-3.5">
                  <PreviaMarkdown markdown={rascunho.conteudo} />
                </div>
              </div>
              <p className="text-[10.5px] leading-4 text-faint lg:col-span-2">
                Título, público, situação e coleções não entram neste texto. São dados à parte — o assistente recebe
                só o conteúdo, sem os metadados.
              </p>
            </div>
          )}
        </main>

        <aside className="min-h-0 overflow-y-auto border-t border-line lg:border-l lg:border-t-0">
          <Painel titulo="Quem pode usar">
            <div className="grid gap-1.5">
              {publicosDisponiveis.map(({ id, rotulo, consequencia }) => (
                <label
                  key={id}
                  className={`flex cursor-pointer items-start gap-2 rounded-[9px] border p-2 ${
                    publico === id ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-hover"
                  } ${podeEscrever ? "" : "pointer-events-none opacity-60"}`}
                >
                  <input type="radio" name="publico" className="mt-0.5" checked={publico === id} disabled={!podeEscrever} onChange={() => trocarPublico(id)} />
                  <span className="min-w-0">
                    <strong className="block text-[11.5px] font-semibold text-fg">{rotulo}</strong>
                    {publico === id && <small className="mt-0.5 block text-[10.5px] leading-4 text-sub">{consequencia}</small>}
                  </span>
                </label>
              ))}
            </div>
            {confirmandoExterno && (
              <div role="alertdialog" className="mt-2 rounded-[9px] border border-warning/40 bg-warning/10 p-2.5">
                <p className="text-[11px] font-semibold text-warning">Este documento foi escrito para uso interno.</p>
                <p className="mt-1 text-[10.5px] leading-4 text-sub">
                  Confira se não há preço de custo, margem, nome de cliente ou combinado interno no texto.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => aplicarPublico("clientes")} className="rounded-[7px] bg-warning px-2.5 py-1 text-[10.5px] font-semibold text-white">
                    Li, pode abrir
                  </button>
                  <button type="button" onClick={() => setConfirmandoExterno(false)} className="rounded-[7px] px-2.5 py-1 text-[10.5px] font-semibold text-sub hover:bg-surface-hover">
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </Painel>

          {publico !== "pessoal" && inteligencia && (
            <Painel titulo={exigeColecao ? "Usado por · obrigatório" : "Usado por"}>
              <div className="flex flex-wrap gap-1.5">
                {colecoes.map((colecao) => (
                  <label key={colecao.id} className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[10.5px] text-sub">
                    <input
                      type="checkbox"
                      disabled={!podeEscrever}
                      checked={(rascunho.colecoesIds || []).includes(colecao.id)}
                      onChange={(e) => aoMudar({
                        ...rascunho,
                        colecoesIds: e.target.checked
                          ? [...(rascunho.colecoesIds || []), colecao.id]
                          : (rascunho.colecoesIds || []).filter((id) => id !== colecao.id),
                      })}
                    />
                    {colecao.name}
                  </label>
                ))}
                {!colecoes.length && <span className="text-[10.5px] italic text-faint">nenhuma coleção deste tipo ainda</span>}
              </div>
              {impedimento && <p className="mt-2 text-[10.5px] leading-4 text-danger">{impedimento}</p>}
            </Painel>
          )}

          <Painel titulo="Tamanho">
            <p className="text-[12px] text-fg">
              {palavras.toLocaleString("pt-BR")} palavras{" "}
              <span className="font-semibold" style={{ color: folego.cor }}>· {folego.rotulo}</span>
            </p>
            <p className="mt-1 text-[10.5px] leading-4 text-sub">
              Acima de ~{PALAVRAS_CONFORTAVEIS.toLocaleString("pt-BR")} palavras o assistente começa a perder o fio.
            </p>
          </Painel>

          {/*
            O desenho previa "Trechos que a IA encontra", listando cada bloco
            como um trecho procurável. A busca não funciona assim: o
            search_vector cobre o documento INTEIRO — título com peso A,
            caminho B, conteúdo C — e o trecho é um ts_headline calculado na
            hora da pergunta. Listar blocos ensinaria a quebrar o texto para
            "melhorar a busca", o que não muda nada. O que muda é usar as
            palavras que o cliente usa.
          */}
          <Painel titulo="Como a busca acha isto">
            <p className="text-[10.5px] leading-4 text-sub">
              O documento inteiro é procurado de uma vez — o título pesa mais que o corpo. O assistente recebe um
              recorte montado na hora da pergunta, não um bloco fixo. O que faz ele ser encontrado é o texto conter
              as palavras que o cliente usa.
            </p>
            <div className="mt-2.5">
              <div className="flex gap-1.5">
                <label className="sr-only" htmlFor="pergunta-editor">Pergunta de teste</label>
                <input
                  id="pergunta-editor"
                  value={pergunta}
                  onChange={(e) => setPergunta(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && testar()}
                  placeholder="Testar uma pergunta…"
                  className="min-w-0 flex-1 rounded-[8px] border border-line bg-bg px-2.5 py-1.5 text-[11.5px] text-fg outline-none focus:border-accent placeholder:text-faint"
                />
                <button
                  type="button"
                  onClick={testar}
                  disabled={testando || !pergunta.trim()}
                  aria-label="Testar"
                  className="rounded-[8px] border border-line px-2.5 text-sub hover:bg-surface-hover hover:text-fg disabled:opacity-40"
                >
                  {testando ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                </button>
              </div>
              {previa && (
                <div className="mt-2 rounded-[8px] bg-surface p-2.5">
                  {previa.erro
                    ? <p className="text-[10.5px] text-danger">{previa.erro}</p>
                    : previa.casou
                      ? <>
                        <p className="text-[10.5px] font-semibold text-success">Responde.</p>
                        <p className="mt-1 whitespace-pre-wrap text-[10.5px] leading-4 text-sub">{previa.trecho}</p>
                      </>
                      : <p className="text-[10.5px] leading-4 text-warning">Nenhuma palavra dessa pergunta aparece no texto.</p>}
                </div>
              )}
            </div>
          </Painel>

          <Painel
            titulo="Histórico"
            acao={rascunho.id ? (
              <button type="button" onClick={aoVerHistorico} className="ml-auto text-[10px] font-semibold text-accent-forte hover:underline">
                Ver versões
              </button>
            ) : null}
          >
            <p className="text-[10.5px] leading-4 text-sub">
              {rascunho.id
                ? <>Versão {rascunho.versao || 1}. Cada salvamento preserva a anterior.</>
                : "Ainda não salvo."}
            </p>
          </Painel>

          <Painel titulo="Arquivo">
            <div className="flex flex-wrap gap-1.5">
              <input ref={arquivoRef} type="file" accept=".md,.markdown,.txt" className="hidden" onChange={(e) => importar(e.target.files?.[0])} />
              {podeEscrever && (
                <button type="button" onClick={() => arquivoRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-[8px] border border-line px-2.5 py-1.5 text-[10.5px] font-semibold text-sub hover:bg-surface-hover hover:text-fg">
                  <FileUp size={13} /> Importar .md
                </button>
              )}
              <button type="button" onClick={exportar} className="inline-flex items-center gap-1.5 rounded-[8px] border border-line px-2.5 py-1.5 text-[10.5px] font-semibold text-sub hover:bg-surface-hover hover:text-fg">
                <Download size={13} /> Exportar .md
              </button>
            </div>
          </Painel>

          {rascunho.id && podeEscrever && (
            <Painel titulo="Arquivar">
              <button type="button" onClick={aoArquivar} className="inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[10.5px] font-semibold text-sub hover:bg-danger/10 hover:text-danger">
                <Archive size={13} /> Arquivar documento
              </button>
            </Painel>
          )}
        </aside>
      </div>

      {podeEscrever && (
        <footer className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <p className="text-[10.5px] text-faint">
            {situacao === "publicado"
              ? `No ar para ${PUBLICO_POR_ID.get(publico)?.rotulo.toLocaleLowerCase("pt-BR")}.`
              : "Rascunho não é consultado por nenhum assistente."}
          </p>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => aoSalvar(false)}
              disabled={salvando}
              className="inline-flex items-center gap-2 rounded-[9px] border border-line px-4 py-2.5 text-[12.5px] font-semibold text-sub hover:bg-surface-hover hover:text-fg disabled:opacity-40"
            >
              <Save size={15} /> Salvar como rascunho
            </button>
            <button
              type="button"
              onClick={() => aoSalvar(true)}
              disabled={salvando || Boolean(impedimento)}
              title={impedimento || undefined}
              className="inline-flex items-center gap-2 rounded-[9px] bg-accent px-4 py-2.5 text-[12.5px] font-semibold text-white disabled:opacity-40"
            >
              <Send size={15} /> {salvando ? "Salvando…" : situacao === "publicado" ? "Salvar publicado" : "Publicar"}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
