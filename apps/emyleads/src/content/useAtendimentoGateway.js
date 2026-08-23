import { useCallback, useEffect, useState } from "react";
import { api } from "../data/client";

/**
 * Quem é o dono do atendimento da conversa aberta — segundo o gateway.
 *
 * É outra coisa que a pausa dos chatbots do CRM: aquela vale só nesta máquina
 * e só para as regras do EmyLeads; esta decide, no serviço que roda sempre, se
 * quem responde é o robô, o agente de IA ou ninguém (porque alguém assumiu).
 *
 * `undefined` enquanto lê e `null` quando não dá para saber — gateway offline,
 * máquina não vinculada, nenhuma conexão correspondente. Nesses casos a faixa
 * não mostra nada: este não é o freio de mão principal, e um erro aqui não
 * pode competir com o controle que o atendente usa quando está com pressa.
 */
export function useAtendimentoGateway(contato) {
  const [status, setStatus] = useState(undefined);
  const [membros, setMembros] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const telefone = contato?.telefone || "";

  const carregar = useCallback(async () => {
    if (!telefone) return setStatus(null);
    try {
      const sessaoWeb = await api.config.ler({ chave: "sessaoWeb.operador" });
      const organizationId = (await api.auth.estado())?.organizacaoAtual?.id;
      if (!organizationId) return setStatus(null);

      const [atual, equipe] = await Promise.all([
        api.gateway.statusConversaAtual({
          organizationId,
          contato: telefone,
          conexaoLast4: sessaoWeb?.last4 || null,
        }),
        api.organizacoes.membros(),
      ]);
      setStatus(atual);
      setMembros((equipe || []).filter((item) => item?.status !== "removed"));
    } catch {
      setStatus(null);
      setMembros([]);
    }
  }, [telefone]);

  useEffect(() => {
    setStatus(undefined);
    carregar();
  }, [carregar]);

  /**
   * Reusa `transferirConversa`, que é o mesmo endpoint com o mesmo efeito. O
   * motivo distingue a ação do atendente de uma transferência disparada pelo
   * fluxo — os dois acabam no campo `reason` da sessão, e só o texto separa.
   */
  const definirDono = useCallback(
    async (dono, agente = null) => {
      if (!telefone || salvando) return;
      setSalvando(true);
      try {
        const sessaoWeb = await api.config.ler({ chave: "sessaoWeb.operador" });
        const sessao = await api.auth.estado();
        const organizationId = sessao?.organizacaoAtual?.id;
        await api.gateway.transferirConversa({
          organizationId,
          conexaoLast4: sessaoWeb?.last4 || null,
          contato: telefone,
          destino: dono,
          motivo: "Definido pelo atendente no WhatsApp",
          // Quem clicou. Sem isto, "humano" era um booleano anônimo: dois
          // atendentes podiam pegar a mesma conversa e nada saberia dizer que
          // eram dois.
          atendente: { id: sessao?.usuario?.id, nome: sessao?.usuario?.nome || sessao?.usuario?.email },
          agente: dono === "ia" && agente ? { id: agente.id, nome: agente.nome } : null,
        });
        await carregar();
      } catch (err) {
        console.warn("[EmyLeads] falha ao trocar o dono do atendimento:", err);
        await carregar();
      } finally {
        setSalvando(false);
      }
    },
    [telefone, salvando, carregar]
  );

  return { status, membros, salvando, definirDono };
}
