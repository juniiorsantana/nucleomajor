import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../data/client";
import { observarConversa } from "../wa/conversa";

/**
 * A conversa aberta no WhatsApp e o contato da base que corresponde a ela.
 *
 * É o hook central do painel: tudo que se vê à direita depende de responder
 * "quem é essa pessoa" — e essa pergunta tem duas partes que falham por
 * motivos diferentes. `conversa` vem do WhatsApp e pode estar degradada;
 * `contato` vem da nossa base e pode simplesmente não existir ainda.
 *
 * Por isso os três estados são distintos e nenhum deles é "erro":
 *   conversa === undefined → ainda descobrindo
 *   conversa === null      → nenhuma conversa aberta
 *   contato  === null      → conversa aberta, mas fora da base
 */
export function useConversaAtiva() {
  const [conversa, setConversa] = useState(undefined);
  const [contato, setContato] = useState(undefined);
  const versao = useRef(0);

  useEffect(() => observarConversa(setConversa), []);

  // No modo degradado pode não existir nem waId nem telefone. O nome ainda é
  // o último recurso de resolução; portanto ele também precisa participar da
  // chave, senão trocar entre duas conversas anônimas mantém a ficha anterior.
  const chave = conversa
    ? JSON.stringify({
        waId: conversa.waId || "",
        telefone: conversa.telefone || "",
        nome: conversa.nome || "",
        grupo: !!conversa.grupo,
        degradado: !!conversa.degradado,
      })
    : "";

  const resolver = useCallback(async () => {
    if (conversa === undefined) return;

    // Grupo não tem ficha de contato — e forçar um contato para um grupo
    // criaria um registro que nunca casa com pessoa nenhuma.
    if (!conversa || conversa.grupo) {
      setContato(null);
      return;
    }

    const minha = ++versao.current;
    try {
      const achado = await api.contatos.resolver({
        waId: conversa.waId,
        telefone: conversa.telefone,
        // O nome só vai como último recurso, e só quando não há identidade
        // melhor — casar por nome é palpite, e no caminho bom nunca é preciso.
        nome: conversa.degradado ? conversa.nome : null,
      });
      // Trocar de conversa rápido dispara resoluções concorrentes; só a mais
      // recente pode escrever, senão a ficha exibe o contato anterior.
      if (versao.current === minha) setContato(achado);
    } catch (err) {
      console.warn("[EmyLeads] falha ao resolver o contato:", err);
      if (versao.current === minha) setContato(null);
    }
  }, [conversa, chave]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setContato(undefined);
    resolver();
  }, [chave, conversa === undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  return { conversa, contato, recarregar: resolver };
}
