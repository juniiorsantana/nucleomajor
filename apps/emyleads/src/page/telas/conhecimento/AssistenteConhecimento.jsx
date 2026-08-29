import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, FileUp, Loader2, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { api } from "../../../data/client";
import { PUBLICOS } from "./conhecimentoDados";
import { MODELOS, MODELO_POR_ID } from "./modelosConhecimento";
import {
  CAMINHOS_DE_ESCRITA,
  ETAPAS,
  avancar,
  conteudoDoEstado,
  documentoDoEstado,
  escolherModelo,
  escolherPublico,
  estadoInicial,
  estadoFoiAlterado,
  motivoParaNaoAvancar,
  motivoParaNaoPublicarAgora,
  voltar,
} from "./assistenteEstado";
import { ETAPA_DO_CAMPO } from "./erroDeGravacao";

function Trilha({ etapa }) {
  return (
    <>
      {/* No celular a trilha vira uma barra: cinco rótulos não cabem em 375px
          sem virar sopa de letras. */}
      <div className="sm:hidden">
        <p className="text-[11px] font-semibold text-sub">Etapa {etapa} de {ETAPAS.length}</p>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(etapa / ETAPAS.length) * 100}%` }} />
        </div>
      </div>
      <div className="hidden flex-wrap items-center gap-x-2 gap-y-1 sm:flex">
        {ETAPAS.map(({ numero, rotulo }) => {
          const feita = numero < etapa;
          const atual = numero === etapa;
          return (
            <span key={numero} className={`flex items-center gap-1.5 text-[10px] font-semibold ${atual ? "text-fg" : "text-faint"}`}>
              <span
                className={`flex h-[17px] w-[17px] items-center justify-center rounded-full text-[9.5px] font-bold ${
                  feita ? "bg-success-soft text-success" : atual ? "bg-accent text-white" : "bg-surface text-faint"
                }`}
              >
                {feita ? <Check size={11} strokeWidth={3} /> : numero}
              </span>
              {rotulo}
            </span>
          );
        })}
      </div>
    </>
  );
}

function Opcao({ ativo, titulo, descricao, etiqueta, aviso, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={`flex w-full items-start gap-3 rounded-[11px] border p-3 text-left ${
        ativo ? "border-accent bg-accent-soft" : "border-line bg-bg hover:bg-surface-hover"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <strong className="text-[13px] font-semibold text-fg">{titulo}</strong>
          {etiqueta && (
            <span className="rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[.06em] text-white">
              {etiqueta}
            </span>
          )}
        </span>
        {descricao && <small className="mt-1 block text-[11.5px] leading-4 text-sub">{descricao}</small>}
        {aviso && <small className="mt-1.5 block text-[11px] leading-4 text-warning">{aviso}</small>}
        {children}
      </span>
    </button>
  );
}

export default function AssistenteConhecimento({
  modeloId = null, inteligencia, aoFechar, aoSalvar, salvando, falha = null, somentePessoal = false,
}) {
  const [estado, setEstado] = useState(() => estadoInicial(modeloId));
  const [erroArquivo, setErroArquivo] = useState("");
  const [pergunta, setPergunta] = useState("");
  const [previa, setPrevia] = useState(null);
  const [testando, setTestando] = useState(false);
  const arquivoRef = useRef(null);
  const dialogoRef = useRef(null);
  const tituloRef = useRef(null);
  const caminhoRef = useRef(null);
  const estadoOriginal = useRef(estado);
  const estadoAtual = useRef(estado);
  const focoAnterior = useRef(typeof document === "undefined" ? null : document.activeElement);
  estadoAtual.current = estado;

  const pedirFechamento = () => {
    const alterado = estadoFoiAlterado(estadoAtual.current, estadoOriginal.current);
    if (!alterado || window.confirm("Descartar o conhecimento que ainda não foi salvo?")) aoFechar();
  };

  useEffect(() => {
    dialogoRef.current?.focus();
    const aoTeclar = (evento) => {
      if (evento.key === "Escape") {
        evento.preventDefault();
        pedirFechamento();
      }
    };
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      focoAnterior.current?.focus?.();
    };
  }, []);

  /**
   * A falha de gravação leva a pessoa até o campo que a causou.
   *
   * Só a frase não bastaria: o caminho do arquivo mora na etapa 5 e o público
   * na etapa 3, então "o caminho não é válido" lido na etapa 5 depois de uma
   * publicação recusada ainda deixaria a pessoa procurando. `sinal` muda a
   * cada falha, inclusive quando a mensagem se repete — sem ele, errar duas
   * vezes no mesmo campo moveria o foco só na primeira.
   */
  useEffect(() => {
    if (!falha?.campo) return;
    const etapa = ETAPA_DO_CAMPO[falha.campo];
    if (etapa) setEstado((atual) => (atual.etapa === etapa ? atual : { ...atual, etapa }));
    // Depois da pintura: na etapa nova o campo ainda não existe no DOM.
    const alvo = { titulo: tituloRef, caminho: caminhoRef }[falha.campo];
    if (!alvo) return;
    const id = requestAnimationFrame(() => alvo.current?.focus?.());
    return () => cancelAnimationFrame(id);
  }, [falha?.sinal, falha?.campo]);

  const colecoes = useMemo(() => {
    const desejada = estado.publico === "clientes" ? "external" : "internal";
    return (inteligencia?.collections || []).filter(
      (item) => item.audience === desejada && item.scope_type !== "personal" && item.status !== "archived",
    );
  }, [inteligencia, estado.publico]);

  // O desenho pedia três listas — Assistentes, Skills e Campanhas. O banco tem
  // uma tabela só, `knowledge_collections`, e o que distingue campanha é o
  // `scope_type`. Inventar três seletores criaria a impressão de três controles
  // independentes que na verdade escrevem no mesmo lugar.
  const grupos = useMemo(() => ([
    { titulo: "Coleções", itens: colecoes.filter((item) => item.scope_type !== "campaign") },
    { titulo: "Campanhas", itens: colecoes.filter((item) => item.scope_type === "campaign") },
  ].filter((grupo) => grupo.itens.length)), [colecoes]);

  const pendencia = motivoParaNaoAvancar(estado);
  const impedimentoParaPublicar = motivoParaNaoPublicarAgora(estado, inteligencia?.collections);
  const conteudo = conteudoDoEstado(estado);
  const palavras = conteudo.trim() ? conteudo.trim().split(/\s+/).length : 0;
  const publicosDisponiveis = somentePessoal ? PUBLICOS.filter((item) => item.id === "pessoal") : PUBLICOS;

  const mudar = (patch) => setEstado((atual) => ({ ...atual, ...patch }));

  const lerArquivo = async (arquivo) => {
    setErroArquivo("");
    if (!arquivo) return;
    if (!/\.(md|markdown|txt)$/i.test(arquivo.name)) {
      setErroArquivo("Escolha um arquivo .md, .markdown ou .txt.");
      return;
    }
    if (arquivo.size > 500 * 1024) {
      setErroArquivo("O arquivo passa de 500 KB. Divida em documentos menores.");
      return;
    }
    const texto = await arquivo.text();
    mudar({ texto, titulo: estado.titulo || arquivo.name.replace(/\.[^.]+$/, "") });
  };

  const testar = async () => {
    if (!pergunta.trim()) return;
    setTestando(true);
    setPrevia(null);
    try {
      const documento = documentoDoEstado(estado);
      setPrevia(await api.conhecimento.testar({
        titulo: documento.titulo, caminho: documento.caminho, conteudo: documento.conteudo, pergunta,
      }));
    } catch (e) {
      setPrevia({ erro: e.message });
    } finally {
      setTestando(false);
    }
  };

  const publicoEscolhido = PUBLICOS.find((item) => item.id === estado.publico);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && pedirFechamento()}>
      <section
        ref={dialogoRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Adicionar conhecimento"
        className="flex max-h-[92vh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-[16px] border border-line bg-bg shadow-2xl sm:max-h-[86vh] sm:rounded-[16px]"
      >
        <header className="flex flex-none items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1"><Trilha etapa={estado.etapa} /></div>
          <button type="button" onClick={pedirFechamento} className="-mr-1 rounded-[8px] p-2 text-sub hover:bg-surface-hover hover:text-fg" aria-label="Fechar">
            <X size={17} />
          </button>
        </header>

        <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {estado.etapa === 1 && (
            <>
              <h2 className="text-[15px] font-semibold text-fg">O que você quer ensinar?</h2>
              <p className="mt-1 text-[12px] leading-5 text-sub">
                Escolha o assunto. A partir dele o modelo já vem com as perguntas certas — você só preenche.
              </p>
              <div className="mt-4 grid gap-2">
                {MODELOS.map((modelo) => (
                  <Opcao
                    key={modelo.id}
                    ativo={estado.modeloId === modelo.id}
                    titulo={modelo.rotulo}
                    descricao={modelo.descricao}
                    onClick={() => setEstado(escolherModelo(estado, modelo.id))}
                  />
                ))}
              </div>
            </>
          )}

          {estado.etapa === 2 && (
            <>
              <h2 className="text-[15px] font-semibold text-fg">Como você quer escrever?</h2>
              <p className="mt-1 text-[12px] leading-5 text-sub">
                Todos os caminhos chegam no mesmo lugar. Se nunca escreveu nada assim, o modelo guiado é o mais fácil.
              </p>
              <div className="mt-4 grid gap-2">
                {CAMINHOS_DE_ESCRITA.map((caminho) => {
                  // Sem blocos não há o que guiar: o modelo de perguntas e
                  // respostas não tem campos prontos para preencher.
                  const semModelo = caminho.id === "guiado" && !(MODELO_POR_ID.get(estado.modeloId)?.blocos || []).length;
                  if (semModelo) return null;
                  return (
                    <Opcao
                      key={caminho.id}
                      ativo={estado.caminhoDeEscrita === caminho.id}
                      titulo={caminho.rotulo}
                      descricao={caminho.descricao}
                      etiqueta={caminho.recomendado ? "Recomendado" : null}
                      onClick={() => mudar({ caminhoDeEscrita: caminho.id })}
                    />
                  );
                })}
              </div>

              {estado.caminhoDeEscrita === "arquivo" && (
                <div className="mt-3 rounded-[11px] border border-dashed border-line-strong p-4 text-center">
                  <input
                    ref={arquivoRef}
                    type="file"
                    accept=".md,.markdown,.txt"
                    className="hidden"
                    onChange={(e) => lerArquivo(e.target.files?.[0])}
                  />
                  <button
                    type="button"
                    onClick={() => arquivoRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-[9px] border border-line px-3.5 py-2 text-[12px] font-semibold text-fg hover:bg-surface-hover"
                  >
                    <FileUp size={15} /> Escolher arquivo
                  </button>
                  {estado.texto && !erroArquivo && (
                    <p className="mt-2 text-[11px] text-success">Arquivo lido: {estado.texto.split(/\s+/).length} palavras.</p>
                  )}
                  {erroArquivo && <p className="mt-2 text-[11px] text-danger">{erroArquivo}</p>}
                </div>
              )}

              {/* Escrever é a etapa 2, não uma etapa à parte: o desenho promete
                  "você preenche e pronto", e mandar a pessoa para outra tela
                  entre escolher e escrever quebraria isso. */}
              {estado.caminhoDeEscrita === "guiado" && (
                <div className="mt-4 grid gap-3 border-t border-line pt-4">
                  {estado.blocos.map((bloco, indice) => {
                    const modelo = (MODELO_POR_ID.get(estado.modeloId)?.blocos || [])[indice];
                    return (
                      <label key={bloco.rotulo || indice} className="block">
                        <span className="flex flex-wrap items-center gap-2">
                          <strong className="text-[12px] font-semibold text-fg">{bloco.rotulo}</strong>
                          {modelo?.importante && (
                            <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[.06em] text-warning">
                              Importante
                            </span>
                          )}
                        </span>
                        {modelo?.ajuda && <small className="mt-0.5 block text-[11px] leading-4 text-sub">{modelo.ajuda}</small>}
                        <textarea
                          value={bloco.texto}
                          onChange={(e) => mudar({
                            blocos: estado.blocos.map((item, i) => (i === indice ? { ...item, texto: e.target.value } : item)),
                          })}
                          rows={modelo?.lista ? 4 : 3}
                          placeholder={modelo?.exemplo || (modelo?.lista ? "Um item por linha" : "")}
                          className="mt-1.5 w-full resize-y rounded-[9px] border border-line bg-bg p-2.5 text-[12.5px] leading-5 text-fg outline-none focus:border-accent placeholder:text-faint"
                        />
                      </label>
                    );
                  })}
                </div>
              )}

              {estado.caminhoDeEscrita === "texto" && (
                <textarea
                  value={estado.texto}
                  onChange={(e) => mudar({ texto: e.target.value })}
                  rows={10}
                  placeholder="Cole ou escreva aqui. Pode ser texto comum — não precisa saber Markdown."
                  className="mt-4 w-full resize-y rounded-[10px] border border-line bg-bg p-3 text-[12.5px] leading-5 text-fg outline-none focus:border-accent placeholder:text-faint"
                />
              )}

              {estado.caminhoDeEscrita === "perguntas" && (
                <div className="mt-4 grid gap-2.5 border-t border-line pt-4">
                  {estado.perguntas.map((item, indice) => (
                    <div key={indice} className="rounded-[10px] border border-line p-2.5">
                      <div className="flex items-center gap-2">
                        <input
                          value={item.pergunta}
                          onChange={(e) => mudar({
                            perguntas: estado.perguntas.map((p, i) => (i === indice ? { ...p, pergunta: e.target.value } : p)),
                          })}
                          placeholder="A pergunta, do jeito que o cliente faz"
                          className="min-w-0 flex-1 bg-transparent text-[12.5px] font-semibold text-fg outline-none placeholder:font-normal placeholder:text-faint"
                        />
                        {estado.perguntas.length > 1 && (
                          <button
                            type="button"
                            aria-label="Remover pergunta"
                            onClick={() => mudar({ perguntas: estado.perguntas.filter((_, i) => i !== indice) })}
                            className="rounded-[7px] p-1.5 text-faint hover:bg-danger/10 hover:text-danger"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                      <textarea
                        value={item.resposta}
                        onChange={(e) => mudar({
                          perguntas: estado.perguntas.map((p, i) => (i === indice ? { ...p, resposta: e.target.value } : p)),
                        })}
                        rows={2}
                        placeholder="A resposta que vocês já dão hoje"
                        className="mt-1.5 w-full resize-y bg-transparent text-[12.5px] leading-5 text-fg outline-none placeholder:text-faint"
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => mudar({ perguntas: [...estado.perguntas, { pergunta: "", resposta: "" }] })}
                    className="inline-flex items-center gap-1.5 self-start rounded-[9px] border border-dashed border-line-strong px-3 py-2 text-[12px] font-semibold text-sub hover:bg-surface-hover hover:text-fg"
                  >
                    <Plus size={14} /> Adicionar pergunta
                  </button>
                </div>
              )}
            </>
          )}

          {estado.etapa === 3 && (
            <>
              <h2 className="text-[15px] font-semibold text-fg">Quem poderá usar este conteúdo?</h2>
              <p className="mt-1 text-[12px] leading-5 text-sub">
                Isto decide quem vê a informação — inclusive se o assistente pode repeti-la para um cliente.
              </p>
              <div className="mt-4 grid gap-2">
                {publicosDisponiveis.map(({ id, rotulo, consequencia }) => (
                  <Opcao
                    key={id}
                    ativo={estado.publico === id}
                    titulo={id === "equipe" ? "Toda a equipe" : rotulo}
                    descricao={consequencia}
                    aviso={id === "clientes" && estado.publico === "clientes" ? "É o único caminho que expõe conteúdo para fora da empresa." : null}
                    onClick={() => setEstado((atual) => escolherPublico(atual, id, inteligencia?.collections))}
                  />
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-4 text-faint">
                {somentePessoal
                  ? "Profissionais criam referências pessoais. Conteúdo da empresa é administrado por donos e administradores."
                  : "Dá para mudar depois, no editor do documento."}
              </p>
            </>
          )}

          {estado.etapa === 4 && (
            <>
              <h2 className="text-[15px] font-semibold text-fg">Onde este conteúdo deve ser usado?</h2>
              <p className="mt-1 text-[12px] leading-5 text-sub">
                Pode deixar no geral e ajustar depois. Restringir serve quando o texto só faz sentido num contexto.
              </p>
              <div className="mt-4 grid gap-2">
                {estado.publico !== "clientes" && (
                  <Opcao
                    ativo={estado.ondeTodos}
                    titulo="Em qualquer lugar"
                    descricao="Todos os assistentes e skills desta empresa podem consultar."
                    onClick={() => mudar({ ondeTodos: true, colecoesIds: [] })}
                  />
                )}
                <Opcao
                  ativo={!estado.ondeTodos}
                  titulo={estado.publico === "clientes" ? "Coleção externa" : "Só em lugares específicos"}
                  descricao={grupos.length
                    ? (estado.publico === "clientes" ? "Obrigatória para definir qual atendimento ou campanha pode usar o texto." : "Escolha abaixo quais.")
                    : "Não há nenhuma coleção deste tipo nesta empresa ainda."}
                  onClick={() => grupos.length && mudar({ ondeTodos: false })}
                />
              </div>

              {!estado.ondeTodos && grupos.map((grupo) => (
                <div key={grupo.titulo} className="mt-4">
                  <p className="text-[9.5px] font-bold uppercase tracking-[.07em] text-sub">{grupo.titulo}</p>
                  <div className="mt-2 grid gap-1.5">
                    {grupo.itens.map((item) => {
                      const marcado = estado.colecoesIds.includes(item.id);
                      return (
                        <label key={item.id} className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-[9px] border border-line px-3 text-[12px] text-fg hover:bg-surface-hover">
                          <input
                            type="checkbox"
                            checked={marcado}
                            onChange={(e) => mudar({
                              colecoesIds: e.target.checked
                                ? [...estado.colecoesIds, item.id]
                                : estado.colecoesIds.filter((id) => id !== item.id),
                            })}
                          />
                          {item.name}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}

              {estado.publico === "clientes" && !colecoes.length && (
                <p className="mt-4 flex items-start gap-2 rounded-[9px] bg-danger/10 p-3 text-[11.5px] leading-4 text-danger">
                  <AlertTriangle size={15} className="mt-px flex-none" />
                  Não há nenhuma coleção externa nesta empresa. Sem ela, o atendimento não encontra este documento —
                  dá para salvar como rascunho, mas não para publicar.
                </p>
              )}
            </>
          )}

          {estado.etapa === 5 && (
            <>
              <h2 className="text-[15px] font-semibold text-fg">Confira antes de publicar</h2>
              <p className="mt-1 text-[12px] leading-5 text-sub">
                Faça uma pergunta de verdade e veja se este texto responderia.
              </p>

              <div className="mt-4 rounded-[11px] border border-line p-3.5">
                <input
                  ref={tituloRef}
                  value={estado.titulo}
                  onChange={(e) => mudar({ titulo: e.target.value })}
                  placeholder="Título do documento"
                  aria-label="Título do documento"
                  aria-invalid={falha?.campo === "titulo" || undefined}
                  className="w-full bg-transparent text-[15px] font-semibold text-fg outline-none placeholder:text-faint"
                />
                <input
                  ref={caminhoRef}
                  value={estado.caminho}
                  onChange={(e) => mudar({ caminho: e.target.value })}
                  placeholder="empresa/sobre.md"
                  aria-label="Caminho do arquivo"
                  aria-invalid={falha?.campo === "caminho" || undefined}
                  className={`mt-1.5 w-full rounded-[7px] border bg-bg px-2.5 py-1.5 font-mono text-[11px] text-sub outline-none focus:border-accent ${
                    falha?.campo === "caminho" ? "border-danger" : "border-line"
                  }`}
                />
                <dl className="mt-3 grid gap-2 border-t border-line pt-3 text-[11.5px] sm:grid-cols-2">
                  <div>
                    <dt className="text-[9.5px] font-bold uppercase tracking-[.07em] text-faint">Quem pode usar</dt>
                    <dd className="mt-0.5 text-fg">{publicoEscolhido?.rotulo || "—"}</dd>
                    <dd className="mt-0.5 text-[10.5px] leading-4 text-sub">{publicoEscolhido?.consequencia}</dd>
                  </div>
                  <div>
                    <dt className="text-[9.5px] font-bold uppercase tracking-[.07em] text-faint">Onde</dt>
                    <dd className="mt-0.5 text-fg">
                      {estado.ondeTodos && estado.publico !== "clientes"
                        ? "Em qualquer lugar"
                        : colecoes.filter((item) => estado.colecoesIds.includes(item.id)).map((item) => item.name).join(", ") || "—"}
                    </dd>
                    <dd className="mt-0.5 text-[10.5px] text-sub">{palavras} palavras</dd>
                  </div>
                </dl>
              </div>

              <div className="mt-4">
                <label className="text-[11px] font-semibold text-sub" htmlFor="pergunta-teste">Faça uma pergunta para testar</label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    id="pergunta-teste"
                    value={pergunta}
                    onChange={(e) => setPergunta(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && testar()}
                    placeholder="Vocês atendem fora de Cuiabá?"
                    className="min-w-0 flex-1 rounded-[9px] border border-line bg-bg px-3 py-2 text-[12.5px] text-fg outline-none focus:border-accent placeholder:text-faint"
                  />
                  <button
                    type="button"
                    onClick={testar}
                    disabled={testando || !pergunta.trim()}
                    className="inline-flex items-center gap-1.5 rounded-[9px] border border-line px-3 text-[12px] font-semibold text-fg hover:bg-surface-hover disabled:opacity-40"
                  >
                    {testando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Testar
                  </button>
                </div>

                {previa && (
                  <div className="mt-2.5 rounded-[10px] border border-line bg-surface p-3">
                    {previa.erro ? (
                      <p className="text-[11.5px] text-danger">{previa.erro}</p>
                    ) : previa.casou ? (
                      <>
                        <p className="text-[11px] font-semibold text-success">Este texto responde a essa pergunta.</p>
                        <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-5 text-fg">{previa.trecho}</p>
                        <p className="mt-2 text-[10.5px] leading-4 text-faint">
                          É este o trecho que a busca entregaria ao assistente. Depois de publicado, ele concorre com os
                          outros documentos e nem sempre é o escolhido.
                        </p>
                      </>
                    ) : (
                      <p className="text-[11.5px] leading-5 text-warning">
                        Nenhuma palavra desta pergunta aparece no texto. Se é uma dúvida que os clientes têm, vale
                        escrever a resposta com as palavras que eles usam.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Fora da área que rola, e acima do rodapé: em falha de gravação a
            pessoa está com o dedo no botão, e uma mensagem que exige rolar
            para ser lida é uma mensagem que não foi lida. */}
        {falha?.mensagem && (
          <div
            role="alert"
            className="flex flex-none items-start gap-2 border-t border-danger/25 bg-danger/10 px-5 py-3 text-[12px] leading-4 text-danger"
          >
            <AlertTriangle size={15} className="mt-px flex-none" />
            <span className="min-w-0">{falha.mensagem}</span>
          </div>
        )}

        <footer className="flex flex-none flex-wrap items-center gap-2 border-t border-line px-5 py-3.5">
          {estado.etapa > 1 && (
            <button type="button" onClick={() => setEstado(voltar(estado))} className="rounded-[9px] px-3 py-2 text-[12.5px] font-semibold text-sub hover:bg-surface-hover hover:text-fg">
              Voltar
            </button>
          )}
          <button type="button" onClick={pedirFechamento} className="rounded-[9px] px-3 py-2 text-[12.5px] text-faint hover:text-sub">
            Cancelar
          </button>
          <div className="ml-auto flex items-center gap-2">
            {pendencia && estado.etapa < 5 && <span className="hidden text-[10.5px] text-faint sm:inline">{pendencia}</span>}
            {estado.etapa < 5 ? (
              <button
                type="button"
                onClick={() => setEstado(avancar(estado))}
                disabled={Boolean(pendencia)}
                title={pendencia || undefined}
                className="rounded-[9px] bg-accent px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-40"
              >
                Continuar
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => aoSalvar(documentoDoEstado(estado), false)}
                  disabled={salvando || Boolean(pendencia)}
                  title={pendencia || undefined}
                  className="rounded-[9px] border border-line px-3.5 py-2 text-[12.5px] font-semibold text-sub hover:bg-surface-hover hover:text-fg disabled:opacity-40"
                >
                  Salvar como rascunho
                </button>
                <button
                  type="button"
                  onClick={() => aoSalvar(documentoDoEstado(estado), true)}
                  disabled={salvando || Boolean(impedimentoParaPublicar)}
                  title={impedimentoParaPublicar || undefined}
                  className="inline-flex items-center gap-1.5 rounded-[9px] bg-accent px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-40"
                >
                  <Sparkles size={14} /> {salvando ? "Salvando…" : "Publicar"}
                </button>
              </>
            )}
          </div>
          {estado.etapa === 5 && impedimentoParaPublicar && (
            <p className="w-full text-right text-[10.5px] leading-4 text-danger">{impedimentoParaPublicar}</p>
          )}
        </footer>
      </section>
    </div>
  );
}
