import { useCallback, useEffect, useState } from "react";
import { api } from "../../../data/client";

const PLATAFORMA_WEB =
  typeof __EMYLEADS_PLATFORM__ !== "undefined" && __EMYLEADS_PLATFORM__ === "web";

/** A lista se atualiza sozinha pelo realtime; isto é o que segura se ele cair. */
const RECARGA_MS = 20000;

/**
 * O estado da tela de Conversas.
 *
 * Fica fora do componente pelo mesmo motivo que `useOperadores` na Equipe: a
 * tela tem três colunas e duas folhas, e misturar o carregamento com o desenho
 * delas transforma o arquivo num lugar onde ninguém acha nada.
 *
 * Duas classes de falha, tratadas de formas diferentes de propósito. Não
 * conseguir LER é fatal — sem lista não há tela, e o erro toma o lugar dela.
 * Não conseguir ESCREVER é aviso: a conversa continua legível, e derrubar tudo
 * porque o envio ainda não está ligado esconderia o que funciona.
 */
export function useConversas(organizacaoId) {
  const [conversas, setConversas] = useState(null);
  const [modelos, setModelos] = useState([]);
  const [atual, setAtual] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const carregarLista = useCallback(async () => {
    const lista = await api.conversas.listar();
    setConversas(lista);
    // Escolher a primeira só na primeira carga: trocar a conversa aberta
    // debaixo de quem está lendo seria pior que não atualizar nada.
    setAtual((anterior) => anterior || lista[0]?.id || null);
    return lista;
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [, padroes] = await Promise.all([carregarLista(), api.conversas.modelos()]);
        if (vivo) setModelos(padroes);
      } catch (falha) {
        if (vivo) setErro(falha.message);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [carregarLista]);

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
        // Quem decide se a conversa ficou lida é quem entregou as mensagens, e
        // não o clique: na bancada abrir zera o contador, e no portal ele
        // continua sendo o que a VPS reportou — marcar como lida ainda não
        // volta para o WhatsApp. Recarregar aqui mostra a resposta de quem
        // sabe, seja ela qual for.
        await carregarLista();
      } catch (falha) {
        if (vivo) setErro(falha.message);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [atual, carregarLista]);

  /**
   * O aviso do Supabase chega pelo tópico `conversas`, emitido pelo gatilho em
   * `whatsapp_conversations` — a tabela da lista. Mensagem nova mexe a lista, e
   * é por isso que a lista é o que se recarrega aqui: quem está com a conversa
   * aberta vê a bolha nova no ciclo seguinte, e quem não está vê a linha subir.
   */
  useEffect(() => {
    if (!PLATAFORMA_WEB || !organizacaoId) return undefined;
    const aoMudar = (evento) => {
      if (evento.detail?.organizationId === organizacaoId && evento.detail?.topic === "conversas") {
        carregarLista().catch(() => {});
      }
    };
    window.addEventListener("emyleads:connections-changed", aoMudar);
    api.gateway.ativarRealtime({ organizationId: organizacaoId }).catch(() => {
      // A recarga periódica permanece como fallback.
    });
    return () => window.removeEventListener("emyleads:connections-changed", aoMudar);
  }, [organizacaoId, carregarLista]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      carregarLista().catch(() => {});
    }, RECARGA_MS);
    return () => window.clearInterval(timer);
  }, [carregarLista]);

  const enviar = useCallback(
    async (texto) => {
      if (!atual) return;
      const limpo = String(texto || "").trim();
      if (!limpo) return;
      setAviso("");
      try {
        const nova = await api.conversas.enviar({ id: atual, texto: limpo });
        if (nova) setMensagens((antes) => antes.concat([nova]));
        await carregarLista();
      } catch (falha) {
        setAviso(falha.message);
        throw falha;
      }
    },
    [atual, carregarLista]
  );

  const trocarDono = useCallback(
    async (dono) => {
      if (!atual) return;
      setAviso("");
      try {
        await api.conversas.trocarDono({ id: atual, dono });
        setMensagens(await api.conversas.mensagens({ id: atual }));
        await carregarLista();
      } catch (falha) {
        setAviso(falha.message);
      }
    },
    [atual, carregarLista]
  );

  const guardarBaralho = useCallback(async (id, baralho) => {
    await api.conversas.guardarBaralho({ id, baralho }).catch(() => {});
  }, []);

  return {
    conversas,
    modelos,
    atual,
    setAtual,
    mensagens,
    erro,
    aviso,
    enviar,
    trocarDono,
    guardarBaralho,
  };
}
