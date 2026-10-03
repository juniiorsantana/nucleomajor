import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../data/client";
import { conexaoPrincipal, resumirConexao } from "../conexoes/estadoDaConexao";

/**
 * O estado da conexão do WhatsApp, visto de dentro de Conversas.
 *
 * A caixa de entrada não sabia se o WhatsApp estava conectado: uma lista
 * vazia era igual com sessão caída ou com número recém-ligado. Este hook lê o
 * mesmo `api.gateway.conexoes` que a tela de Conexões lê, e devolve a
 * conexão principal resumida em linguagem de gente.
 *
 * Cadência: rápida (6 s) enquanto há motivo para olhar — lista vazia, modal
 * do QR aberto, sessão fora do ar —, lenta (30 s) quando tudo está bem. É o
 * heartbeat da VPS (20 s) que manda; ler mais rápido que isso só repetiria a
 * mesma resposta.
 */
export const CADENCIA_RAPIDA_MS = 6000;
export const CADENCIA_LENTA_MS = 30000;

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
  const precisaOlhar = atento || !conexao || (resumo && resumo.fase !== "conectado");

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

  useEffect(() => {
    if (!organizationId) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") ler();
    }, precisaOlhar ? CADENCIA_RAPIDA_MS : CADENCIA_LENTA_MS);
    return () => clearInterval(id);
  }, [organizationId, precisaOlhar, ler]);

  return { conexao, resumo, carregado, recarregar: ler };
}
