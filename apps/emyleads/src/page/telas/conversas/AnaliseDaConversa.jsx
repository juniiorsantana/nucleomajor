import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Check, FileSearch, LoaderCircle, X } from "lucide-react";
import { api } from "../../../data/client";
import {
  NOME_DO_TIPO,
  ROTULO_DA_SUGESTAO,
  TIPOS_DE_ANALISE,
  analiseDoBanco,
  creditosEmTexto,
  ehRelatorioV1,
  emAndamento,
  etapaPeloNome,
  etiquetaPeloNome,
  impedimentoDaSugestao,
  motivoDaFalha,
  prazoDaSugestao,
  semCreditos,
} from "../../../domain/analiseDaConversa";
import { ehAnaliseV2, ehRelatorioV2 } from "../../../domain/vendedorV2";
import { fmtRelativo } from "../../../lib/formato";
import { RelatorioDaAnalise } from "./RelatorioDaAnalise";
import { RelatorioDoVendedor } from "./RelatorioDoVendedor";

// De quanto em quanto a tela pergunta pelo andamento. A análise leva de um a
// três minutos; perguntar mais rápido só gastaria requisição.
export const INTERVALO_DO_ANDAMENTO_MS = 4000;
// Rascunho não salvo some do banco em 7 dias; depois disso não vale listar.
const VIDA_DO_RASCUNHO_MS = 7 * 24 * 60 * 60 * 1000;

const dataCurta = (valor) =>
  valor ? new Date(valor).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "";

/** O que a ficha lista: as salvas e os rascunhos prontos que ainda valem. */
function analisesDaFicha(linhas, agora = Date.now()) {
  return linhas
    .map(analiseDoBanco)
    .filter((analise) => analise.situacao === "done" && analise.resultado)
    .filter((analise) => analise.salvaEm || agora - new Date(analise.concluidaEm).getTime() < VIDA_DO_RASCUNHO_MS)
    .slice(0, 4);
}

/**
 * A análise da conversa, na ficha lateral: o botão (dono e admin), o saldo do
 * ciclo e as análises salvas. A análise em si abre num diálogo.
 *
 * Some inteira quando não há nada a mostrar: equipe sem análise salva, ou
 * banco antes da migration 20261002100000 (o saldo volta `null`).
 */
export function AnaliseDaConversa({
  conversa,
  contato,
  negocio,
  estagios = [],
  etiquetas = [],
  podePedir = false,
  aoAtualizarEtiquetas,
  aoCriarEtiqueta,
  aoAplicado,
  aoUsarMensagem,
  aoVerMensagem,
}) {
  const [creditos, setCreditos] = useState(null);
  const [lista, setLista] = useState([]);
  const [atual, setAtual] = useState(null);
  const [fase, setFase] = useState(null); // null | "escolher" | "ver"
  const [pedindo, setPedindo] = useState(false);
  const [erro, setErro] = useState("");
  const conversaRef = useRef(conversa.id);
  conversaRef.current = conversa.id;

  const carregar = useCallback(async () => {
    const id = conversa.id;
    const [saldo, linhas] = await Promise.all([
      podePedir ? Promise.resolve().then(() => api.conversas.creditosDeAnalise()).catch(() => null) : null,
      Promise.resolve().then(() => api.conversas.analises({ id })).catch(() => []),
    ]);
    if (conversaRef.current !== id) return;
    setCreditos(saldo);
    setLista(linhas || []);
    // Uma análise pedida antes de recarregar a página continua sendo seguida.
    const pendente = (linhas || []).map(analiseDoBanco).find((analise) => emAndamento(analise.situacao));
    if (pendente) setAtual((anterior) => anterior || pendente);
  }, [conversa.id, podePedir]);

  useEffect(() => {
    setAtual(null);
    setFase(null);
    setErro("");
    setCreditos(null);
    setLista([]);
    carregar();
  }, [carregar]);

  // Enquanto o analista lê, a tela pergunta de tempos em tempos.
  const idAtual = atual?.id;
  const situacaoAtual = atual?.situacao;
  useEffect(() => {
    if (!idAtual || !emAndamento(situacaoAtual)) return undefined;
    let vivo = true;
    const timer = setInterval(async () => {
      try {
        const nova = analiseDoBanco(await api.conversas.analise({ analiseId: idAtual }));
        if (!vivo) return;
        setAtual(nova);
        if (nova.creditos) setCreditos(nova.creditos);
        if (!emAndamento(nova.situacao)) carregar();
      } catch {
        // Uma pergunta que falha não encerra a espera; a próxima tenta de novo.
      }
    }, INTERVALO_DO_ANDAMENTO_MS);
    return () => {
      vivo = false;
      clearInterval(timer);
    };
  }, [idAtual, situacaoAtual, carregar]);

  const pedir = async (tipo) => {
    setPedindo(true);
    setErro("");
    try {
      const dados = await api.conversas.pedirAnalise({ id: conversa.id, tipo });
      const nova = analiseDoBanco({ kind: tipo, ...dados });
      setAtual(nova);
      if (nova.creditos) setCreditos(nova.creditos);
      setFase("ver");
    } catch (falha) {
      setErro(falha?.message || "Não foi possível pedir a análise.");
    } finally {
      setPedindo(false);
    }
  };

  // A lista vem da tabela, sem o relatório agregado: ao abrir, a análise é
  // buscada pela consulta de andamento, que traz o relatório v1 pronto.
  const abrir = async (analise) => {
    setAtual(analise);
    setFase("ver");
    try {
      const completa = analiseDoBanco(await api.conversas.analise({ analiseId: analise.id }));
      if (completa) setAtual((anterior) => (anterior?.id === completa.id ? completa : anterior));
    } catch {
      // Sem a consulta, fica o que a lista trouxe.
    }
  };

  const salvar = async () => {
    if (!atual) return;
    await api.conversas.salvarAnalise({ analiseId: atual.id });
    setAtual((anterior) => (anterior ? { ...anterior, salvaEm: new Date().toISOString() } : anterior));
    carregar();
  };

  const daFicha = analisesDaFicha(lista);
  const andando = atual && emAndamento(atual.situacao);
  if (!podePedir && daFicha.length === 0) return null;
  if (podePedir && creditos === null && daFicha.length === 0 && !andando) return null;

  return (
    <div className="-mx-3.5 mt-3.5 border-t border-line px-3.5 pt-3.5">
      <div className="flex items-center gap-1.5">
        {/* A análise é feita pela IA: o ícone leva a cor dela. */}
        <FileSearch size={13} strokeWidth={2.2} className="flex-none text-ia" />
        <span className="text-[11px] font-bold uppercase tracking-[.08em] text-faint">Análise da conversa</span>
      </div>

      {andando && (
        <button
          type="button"
          onClick={() => setFase("ver")}
          className="mt-2 flex w-full cursor-pointer items-center gap-2 rounded-ctl bg-accent-soft px-2.5 py-2 text-left text-[11.5px] font-medium text-accent-forte"
        >
          <LoaderCircle size={13} className="flex-none animate-spin" />
          Analisando… ver
        </button>
      )}

      {daFicha.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {daFicha.map((analise) => (
            <button
              key={analise.id}
              type="button"
              onClick={() => abrir(analise)}
              className="flex w-full cursor-pointer items-center gap-2 rounded-ctl px-1.5 py-1.5 text-left text-[11.5px] transition-colors hover:bg-surface-hover"
            >
              <span className="min-w-0 flex-1 truncate text-fg">
                {NOME_DO_TIPO[analise.tipo] || "Análise"} · {dataCurta(analise.concluidaEm)}
              </span>
              {analise.notaDoAtendimento != null && (
                <span className="text-[10.5px] font-semibold tabular-nums text-sub">
                  {analise.notaDoAtendimento}/100
                  {analise.coberturaDoAtendimento != null && (
                    <span className="font-normal text-faint"> · {analise.coberturaDoAtendimento}%</span>
                  )}
                </span>
              )}
              <span className={`text-[10.5px] font-semibold ${analise.salvaEm ? "text-success" : "text-faint"}`}>
                {analise.salvaEm ? "Salva" : "Rascunho"}
              </span>
            </button>
          ))}
        </div>
      )}

      {podePedir && creditos && (
        <>
          <button
            type="button"
            onClick={() => {
              setErro("");
              setFase("escolher");
            }}
            disabled={andando}
            className="mt-2 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-ctl border border-line py-2 text-[12px] font-semibold text-accent-forte transition-colors hover:border-accent disabled:cursor-default disabled:opacity-50"
          >
            Analisar conversa
          </button>
          <span className="mt-1.5 block text-center text-[10.5px] text-faint">{creditosEmTexto(creditos)}</span>
        </>
      )}

      {fase && (
        <DialogoDaAnalise
          conversa={conversa}
          fase={fase}
          atual={atual}
          creditos={creditos}
          pedindo={pedindo}
          erro={erro}
          podePedir={podePedir}
          contexto={{ contato, negocio, estagios, etiquetas }}
          aoPedir={pedir}
          aoRefazer={() => {
            setErro("");
            setFase("escolher");
          }}
          aoSalvar={salvar}
          aoAplicar={async (sugestao) => {
            await aplicarSugestao(sugestao, { contato, negocio, estagios, etiquetas, aoAtualizarEtiquetas, aoCriarEtiqueta });
            await aoAplicado?.();
          }}
          aoUsarMensagem={aoUsarMensagem}
          aoVerMensagem={aoVerMensagem}
          aoCriado={aoAplicado}
          aoFechar={() => setFase(null)}
        />
      )}
    </div>
  );
}

/** Faz no CRM o que a sugestão diz, pelas mesmas operações das outras telas. */
export async function aplicarSugestao(sugestao, { contato, negocio, estagios, etiquetas, aoAtualizarEtiquetas, aoCriarEtiqueta }) {
  if (sugestao.tipo === "etapa") {
    const etapa = etapaPeloNome(estagios, sugestao.valor);
    await api.negocios.atualizar({ id: negocio.id, patch: { stageId: etapa.id } });
    return;
  }
  if (sugestao.tipo === "etiqueta") {
    const tag = etiquetaPeloNome(etiquetas, sugestao.valor) || (await aoCriarEtiqueta(sugestao.valor));
    await aoAtualizarEtiquetas(contato.id, [...new Set([...(contato.tags || []), tag.id])]);
    return;
  }
  const quando = prazoDaSugestao(sugestao.prazoDias);
  if (sugestao.tipo === "tarefa") {
    await api.tarefas.criar({
      titulo: sugestao.valor,
      venceEm: quando.getTime(),
      contactId: contato.id,
      dealId: negocio?.id || null,
    });
    return;
  }
  if (sugestao.tipo === "compromisso") {
    await api.agenda.criar({
      titulo: sugestao.valor,
      descricao: sugestao.motivo || "",
      inicio: quando.toISOString(),
      fim: new Date(quando.getTime() + 30 * 60 * 1000).toISOString(),
      contactId: contato.id,
    });
  }
}

function DialogoDaAnalise({
  conversa,
  fase,
  atual,
  creditos,
  pedindo,
  erro,
  podePedir,
  contexto,
  aoPedir,
  aoRefazer,
  aoSalvar,
  aoAplicar,
  aoUsarMensagem,
  aoVerMensagem,
  aoCriado,
  aoFechar,
}) {
  const tituloId = useId();
  const [tipo, setTipo] = useState("comercial");

  useEffect(() => {
    const teclado = (evento) => {
      if (evento.key === "Escape") aoFechar();
    };
    window.addEventListener("keydown", teclado);
    return () => window.removeEventListener("keydown", teclado);
  }, [aoFechar]);

  const titulo =
    fase === "escolher"
      ? "Analisar conversa"
      : `Análise ${atual?.tipo === "atendimento" ? "de atendimento" : "comercial"}`;
  // O relatório v1 e o do vendedor (v2) são relatórios visuais: largos no
  // computador e a tela inteira no celular. O resto (escolher, andamento,
  // falha, formato antigo) segue no diálogo estreito.
  const pronta = fase === "ver" && atual?.situacao === "done" && atual.resultado;
  const doVendedor = Boolean(pronta && (ehRelatorioV2(atual.resultado) || ehAnaliseV2(atual.relatorio)));
  const visual = Boolean(pronta && (doVendedor || ehRelatorioV1(atual.resultado)));

  // No `body`: dentro da ficha, a coluna rolável recortaria o diálogo.
  return createPortal(
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center bg-[#0f1424]/55 backdrop-blur-[2px] ${visual ? "p-0 sm:p-4" : "p-4"}`}
      onMouseDown={(evento) => {
        if (evento.target === evento.currentTarget) aoFechar();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        className={
          visual
            ? "flex h-[100dvh] w-full max-w-[1180px] flex-col rounded-none border-line bg-bg sm:h-auto sm:max-h-[92vh] sm:border"
            : "flex max-h-[88vh] w-full max-w-[560px] flex-col rounded-none border border-line bg-bg"
        }
      >
        <header className={`flex flex-none items-start gap-3 border-b border-line ${visual ? "px-4 py-3 lg:px-8 lg:py-5" : "px-5 py-4"}`}>
          <div className="min-w-0 flex-1">
            {visual ? (
              <>
                <p className="text-[11.5px] font-semibold uppercase tracking-[.06em] text-sub">{titulo}</p>
                <h2 id={tituloId} className="truncate text-[19px] font-bold text-fg lg:text-[26px]">{conversa.nome}</h2>
              </>
            ) : (
              <>
                <h2 id={tituloId} className="text-[15px] font-semibold text-fg">{titulo}</h2>
                <p className="mt-0.5 truncate text-[12px] text-sub">{conversa.nome}</p>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={aoFechar}
            title="Fechar"
            aria-label="Fechar"
            className={`flex flex-none cursor-pointer items-center justify-center rounded-ctl text-sub transition-colors hover:bg-surface-hover hover:text-fg ${
              visual ? "h-11 w-11" : "h-[28px] w-[28px]"
            }`}
          >
            <X size={visual ? 20 : 16} strokeWidth={2.2} />
          </button>
        </header>

        <div className={`scrollbar-fina min-h-0 flex-1 overflow-y-auto ${visual ? "bg-surface px-3 py-4 lg:px-8 lg:py-6" : "px-5 py-4"}`}>
          {fase === "escolher" ? (
            <EscolherTipo tipo={tipo} aoEscolher={setTipo} />
          ) : !atual ? null : emAndamento(atual.situacao) ? (
            <Andamento />
          ) : doVendedor ? (
            <RelatorioDoVendedor
              analise={atual}
              nome={conversa.nome}
              podeAgir={podePedir}
              contato={contexto.contato}
              negocio={contexto.negocio}
              aoUsarMensagem={aoUsarMensagem}
              aoVerMensagem={aoVerMensagem}
              aoCriado={aoCriado}
              aoFechar={aoFechar}
            />
          ) : atual.situacao === "done" && atual.resultado && ehRelatorioV1(atual.resultado) ? (
            <RelatorioDaAnalise
              analise={atual}
              nome={conversa.nome}
              podeAgir={podePedir}
              contato={contexto.contato}
              negocio={contexto.negocio}
              aoUsarMensagem={aoUsarMensagem}
              aoVerMensagem={aoVerMensagem}
              aoCriado={aoCriado}
              aoFechar={aoFechar}
            />
          ) : atual.situacao === "done" && atual.resultado ? (
            <Resultado resultado={atual.resultado} podeAplicar={podePedir} contexto={contexto} aoAplicar={aoAplicar} chave={atual.id} />
          ) : (
            <Falha motivo={atual.motivo} />
          )}
          {erro && <p role="alert" className="mt-3 text-[12px] text-danger">{erro}</p>}
        </div>

        <footer className={`flex flex-none flex-wrap items-center gap-2 border-t border-line ${visual ? "px-4 py-3 lg:px-8" : "px-5 py-3"}`}>
          {fase === "escolher" ? (
            <>
              <span className="min-w-0 flex-1 text-[11px] text-faint">{creditosEmTexto(creditos)}</span>
              <button
                type="button"
                disabled={pedindo || semCreditos(creditos)}
                onClick={() => aoPedir(tipo)}
                className="cursor-pointer rounded-ctl bg-accent px-3.5 py-2 text-[12px] font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-50"
              >
                {pedindo ? "Pedindo…" : "Analisar · usa 1 crédito"}
              </button>
            </>
          ) : (
            <Rodape atual={atual} podePedir={podePedir} aoRefazer={aoRefazer} aoSalvar={aoSalvar} aoFechar={aoFechar} />
          )}
        </footer>
      </section>
    </div>,
    document.body
  );
}

function EscolherTipo({ tipo, aoEscolher }) {
  return (
    <fieldset>
      <legend className="text-[12px] text-sub">Que tipo de análise?</legend>
      <div className="mt-2.5 flex flex-col gap-2">
        {TIPOS_DE_ANALISE.map((opcao) => (
          <label
            key={opcao.chave}
            className={`flex cursor-pointer items-start gap-2.5 rounded-ctl border px-3 py-2.5 transition-colors ${
              tipo === opcao.chave ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong"
            }`}
          >
            <input
              type="radio"
              name="tipo-de-analise"
              value={opcao.chave}
              checked={tipo === opcao.chave}
              onChange={() => aoEscolher(opcao.chave)}
              className="mt-0.5 accent-[var(--el-accent)]"
            />
            <span>
              <span className="block text-[13px] font-semibold text-fg">{opcao.nome}</span>
              <span className="mt-0.5 block text-[11.5px] leading-[16px] text-sub">{opcao.descricao}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-[16px] text-faint">
        O analista lê as últimas mensagens, a leitura automática e o playbook da empresa. Se a análise falhar, o
        crédito volta.
      </p>
    </fieldset>
  );
}

function Andamento() {
  return (
    <div role="status" className="flex flex-col items-center py-8 text-center">
      <LoaderCircle size={22} className="animate-spin text-ia" />
      <p className="mt-3 text-[13px] font-medium text-fg">Lendo a conversa…</p>
      <p className="mt-1 max-w-[340px] text-[11.5px] leading-[16px] text-sub">
        Leva de um a três minutos. Pode fechar: a análise continua e aparece na ficha quando terminar.
      </p>
    </div>
  );
}

function Falha({ motivo }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-none bg-danger-soft px-3 py-3">
      <AlertCircle size={16} className="mt-0.5 flex-none text-danger" />
      <div>
        <p className="text-[12.5px] font-medium text-fg">{motivoDaFalha(motivo)}</p>
        <p className="mt-0.5 text-[11.5px] text-sub">O crédito desta análise foi devolvido.</p>
      </div>
    </div>
  );
}

function Bloco({ titulo, children }) {
  return (
    <section className="mt-4 first:mt-0">
      <h3 className="text-[10.5px] font-bold uppercase tracking-[.08em] text-faint">{titulo}</h3>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

function Resultado({ resultado, podeAplicar, contexto, aoAplicar, chave }) {
  const indicadores = Object.entries(resultado.indicadores || {});
  return (
    <div>
      {resultado.resumo && <p className="text-[13px] leading-[19px] text-fg">{resultado.resumo}</p>}

      {indicadores.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {indicadores.map(([rotulo, valor]) => (
            <span key={rotulo} className="rounded-ctl border border-line-strong px-2 py-0.5 text-[11px]">
              <span className="text-faint">{rotulo}: </span>
              <span className="font-semibold text-fg">{valor}</span>
            </span>
          ))}
        </div>
      )}

      {resultado.porque?.length > 0 && (
        <Bloco titulo="Por quê">
          <ul className="flex flex-col gap-2">
            {resultado.porque.map((item, indice) => (
              <li key={indice} className="text-[12px] leading-[17px] text-fg">
                {item.texto}
                {item.evidencia && (
                  <blockquote className="mt-1 border-l-2 border-line-strong pl-2 text-[11.5px] italic text-sub">
                    “{item.evidencia}”{item.quando ? <span className="not-italic text-faint"> · {item.quando}</span> : null}
                  </blockquote>
                )}
              </li>
            ))}
          </ul>
        </Bloco>
      )}

      {resultado.oQueFaltou?.length > 0 && (
        <Bloco titulo="O que faltou">
          <ul className="list-disc space-y-1 pl-4 text-[12px] leading-[17px] text-fg">
            {resultado.oQueFaltou.map((item, indice) => (
              <li key={indice}>{item}</li>
            ))}
          </ul>
        </Bloco>
      )}

      {resultado.proximoPasso && (
        <Bloco titulo="Próximo passo">
          <p className="rounded-ctl bg-accent-soft px-3 py-2 text-[12.5px] leading-[18px] text-fg">
            {resultado.proximoPasso}
          </p>
        </Bloco>
      )}

      {resultado.sugestoes?.length > 0 && (
        <Bloco titulo="Sugestões">
          <div className="flex flex-col gap-1.5">
            {resultado.sugestoes.map((sugestao, indice) => (
              <Sugestao
                key={`${chave}:${indice}`}
                sugestao={sugestao}
                podeAplicar={podeAplicar}
                impedimento={impedimentoDaSugestao(sugestao, contexto)}
                aoAplicar={aoAplicar}
              />
            ))}
          </div>
        </Bloco>
      )}
    </div>
  );
}

function Sugestao({ sugestao, podeAplicar, impedimento, aoAplicar }) {
  const [estado, setEstado] = useState("livre"); // livre | aplicando | aplicada
  const [erro, setErro] = useState("");
  const aplicar = async () => {
    setEstado("aplicando");
    setErro("");
    try {
      await aoAplicar(sugestao);
      setEstado("aplicada");
    } catch (falha) {
      setErro(falha?.message || "Não foi possível aplicar.");
      setEstado("livre");
    }
  };
  return (
    <div className="rounded-ctl border border-line px-3 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <span className="block text-[12px] text-fg">
            <span className="text-sub">{ROTULO_DA_SUGESTAO[sugestao.tipo]}: </span>
            <span className="font-semibold">{sugestao.valor}</span>
          </span>
          {sugestao.motivo && <span className="mt-0.5 block text-[11px] leading-[15px] text-faint">{sugestao.motivo}</span>}
        </div>
        {podeAplicar &&
          (estado === "aplicada" ? (
            <span className="inline-flex flex-none items-center gap-1 text-[11px] font-semibold text-success">
              <Check size={13} strokeWidth={2.5} /> Feito
            </span>
          ) : (
            <button
              type="button"
              disabled={Boolean(impedimento) || estado === "aplicando"}
              title={impedimento || undefined}
              onClick={aplicar}
              className="flex-none cursor-pointer rounded-ctl border border-line px-2.5 py-1 text-[11px] font-semibold text-accent-forte transition-colors hover:border-accent disabled:cursor-default disabled:opacity-45"
            >
              {estado === "aplicando" ? "Aplicando…" : "Aplicar"}
            </button>
          ))}
      </div>
      {podeAplicar && impedimento && estado !== "aplicada" && (
        <span className="mt-1 block text-[10.5px] text-faint">{impedimento}</span>
      )}
      {erro && <span role="alert" className="mt-1 block text-[10.5px] text-danger">{erro}</span>}
    </div>
  );
}

function Rodape({ atual, podePedir, aoRefazer, aoSalvar, aoFechar }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const pronta = atual?.situacao === "done" && atual?.resultado;
  const salvar = async () => {
    setSalvando(true);
    setErro("");
    try {
      await aoSalvar();
    } catch (falha) {
      setErro(falha?.message || "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  };
  return (
    <>
      <span className="min-w-0 flex-1 text-[11px] text-faint">
        {erro ? (
          <span role="alert" className="text-danger">{erro}</span>
        ) : pronta && !atual.salvaEm ? (
          "Rascunho: some em 7 dias se não for salvo."
        ) : atual?.salvaEm ? (
          `Salva na ficha ${fmtRelativo(atual.salvaEm)}`
        ) : null}
      </span>
      {podePedir && atual && !emAndamento(atual.situacao) && (
        <button
          type="button"
          onClick={aoRefazer}
          className="cursor-pointer rounded-ctl border border-line px-3 py-2 text-[12px] font-semibold text-sub hover:border-line-strong hover:text-fg"
        >
          {pronta ? "Refazer" : "Tentar de novo"}
        </button>
      )}
      {podePedir && pronta && !atual.salvaEm ? (
        <button
          type="button"
          disabled={salvando}
          onClick={salvar}
          className="cursor-pointer rounded-ctl bg-accent px-3.5 py-2 text-[12px] font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {salvando ? "Salvando…" : "Salvar na ficha"}
        </button>
      ) : (
        <button
          type="button"
          onClick={aoFechar}
          className="cursor-pointer rounded-ctl bg-accent px-3.5 py-2 text-[12px] font-semibold text-on-accent transition-opacity hover:opacity-90"
        >
          Fechar
        </button>
      )}
    </>
  );
}
