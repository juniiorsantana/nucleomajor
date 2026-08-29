const texto = (valor) => String(valor || "").toLowerCase();

/**
 * Traduz erros do Postgres/Supabase para decisões que a interface consegue
 * explicar. O expediente nunca aparece aqui: ele é preferência visual, não
 * uma permissão para criar compromissos.
 */
export function normalizarErroAgenda(error, codigoPadrao = "agenda-falhou") {
  const codigoOriginal = String(error?.code || error?.codigo || "");
  const mensagem = texto(error?.message);
  const detalhes = texto(error?.details);
  const restricao = texto(error?.constraint);

  if (
    codigoOriginal === "23P01"
    || mensagem.includes("calendar_events_no_owner_overlap")
    || detalhes.includes("calendar_events_no_owner_overlap")
    || restricao.includes("calendar_events_no_owner_overlap")
  ) {
    return {
      codigo: "agenda-conflito",
      mensagem: "Esse horário se sobrepõe a outro compromisso da mesma agenda. Escolha outro horário ou ajuste o evento existente.",
    };
  }

  if (codigoOriginal === "42501" || mensagem.includes("row-level security")) {
    return {
      codigo: "agenda-sem-permissao",
      mensagem: "Você não tem permissão para alterar esse evento.",
    };
  }

  return {
    codigo: codigoPadrao,
    mensagem: error?.message || "Não foi possível acessar a agenda.",
  };
}

