const TONS = {
  ok: "bg-success-soft text-success",
  atencao: "bg-warning/15 text-warning",
  perigo: "bg-danger/10 text-danger",
  neutro: "bg-surface-hover text-sub",
  destaque: "bg-accent/10 text-accent-forte",
};

export function Selo({ tom = "neutro", children }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONS[tom] || TONS.neutro}`}>
      {children}
    </span>
  );
}

export function Secao({ titulo, descricao, acao, children }) {
  return (
    <section className="rounded-[14px] border border-line bg-bg">
      <div className="flex flex-wrap items-start gap-3 border-b border-line px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold text-fg">{titulo}</h2>
          {descricao && <p className="mt-0.5 text-[12px] leading-relaxed text-sub">{descricao}</p>}
        </div>
        {acao}
      </div>
      {children}
    </section>
  );
}

export const BOTAO_SECUNDARIO =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-[8px] border border-line bg-bg px-3 py-1.5 text-[12.5px] font-medium text-sub transition-colors hover:border-line-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-40";
export const BOTAO_PERIGO =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-[8px] border border-danger/40 bg-bg px-3 py-1.5 text-[12.5px] font-semibold text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40";
