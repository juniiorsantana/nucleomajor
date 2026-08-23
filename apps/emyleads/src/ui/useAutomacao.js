import { useCallback, useEffect, useState } from "react";
import { api } from "../data/client";

/**
 * Estado do kill switch das respostas automáticas.
 *
 * Fica em `ui/` porque as duas superfícies leem o mesmo freio: o painel dentro
 * do WhatsApp e a Gestão. `page/` não importa de `content/` — essa fronteira é
 * o que mantém a Gestão viva fora da aba do WhatsApp.
 *
 * `undefined` enquanto lê: a faixa não pinta nada antes de saber. Piscar
 * "ativo" por um instante numa automação pausada seria pior que não mostrar
 * nada — é justamente o momento em que o atendente está conferindo se o freio
 * pegou.
 */
export function useAutomacao() {
  const [estado, setEstado] = useState(undefined);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setEstado(await api.automacao.estado());
    } catch (err) {
      console.warn("[EmyLeads] falha ao ler o estado da automação:", err);
      setEstado(null);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Pausar pela Gestão, em outra aba, não avisa esta. Revalidar quando o
  // atendente volta ao WhatsApp evita a faixa mentir sobre o estado do bot.
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

  const definirPausa = useCallback(
    async (pausada) => {
      setSalvando(true);
      // Otimista: o botão do freio precisa responder na hora. Se a gravação
      // falhar, o carregar() abaixo devolve a faixa ao estado real.
      setEstado((atual) => ({ ...atual, pausada }));
      try {
        setEstado(await api.automacao.pausar({ pausada }));
      } catch (err) {
        console.error("[EmyLeads] falha ao mudar a pausa da automação:", err);
        await carregar();
      } finally {
        setSalvando(false);
      }
    },
    [carregar]
  );

  return { estado, salvando, definirPausa, recarregar: carregar };
}
