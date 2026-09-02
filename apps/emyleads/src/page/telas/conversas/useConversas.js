import { useCallback, useEffect, useState } from "react";
import { api } from "../../../data/client";

/**
 * O estado da tela de Conversas.
 *
 * Fica fora do componente pelo mesmo motivo que `useOperadores` na Equipe: a
 * tela tem quatro colunas e duas folhas, e misturar o carregamento com o
 * desenho delas transforma o arquivo num lugar onde ninguém acha nada.
 *
 * A lista recarrega depois de cada escrita porque a prévia, a hora e o dono da
 * linha mudam junto — mandar mensagem e ver a lista parada é o tipo de defeito
 * que faz alguém mandar duas vezes.
 */
export function useConversas() {
  const [conversas, setConversas] = useState(null);
  const [modelos, setModelos] = useState([]);
  const [atual, setAtual] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [erro, setErro] = useState("");

  const carregarLista = useCallback(async () => {
    const lista = await api.conversas.listar();
    setConversas(lista);
    return lista;
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [lista, padroes] = await Promise.all([
          api.conversas.listar(),
          api.conversas.modelos(),
        ]);
        if (!vivo) return;
        setConversas(lista);
        setModelos(padroes);
        setAtual((anterior) => anterior || lista[0]?.id || null);
      } catch (falha) {
        if (vivo) setErro(falha.message);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (!atual) {
      setMensagens([]);
      return undefined;
    }
    let vivo = true;
    (async () => {
      try {
        const lista = await api.conversas.mensagens({ id: atual });
        if (!vivo) return;
        setMensagens(lista);
        // Abrir a conversa é o que zera o não lido — por isso a lista recarrega
        // aqui, e não no clique: quem decide se ficou lida é quem entregou as
        // mensagens.
        await carregarLista();
      } catch (falha) {
        if (vivo) setErro(falha.message);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [atual, carregarLista]);

  const enviar = useCallback(
    async (texto) => {
      if (!atual) return;
      const limpo = String(texto || "").trim();
      if (!limpo) return;
      const nova = await api.conversas.enviar({ id: atual, texto: limpo });
      if (nova) setMensagens((antes) => antes.concat([nova]));
      await carregarLista();
    },
    [atual, carregarLista]
  );

  const trocarDono = useCallback(
    async (dono) => {
      if (!atual) return;
      await api.conversas.trocarDono({ id: atual, dono });
      setMensagens(await api.conversas.mensagens({ id: atual }));
      await carregarLista();
    },
    [atual, carregarLista]
  );

  const guardarBaralho = useCallback(async (id, baralho) => {
    await api.conversas.guardarBaralho({ id, baralho });
  }, []);

  return {
    conversas,
    modelos,
    atual,
    setAtual,
    mensagens,
    erro,
    enviar,
    trocarDono,
    guardarBaralho,
  };
}
