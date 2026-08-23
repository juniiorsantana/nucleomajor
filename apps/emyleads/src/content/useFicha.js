import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../data/client";

/**
 * Ficha completa do contato — negócios, tarefas e notas — numa chamada só.
 *
 * Cinco idas separadas ao service worker dariam cinco re-renderizações e um
 * piscar visível a cada troca de conversa, que é a ação mais frequente do
 * produto.
 *
 * `undefined` é carregando, `null` é sem contato. São coisas diferentes: a
 * primeira mostra esqueleto, a segunda mostra o estado de "fora da base".
 */
export function useFicha(contactId) {
  const [ficha, setFicha] = useState(undefined);
  const versao = useRef(0);

  const carregar = useCallback(async () => {
    if (!contactId) {
      setFicha(null);
      return;
    }
    const minha = ++versao.current;
    try {
      const dados = await api.contatos.ficha({ contactId });
      if (versao.current === minha) setFicha(dados);
    } catch (err) {
      console.warn("[EmyLeads] falha ao carregar a ficha:", err);
      if (versao.current === minha) setFicha(null);
    }
  }, [contactId]);

  useEffect(() => {
    setFicha(undefined);
    carregar();
  }, [contactId, carregar]);

  return { ficha, recarregar: carregar };
}
