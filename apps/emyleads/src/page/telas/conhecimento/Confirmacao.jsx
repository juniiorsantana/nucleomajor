import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A confirmação que substitui `window.confirm`.
 *
 * O `confirm` nativo trava a thread, ignora o tema, não dá para estilizar o
 * botão destrutivo e, em alguns navegadores, ganha uma caixa de "não deixe
 * este site abrir mais diálogos" que desliga silenciosamente todas as
 * confirmações seguintes — inclusive a de arquivar um documento.
 *
 * A API é uma promessa para o código chamador continuar linear: quem antes
 * escrevia `if (!confirm(...)) return;` agora escreve
 * `if (!(await confirmar(...))) return;`. Um callback obrigaria a inverter o
 * fluxo de três funções que hoje se leem de cima para baixo.
 */
export function useConfirmacao() {
  const [pedido, setPedido] = useState(null);
  const botaoRef = useRef(null);
  const focoAnterior = useRef(null);

  const confirmar = useCallback(
    ({ titulo, mensagem = "", acao = "Continuar", destrutivo = false }) =>
      new Promise((resolve) => {
        focoAnterior.current = typeof document === "undefined" ? null : document.activeElement;
        setPedido({ titulo, mensagem, acao, destrutivo, resolve });
      }),
    [],
  );

  const responder = useCallback((resposta) => {
    setPedido((atual) => {
      atual?.resolve(resposta);
      return null;
    });
    focoAnterior.current?.focus?.();
  }, []);

  useEffect(() => {
    if (!pedido) return undefined;
    botaoRef.current?.focus();
    const aoTeclar = (evento) => {
      if (evento.key !== "Escape") return;
      // Escape é sempre a resposta segura: cancela, nunca confirma.
      evento.preventDefault();
      evento.stopPropagation();
      responder(false);
    };
    // Na captura, para o Escape não chegar ao assistente e fechar os dois.
    document.addEventListener("keydown", aoTeclar, true);
    return () => document.removeEventListener("keydown", aoTeclar, true);
  }, [pedido, responder]);

  const dialogo = pedido ? (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && responder(false)}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-label={pedido.titulo}
        className="w-full max-w-[380px] rounded-[14px] border border-line bg-bg p-5 shadow-2xl"
      >
        <h2 className="text-[14.5px] font-semibold text-fg">{pedido.titulo}</h2>
        {pedido.mensagem && <p className="mt-1.5 text-[12px] leading-5 text-sub">{pedido.mensagem}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => responder(false)}
            className="rounded-[9px] px-3 py-2 text-[12.5px] font-semibold text-sub hover:bg-surface-hover hover:text-fg"
          >
            Cancelar
          </button>
          <button
            ref={botaoRef}
            type="button"
            onClick={() => responder(true)}
            className={`rounded-[9px] px-4 py-2 text-[12.5px] font-semibold text-white ${
              pedido.destrutivo ? "bg-danger" : "bg-accent"
            }`}
          >
            {pedido.acao}
          </button>
        </div>
      </section>
    </div>
  ) : null;

  return [dialogo, confirmar];
}
