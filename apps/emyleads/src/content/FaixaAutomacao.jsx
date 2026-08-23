import { useState } from "react";
import { Bot, BotOff, Headset, Pause, Play } from "lucide-react";
import { api } from "../data/client";
import { fmtRelativo } from "../lib/formato";
import { textoDoAtendimento, textoDoDono } from "../ui/atendimento";
import { Botao } from "../ui/componentes";
import { useAutomacao } from "../ui/useAutomacao";
import { textoDoMotivo } from "../ui/useDiario";
import { useAtendimentoGateway } from "./useAtendimentoGateway";

/**
 * Quem é o dono desta conversa no gateway, e o botão para mudar isso.
 *
 * Linha separada, com ícone próprio, de propósito: o freio acima é a pausa dos
 * chatbots do CRM nesta máquina; isto aqui é o atendimento no serviço que roda
 * sempre. Foi a confusão entre os dois que fez um contato receber duas
 * respostas para a mesma mensagem — desenhá-los como o mesmo controle seria
 * convidar o erro de volta.
 */
function LinhaAtendimento({ contato }) {
  const { status, membros, salvando, definirDono } = useAtendimentoGateway(contato);

  // Sem gateway, sem conexão correspondente ou ainda lendo: não desenha nada.
  // Um erro aqui não pode roubar espaço do freio de mão.
  if (!status) return null;

  const dono = status.sessao?.owner || status.donoPadrao;
  if (!dono) return null;

  const assumido = dono === "humano";
  const agenteAtual = status.sessao?.agentId || membros[0]?.user_id || "";
  const agenteSelecionado = membros.find((item) => item.user_id === agenteAtual) || membros[0] || null;
  const nomeDoMembro = (item) => item?.profile?.full_name || item?.profile?.email || item?.user_id || "Profissional";

  return (
    <div className="flex items-center gap-2 pl-[21px] text-[10.5px]">
      <Headset size={11} strokeWidth={1.75} className="-ml-[15px] flex-none text-faint" />
      <span className="min-w-0 flex-1 truncate text-faint">
        Atendimento:{" "}
        <span className="font-medium text-sub">
          {status.sessao ? textoDoAtendimento(status.sessao) : textoDoDono(dono)}
        </span>
        {!status.sessao && " (padrão da conexão)"}
      </span>
      {!assumido && membros.length > 0 && (
        <select
          aria-label="Profissional da IA"
          value={agenteAtual}
          onChange={(event) => {
            const membro = membros.find((item) => item.user_id === event.target.value);
            if (membro) definirDono("ia", { id: membro.user_id, nome: nomeDoMembro(membro) });
          }}
          disabled={salvando}
          className="max-w-[130px] cursor-pointer rounded-el border border-line bg-bg px-1.5 py-0.5 text-[10.5px] text-sub disabled:opacity-40"
        >
          {membros.map((membro) => (
            <option key={membro.user_id} value={membro.user_id}>
              {nomeDoMembro(membro)}
            </option>
          ))}
        </select>
      )}
      <button
        title={
          assumido
            ? "Devolver esta conversa para as regras do CRM"
            : "Assumir esta conversa: nenhum automatismo responde até você devolver"
        }
        onClick={() => {
          if (assumido) return definirDono("bot");
          if (agenteSelecionado) return definirDono("ia", { id: agenteSelecionado.user_id, nome: nomeDoMembro(agenteSelecionado) });
          return definirDono("humano");
        }}
        disabled={salvando}
        className="flex-none cursor-pointer rounded-el px-1.5 py-0.5 text-[10.5px] font-medium text-sub transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-40"
      >
        {assumido ? "Devolver ao robô" : agenteSelecionado ? "Enviar à IA" : "Assumir"}
      </button>
    </div>
  );
}

/**
 * A faixa de controle do bot — o freio de mão do atendente.
 *
 * Fica no topo da ficha, acima de tudo, porque ao abrir uma conversa "o bot
 * vai responder isso?" é tão urgente quanto "quem é essa pessoa?".
 *
 * Aparece SEMPRE, inclusive quando está tudo normal. Uma faixa que só surge
 * no problema não ensina onde procurar quando o problema aparece — e o
 * atendente que precisa parar um bot está justamente com pressa.
 *
 * Dois níveis, de propósito:
 *   · pausar tudo — vale para todas as conversas, pega na hora, é reversível;
 *   · parar este bot — desativa só o bot armado nesta conversa e sincroniza,
 *     porque um bot que responde besteira responde besteira para todo mundo.
 */
export function FaixaAutomacao({ sugestoes, ultimaDoContato, recarregarSugestoes, contato }) {
  const { estado, salvando, definirPausa } = useAutomacao();
  const [parando, setParando] = useState(false);
  const [erro, setErro] = useState("");

  if (estado === undefined) return null;

  const pausada = !!estado?.pausada;
  // O provider arma o PRIMEIRO chatbot aplicável, na mesma ordem que a
  // avaliação usa. Então a cabeça da lista é literalmente quem responderia.
  const armado = pausada ? null : (sugestoes || [])[0] || null;

  const pararEsteBot = async () => {
    if (!armado || parando) return;
    setParando(true);
    setErro("");
    try {
      await api.chatbots.atualizar({ id: armado.chatbotId, patch: { ativo: false } });
      await recarregarSugestoes?.();
    } catch (err) {
      setErro(err?.message || "Não foi possível parar o bot.");
    } finally {
      setParando(false);
    }
  };

  if (pausada) {
    return (
      <div className="flex flex-none flex-col gap-0.5 border-b border-line bg-danger/10 px-3 py-1.5 text-[11.5px]">
        <div className="flex items-center gap-2">
          <BotOff size={13} strokeWidth={1.75} className="flex-none text-danger" />
          <span className="min-w-0 flex-1 truncate font-medium text-danger">
            Respostas automáticas pausadas
          </span>
          <Botao
            variante="primario"
            className="flex flex-none items-center gap-1"
            onClick={() => definirPausa(false)}
            disabled={salvando}
          >
            <Play size={11} strokeWidth={2.25} />
            Retomar
          </Botao>
        </div>
        {/* A pausa é dos chatbots desta máquina. O agente de IA responde pelo
            gateway e não é alcançado por ela — esconder o dono aqui faria
            parecer que "pausado" cala tudo. */}
        <LinhaAtendimento contato={contato} />
      </div>
    );
  }

  return (
    <div className="flex flex-none flex-col gap-0.5 border-b border-line bg-bg px-3 py-1.5 text-[11.5px]">
      <div className="flex items-center gap-2">
        <Bot size={13} strokeWidth={1.75} className="flex-none text-sub" />
        <span className="min-w-0 flex-1 truncate">
          {armado ? (
            <>
              <span className="text-sub">Responde automático: </span>
              <span className="font-medium text-fg">{armado.nome}</span>
            </>
          ) : (
            <span className="text-faint">Nenhum bot armado para este contato</span>
          )}
          {erro && <span className="ml-2 text-danger">{erro}</span>}
        </span>
        {armado && (
          <button
            title={`Desativar “${armado.nome}” em todas as conversas`}
            onClick={pararEsteBot}
            disabled={parando}
            className="flex-none cursor-pointer rounded-el px-1.5 py-1 text-[11px] text-sub transition-colors hover:bg-surface-hover hover:text-danger disabled:opacity-40"
          >
            Parar este bot
          </button>
        )}
        <button
          title="Pausar todas as respostas automáticas nesta máquina"
          onClick={() => definirPausa(true)}
          disabled={salvando}
          className="flex flex-none cursor-pointer items-center gap-1 rounded-el border border-line px-1.5 py-1 text-[11px] font-medium text-sub transition-colors hover:border-danger/50 hover:text-danger disabled:opacity-40"
        >
          <Pause size={11} strokeWidth={2.25} />
          Pausar
        </button>
      </div>

      {/* A última decisão tomada para ESTA conversa. É o que responde
          "por que não respondeu?" sem sair do WhatsApp e sem abrir o console. */}
      {ultimaDoContato && (
        <p
          className={`truncate pl-[21px] text-[10.5px] ${
            ultimaDoContato.resultado === "erro" ? "text-danger" : "text-faint"
          }`}
          title={ultimaDoContato.erro || ultimaDoContato.messageId || ""}
        >
          {textoDoMotivo(ultimaDoContato.motivo)} · {fmtRelativo(ultimaDoContato.em)}
        </p>
      )}

      <LinhaAtendimento contato={contato} />
    </div>
  );
}
