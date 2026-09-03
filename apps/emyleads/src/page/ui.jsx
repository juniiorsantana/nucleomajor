import { useEffect, useId, useRef } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Peças da página de gestão.
 *
 * Densidade diferente do painel, e de propósito: o painel vive em 380px
 * espremido ao lado de uma conversa, então cada pixel conta. A gestão ocupa a
 * tela inteira e é onde se para para pensar — linha de 56px, título de 24px,
 * respiro. Mesma paleta, mesma tipografia, mesmos raios; escala diferente.
 */

/* ------------------------------------------------------------------ */

/**
 * Marca — símbolo + assinatura.
 *
 * A ordem dos pesos e cores vem da logo e não do palpite: **Emy** é escuro e
 * pesado, **Leads** é roxo e leve. Eu tinha codado ao contrário antes de ver o
 * arquivo.
 *
 * O símbolo é o PNG de verdade, servido de `/icons/` — caminho que funciona
 * tanto na extensão (raiz do pacote) quanto na bancada (pasta public).
 */
export function Marca({ tamanho = 36, texto = true }) {
  const base = typeof import.meta !== "undefined" ? import.meta.env.BASE_URL || "/" : "/";
  return (
    <div className="flex items-center gap-2.5">
      <img
        src={`${base}icons/marca.png`}
        alt=""
        className="flex-none"
        style={{ width: tamanho, height: tamanho }}
      />
      {texto && (
        <span
          className="tracking-tight"
          style={{ fontSize: tamanho * 0.58 }}
        >
          <span className="font-bold text-fg">Emy</span>
          <span className="font-medium text-accent">Leads</span>
        </span>
      )}
    </div>
  );
}

/**
 * Avatar de iniciais.
 *
 * `cor` só é passada para GENTE da organização, não para contato. A diferença
 * é proposital: a cor serve para reconhecer de relance quem da equipe está
 * naquela linha, e vale porque são três ou quatro pessoas que se repetem o dia
 * todo. Espalhar cor por milhares de contatos não distingue ninguém — vira
 * ruído colorido, e ainda apagaria o sinal que a cor tem no funil, onde ela já
 * quer dizer estágio.
 *
 * Colorida, o fundo é sólido e a letra é branca. A alternativa — fundo claro
 * com a letra na cor — sai ilegível no tema escuro, onde a paleta de pessoa é
 * escura por natureza.
 */
export function Iniciais({ nome, tamanho = 34, cor = null }) {
  // Só letras: contato importado sem nome vira "+5511987654321", e a inicial
  // dele sairia como "+".
  const partes = String(nome || "")
    .trim()
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean);
  const letras = partes.length
    ? (partes[0][0] || "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")
    : "#";
  return (
    <div
      className={`flex flex-none items-center justify-center rounded-full font-semibold ${
        cor ? "text-white" : "bg-accent-soft text-accent-forte"
      }`}
      style={{
        width: tamanho,
        height: tamanho,
        fontSize: tamanho * 0.38,
        ...(cor ? { background: cor } : {}),
      }}
    >
      {letras.toUpperCase()}
    </div>
  );
}

/** Selo do WhatsApp ao lado do telefone. Verde porque é a marca DELES. */
export function SeloWhatsApp({ tamanho = 16 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={tamanho}
      height={tamanho}
      fill="#25D366"
      aria-label="WhatsApp"
      className="flex-none"
    >
      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.83 2.41a8.19 8.19 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.38.11-.5.11-.11.25-.29.37-.44.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.48c-.16 0-.43.06-.65.31-.22.25-.85.83-.85 2.03s.87 2.35.99 2.51c.12.16 1.71 2.61 4.14 3.66.58.25 1.03.4 1.38.51.58.19 1.11.16 1.53.1.47-.07 1.44-.59 1.64-1.16.2-.57.2-1.05.14-1.16-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */

export function Rail({ telas, ativa, aoTrocar, rodape }) {
  return (
    <>
      <nav aria-label="Navegação principal" className="hidden w-64 flex-none flex-col border-r border-line bg-bg md:flex">
        <div className="px-5 pb-2 pt-5">
          <Marca />
        </div>

        <div className="flex flex-1 flex-col gap-1 px-3 pt-4">
          {telas.map((t) => {
            const on = t.id === ativa;
            return (
              <button
                key={t.id}
                onClick={() => aoTrocar(t.id)}
                className={`flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-[14px] transition-colors ${
                  on
                    ? "bg-accent-soft font-semibold text-accent-forte"
                    : "font-medium text-sub hover:bg-surface-hover hover:text-fg"
                }`}
              >
                <t.icone size={19} strokeWidth={1.75} className="flex-none" />
                {t.rotulo}
              </button>
            );
          })}
        </div>

        {rodape && <div className="p-3">{rodape}</div>}
      </nav>
      <nav aria-label="Navegação móvel" className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch gap-1 overflow-x-auto border-t border-line bg-bg/95 px-2 py-1.5 backdrop-blur md:hidden">
        {telas.map((t) => {
          const on = t.id === ativa;
          return (
            <button key={t.id} onClick={() => aoTrocar(t.id)} className={`flex min-w-[62px] cursor-pointer flex-col items-center justify-center gap-1 rounded-[8px] px-2 text-[9px] font-semibold ${on ? "bg-accent-soft text-accent-forte" : "text-sub"}`}>
              <t.icone size={18} strokeWidth={1.8} />
              <span>{t.rotulo}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}

export function CabecalhoTela({ titulo, busca, acao }) {
  return (
    <header className="flex flex-none flex-wrap items-center gap-3 border-b border-line bg-bg px-4 py-3 md:flex-nowrap md:gap-6 md:px-8 md:py-4">
      <h1 className="text-[20px] font-semibold tracking-tight text-fg md:text-[24px]">
        {titulo}
      </h1>
      <div className="order-3 flex w-full justify-center md:order-none md:flex-1">{busca}</div>
      {acao}
    </header>
  );
}

export function CampoBusca({ valor, aoMudar, placeholder }) {
  return (
    <div className="relative w-full max-w-[490px]">
      <svg
        viewBox="0 0 24 24"
        className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 stroke-faint"
        fill="none"
        strokeWidth="2"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" strokeLinecap="round" />
      </svg>
      <input
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[10px] border border-line bg-bg py-2.5 pl-11 pr-14 text-[14px] text-fg placeholder:text-faint outline-none transition-colors focus:border-accent"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-faint">
        ⌘K
      </kbd>
    </div>
  );
}

export function BotaoPrimario({ children, className = "", ...props }) {
  return (
    <button
      className={`flex flex-none cursor-pointer items-center gap-2 rounded-[10px] bg-accent px-5 py-3 text-[14px] font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Indicador da visão geral.
 *
 * A terceira linha mostra um número REAL — quantos entraram nesta semana — no
 * lugar do "+18% vs período anterior" da referência. Comparar com período
 * anterior exigiria histórico, que não guardamos; e número inventado na tela é
 * pior do que número a menos.
 */
export function CartaoIndicador({ icone: Icone, rotulo, valor, nota, tomNota = "success" }) {
  const tons = {
    success: "text-success",
    danger: "text-danger",
    neutro: "text-faint",
  };
  return (
    <div className="flex-1 rounded-[14px] border border-line bg-bg p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-accent-soft text-accent-forte">
          <Icone size={19} strokeWidth={1.75} />
        </div>
        <span className="text-[14px] font-medium text-sub">{rotulo}</span>
      </div>
      <div className="mt-3 text-[30px] font-semibold leading-none tracking-tight text-fg">
        {valor}
      </div>
      {nota && (
        <div className={`mt-3 flex items-center gap-1 text-[13px] font-medium ${tons[tomNota]}`}>
          {tomNota === "success" && (
            <svg viewBox="0 0 24 24" className="h-4 w-4 stroke-current" fill="none" strokeWidth="2.2">
              <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {nota}
        </div>
      )}
    </div>
  );
}

/**
 * `rotuloVazio` é opcional, e é essa a diferença entre filtrar e escolher.
 *
 * Num filtro a opção vazia é o estado natural — "todos os status" é uma
 * resposta legítima, e sem ela não há como voltar de um filtro aplicado. Já
 * onde o seletor edita um valor obrigatório (o papel de alguém na equipe),
 * vazio não é resposta: é o campo em branco chegando ao banco. Quando ninguém
 * passa `rotuloVazio`, o seletor só oferece as opções de verdade.
 */
export function Seletor({ valor, aoMudar, opcoes, rotuloVazio, compacto = false }) {
  return (
    <div className="relative">
      <select
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className={`cursor-pointer appearance-none rounded-[9px] border border-line bg-bg font-medium text-sub outline-none transition-colors hover:border-line-strong focus:border-accent ${compacto ? "py-1.5 pl-3 pr-8 text-[12px]" : "py-2.5 pl-4 pr-10 text-[13.5px]"}`}
      >
        {rotuloVazio && <option value="">{rotuloVazio}</option>}
        {opcoes.map((o) => (
          <option key={o.id} value={o.id}>
            {o.rotulo}
          </option>
        ))}
      </select>
      <ChevronDown
        size={compacto ? 14 : 16}
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-sub ${compacto ? "right-2.5" : "right-3"}`}
      />
    </div>
  );
}

export function Caixa({ marcada, aoMudar, titulo }) {
  return (
    <button
      onClick={aoMudar}
      title={titulo}
      className={`flex h-[18px] w-[18px] flex-none cursor-pointer items-center justify-center rounded-[5px] border transition-colors ${
        marcada ? "border-accent bg-accent text-white" : "border-line-strong bg-bg hover:border-accent"
      }`}
    >
      {marcada && (
        <svg viewBox="0 0 24 24" className="h-3 w-3 stroke-current" fill="none" strokeWidth="3.5">
          <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

export function PilulaEstagio({ nome, cor }) {
  if (!nome) return <span className="text-[13px] text-faint">—</span>;
  return (
    <span
      className="inline-flex items-center rounded-[8px] px-2.5 py-1 text-[12.5px] font-medium"
      style={{ color: cor.texto, background: cor.fundo }}
    >
      {nome}
    </span>
  );
}

export function Paginacao({ pagina, paginas, aoIr }) {
  if (paginas <= 1) return null;

  // Primeira, última, e a janela em volta da atual. O resto vira reticências —
  // 26 botões de página não cabem nem ajudam.
  const numeros = [];
  for (let p = 1; p <= paginas; p++) {
    if (p === 1 || p === paginas || Math.abs(p - pagina) <= 1) numeros.push(p);
    else if (numeros[numeros.length - 1] !== "…") numeros.push("…");
  }

  const Botao = ({ children, ...props }) => (
    <button
      {...props}
      className="flex h-9 min-w-9 cursor-pointer items-center justify-center rounded-[8px] border border-line bg-bg px-2 text-[13.5px] font-medium text-sub transition-colors hover:border-line-strong hover:text-fg disabled:opacity-40"
    >
      {children}
    </button>
  );

  return (
    <div className="flex items-center gap-1.5">
      <Botao disabled={pagina === 1} onClick={() => aoIr(pagina - 1)}>
        ‹
      </Botao>
      {numeros.map((n, i) =>
        n === "…" ? (
          <span key={`e${i}`} className="px-1 text-[13.5px] text-faint">
            …
          </span>
        ) : (
          <button
            key={n}
            onClick={() => aoIr(n)}
            className={`flex h-9 min-w-9 cursor-pointer items-center justify-center rounded-[8px] border px-2 text-[13.5px] font-medium transition-colors ${
              n === pagina
                ? "border-accent bg-accent-soft text-accent-forte"
                : "border-line bg-bg text-sub hover:border-line-strong hover:text-fg"
            }`}
          >
            {n}
          </button>
        )
      )}
      <Botao disabled={pagina === paginas} onClick={() => aoIr(pagina + 1)}>
        ›
      </Botao>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Confirmação no lugar do `confirm()` nativo.
 *
 * O nativo bloqueia a thread, ignora o tema e, dentro da extensão, aparece
 * ancorado no topo do navegador — longe do botão que se acabou de apertar.
 * Nasceu na Agenda; mora aqui desde que a Equipe passou a precisar do mesmo
 * diálogo para remover pessoa, cancelar convite e revogar operador.
 *
 * `pedido` é `null` quando não há nada a confirmar — quem chama guarda o
 * pedido num estado e o diálogo se encarrega de aparecer e sumir. O `useId`
 * dá o rótulo acessível: dois diálogos na mesma tela (a Equipe tem o dela e o
 * bloco de operadores tem o seu) não podem dividir o mesmo `id`.
 */
export function DialogoConfirmar({ pedido, aoFechar }) {
  const botaoRef = useRef(null);
  const tituloId = useId();
  useEffect(() => {
    if (!pedido) return undefined;
    botaoRef.current?.focus();
    const teclado = (e) => { if (e.key === "Escape") aoFechar(); };
    window.addEventListener("keydown", teclado);
    return () => window.removeEventListener("keydown", teclado);
  }, [aoFechar, pedido]);
  if (!pedido) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0f1424]/55 p-4 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <section role="alertdialog" aria-modal="true" aria-labelledby={tituloId} className="w-full max-w-sm rounded-[15px] border border-line bg-bg p-5 shadow-2xl">
        <h2 id={tituloId} className="text-[15px] font-semibold text-fg">{pedido.titulo}</h2>
        <p className="mt-2 text-[12px] text-sub">{pedido.descricao}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={aoFechar} className="cursor-pointer rounded-[9px] border border-line px-3.5 py-2 text-[12px] font-semibold text-sub hover:border-line-strong hover:text-fg">
            Cancelar
          </button>
          <button
            ref={botaoRef}
            type="button"
            onClick={() => { pedido.confirmar(); aoFechar(); }}
            className="cursor-pointer rounded-[9px] bg-danger px-3.5 py-2 text-[12px] font-semibold text-white hover:brightness-95"
          >
            {pedido.rotulo || "Confirmar"}
          </button>
        </div>
      </section>
    </div>
  );
}
