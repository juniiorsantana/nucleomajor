import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../data/client";

/**
 * Pede o pareamento e lê o QR enquanto o modal estiver aberto.
 *
 * As mesmas regras que a tela de Conexões aprendeu na dor, em 10/09/2026:
 *
 * - o código do WhatsApp gira a cada ~20 s e a janela dura ~2 min; ler a cada
 *   15 s mostra sempre um código válido. Numa conexão remota cada leitura é
 *   um comando que atravessa o Supabase e volta — ler mais rápido estourou o
 *   teto do pareamento em dezessete minutos;
 * - uma leitura por vez (a trava é o que impede o teto de fechar);
 * - depois de uma recusa, um minuto de pausa; o clique de gente ignora a
 *   pausa, porque pedir de novo é decisão de quem está com o celular na mão.
 */
export const ESPERA_DO_QR_MS = 15000;
export const PAUSA_APOS_RECUSA_MS = 60000;

export function usePareamento({ organizationId, conexao, aberto }) {
  // { imageData, status } quando há código; { erro } quando não veio; null antes de tudo.
  const [qr, setQr] = useState(null);
  const [pedindo, setPedindo] = useState(false);
  const lendoRef = useRef(false);
  const pausaRef = useRef(0);

  const ler = useCallback(
    async (forcar = false) => {
      if (!organizationId || !conexao || lendoRef.current) return;
      if (!forcar && Date.now() < pausaRef.current) return;
      lendoRef.current = true;
      try {
        const lido = await api.gateway.qr({
          organizationId,
          connectionId: conexao.connectionId,
          remoto: conexao.remoteManaged,
        });
        setQr(lido || { erro: "" });
        pausaRef.current = 0;
      } catch (e) {
        setQr({ erro: e?.message || "Não foi possível ler o QR." });
        pausaRef.current = Date.now() + PAUSA_APOS_RECUSA_MS;
      } finally {
        lendoRef.current = false;
      }
    },
    [organizationId, conexao]
  );

  const pedir = useCallback(async () => {
    if (!organizationId || !conexao) return;
    setPedindo(true);
    setQr(null);
    try {
      await api.gateway.parear({
        organizationId,
        connectionId: conexao.connectionId,
        remoto: conexao.remoteManaged,
      });
      // Sem esperar o heartbeat: quem clicou quer o código agora, e o estado
      // da VPS leva até 20 s para dizer "estou em pareamento".
      await ler(true);
    } catch (e) {
      setQr({ erro: e?.message || "Não foi possível iniciar a conexão." });
    } finally {
      setPedindo(false);
    }
  }, [organizationId, conexao, ler]);

  useEffect(() => {
    if (!aberto || !organizationId || !conexao) return undefined;
    let ativo = true;
    const id = setInterval(() => {
      if (ativo && document.visibilityState === "visible") ler();
    }, ESPERA_DO_QR_MS);
    return () => {
      ativo = false;
      clearInterval(id);
    };
  }, [aberto, organizationId, conexao, ler]);

  useEffect(() => {
    if (!aberto) setQr(null);
  }, [aberto]);

  return { qr, pedindo, pedir, ler };
}
