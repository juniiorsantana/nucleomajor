import { useCallback, useLayoutEffect, useRef } from "react";

const DISTANCIA_DO_FIM_PX = 40;

export function useRolagemConversa(conversaId, mensagens) {
  const rolagem = useRef(null);
  const conversaAnterior = useRef(null);
  const estavaNoFim = useRef(true);

  const aoRolar = useCallback(() => {
    const caixa = rolagem.current;
    if (!caixa) return;
    const distanciaDoFim = caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight;
    estavaNoFim.current = distanciaDoFim < DISTANCIA_DO_FIM_PX;
  }, []);

  useLayoutEffect(() => {
    if (conversaAnterior.current !== conversaId) estavaNoFim.current = true;
    conversaAnterior.current = conversaId;

    const caixa = rolagem.current;
    if (!conversaId || !caixa || !estavaNoFim.current) return;
    caixa.scrollTop = caixa.scrollHeight;
  }, [conversaId, mensagens]);

  return { rolagem, aoRolar };
}
