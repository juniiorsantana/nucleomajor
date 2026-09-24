import { Handle, Position } from "@xyflow/react";
import { CircleStop, Hourglass, ListChecks, MessageSquareText, Plus, Radio, Share2, Split, Tags, TextCursorInput } from "lucide-react";
import { ROTULOS_SAIDA } from "../../domain/chatbots";

/**
 * Os cartões do mapa.
 *
 * Os rótulos flutuantes "entrada" e "saída" saíram (protótipo de 07/09): quem
 * tem mais de um caminho lista as saídas DENTRO do cartão, com a porta
 * alinhada à linha, e o rótulo passa a ser a própria saída. A porta de cada
 * saída tem o id da saída (`padrao`, `sim`, `sucesso`…), que é o que a
 * conexão grava — o desenho e o dado usam o mesmo nome.
 */

function PortaEntrada() {
  return <Handle type="target" position={Position.Left} id="entrada" className="flow-port flow-port--in" />;
}

/** O `+` de uma saída livre: abre o seletor ali e o bloco nasce ligado. */
function BotaoMais({ saida, aoPedirBloco }) {
  if (!aoPedirBloco) return null;
  return (
    <button
      type="button"
      className="flow-port-mais nodrag nopan"
      title="Adicionar um bloco nesta saída"
      aria-label={`Adicionar um bloco na saída ${ROTULOS_SAIDA[saida] || saida}`}
      onClick={(event) => {
        event.stopPropagation();
        aoPedirBloco(saida, event);
      }}
    >
      <Plus size={12} strokeWidth={2.4} />
    </button>
  );
}

/** Uma saída só: a porta fica na borda direita, como sempre foi. */
function SaidaUnica({ saida = "padrao", livre, aoPedirBloco }) {
  return (
    <div className="flow-port-grupo">
      <Handle type="source" position={Position.Right} id={saida} className="flow-port flow-port--out" />
      {livre && <BotaoMais saida={saida} aoPedirBloco={aoPedirBloco} />}
    </div>
  );
}

/** Várias saídas: uma linha por caminho, e a porta alinhada à linha. */
function SaidasNomeadas({ saidas, rotulos = {}, aoPedirBloco }) {
  return (
    <div className="flow-node__saidas">
      {saidas.map(({ nome, livre }) => (
        <div key={nome} className={`flow-saida flow-saida--${nome}`}>
          {/* A opção de uma pergunta tem id próprio; o nome dela vem do bloco. */}
          <span className="flow-saida__rotulo">{rotulos[nome] || ROTULOS_SAIDA[nome] || nome}</span>
          <div className="flow-port-grupo flow-port-grupo--linha">
            <Handle type="source" position={Position.Right} id={nome} className="flow-port flow-port--out" />
            {livre && <BotaoMais saida={nome} aoPedirBloco={aoPedirBloco} />}
          </div>
        </div>
      ))}
    </div>
  );
}

function CabecalhoNo({ icone: Icone, categoria, indice, tom }) {
  return (
    <div className="flow-node__header">
      <span className={`flow-node__icon flow-node__icon--${tom}`}>
        <Icone size={15} strokeWidth={1.9} />
      </span>
      <span className="flow-node__category">{categoria}</span>
      {indice != null && indice >= 0 && <span className="flow-node__index">{String(indice + 1).padStart(2, "0")}</span>}
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
      <SaidaUnica livre={false} />
    </article>
  );
}

/**
 * O início do fluxo: um cartão só (Etapa 7).
 *
 * "Disparo" e "Filtro" eram dois cartões fixos que todo fluxo novo trazia. No
 * dado os dois nós continuam (`entrada` → `condicoes`, é o que o banco
 * valida), mas o mapa mostra um cartão: o gatilho de verdade no título e as
 * condições embaixo — só quando o gatilho é uma mensagem, porque os outros
 * começam o fluxo sem conferir condição.
 */
export function NoCondicoes({ data, selected }) {
  const comMensagem = data.comMensagem !== false;
  return (
    <article className={`flow-node flow-node--condicoes flow-node--inicio ${selected ? "is-selected" : ""}`}>
      <CabecalhoNo icone={Radio} categoria="Início" tom="entrada" />
      <div className="flow-node__body">
        <strong>{data.gatilho || "Nova mensagem"}</strong>
        {comMensagem ? (
          <>
            <p>{data.quantidade ? `${data.quantidade} condiç${data.quantidade === 1 ? "ão" : "ões"} · todas devem atender` : "Sem condições"}</p>
            <div className="flow-node__chips">
              {(data.resumos || []).slice(0, 2).map((resumo) => <span key={resumo}>{resumo}</span>)}
              {(data.resumos || []).length > 2 && <span>+{data.resumos.length - 2}</span>}
            </div>
          </>
        ) : (
          <p>Começa direto, sem conferir condições</p>
        )}
        <span className={`flow-node__status ${data.ativo ? "is-active" : ""}`}>
          <i /> {data.ativo ? "Fluxo ativo" : "Fluxo pausado"}
        </span>
      </div>
      <SaidaUnica livre={data.livres?.includes("padrao")} aoPedirBloco={data.aoPedirBloco} />
    </article>
  );
}

const APARENCIA = {
  enviar_mensagem: { icone: MessageSquareText, categoria: "Mensagem", tom: "mensagem", titulo: "Enviar mensagem" },
  editar_etiquetas: { icone: Tags, categoria: "Contato", tom: "etiqueta", titulo: "Editar etiquetas" },
  transferir: { icone: Share2, categoria: "Transferência", tom: "transferencia", titulo: "Transferir conversa" },
  condicao: { icone: Split, categoria: "Decisão", tom: "condicao", titulo: "Condição" },
  encerrar: { icone: CircleStop, categoria: "Fim", tom: "encerrar", titulo: "Encerrar" },
  perguntar: { icone: ListChecks, categoria: "Pergunta", tom: "pergunta", titulo: "Pedir para escolher" },
  coletar: { icone: TextCursorInput, categoria: "Pergunta", tom: "pergunta", titulo: "Pedir para digitar" },
  aguardar: { icone: Hourglass, categoria: "Espera", tom: "espera", titulo: "Aguardar" },
};

export function NoAcao({ data, selected }) {
  const { icone, categoria, tom, titulo } = APARENCIA[data.tipo] || APARENCIA.editar_etiquetas;
  const mensagem = data.tipo === "enviar_mensagem";
  const saidas = data.saidas || [];
  const livres = new Set(data.livres || []);
  return (
    <article className={`flow-node flow-node--acao flow-node--${tom} ${selected ? "is-selected" : ""}`}>
      <PortaEntrada />
      <CabecalhoNo icone={icone} categoria={categoria} indice={data.indice} tom={tom} />
      <div className="flow-node__body">
        <strong>{titulo}</strong>
        <p className={mensagem ? "flow-node__preview" : ""}>{data.resumo}</p>
        {/* Só no v2: lá o executor para na primeira mensagem. No v3 cada
            bloco roda na sua vez, e o aviso mentiria. */}
        {data.alerta && <span className="flow-node__warning">Não executado após a 1ª mensagem</span>}
        {saidas.length > 1 && (
          <SaidasNomeadas
            saidas={saidas.map((nome) => ({ nome, livre: livres.has(nome) }))}
            rotulos={data.rotulos}
            aoPedirBloco={data.aoPedirBloco}
          />
        )}
        {/* Sem saída: depois de encerrar ou de entregar a uma pessoa, quem
            continua é outro. Um bloco ligado aqui nunca rodaria. */}
        {!saidas.length && <span className="flow-node__fim"><CircleStop size={11} /> Fim do fluxo</span>}
      </div>
      {saidas.length === 1 && (
        <SaidaUnica saida={saidas[0]} livre={livres.has(saidas[0])} aoPedirBloco={data.aoPedirBloco} />
      )}
    </article>
  );
}

export const tiposDeNo = {
  entrada: NoEntrada,
  condicoes: NoCondicoes,
  acao: NoAcao,
};
