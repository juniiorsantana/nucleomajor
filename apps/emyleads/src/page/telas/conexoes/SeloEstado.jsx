/** O selo de estado dos cartões de Conexões (WhatsApp, Claude e ChatGPT). */
export function SeloEstado({ tom = "neutro", children }) {
  const classes = {
    sucesso: "bg-success-soft text-success",
    atencao: "bg-warning/10 text-warning",
    erro: "bg-danger/10 text-danger",
    neutro: "bg-surface-hover text-sub",
  };
  return (
    <span className={`inline-flex flex-none items-center rounded-full px-2.5 py-1 text-[12px] font-medium ${classes[tom]}`}>
      {children}
    </span>
  );
}
