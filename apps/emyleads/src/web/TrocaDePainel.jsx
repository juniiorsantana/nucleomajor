import { useState } from "react";
import { ArrowLeftRight, Sparkles, X } from "lucide-react";
import { guardarPainel, outroPainel } from "./painel";

const TEXTO = {
  novo: { rotulo: "Experimentar o painel novo", dica: "Você pode voltar quando quiser." },
  antigo: { rotulo: "Voltar ao painel antigo", dica: "O painel novo continua disponível aqui." },
};

/**
 * O botão flutuante que troca de painel. Fica no canto de baixo, acima da
 * barra do celular. Trocar guarda a escolha e recarrega a página (sem o
 * `?painel=` da URL), porque cada painel é um código à parte. O X esconde o botão só nesta aba.
 */
/** Recarrega sem o `?painel=` da URL, senão ele escolheria de novo o painel de antes. */
function recarregar() {
  const url = new URL(window.location.href);
  url.searchParams.delete("painel");
  window.location.replace(url.toString());
}

export function TrocaDePainel({ painel, aoTrocar = recarregar }) {
  const destino = outroPainel(painel);
  const [escondido, setEscondido] = useState(() => {
    try {
      return sessionStorage.getItem("nucleo.painel.botao") === "escondido";
    } catch {
      return false;
    }
  });
  if (escondido) return null;

  const trocar = () => {
    guardarPainel(destino);
    aoTrocar(destino);
  };
  const esconder = () => {
    try {
      sessionStorage.setItem("nucleo.painel.botao", "escondido");
    } catch {
      // Sem armazenamento, some só até a próxima renderização da página.
    }
    setEscondido(true);
  };
  const Icone = destino === "novo" ? Sparkles : ArrowLeftRight;

  return (
    <div
      className="fixed bottom-[calc(84px+env(safe-area-inset-bottom,0px))] right-4 z-50 flex items-stretch overflow-hidden border border-line-strong bg-bg text-fg lg:bottom-4"
      style={{ boxShadow: "var(--el-shadow-floating)", borderRadius: "var(--el-radius-control)" }}
      data-troca-de-painel
    >
      <button
        type="button"
        onClick={trocar}
        title={TEXTO[destino].dica}
        className="flex min-h-[44px] cursor-pointer items-center gap-2 px-3.5 text-[13px] font-semibold hover:bg-surface-hover"
      >
        <Icone size={15} strokeWidth={2} aria-hidden="true" />
        {TEXTO[destino].rotulo}
      </button>
      <button
        type="button"
        onClick={esconder}
        aria-label="Esconder este botão"
        className="flex min-h-[44px] w-10 cursor-pointer items-center justify-center border-l border-line text-sub hover:bg-surface-hover hover:text-fg"
      >
        <X size={15} strokeWidth={2} />
      </button>
    </div>
  );
}
