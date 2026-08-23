import { useEffect, useRef } from "react";
import { api } from "../data/client";
import { criarFilaPorChave } from "../lib/fila";
import { renderizar } from "../lib/template";
import { ouvir, perguntar } from "../wa/ponte";

// Primeira das três camadas de idempotência: uma fila por conversa faz
// mensagens em rajada serem avaliadas em ordem. Depois da primeira resposta, a
// segunda pode deixar de atender a regra. Ver IDEMPOTENCIA-AUTOMACAO.md.
const enfileirar = criarFilaPorChave();

/** O diário nunca pode derrubar um envio — daí o catch em toda escrita. */
const anotar = (entrada) => api.automacao.registrar(entrada).catch(() => {});

/**
 * Entrega a conversa ao novo dono, no gateway.
 *
 * Falhar aqui é o caso mais feio do fluxo quando o destino é humano: o cliente
 * foi avisado de que alguém vai atender, e o robô continua respondendo. Por
 * isso a falha vira linha no diário com motivo próprio, em vez de sumir num
 * catch — o operador precisa ter como descobrir.
 */
async function transferir(mensagem, contato, preparacao, transferencia) {
  try {
    const sessaoWeb = await api.config.ler({ chave: "sessaoWeb.operador" });
    await api.gateway.transferirConversa({
      organizationId: preparacao.organizationId || (await api.auth.estado())?.organizacaoAtual?.id,
      conexaoLast4: sessaoWeb?.last4 || null,
      contato: contato.telefone || mensagem.telefone,
      destino: transferencia.destino,
      motivo: transferencia.motivo,
    });
  } catch (err) {
    await anotar({
      messageId: mensagem.messageId,
      contactId: contato.id,
      chatbotId: preparacao.chatbotId,
      chatbotNome: preparacao.nome,
      resultado: "erro",
      motivo: "falha-na-transferencia",
      erro: err?.message || String(err),
    });
  }
}

async function processar(mensagem) {
  const contato = await api.contatos.resolver({
    waId: mensagem.waId,
    telefone: mensagem.telefone,
  });
  // Nunca cadastra silenciosamente quem escreveu; bots atuam apenas na base.
  if (!contato) {
    console.warn("[EmyLeads] resposta automática ignorada: contato não encontrado no workspace.", {
      waId: mensagem.waId,
      telefone: mensagem.telefone,
    });
    // Só o content script enxerga este caso: o provider nem chega a ser
    // chamado, porque não existe contactId para chamar com.
    await anotar({
      messageId: mensagem.messageId,
      resultado: "ignorado",
      motivo: "contato-fora-da-base",
    });
    return null;
  }

  const { preparacao, motivo } = await api.chatbots.prepararAutomatico({
    contactId: contato.id,
    messageId: mensagem.messageId,
    agora: mensagem.recebidoEm,
  });
  if (!preparacao) {
    // O provider já anotou o motivo no diário; aqui é só o rastro no console.
    console.info("[EmyLeads] nova mensagem sem resposta automática.", {
      contactId: contato.id,
      messageId: mensagem.messageId,
      motivo,
    });
    return null;
  }

  let enviou = false;
  try {
    if (preparacao.mensagem) {
      const texto = renderizar(preparacao.mensagem, contato);
      if (!texto) throw new Error("A resposta automatica ficou vazia.");
      await perguntar("enviarMensagemAutomatica", { waId: mensagem.waId, texto });
      enviou = true;
      console.info("[EmyLeads] resposta automática enviada.", {
        contactId: contato.id,
        chatbotId: preparacao.chatbotId,
        messageId: mensagem.messageId,
      });
      // Protege contra reenvio se o CRM falhar depois que o WhatsApp aceitou.
      await api.chatbots
        .marcarAutomaticoEnviado({
          contactId: contato.id,
          chatbotId: preparacao.chatbotId,
          chatbotNome: preparacao.nome,
          messageId: mensagem.messageId,
          executionId: preparacao.executionId || null,
        })
        .catch(() => {});
    }

    const resultado = await api.chatbots.executar({
      contactId: contato.id,
      chatbotId: preparacao.chatbotId,
      preparacao,
      mensagemRecebidaId: mensagem.messageId,
      agora: mensagem.recebidoEm,
    });

    // A transferência é o último passo, e depois do envio confirmado. Falha
    // aqui NÃO desfaz o envio nem derruba a execução: a mensagem já saiu, e
    // reexecutar o fluxo mandaria de novo.
    if (resultado?.transferencia) {
      await transferir(mensagem, contato, preparacao, resultado.transferencia);
    }

    return resultado;
  } catch (err) {
    if (!enviou) {
      await api.chatbots
        .cancelarAutomatico({
          contactId: contato.id,
          chatbotId: preparacao.chatbotId,
          chatbotNome: preparacao.nome,
          messageId: mensagem.messageId,
          executionId: preparacao.executionId || null,
          erro: err?.message || String(err),
        })
        .catch(() => {});
    } else {
      // Pior caso do fluxo: o cliente RECEBEU a mensagem, mas o CRM não
      // registrou a execução. A reserva fica de pé de propósito, para não
      // reenviar; sem esta anotação, o desencontro seria invisível.
      await anotar({
        messageId: mensagem.messageId,
        contactId: contato.id,
        chatbotId: preparacao.chatbotId,
        chatbotNome: preparacao.nome,
        resultado: "erro",
        motivo: "falha-na-execucao",
        erro: err?.message || String(err),
      });
    }
    throw err;
  }
}

/**
 * Mantem a resposta automatica ativa enquanto o painel estiver montado.
 *
 * O callback recebe `null` quando nada foi executado. Avisar também nesse caso
 * é o que mantém o diagnóstico vivo na faixa: "nenhum bot se aplica" é o
 * motivo MAIS comum, e ele nunca chega a produzir um resultado. Quem escuta
 * decide o que recarregar — ver o Painel.
 */
export function useChatbotAutomatico(aoExecutar) {
  const callback = useRef(aoExecutar);
  callback.current = aoExecutar;

  useEffect(
    () =>
      ouvir((evento, mensagem) => {
        if (evento !== "mensagemRecebida" || !mensagem?.messageId || !mensagem?.waId)
          return;
        enfileirar(mensagem.waId, async () => {
          try {
            callback.current?.(await processar(mensagem), mensagem);
          } catch (err) {
            console.error("[EmyLeads] falha na resposta automatica:", err);
            // A falha já foi anotada no diário; avisar mesmo assim é o que faz
            // o erro aparecer na faixa em vez de morrer no console.
            callback.current?.(null, mensagem);
          }
        });
      }),
    []
  );
}
