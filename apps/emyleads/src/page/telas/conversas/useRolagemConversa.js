import { useCallback, useLayoutEffect, useRef, useState } from "react";

const DISTANCIA_DO_FIM_PX = 40;

/**
 * A rolagem da conversa: abre no fim, acompanha mensagem nova quando a pessoa
 * está no fim, e não puxa a tela de quem subiu para ler o histórico.
 *
 * Desde 03/10/2026 também diz se a pessoa está fora do fim (`noFim`) e quantas
 * mensagens chegaram desde que ela saiu (`novas`): é o que alimenta o botão
 * "N novas", que leva de volta ao fim (`irParaOFim`).
 */
export function useRolagemConversa(conversaId, mensagens) {
  const rolagem = useRef(null);
  const conversaAnterior = useRef(null);
  const estavaNoFim = useRef(true);
  const [noFim, setNoFim] = useState(true);
  // Quantas mensagens havia quando a pessoa saiu do fim.
  const [marca, setMarca] = useState(null);
  const quantas = contarMensagens(mensagens);
  const quantasRef = useRef(quantas);
  quantasRef.current = quantas;

  const aoRolar = useCallback(() => {
    const caixa = rolagem.current;
    if (!caixa) return;
    const distanciaDoFim = caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight;
    const agora = distanciaDoFim < DISTANCIA_DO_FIM_PX;
    if (agora !== estavaNoFim.current) {
      setNoFim(agora);
      setMarca(agora ? null : quantasRef.current);
    }
    estavaNoFim.current = agora;
  }, []);

  useLayoutEffect(() => {
    if (conversaAnterior.current !== conversaId) {
      estavaNoFim.current = true;
      setNoFim(true);
      setMarca(null);
    }
    conversaAnterior.current = conversaId;

    const caixa = rolagem.current;
    if (!conversaId || !caixa || !estavaNoFim.current) return;
    caixa.scrollTop = caixa.scrollHeight;
  }, [conversaId, mensagens]);

  const irParaOFim = useCallback(() => {
    const caixa = rolagem.current;
    if (!caixa) return;
    if (typeof caixa.scrollTo === "function") caixa.scrollTo({ top: caixa.scrollHeight, behavior: "smooth" });
    else caixa.scrollTop = caixa.scrollHeight;
    estavaNoFim.current = true;
    setNoFim(true);
    setMarca(null);
  }, []);

  const novas = noFim || marca === null ? 0 : Math.max(0, quantas - marca);
  return { rolagem, aoRolar, noFim, novas, irParaOFim };
}

function contarMensagens(lista) {
  if (!Array.isArray(lista)) return 0;
  return lista.filter((item) => !item?.tipo || item.tipo === "mensagem").length;
}
