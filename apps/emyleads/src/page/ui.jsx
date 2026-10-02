import { Fragment, useEffect, useId, useRef } from "react";
import { ChevronDown, Search } from "lucide-react";
import NavegacaoMobile from "./NavegacaoMobile";

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
 * Marca do Núcleo Major (Sistema Grafite, 02/10/2026).
 *
 * Quadrado grafite com as iniciais e o ponto de sinal no canto: o único azul
 * da marca, o mesmo que no portal quer dizer "aqui tem algo". O nome da
 * interface é Núcleo Major; "EmyLeads" ficou só no código.
 *
 * Desenhada em HTML, e não num PNG, para seguir o tema: o grafite vira claro
 * no escuro junto com o resto.
 */
export function Marca({ tamanho = 36, texto = true }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="relative flex flex-none items-center justify-center bg-fg font-bold tracking-tight text-bg"
        style={{ width: tamanho, height: tamanho, fontSize: tamanho * 0.36 }}
      >
        NM
        <span className="absolute bg-signal" style={{ width: tamanho * 0.19, height: tamanho * 0.19, top: -tamanho * 0.09, right: -tamanho * 0.09 }} />
      </span>
      {texto && (
        <span className="font-semibold tracking-tight text-fg" style={{ fontSize: tamanho * 0.5 }}>
          Núcleo Major
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

/**
 * Telas que o trilho NÃO desenha: Conexões, Equipe e Configurações moram no
 * menu da organização, embaixo. São abertas poucas vezes por semana, e no
 * trilho disputavam espaço com o que se usa cem vezes por dia.
 */
export const GRUPO_DA_ORGANIZACAO = "Ambiente";

/**
 * Agrupa as telas em blocos CONSECUTIVOS de mesmo `grupo`.
 *
 * Consecutivo, e não por chave, porque a lista já chega na ordem em que se
 * quer ler. No trilho, Atendimento e Gestão são o mesmo bloco de trabalho; a
 * régua só aparece antes da Automação.
 */
function blocosDoTrilho(telas) {
  const blocos = [];
  telas
    .filter((t) => t.grupo !== GRUPO_DA_ORGANIZACAO)
    .forEach((t) => {
      const bloco = t.grupo === "Automação" ? "automacao" : "trabalho";
      const ultimo = blocos[blocos.length - 1];
      if (ultimo && ultimo.id === bloco) ultimo.telas.push(t);
      else blocos.push({ id: bloco, telas: [t] });
    });
  return blocos;
}

/**
 * A dica do trilho: nome, o que está esperando e o atalho.
 *
 * Vive FORA da barra, à direita; por isso não pode haver `overflow` no
 * caminho até ela. Aparece também no foco do teclado, não só no mouse.
 */
export function DicaDoTrilho({ rotulo, estado, atalho }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-50 flex -translate-y-1/2 items-center gap-2.5 whitespace-nowrap rounded-ctl bg-fg px-2.5 py-1.5 text-[12px] font-medium text-bg opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {rotulo}
      {estado && <span className="text-signal-soft">{estado}</span>}
      {atalho && <kbd className="font-mono text-[10.5px] opacity-60">{atalho}</kbd>}
    </span>
  );
}

/**
 * Navegação principal: o trilho Instrumento (Sistema Grafite, 02/10/2026).
 *
 * Só ícones, numa barra de 60px, mas um trilho que trabalha:
 *   - em cima, a busca da tela e os destinos de trabalho;
 *   - depois da régua, a automação, com a cor do ator (IA em violeta, Fluxos
 *     em ciano);
 *   - embaixo, a organização, que abre Conexões, Equipe, Configurações, a
 *     troca de empresa e a conta (`rodapeCompacto`).
 *
 * `contagens` só traz o que é DA PESSOA e está esperando; contagem que não
 * vem não é desenhada. Um zero inventado ensinaria a ignorar o número.
 *
 * O celular não usa o trilho: `NavegacaoMobile` desenha o dock de baixo, com
 * `rodape` (o rodapé completo) dentro do "Mais".
 */
export function Rail({ telas, ativa, aoTrocar, rodape, rodapeCompacto = null, contagens = {}, aoBuscar = null }) {
  const blocos = blocosDoTrilho(telas);

  return (
    <>
      <nav aria-label="Navegação principal" className="relative z-30 hidden h-full w-full flex-none flex-col items-center border-r border-line bg-surface py-3 md:flex">
        <div className="mb-3 flex-none">
          <Marca tamanho={32} texto={false} />
        </div>

        {aoBuscar && (
          <button
            type="button"
            onClick={aoBuscar}
            aria-label="Buscar nesta tela"
            className="group relative mb-2 flex h-8 w-9 flex-none cursor-pointer items-center justify-center rounded-ctl border border-line-strong bg-bg text-faint transition-colors hover:border-faint hover:text-fg"
          >
            <Search size={15} strokeWidth={1.75} aria-hidden="true" />
            <DicaDoTrilho rotulo="Buscar nesta tela" atalho="Ctrl K" />
          </button>
        )}

        <div className="flex min-h-0 flex-1 flex-col items-center gap-0.5">
          {blocos.map((bloco, iBloco) => (
            <Fragment key={bloco.id + iBloco}>
              {iBloco > 0 && <div className="my-2 h-px w-6 flex-none bg-line-strong" />}
              {bloco.telas.map((t) => {
                const on = t.id === ativa;
                const contagem = contagens[t.id];
                const tom = t.tom === "ia" ? "text-ia" : t.tom === "flow" ? "text-flow" : on ? "text-fg" : "text-faint";
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => aoTrocar(t.id)}
                    aria-current={on ? "page" : undefined}
                    aria-label={contagem ? `${t.rotulo}, ${contagem.texto}` : t.rotulo}
                    className={`group relative flex h-10 w-11 flex-none cursor-pointer items-center justify-center rounded-ctl transition-colors hover:bg-surface-hover hover:text-fg ${tom} ${on ? "bg-surface-hover" : ""}`}
                  >
                    {on && <span aria-hidden="true" className="absolute -left-2 bottom-1.5 top-1.5 w-0.5 bg-signal" />}
                    <t.icone size={19} strokeWidth={1.75} aria-hidden="true" />
                    {contagem?.numero > 0 && (
                      <span
                        aria-hidden="true"
                        className="absolute right-0 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-signal px-1 text-[10px] font-semibold tabular-nums text-on-signal ring-2 ring-surface"
                      >
                        {contagem.numero > 99 ? "99+" : contagem.numero}
                      </span>
                    )}
                    <DicaDoTrilho rotulo={t.rotulo} estado={contagem?.texto} atalho={t.atalho ? `G ${t.atalho}` : null} />
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>

        {(rodapeCompacto || rodape) && <div className="mt-2 flex-none">{rodapeCompacto || rodape}</div>}
      </nav>
      <NavegacaoMobile telas={telas} ativa={ativa} aoTrocar={aoTrocar} rodape={rodape} />
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
        className="w-full rounded-ctl border border-line bg-bg py-2.5 pl-11 pr-14 text-[14px] text-fg placeholder:text-faint outline-none transition-colors focus:border-accent"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 text-[12px] font-medium text-faint md:block">
        ⌘K
      </kbd>
    </div>
  );
}

export function BotaoPrimario({ children, className = "", ...props }) {
  return (
    <button
      className={`flex min-h-11 flex-none cursor-pointer items-center justify-center gap-2 rounded-ctl bg-accent px-5 py-3 text-[14px] font-semibold text-white transition-[filter,box-shadow] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
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
    <div className="flex-1 rounded-none border border-line bg-bg p-5">
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
        className={`cursor-pointer appearance-none rounded-ctl border border-line bg-bg font-medium text-sub outline-none transition-colors hover:border-line-strong focus:border-accent ${compacto ? "py-1.5 pl-3 pr-8 text-[12px]" : "py-2.5 pl-4 pr-10 text-[13.5px]"}`}
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
      className={`flex h-[18px] w-[18px] flex-none cursor-pointer items-center justify-center rounded-ctl border transition-colors ${
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

/**
 * O estágio como etiqueta neutra com o quadrado da cor do degrau. O nome é
 * texto comum, e por isso lê nos dois temas; a cor só diz onde no funil.
 */
export function PilulaEstagio({ nome, cor }) {
  if (!nome) return <span className="text-[13px] text-faint">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-ctl border border-line-strong px-2 py-0.5 text-[12px] font-medium text-fg">
      <span aria-hidden="true" className="h-2 w-2 flex-none" style={{ background: cor?.marca || "var(--el-st-1)" }} />
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
      className="flex h-9 min-w-9 cursor-pointer items-center justify-center rounded-ctl border border-line bg-bg px-2 text-[13.5px] font-medium text-sub transition-colors hover:border-line-strong hover:text-fg disabled:opacity-40"
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
            className={`flex h-9 min-w-9 cursor-pointer items-center justify-center rounded-ctl border px-2 text-[13.5px] font-medium transition-colors ${
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
      <section role="alertdialog" aria-modal="true" aria-labelledby={tituloId} className="w-full max-w-sm rounded-none border border-line bg-bg p-5 ">
        <h2 id={tituloId} className="text-[15px] font-semibold text-fg">{pedido.titulo}</h2>
        <p className="mt-2 text-[12px] text-sub">{pedido.descricao}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={aoFechar} className="cursor-pointer rounded-ctl border border-line px-3.5 py-2 text-[12px] font-semibold text-sub hover:border-line-strong hover:text-fg">
            Cancelar
          </button>
          <button
            ref={botaoRef}
            type="button"
            onClick={() => { pedido.confirmar(); aoFechar(); }}
            className="cursor-pointer rounded-ctl bg-danger px-3.5 py-2 text-[12px] font-semibold text-white hover:brightness-95"
          >
            {pedido.rotulo || "Confirmar"}
          </button>
        </div>
      </section>
    </div>
  );
}
