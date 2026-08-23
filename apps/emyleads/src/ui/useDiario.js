import { useCallback, useEffect, useState } from "react";
import { api } from "../data/client";

/**
 * Como cada motivo do diário é explicado para quem não escreveu o código.
 *
 * O slug é estável e serve ao código; este texto serve ao atendente. Manter os
 * dois separados evita a tentação de renomear o slug — que quebraria o
 * histórico já gravado — só para melhorar a frase.
 */
export const MOTIVOS = {
  enviado: "Respondeu",
  "automacao-pausada": "Automação pausada",
  "contato-fora-da-base": "Contato fora da base",
  "contato-sem-ficha": "Contato sem ficha",
  "mensagem-ja-respondida": "Mensagem já respondida",
  "nenhum-bot-aplicavel": "Nenhum bot se aplica",
  "reserva-ativa": "Outra aba já respondeu",
  "falha-no-envio": "Falha no envio",
  "falha-na-execucao": "Enviou, mas não registrou",
  // Enviou e não entregou a conversa. Quando o destino era humano, o cliente
  // foi avisado de que alguém vai atender — e ninguém foi avisado disso.
  "falha-na-transferencia": "Enviou, mas não transferiu",
};

export const textoDoMotivo = (motivo) => MOTIVOS[motivo] || motivo || "—";

/**
 * O diário da automação.
 *
 * Revalida ao voltar para a aba, como as sugestões: o diário é escrito pelo
 * content script noutra aba, então nada avisa esta página de que chegou coisa
 * nova.
 */
export function useDiario({ contactId = null } = {}) {
  const [diario, setDiario] = useState(undefined);

  const carregar = useCallback(async () => {
    try {
      setDiario(await api.automacao.diario());
    } catch (err) {
      console.warn("[EmyLeads] falha ao ler o diário da automação:", err);
      setDiario(null);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

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

  const entradas = diario?.entradas || [];
  return {
    diario,
    entradas,
    porChatbot: diario?.porChatbot || [],
    // As entradas já vêm da mais nova para a mais velha.
    ultimaDoContato: contactId
      ? entradas.find((entrada) => entrada.contactId === contactId) || null
      : null,
    recarregar: carregar,
  };
}
