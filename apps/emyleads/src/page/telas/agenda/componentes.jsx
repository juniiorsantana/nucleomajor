import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, Search, Undo2, X } from "lucide-react";

/**
 * Peças de tela que a Agenda e as Tarefas dividem.
 *
 * Nasceram juntas porque as duas telas passaram a ser pensadas primeiro para o
 * telefone: formulário que sobe de baixo, aviso com Desfazer acima do dock,
 * escolha de contato com busca. Cada uma resolve um defeito que as duas telas
 * tinham do mesmo jeito.
 */

const CONSULTA_ESTREITA = "(max-width: 767px)";

/**
 * Se a tela é de telefone.
 *
 * `resize` junto do `change` pelo mesmo motivo de sempre neste painel: embutido
 * no WhatsApp Web, quem muda a largura é o layout hospedeiro, e nem toda
 * WebView entrega o `change` nessa situação.
 */
export function useEstreito() {
  const [estreito, setEstreito] = useState(() => (
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(CONSULTA_ESTREITA).matches
      : false
  ));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const consulta = window.matchMedia(CONSULTA_ESTREITA);
    const aplicar = () => setEstreito(consulta.matches);
    aplicar();
    consulta.addEventListener("change", aplicar);
    window.addEventListener("resize", aplicar);
    return () => {
      consulta.removeEventListener("change", aplicar);
      window.removeEventListener("resize", aplicar);
    };
  }, []);
  return estreito;
}

const SELETOR_FOCAVEIS = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";

/**
 * Formulário ou detalhe que, no telefone, sobe de baixo.
 *
 * A caixa centralizada de antes deixava o Salvar no fim da rolagem, atrás do
 * teclado. Aqui o rodapé é fixo e o miolo é que rola; a borda de baixo respeita
 * a área segura do aparelho. No computador continua caixa no centro, ou gaveta
 * à direita quando `lado="direita"` — o detalhe de um compromisso não precisa
 * esconder a semana inteira para ser lido.
 *
 * Com `onSubmit`, o painel inteiro é o `<form>`: o botão de enviar pode morar
 * no rodapé sem sair do formulário.
 */
export function Folha({
  titulo,
  subtitulo,
  icone: Icone,
  aoFechar,
  rodape,
  children,
  largura = "md:max-w-lg",
  lado = "centro",
  onSubmit,
  camada = "z-50",
  semCabecalho = false,
  rotuloAcessivel,
}) {
  const tituloId = useId();
  const painelRef = useRef(null);
  const fecharRef = useRef(aoFechar);
  fecharRef.current = aoFechar;

  useEffect(() => {
    const painel = painelRef.current;
    const focoAnterior = document.activeElement;
    // Só o campo marcado com `data-autofocus` ganha o foco; sem marca, o
    // painel. Focar um campo por conta própria abria o teclado do telefone
    // por cima de uma tarefa que a pessoa só queria ler.
    const primeiro = painel?.querySelector("[data-autofocus]");
    (primeiro || painel)?.focus?.({ preventScroll: true });
    const teclado = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fecharRef.current(); return; }
      if (e.key !== "Tab") return;
      const focaveis = [...(painel?.querySelectorAll(SELETOR_FOCAVEIS) || [])].filter((el) => el.offsetParent !== null);
      if (!focaveis.length) return;
      const inicio = focaveis[0];
      const fim = focaveis[focaveis.length - 1];
      if (e.shiftKey && document.activeElement === inicio) { e.preventDefault(); fim.focus(); }
      else if (!e.shiftKey && document.activeElement === fim) { e.preventDefault(); inicio.focus(); }
    };
    document.addEventListener("keydown", teclado);
    return () => {
      document.removeEventListener("keydown", teclado);
      focoAnterior?.focus?.();
    };
  }, []);

  const Painel = onSubmit ? "form" : "section";
  const direita = lado === "direita";
  return (
    <div
      className={`fixed inset-0 ${camada} flex items-end justify-center bg-[#0f1424]/55 backdrop-blur-[2px] ${direita ? "md:items-stretch md:justify-end" : "md:items-center md:p-4"}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}
    >
      <Painel
        ref={painelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titulo ? tituloId : undefined}
        aria-label={titulo ? undefined : rotuloAcessivel}
        tabIndex={-1}
        onSubmit={onSubmit}
        className={`folha-agenda flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-none border border-line bg-bg  outline-none ${largura} ${direita ? "md:h-full md:max-h-none md:w-[420px] md:max-w-[94vw] md:rounded-none md:border-y-0 md:border-r-0" : "md:max-h-[90vh] md:rounded-none"}`}
      >
        {/* A alça diz "isto se fecha puxando para baixo" antes de qualquer
            texto — é a convenção que o telefone já ensinou. */}
        <span aria-hidden="true" className="mx-auto mt-2 h-1 w-10 flex-none rounded-full bg-line-strong md:hidden" />
        {!semCabecalho && (
          <header className="flex flex-none items-start gap-3 border-b border-line px-4 py-3 md:px-5 md:py-4">
            {Icone && (
              <span className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-ctl bg-accent-soft text-accent-forte">
                <Icone size={18} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h2 id={tituloId} className="text-[17px] font-semibold leading-6 text-fg md:text-[16px]">{titulo}</h2>
              {subtitulo && <p className="mt-0.5 text-[13px] leading-5 text-sub md:text-[12px]">{subtitulo}</p>}
            </div>
            <button
              type="button"
              onClick={aoFechar}
              aria-label="Fechar"
              className="-mr-1 flex h-11 w-11 flex-none cursor-pointer items-center justify-center rounded-ctl text-sub hover:bg-surface-hover hover:text-fg md:h-9 md:w-9"
            >
              <X size={19} />
            </button>
          </header>
        )}
        <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {rodape && (
          <footer className="flex flex-none items-center gap-2 border-t border-line bg-surface/60 px-4 pb-[calc(12px+env(safe-area-inset-bottom,0px))] pt-3 md:px-5 md:pb-3">
            {rodape}
          </footer>
        )}
      </Painel>
    </div>
  );
}

const TEMPO_AVISO = 5000;
const TEMPO_DESFAZER = 9000;

/**
 * Aviso flutuante junto da ação, com Desfazer quando existe volta.
 *
 * Fixo na janela, e não preso à tela: no telefone ele sobe acima do dock e do
 * botão "+", onde antes ficava por baixo dos dois.
 */
export function Aviso({ aviso, aoFechar }) {
  useEffect(() => {
    if (!aviso) return undefined;
    const relogio = setTimeout(aoFechar, aviso.acao ? TEMPO_DESFAZER : TEMPO_AVISO);
    return () => clearTimeout(relogio);
  }, [aviso, aoFechar]);
  if (!aviso) return null;
  const erro = aviso.tom === "erro";
  return (
    <div className="aviso-agenda pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-4">
      <div
        role={erro ? "alert" : "status"}
        aria-live="polite"
        className={`pointer-events-auto flex min-h-12 w-full max-w-[560px] items-center gap-3 rounded-none border px-4 py-2  md:w-auto ${erro ? "border-danger/30 bg-[color-mix(in_srgb,var(--el-danger)_12%,var(--el-bg))] text-danger" : "border-line-strong bg-fg text-bg"}`}
      >
        <span className="min-w-0 flex-1 text-[14px] font-medium md:text-[13px]">{aviso.texto}</span>
        {aviso.acao && (
          <button
            type="button"
            onClick={() => { aviso.acao.executar(); aoFechar(); }}
            className={`flex min-h-10 flex-none cursor-pointer items-center gap-1.5 rounded-ctl px-3 text-[13px] font-bold ${erro ? "hover:bg-danger/15" : "bg-bg/15 hover:bg-bg/25"}`}
          >
            <Undo2 size={15} />{aviso.acao.rotulo}
          </button>
        )}
        <button type="button" aria-label="Fechar aviso" onClick={aoFechar} className="flex h-10 w-10 flex-none cursor-pointer items-center justify-center rounded-ctl opacity-60 hover:opacity-100">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

/**
 * Botões lado a lado em que só um vale — Dia/Semana/Mês, Minhas/Equipe.
 *
 * 44px de altura no telefone: é o alvo mínimo de toque, e era o que faltava
 * nos botões de 28px da barra antiga.
 */
export function Segmentado({ opcoes, valor, aoMudar, rotulo, className = "", cheio = false }) {
  return (
    <div role="radiogroup" aria-label={rotulo} className={`flex rounded-ctl bg-surface p-1 ${cheio ? "w-full" : ""} ${className}`}>
      {opcoes.map((opcao) => {
        const ativo = opcao.id === valor;
        return (
          <button
            key={opcao.id}
            type="button"
            role="radio"
            aria-checked={ativo}
            title={opcao.dica}
            onClick={() => aoMudar(opcao.id)}
            className={`flex min-h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl px-3 text-[14px] font-semibold transition-colors md:min-h-8 md:text-[12px] ${ativo ? "bg-bg text-fg " : "text-sub hover:text-fg"}`}
          >
            {opcao.rotulo}
            {opcao.contador > 0 && (
              <span className={`min-w-5 rounded-full px-1.5 text-[11px] leading-5 md:text-[10px] ${ativo ? "bg-accent-soft text-accent-forte" : "bg-bg text-sub"}`}>{opcao.contador}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Pílula de filtro. `tom="perigo"` para o que pede atenção (atrasadas). */
export function Chip({ ativo, aoClicar, children, contador, tom, cor, title }) {
  const perigo = tom === "perigo" && contador > 0;
  return (
    <button
      type="button"
      aria-pressed={ativo}
      title={title}
      onClick={aoClicar}
      className={`inline-flex min-h-10 flex-none cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[14px] font-medium transition-colors md:min-h-8 md:px-3 md:text-[12px] ${
        ativo ? "border-accent bg-accent-soft text-accent-forte" : "border-line bg-bg text-sub hover:border-line-strong hover:text-fg"
      }`}
    >
      {cor && <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: cor }} />}
      {children}
      {contador > 0 && (
        <span className={`rounded-full px-1.5 text-[12px] font-semibold leading-5 md:text-[10.5px] ${perigo ? "bg-danger text-white" : ativo ? "bg-bg/70" : "bg-surface"}`}>{contador}</span>
      )}
    </button>
  );
}

function normalizar(texto) {
  return String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function nomeDe(contato) {
  return contato?.nome || contato?.name || "Sem nome";
}

const LIMITE_RESULTADOS = 40;

/**
 * Escolha de contato com busca.
 *
 * Era um `<select>` com todos os leads da empresa — com algumas centenas,
 * achar alguém exigia rolar a lista inteira, e no telefone o seletor nativo
 * mostrava cinco nomes por vez. A lista abre embutida, e não flutuando, porque
 * mora dentro de folhas que rolam: um menu flutuante seria cortado pela borda.
 */
export function SeletorContato({ contatos = [], valor, aoMudar, rotulo = "Contato", placeholder = "Buscar pelo nome, empresa ou telefone" }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const entradaId = useId();
  const listaId = useId();
  const entradaRef = useRef(null);
  const escolhido = contatos.find((contato) => contato.id === valor) || null;

  const resultados = useMemo(() => {
    const termo = normalizar(busca.trim());
    const ordenados = contatos
      .slice()
      .sort((a, b) => nomeDe(a).localeCompare(nomeDe(b), "pt-BR"));
    const achados = termo
      ? ordenados.filter((contato) => normalizar(`${nomeDe(contato)} ${contato.empresa || ""} ${contato.telefone || ""}`).includes(termo))
      : ordenados;
    return { itens: achados.slice(0, LIMITE_RESULTADOS), total: achados.length };
  }, [busca, contatos]);

  const escolher = (id) => {
    aoMudar(id);
    setAberto(false);
    setBusca("");
  };

  return (
    <div>
      <label htmlFor={entradaId} className="mb-1 block text-[13px] font-semibold text-sub md:text-[12px]">{rotulo}</label>
      {escolhido && !aberto ? (
        <div className="flex min-h-11 items-center gap-2 rounded-ctl border border-line bg-bg py-1 pl-3 pr-1">
          <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-accent-soft text-[11px] font-bold text-accent-forte">
            {nomeDe(escolhido).split(/\s+/).slice(0, 2).map((parte) => parte[0]).join("").toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium text-fg md:text-[13px]">{nomeDe(escolhido)}</span>
            {(escolhido.empresa || escolhido.telefone) && <span className="block truncate text-[12px] text-faint md:text-[11px]">{escolhido.empresa || escolhido.telefone}</span>}
          </span>
          <button type="button" id={entradaId} onClick={() => { setAberto(true); setTimeout(() => entradaRef.current?.focus(), 0); }} className="min-h-9 cursor-pointer rounded-ctl px-2.5 text-[13px] font-semibold text-accent-forte hover:bg-accent-soft md:text-[12px]">Trocar</button>
          <button type="button" aria-label="Remover contato" onClick={() => aoMudar("")} className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-ctl text-sub hover:bg-surface-hover hover:text-fg"><X size={16} /></button>
        </div>
      ) : (
        <div className="rounded-ctl border border-line bg-bg focus-within:border-accent">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              ref={entradaRef}
              id={entradaId}
              role="combobox"
              aria-expanded={aberto}
              aria-controls={listaId}
              aria-autocomplete="list"
              value={busca}
              onFocus={() => setAberto(true)}
              onChange={(e) => { setBusca(e.target.value); setAberto(true); }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && aberto) { e.stopPropagation(); e.preventDefault(); setAberto(false); }
                if (e.key === "Enter" && aberto) {
                  e.preventDefault();
                  if (resultados.itens[0]) escolher(resultados.itens[0].id);
                }
              }}
              placeholder={escolhido ? nomeDe(escolhido) : placeholder}
              className="min-h-11 w-full rounded-ctl bg-transparent pl-9 pr-3 text-[15px] text-fg outline-none placeholder:text-faint md:min-h-10 md:text-[13px]"
            />
          </div>
          {aberto && (
            <ul id={listaId} role="listbox" className="scrollbar-fina max-h-60 overflow-y-auto border-t border-line py-1">
              <li>
                <button type="button" onClick={() => escolher("")} className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-3 text-left text-[14px] text-sub hover:bg-surface-hover md:min-h-9 md:text-[12.5px]">
                  Sem contato
                  {!valor && <Check size={14} className="ml-auto text-accent-forte" />}
                </button>
              </li>
              {resultados.itens.map((contato) => (
                <li key={contato.id} role="option" aria-selected={contato.id === valor}>
                  <button type="button" onClick={() => escolher(contato.id)} className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-3 text-left hover:bg-surface-hover md:min-h-9">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-fg md:text-[12.5px]">{nomeDe(contato)}</span>
                      {(contato.empresa || contato.telefone) && <span className="block truncate text-[12px] text-faint md:text-[11px]">{contato.empresa || contato.telefone}</span>}
                    </span>
                    {contato.id === valor && <Check size={14} className="text-accent-forte" />}
                  </button>
                </li>
              ))}
              {!resultados.total && <li className="px-3 py-3 text-[13px] text-faint">Nenhum contato com “{busca}”.</li>}
              {resultados.total > resultados.itens.length && (
                <li className="px-3 py-2 text-[12px] text-faint">Mais {resultados.total - resultados.itens.length} — continue digitando para achar.</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Caixa de concluir com área de toque de 44px e desenho de 20px. */
export function CaixaConcluir({ marcada, aoMudar, titulo, desabilitada = false }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={marcada}
      aria-label={titulo}
      title={titulo}
      disabled={desabilitada}
      onClick={(e) => { e.stopPropagation(); aoMudar(); }}
      className="group/caixa -m-2 flex h-11 w-11 flex-none cursor-pointer items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40 md:h-9 md:w-9"
    >
      <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 transition-colors md:h-5 md:w-5 ${marcada ? "border-success bg-success text-white" : "border-line-strong text-transparent group-hover/caixa:border-success group-hover/caixa:text-success"}`}>
        <Check size={13} strokeWidth={3} />
      </span>
    </button>
  );
}
