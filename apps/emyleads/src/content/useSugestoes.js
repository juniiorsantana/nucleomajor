import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../data/client";

/**
 * Sugestões do motor de condições para o contato da conversa aberta.
 *
 * Mesma convenção de useFicha: `undefined` é carregando, `null` é sem
 * contato (nada a avaliar), array é o resultado — mesmo que vazio.
 */
export function useSugestoes(contactId) {
  const [sugestoes, setSugestoes] = useState(undefined);
  const versao = useRef(0);

  const carregar = useCallback(async () => {
    if (!contactId) {
      setSugestoes(null);
      return;
    }
    const minha = ++versao.current;
    try {
      const { sugestoes: dados } = await api.chatbots.avaliar({ contactId });
      if (versao.current === minha) setSugestoes(dados);
    } catch (err) {
      console.warn("[EmyLeads] falha ao avaliar chatbots:", err);
      if (versao.current === minha) setSugestoes(null);
    }
  }, [contactId]);

  useEffect(() => {
    setSugestoes(undefined);
    carregar();
  }, [contactId, carregar]);

  // A Gestão vive em outra aba. Criar, editar, ativar ou desativar um bot não
  // muda o contactId da conversa já aberta, então o efeito acima não rodaria
  // novamente. Reavaliar quando o usuário volta ao WhatsApp mantém a faixa em
  // sincronia sem exigir trocar de conversa ou recarregar a página inteira.
  useEffect(() => {
    const aoRetomar = () => {
      if (document.visibilityState === "visible") carregar();
    };
    window.addEventListener("focus", aoRetomar);
    document.addEventListener("visibilitychange", aoRetomar);
    return () => {
      window.removeEventListener("focus", aoRetomar);
      document.removeEventListener("visibilitychange", aoRetomar);
    };
  }, [carregar]);

  return { sugestoes, recarregar: carregar };
}
