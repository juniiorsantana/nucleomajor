/**
 * Componentes base. Painel e página de gestão montam em cima destes, para as
 * duas superfícies parecerem o mesmo produto em vez de telas soltas.
 *
 * Densidade de software de produtividade: corpo 13px, metadado 11–12px, linha
 * de 28–32px. Hierarquia por peso, espaço e contraste — não por borda, sombra
 * ou cartão. Nada de cartão dentro de cartão.
 */

/** Iniciais quando não há foto. Duas letras no máximo. */
function iniciais(nome) {
  const partes = String(nome || "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (primeira + ultima).toUpperCase();
}

export function Avatar({ nome, foto, tamanho = 36 }) {
  const estilo = { width: tamanho, height: tamanho };
  if (foto) {
    return (
      <img
        src={foto}
        alt=""
        style={estilo}
        className="flex-none rounded-full object-cover"
      />
    );
  }
  return (
    <div
      style={{ ...estilo, fontSize: Math.round(tamanho * 0.36) }}
      className="flex flex-none items-center justify-center rounded-full bg-accent-soft font-semibold text-accent"
    >
      {iniciais(nome)}
    </div>
  );
}

export function Rotulo({ children, className = "" }) {
  return (
    <div
      className={`text-[10.5px] font-semibold uppercase tracking-[0.06em] text-faint ${className}`}
    >
      {children}
    </div>
  );
}

/** Linha rótulo/valor. Sem borda entre linhas: o espaço já separa. */
export function Campo({ rotulo, children, vazio = "—" }) {
  const preenchido =
    children !== null && children !== undefined && children !== "";
  return (
    <div className="flex min-h-7 items-baseline gap-3 py-[3px]">
      <span className="w-[88px] flex-none text-[10.5px] font-medium uppercase tracking-[0.04em] text-faint">
        {rotulo}
      </span>
      <span
        className={`min-w-0 flex-1 break-words text-[12.5px] ${preenchido ? "text-fg" : "text-faint"}`}
      >
        {preenchido ? children : vazio}
      </span>
    </div>
  );
}

export function Etiqueta({ cor, children, aoRemover }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        color: cor || "var(--el-sub)",
        background: cor ? `${cor}1a` : "var(--el-surface-hover)",
      }}
    >
      {children}
      {aoRemover && (
        <button
          onClick={aoRemover}
          title="Remover"
          className="cursor-pointer opacity-50 transition-opacity hover:opacity-100"
        >
          ×
        </button>
      )}
    </span>
  );
}

export function Botao({ variante = "primario", className = "", ...props }) {
  const variantes = {
    primario:
      "bg-accent text-white font-semibold hover:brightness-110 disabled:opacity-40",
    fantasma:
      "border border-line text-sub font-medium hover:border-line-strong hover:text-fg disabled:opacity-40",
    perigo:
      "border border-line text-danger font-medium hover:border-danger/50 disabled:opacity-40",
  };
  return (
    <button
      className={`cursor-pointer rounded-el px-2.5 py-1.5 text-[12px] transition-all ${variantes[variante]} ${className}`}
      {...props}
    />
  );
}

export function BotaoIcone({ titulo, className = "", ...props }) {
  return (
    <button
      title={titulo}
      className={`flex cursor-pointer items-center justify-center rounded-el p-1.5 text-sub transition-colors hover:bg-surface-hover hover:text-fg ${className}`}
      {...props}
    />
  );
}

export function Entrada({ className = "", ...props }) {
  return (
    <input
      className={`w-full rounded-el border border-line bg-bg px-2.5 py-1.5 text-[12.5px] text-fg placeholder:text-faint outline-none transition-colors focus:border-accent ${className}`}
      {...props}
    />
  );
}

/** Abas com sublinhado — não pílula, não caixa. */
export function Abas({ itens, ativa, aoTrocar }) {
  return (
    <div className="flex items-stretch gap-1 border-b border-line px-2">
      {itens.map((item) => {
        const selecionada = item.id === ativa;
        return (
          <button
            key={item.id}
            onClick={() => aoTrocar(item.id)}
            className={`relative cursor-pointer px-2 py-2 text-[11.5px] font-medium transition-colors ${
              selecionada ? "text-fg" : "text-sub hover:text-fg"
            }`}
          >
            {item.rotulo}
            {item.contador > 0 && (
              <span className="ml-1 text-[10px] text-faint">{item.contador}</span>
            )}
            {selecionada && (
              <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-accent" />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Vazio({ titulo, descricao, children }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
      <div className="text-[12.5px] font-medium text-fg">{titulo}</div>
      {descricao && (
        <p className="max-w-56 text-[11.5px] leading-relaxed text-sub">
          {descricao}
        </p>
      )}
      {children && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

/**
 * Cartão — o bloco de conteúdo da ficha.
 *
 * Cada assunto (contato, funil, tags, tarefas, notas) vira um cartão branco
 * sobre o fundo cinza do painel. A separação vem da elevação, não de régua,
 * e é o que permite empilhar tudo numa rolagem só sem virar sopa: o olho
 * encontra o bloco antes de ler o conteúdo.
 */
export function Cartao({ titulo, acao, children, className = "" }) {
  return (
    // `shrink-0` não é enfeite: a pilha é um flex column com rolagem, e item
    // de flex encolhe por padrão. Sem isto os cartões se espremem para caber
    // na altura disponível em vez de a pilha rolar — a ficha inteira ficava
    // achatada, com o conteúdo cortado dentro de cada cartão.
    <section
      className={`shrink-0 overflow-hidden rounded-el-lg border border-line bg-bg ${className}`}
    >
      {titulo && (
        <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
          <span className="text-[12px] font-semibold text-fg">{titulo}</span>
          <div className="ml-auto flex items-center gap-1">{acao}</div>
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Linha de dado com ícone no lugar de rótulo.
 *
 * Rótulo em caixa alta ocupa uma coluna inteira para dizer o que um ícone diz
 * em 16px — e numa coluna estreita essa largura faz falta no valor, que é a
 * parte que importa.
 */
export function LinhaIcone({ icone: Icone, children, titulo, aoClicar, vazio }) {
  const conteudo = (
    <>
      <Icone
        size={15}
        className="mt-[1px] flex-none text-faint"
        strokeWidth={1.75}
      />
      <span
        className={`min-w-0 flex-1 break-words text-[12.5px] ${vazio ? "text-faint" : "text-fg"}`}
      >
        {children}
      </span>
    </>
  );

  if (!aoClicar)
    return <div className="flex items-start gap-2.5 px-3 py-[5px]">{conteudo}</div>;

  return (
    <button
      onClick={aoClicar}
      title={titulo}
      className="flex w-full cursor-text items-start gap-2.5 px-3 py-[5px] text-left transition-colors hover:bg-surface-hover"
    >
      {conteudo}
    </button>
  );
}

/** Pílula de estado. */
export function Pilula({ tom = "neutro", children, className = "" }) {
  const tons = {
    neutro: "bg-surface-hover text-sub",
    accent: "bg-accent-soft text-accent-forte",
    perigo: "bg-danger/10 text-danger",
    aviso: "bg-warning/10 text-warning",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11px] font-semibold ${tons[tom]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Esqueleto de carregamento — evita o painel piscar vazio a cada troca. */
export function Esqueleto({ linhas = 4 }) {
  return (
    <div className="flex flex-col gap-2 p-3">
      {Array.from({ length: linhas }).map((_, i) => (
        <div
          key={i}
          className="h-3 animate-pulse rounded bg-surface-hover"
          style={{ width: `${90 - i * 12}%` }}
        />
      ))}
    </div>
  );
}
