import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { renderizar } from "../lib/template";
import { Botao } from "../ui/componentes";
import { escreverNoComposer } from "../wa/composer";
import { api } from "../data/client";

/**
 * As sugestões chegam por prop, e não de um `useSugestoes` próprio: a faixa de
 * automação precisa da MESMA lista para saber qual bot está armado. Duas
 * chamadas de `chatbots.avaliar` poderiam divergir entre si e mostrar uma
 * coisa em cima e outra embaixo.
 */
export function FaixaSugestao({ contato, contactId, sugestoes, recarregarSugestoes, recarregar }) {
  const [dispensadas, setDispensadas] = useState(() => new Set());
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    setDispensadas(new Set());
    setErro("");
  }, [contactId]);

  const pendente = (sugestoes || []).find((s) => !dispensadas.has(s.chatbotId));
  if (!pendente) return null;

  const inserir = async () => {
    if (processando) return;
    setProcessando(true);
    setErro("");
    try {
      const preparacao = await api.chatbots.preparar({
        contactId,
        chatbotId: pendente.chatbotId,
      });
      if (!preparacao) return;

      if (preparacao.mensagem) {
        const inseriu = escreverNoComposer(renderizar(preparacao.mensagem, contato));
        if (!inseriu) {
          setErro("Abra uma conversa para preparar a mensagem.");
          return;
        }
      }

      await api.chatbots.executar({
        contactId,
        chatbotId: pendente.chatbotId,
        preparacao,
      });
      setDispensadas((atual) => new Set(atual).add(pendente.chatbotId));
      // `recarregar` do painel já reavalia as sugestões junto com a ficha.
      await recarregar?.();
    } catch (err) {
      if (err?.codigo === "chatbot-nao-se-aplica") {
        setDispensadas((atual) => new Set(atual).add(pendente.chatbotId));
      } else if (err?.codigo === "chatbot-preparacao-obsoleta") {
        setErro("A sugestão mudou. Prepare-a novamente.");
        await recarregarSugestoes();
      } else {
        setErro(err?.message || "Não foi possível executar o chatbot.");
      }
    } finally {
      setProcessando(false);
    }
  };

  const dispensar = () => {
    setDispensadas((atual) => new Set(atual).add(pendente.chatbotId));
    setErro("");
  };

  return (
    <div className="flex flex-none items-center gap-2 border-b border-line bg-accent/5 px-3 py-1.5 text-[11.5px]">
      <span className="min-w-0 flex-1 truncate text-fg">
        <span className="font-medium text-accent">{pendente.nome}</span>
        <span className="text-sub"> — sugestão de resposta</span>
        {erro && <span className="ml-2 text-danger">{erro}</span>}
      </span>
      <Botao variante="primario" className="flex-none" onClick={inserir} disabled={processando}>
        {pendente.etiquetas?.length ? "Executar" : "Inserir no WhatsApp"}
      </Botao>
      <button
        title="Dispensar sugestão"
        onClick={dispensar}
        className="flex-none cursor-pointer rounded-el p-1 text-sub transition-colors hover:bg-surface-hover hover:text-fg"
      >
        <X size={13} strokeWidth={1.75} />
      </button>
    </div>
  );
}
