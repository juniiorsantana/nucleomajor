import { Handle, Position } from "@xyflow/react";
import { GitBranch, MessageSquareText, Radio, Share2, Tags } from "lucide-react";

function Porta({ tipo }) {
  const entrada = tipo === "target";
  return (
    <>
      <Handle
        type={tipo}
        position={entrada ? Position.Left : Position.Right}
        id={entrada ? "entrada" : "saida"}
        className={`flow-port ${entrada ? "flow-port--in" : "flow-port--out"}`}
      />
      <span className={`flow-port-label ${entrada ? "flow-port-label--in" : "flow-port-label--out"}`}>
        {entrada ? "entrada" : "saída"}
      </span>
    </>
  );
}

function CabecalhoNo({ icone: Icone, categoria, indice, tom }) {
  return (
    <div className="flow-node__header">
      <span className={`flow-node__icon flow-node__icon--${tom}`}>
        <Icone size={15} strokeWidth={1.9} />
      </span>
      <span className="flow-node__category">{categoria}</span>
      {indice != null && <span className="flow-node__index">{String(indice + 1).padStart(2, "0")}</span>}
    </div>
  );
}

export function NoEntrada({ data, selected }) {
  return (
    <article className={`flow-node flow-node--entrada ${selected ? "is-selected" : ""}`}>
      <CabecalhoNo icone={Radio} categoria="Disparo" tom="entrada" />
      <div className="flow-node__body">
        <strong>Nova mensagem</strong>
        <p>Contato conhecido escreve no WhatsApp</p>
        <span className={`flow-node__status ${data.ativo ? "is-active" : ""}`}>
          <i /> {data.ativo ? "Fluxo ativo" : "Fluxo pausado"}
        </span>
      </div>
      <Porta tipo="source" />
    </article>
  );
}

export function NoCondicoes({ data, selected }) {
  return (
    <article className={`flow-node flow-node--condicoes ${selected ? "is-selected" : ""}`}>
      <Porta tipo="target" />
      <CabecalhoNo icone={GitBranch} categoria="Filtro" tom="condicao" />
      <div className="flow-node__body">
        <strong>Condições</strong>
        <p>{data.quantidade ? `${data.quantidade} regra${data.quantidade === 1 ? "" : "s"} · todas devem atender` : "Nenhuma regra configurada"}</p>
        <div className="flow-node__chips">
          {(data.resumos || []).slice(0, 2).map((resumo) => <span key={resumo}>{resumo}</span>)}
          {(data.resumos || []).length > 2 && <span>+{data.resumos.length - 2}</span>}
        </div>
      </div>
      <Porta tipo="source" />
    </article>
  );
}

const APARENCIA = {
  enviar_mensagem: { icone: MessageSquareText, categoria: "Mensagem", tom: "mensagem", titulo: "Enviar mensagem" },
  editar_etiquetas: { icone: Tags, categoria: "Contato", tom: "etiqueta", titulo: "Editar etiquetas" },
  transferir: { icone: Share2, categoria: "Transferência", tom: "transferencia", titulo: "Transferir conversa" },
};

export function NoAcao({ data, selected }) {
  const { icone, categoria, tom, titulo } = APARENCIA[data.tipo] || APARENCIA.editar_etiquetas;
  const mensagem = data.tipo === "enviar_mensagem";
  const transferencia = data.tipo === "transferir";
  return (
    <article className={`flow-node flow-node--acao flow-node--${tom} ${selected ? "is-selected" : ""}`}>
      <Porta tipo="target" />
      <CabecalhoNo icone={icone} categoria={categoria} indice={data.indice} tom={tom} />
      <div className="flow-node__body">
        <strong>{titulo}</strong>
        <p className={mensagem ? "flow-node__preview" : ""}>{data.resumo}</p>
        {/* Transferência é terminal: o aviso de "não executado" mentiria, porque
            ela É executada — depois do envio, e encerrando o fluxo. */}
        {data.alerta && !transferencia && (
          <span className="flow-node__warning">Não executado após a 1ª mensagem</span>
        )}
      </div>
      {/* Sem porta de saída: depois de entregar a conversa, quem continua é o
          novo dono. Um bloco ligado aqui embaixo nunca rodaria. */}
      {!transferencia && <Porta tipo="source" />}
    </article>
  );
}

export const tiposDeNo = {
  entrada: NoEntrada,
  condicoes: NoCondicoes,
  acao: NoAcao,
};
