import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { api } from "../../../data/client";
import { fotoPersistidaDoContato } from "../../../lib/contatoTecnico";
import { Iniciais } from "../../ui";
import { ROTULOS_DA_SITUACAO, SITUACOES, situacaoDaConversa } from "./conversaDoLead";

/**
 * A foto do lead: a que a equipe salvou no CRM, senão a do WhatsApp dele,
 * senão as iniciais. Foto que não carrega (link do WhatsApp expira) cai para
 * as iniciais em vez de mostrar imagem quebrada.
 */
export function AvatarDoLead({ contato, conversa, tamanho = 36 }) {
  const foto = fotoPersistidaDoContato(contato) || conversa?.fotoUrl || null;
  const [visivel, setVisivel] = useState(Boolean(foto));
  useEffect(() => setVisivel(Boolean(foto)), [foto]);

  if (foto && visivel) {
    return (
      <img
        src={foto}
        alt=""
        onError={() => setVisivel(false)}
        className="flex-none rounded-full object-cover"
        style={{ width: tamanho, height: tamanho }}
      />
    );
  }
  return <Iniciais nome={contato?.nome || conversa?.nome || ""} tamanho={tamanho} />;
}

const TOM = {
  [SITUACOES.respondeu]: "bg-success-soft text-success",
  [SITUACOES.aguardando]: "bg-accent-soft text-accent-forte",
  [SITUACOES.semConversa]: "bg-surface text-sub",
};

/** "Respondeu · 14:32", com a prévia da última mensagem no título. */
export function SituacaoDaConversa({ conversa }) {
  const situacao = situacaoDaConversa(conversa);
  return (
    <span className="flex min-w-0 items-center gap-2" title={conversa?.previa || undefined}>
      <span className={`flex-none rounded-full px-2 py-0.5 text-[11.5px] font-medium ${TOM[situacao]}`}>
        {ROTULOS_DA_SITUACAO[situacao]}
      </span>
      {situacao !== SITUACOES.semConversa && conversa?.hora && (
        <span className="flex-none text-[12.5px] text-sub">{conversa.hora}</span>
      )}
    </span>
  );
}

/** Quantas mensagens o resumo da ficha mostra. O resto fica no chat. */
const MENSAGENS_NO_RESUMO = 6;

/**
 * O fim da conversa, em miniatura, dentro da ficha.
 *
 * Só leitura, de propósito: responder é no chat, onde está a caixa de texto,
 * o anexo e o dono da conversa. Aqui a pergunta é "em que pé está?".
 */
export function ResumoDaConversa({ conversa, aoAbrirConversa, podeComecar }) {
  const [mensagens, setMensagens] = useState(null);
  const [erro, setErro] = useState(false);
  const id = conversa?.id || null;

  useEffect(() => {
    if (!id) return undefined;
    let vivo = true;
    setMensagens(null);
    setErro(false);
    api.conversas
      .mensagens({ id })
      .then((lista) => {
        if (!vivo) return;
        const soMensagens = (lista || []).filter((item) => item.tipo === "mensagem");
        setMensagens(soMensagens.slice(-MENSAGENS_NO_RESUMO));
      })
      .catch(() => vivo && setErro(true));
    return () => {
      vivo = false;
    };
  }, [id]);

  if (!conversa) {
    return (
      <div className="rounded-[10px] border border-dashed border-line px-4 py-4 text-center">
        <p className="text-[12.5px] text-sub">Ainda não há conversa no WhatsApp com este lead.</p>
        {podeComecar && (
          <button
            type="button"
            onClick={aoAbrirConversa}
            className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-[8px] bg-accent px-3 py-2 text-[12px] font-semibold text-white hover:brightness-110"
          >
            <MessageCircle size={14} />
            Começar conversa
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-[10px] border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <SituacaoDaConversa conversa={conversa} />
      </div>
      <div className="grid gap-1.5 px-3 py-3">
        {erro && <p className="text-[12px] text-faint">Não deu para carregar as mensagens agora.</p>}
        {!erro && mensagens === null && <p className="text-[12px] text-faint">Carregando mensagens…</p>}
        {!erro && mensagens?.length === 0 && (
          <p className="text-[12px] text-faint">{conversa.previa || "Nenhuma mensagem espelhada ainda."}</p>
        )}
        {mensagens?.map((mensagem) => (
          <div
            key={mensagem.messageId || `${mensagem.enviadaEm}-${mensagem.direcao}`}
            className={`flex ${mensagem.direcao === "sai" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-[10px] px-2.5 py-1.5 text-[12px] leading-[16px] ${
                mensagem.direcao === "sai" ? "bg-accent-soft text-fg" : "bg-bg text-fg"
              }`}
            >
              <p className="whitespace-pre-wrap break-words">
                {mensagem.texto || (mensagem.midia ? rotuloDaMidia(mensagem.midia) : "")}
              </p>
              <p className="mt-0.5 text-right text-[10px] text-faint">{mensagem.hora}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-line px-3 py-2">
        <button
          type="button"
          onClick={aoAbrirConversa}
          className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-[8px] bg-accent px-3 py-2 text-[12px] font-semibold text-white hover:brightness-110"
        >
          <MessageCircle size={14} />
          Abrir no chat
        </button>
      </div>
    </div>
  );
}

function rotuloDaMidia(midia) {
  const tipo = String(midia?.tipo || midia?.type || "").toLowerCase();
  if (tipo.includes("audio")) return "🎤 Áudio";
  if (tipo.includes("imag")) return "📷 Imagem";
  return "📎 Arquivo";
}
