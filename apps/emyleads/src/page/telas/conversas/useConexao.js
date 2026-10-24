import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../data/client";
import { useIntervaloVisivel } from "../../../lib/useIntervaloVisivel";
import { conexaoPrincipal, FASES, resumirConexao } from "../conexoes/estadoDaConexao";

/**
 * O estado da conexão do WhatsApp, visto de dentro de Conversas.
 *
 * A caixa de entrada não sabia se o WhatsApp estava conectado: uma lista
 * vazia era igual com sessão caída ou com número recém-ligado. Este hook lê o
 * mesmo `api.gateway.conexoes` que a tela de Conexões lê, e devolve a
 * conexão principal resumida em linguagem de gente.
 *
 * Cadência: rápida (6 s) só enquanto alguém pareia — modal do QR aberto ou a
 * VPS dizendo que está em pareamento —, média (30 s) quando a conexão não está
 * bem, lenta (60 s) quando está conectada. Cada leitura são duas consultas
 * (`whatsapp_connections` e `connection_runtime_status`), e até 23/10/2026 a
 * lista vazia e a empresa sem WhatsApp ficavam nos 6 s para sempre. É o
 * heartbeat da VPS (20 s) que manda; ler mais rápido que isso só repetiria a
 * mesma resposta. Com a aba oculta, não lê.
 */
export const CADENCIA_RAPIDA_MS = 6000;
export const CADENCIA_MEDIA_MS = 30000;
export const CADENCIA_LENTA_MS = 60000;

export function cadenciaDaConexao({ atento = false, resumo = null } = {}) {
  if (atento || resumo?.fase === FASES.PAREANDO) return CADENCIA_RAPIDA_MS;
  if (resumo?.fase === FASES.CONECTADO) return CADENCIA_LENTA_MS;
  return CADENCIA_MEDIA_MS;
}

export function useConexao(organizationId, { atento = false } = {}) {
  const [conexao, setConexao] = useState(null);
  const [carregado, setCarregado] = useState(false);
  const ativoRef = useRef(true);

  const ler = useCallback(async () => {
    if (!organizationId) return;
    try {
      const estado = await api.gateway.conexoes({ organizationId });
      if (!ativoRef.current || estado?.organizationId !== organizationId) return;
      setConexao(conexaoPrincipal(estado?.conexoes));
    } catch {
      // Sem resposta, a tela fica com o que sabia. Inventar "desconectado"
      // por causa de uma falha de rede mandaria alguém parear à toa.
    } finally {
      if (ativoRef.current) setCarregado(true);
    }
  }, [organizationId]);

  const resumo = conexao ? resumirConexao(conexao) : null;

  useEffect(() => {
    ativoRef.current = true;
    setConexao(null);
    setCarregado(false);
    if (!organizationId) return undefined;
    ler();
    return () => {
      ativoRef.current = false;
    };
  }, [organizationId, ler]);

  useIntervaloVisivel(ler, cadenciaDaConexao({ atento, resumo }), { ativo: Boolean(organizationId) });

  return { conexao, resumo, carregado, recarregar: ler };
}
