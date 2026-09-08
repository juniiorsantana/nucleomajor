import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../data/client";
import { textoDoMotivoDeEnvio } from "../../../ui/atendimento";
import { conciliarPendentes, mesmaConversa, textoDaTransferencia } from "./conversasUtils";

const PLATAFORMA_WEB =
  typeof __EMYLEADS_PLATFORM__ !== "undefined" && __EMYLEADS_PLATFORM__ === "web";

/** A lista se atualiza sozinha pelo realtime; isto é o que segura se ele cair. */
const RECARGA_MS = 20000;

/**
 * Quanto a tela espera pelo desfecho de um comando.
 *
 * Primeiro consulta a cada dois segundos; depois desacelera para dez segundos
 * até completar os dez minutos em que a RPC mantém o comando válido.
 */
const ESPERA_DO_DESFECHO_MS = 2000;
const TENTATIVAS_RAPIDAS_DO_DESFECHO = 20;
const TENTATIVAS_LENTAS_DO_DESFECHO = 56;
const ESPERA_LENTA_DO_DESFECHO_MS = 10000;

const horaDeAgora = () =>
  new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/**
 * O estado da tela de Conversas.
 *
 * Fica fora do componente pelo mesmo motivo que `useOperadores` na Equipe: a
 * tela tem três colunas e duas folhas, e misturar o carregamento com o desenho
 * delas transforma o arquivo num lugar onde ninguém acha nada.
 *
 * Duas classes de falha, tratadas de formas diferentes de propósito. Não
 * conseguir LER é fatal — sem lista não há tela, e o erro toma o lugar dela.
 * Não conseguir ESCREVER é aviso: a conversa continua legível, e derrubar tudo
 * porque o envio ainda não está ligado esconderia o que funciona.
 */
export function useConversas(organizacaoId) {
  const [conversas, setConversas] = useState(null);
  const [modelos, setModelos] = useState([]);
  const [atual, setAtual] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [equipe, setEquipe] = useState([]);
  // As mensagens que saíram daqui e ainda não voltaram do aparelho.
  const [pendentes, setPendentes] = useState([]);
  /**
   * As transferências feitas nesta sessão, como pílula dentro da conversa.
   *
   * Vive em memória, e some ao recarregar a página. É feedback do que VOCÊ
   * acabou de fazer, e não histórico da conversa: guardar histórico de
   * transferência de forma durável exige registrá-lo na VPS, que é onde a
   * decisão mora — o árbitro hoje sobrescreve o dono da sessão em vez de
   * versioná-lo, então nem ele sabe dizer o que aconteceu antes.
   */
  const [eventos, setEventos] = useState([]);
  const [organizacaoDoEstado, setOrganizacaoDoEstado] = useState(organizacaoId || null);

  const organizacaoRef = useRef(organizacaoId);
  organizacaoRef.current = organizacaoId;
  const conversasRef = useRef(conversas);
  conversasRef.current = conversas;
  const montadoRef = useRef(true);

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  // Qual conversa está aberta AGORA, para o acompanhamento que roda solto.
  // Sem isto, um comando disparado numa conversa recarregaria as mensagens por
  // cima de outra que a pessoa já abriu no meio da espera.
  const atualRef = useRef(atual);
  atualRef.current = atual;

  const carregarLista = useCallback(async (organizacaoEsperada = organizacaoRef.current) => {
    const lista = await api.conversas.listar();
    if (organizacaoEsperada !== organizacaoRef.current || !montadoRef.current) return null;
    setConversas(lista);
    setOrganizacaoDoEstado(organizacaoEsperada || null);
    setErro("");
    // Escolher a primeira só na primeira carga: trocar a conversa aberta
    // debaixo de quem está lendo seria pior que não atualizar nada.
    setAtual((anterior) => anterior || lista[0]?.id || null);
    return lista;
  }, []);

  useEffect(() => {
    let vivo = true;
    const organizacaoEsperada = organizacaoId;
    setConversas(null);
    setModelos([]);
    setAtual(null);
    setMensagens([]);
    setErro("");
    setAviso("");
    setEquipe([]);
    setPendentes([]);
    setEventos([]);
    setOrganizacaoDoEstado(null);
    if (!organizacaoEsperada) return () => {
      vivo = false;
    };
    (async () => {
      try {
        const [, padroes] = await Promise.all([
          carregarLista(organizacaoEsperada),
          api.conversas.modelos(),
        ]);
        if (vivo && organizacaoEsperada === organizacaoRef.current) setModelos(padroes);
      } catch (falha) {
        if (vivo && organizacaoEsperada === organizacaoRef.current) {
          setOrganizacaoDoEstado(organizacaoEsperada);
          setErro(falha.message);
        }
      }
    })();
    return () => {
      vivo = false;
    };
  }, [organizacaoId, carregarLista]);

  /**
   * A equipe, para o menu de a quem atribuir.
   *
   * Falhar aqui não derruba nada: sem a lista, a faixa continua oferecendo
   * robô, IA e "alguém assume" — que é o comportamento anterior a esta leva, e
   * é melhor que uma tela de erro por causa de um menu.
   */
  useEffect(() => {
    let vivo = true;
    const organizacaoEsperada = organizacaoId;
    api.organizacoes
      .membros()
      .then((lista) => {
        if (!vivo || organizacaoEsperada !== organizacaoRef.current) return;
        setEquipe(
          (lista || [])
            .filter((membro) => membro.status === "active")
            .map((membro) => ({
              id: membro.user_id,
              nome:
                membro.profile?.display_name ||
                membro.profile?.full_name ||
                "Sem nome",
              cor: membro.profile?.color || "",
            }))
        );
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [organizacaoId]);

  /**
   * Recarrega a conversa aberta.
   *
   * Existe como função — e não só dentro do efeito que reage a `atual` — porque
   * era exatamente essa a falta: o realtime e o timer recarregavam só a LISTA.
   * A lateral mostrava o tique e o dono novo, e a conversa aberta ficava
   * congelada até a pessoa sair dela e voltar. Quem abriu a conversa é
   * justamente quem mais precisa vê-la mudar.
   *
   * Só escreve no estado quando o conteúdo mudou de verdade. Sem essa guarda,
   * uma recarga a cada 20 segundos criaria um array novo toda vez, e o efeito
   * que rola a conversa até o fim puxaria a tela de quem está lendo o
   * histórico.
   */
  const carregarMensagens = useCallback(async (
    id,
    organizacaoEsperada = organizacaoRef.current
  ) => {
    if (!id) return;
    const lista = await api.conversas.mensagens({ id });
    if (
      id !== atualRef.current ||
      organizacaoEsperada !== organizacaoRef.current ||
      !montadoRef.current
    ) return;
    setMensagens((antes) => (mesmaConversa(antes, lista) ? antes : lista));
  }, []);

  useEffect(() => {
    if (!atual) {
      setMensagens([]);
      return undefined;
    }
    let vivo = true;
    const organizacaoEsperada = organizacaoId;
    (async () => {
      try {
        await carregarMensagens(atual, organizacaoEsperada);
        if (!vivo) return;
        // Quem decide se a conversa ficou lida é quem entregou as mensagens, e
        // não o clique: na bancada abrir zera o contador, e no portal ele
        // continua sendo o que a VPS reportou — marcar como lida ainda não
        // volta para o WhatsApp. Recarregar aqui mostra a resposta de quem
        // sabe, seja ela qual for.
        await carregarLista(organizacaoEsperada);
      } catch (falha) {
        if (vivo && organizacaoEsperada === organizacaoRef.current) {
          if (conversasRef.current === null) setErro(falha.message);
          else setAviso(falha.message);
        }
      }
    })();
    return () => {
      vivo = false;
    };
  }, [atual, organizacaoId, carregarLista, carregarMensagens]);

  /**
   * O aviso do Supabase chega pelo tópico `conversas`, emitido pelo gatilho em
   * `whatsapp_conversations` — a tabela da lista.
   *
   * A lista é o único gatilho, e ainda assim serve para os dois lados: mensagem
   * nova mexe a prévia da conversa, e trocar quem atende mexe o dono. Nos dois
   * casos a linha é reescrita, o aviso sai, e aqui recarregamos TAMBÉM a
   * conversa aberta. É por isso que o tique e a faixa agora aparecem sozinhos,
   * em vez de esperarem alguém sair da conversa e voltar.
   */
  useEffect(() => {
    if (!PLATAFORMA_WEB || !organizacaoId) return undefined;
    const aoMudar = (evento) => {
      if (evento.detail?.organizationId === organizacaoId && evento.detail?.topic === "conversas") {
        carregarLista().catch(() => {});
        carregarMensagens(atualRef.current).catch(() => {});
      }
    };
    window.addEventListener("emyleads:connections-changed", aoMudar);
    api.gateway.ativarRealtime({ organizationId: organizacaoId }).catch(() => {
      // A recarga periódica permanece como fallback.
    });
    return () => window.removeEventListener("emyleads:connections-changed", aoMudar);
  }, [organizacaoId, carregarLista, carregarMensagens]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      carregarLista().catch(() => {});
      carregarMensagens(atualRef.current).catch(() => {});
    }, RECARGA_MS);
    return () => window.clearInterval(timer);
  }, [carregarLista, carregarMensagens]);

  /**
   * Acompanha um comando até ele terminar.
   *
   * Enfileirar não é enviar: quem executa é o runtime da VPS, alguns segundos
   * depois. Sem este acompanhamento a tela só saberia dizer "pedi", e quem
   * atende não distinguiria a mensagem que saiu da que o Bridge recusou.
   *
   * Acompanha até a validade da RPC. Depois das tentativas rápidas, reduz a
   * frequência para não consultar o banco a cada dois segundos por dez minutos.
   */
  const acompanhar = useCallback(async (comandoId, continuar = () => true) => {
    // Sem comando não há o que acompanhar: é a bancada, que executa na hora.
    if (!comandoId) return { situacao: "completed", motivo: "" };
    const total = TENTATIVAS_RAPIDAS_DO_DESFECHO + TENTATIVAS_LENTAS_DO_DESFECHO;
    for (let tentativa = 0; tentativa < total; tentativa += 1) {
      const espera = tentativa < TENTATIVAS_RAPIDAS_DO_DESFECHO
        ? ESPERA_DO_DESFECHO_MS
        : ESPERA_LENTA_DO_DESFECHO_MS;
      await new Promise((pronto) => window.setTimeout(pronto, espera));
      if (!continuar()) return { situacao: "cancelled", motivo: "" };
      let desfecho = null;
      try {
        desfecho = await api.conversas.desfecho({ comandoId });
      } catch {
        // Não saber o desfecho não é o mesmo que ele ter falhado. Continua
        // tentando; quem decide é a próxima resposta, não esta.
        continue;
      }
      if (!desfecho) return { situacao: "completed", motivo: "" };
      if (desfecho.situacao !== "pending" && desfecho.situacao !== "claimed") {
        return desfecho;
      }
    }
    return { situacao: "expired", motivo: "expired" };
  }, []);

  const enviar = useCallback(
    async (texto) => {
      if (!atual) return;
      const limpo = String(texto || "").trim();
      if (!limpo) return;
      setAviso("");

      // A bolha aparece antes do desfecho, marcada como enviando. Sem ela a
      // caixa esvazia e a conversa fica igual por quinze segundos — quem
      // escreveu não tem como saber se o clique pegou, e escreve de novo.
      const chave = `pendente-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const hora = horaDeAgora();
      const conversa = atual;
      const organizacaoDoEnvio = organizacaoRef.current;
      const messageIdsConhecidos = mensagens
        .filter((mensagem) => mensagem.tipo === "mensagem" && mensagem.direcao === "sai")
        .map((mensagem) => mensagem.messageId)
        .filter(Boolean);
      setPendentes((antes) => antes.concat([
        { chave, conversa, texto: limpo, hora, messageIdsConhecidos },
      ]));

      const largar = () => setPendentes((antes) => antes.filter((p) => p.chave !== chave));
      const marcar = (motivo) =>
        setPendentes((antes) =>
          antes.map((p) => (p.chave === chave ? { ...p, falhou: true, motivo } : p))
        );

      let comando;
      try {
        comando = await api.conversas.enviar({ id: conversa, texto: limpo });
      } catch (falha) {
        largar();
        setAviso(falha.message);
        throw falha;
      }

      // Na bancada o envio já aconteceu e a bolha de verdade já existe. Largar
      // a provisória aqui evita o piscar da mensagem duplicada.
      if (!comando?.comandoId) largar();

      // O acompanhamento roda solto: quem escreveu já pode escrever a próxima,
      // e prender a caixa até o runtime responder transformaria dois segundos
      // de fila numa tela travada.
      (async () => {
        const desfecho = await acompanhar(
          comando?.comandoId,
          () => montadoRef.current && organizacaoRef.current === organizacaoDoEnvio
        );
        if (desfecho.situacao === "cancelled") return;
        if (desfecho.situacao === "completed") {
          // O Bridge confirmou o envio, mas a bolha de verdade só existe quando
          // a sincronia a trouxer de volta do aparelho — e isso leva mais um
          // ciclo. Recarregar uma vez aqui quase nunca alcança; quem troca o
          // relógio pelo tique é o realtime, que dispara quando a linha da
          // conversa muda. Esta recarga só encurta o caminho quando dá.
          await carregarLista().catch(() => {});
          await carregarMensagens(conversa).catch(() => {});
          return;
        }
        marcar(desfecho.motivo);
        setAviso(textoDoMotivoDeEnvio(desfecho.motivo));
      })().catch((falha) => {
        if (!montadoRef.current || organizacaoRef.current !== organizacaoDoEnvio) return;
        marcar("");
        setAviso(falha.message);
      });
    },
    [atual, mensagens, acompanhar, carregarLista, carregarMensagens]
  );

  const trocarDono = useCallback(
    async (dono, atendenteId = null) => {
      if (!atual) return;
      setAviso("");
      const conversa = atual;
      const organizacaoDaTransferencia = organizacaoRef.current;
      const nome = equipe.find((p) => p.id === atendenteId)?.nome || "";
      const chave = `evento-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // A pílula aparece na hora, e não quando a VPS confirmar. Trocar quem
      // atende é a ação em que a demora mais incomoda: sem sinal nenhum, a
      // pessoa clica de novo achando que o clique não pegou.
      setEventos((antes) =>
        antes.concat([
          {
            chave,
            conversa,
            dono,
            texto: textoDaTransferencia(dono, nome),
            hora: horaDeAgora(),
          },
        ])
      );

      try {
        const comando = await api.conversas.trocarDono({ id: conversa, dono, atendenteId });
        const desfecho = await acompanhar(
          comando?.comandoId,
          () =>
            montadoRef.current &&
            organizacaoRef.current === organizacaoDaTransferencia
        );
        if (desfecho.situacao === "cancelled") return;
        if (desfecho.situacao !== "completed" && desfecho.situacao !== "pending") {
          setAviso(textoDoMotivoDeEnvio(desfecho.motivo));
          // Não aconteceu: a pílula sai, senão a conversa afirmaria uma
          // transferência que o árbitro recusou.
          setEventos((antes) => antes.filter((e) => e.chave !== chave));
        }
        // Recarrega em qualquer desfecho: quem manda em quem atende é o árbitro
        // da VPS, e a lista mostra o que ele respondeu — inclusive quando a
        // resposta foi "não mudei nada".
        await carregarLista(organizacaoDaTransferencia);
        await carregarMensagens(conversa, organizacaoDaTransferencia);
      } catch (falha) {
        if (
          !montadoRef.current ||
          organizacaoRef.current !== organizacaoDaTransferencia
        ) return;
        setEventos((antes) => antes.filter((e) => e.chave !== chave));
        setAviso(falha.message);
      }
    },
    [atual, equipe, acompanhar, carregarLista, carregarMensagens]
  );

  /**
   * Some com a bolha provisória quando a de verdade chega.
   *
   * O casamento é pelo texto, e não por identificador, porque não existe um: o
   * id da mensagem é do WhatsApp e nasce no aparelho, depois do envio. Duas
   * mensagens iguais seguidas fariam a primeira volta apagar as duas bolhas
   * pendentes — some uma bolha provisória a mais, e a conversa continua certa,
   * porque as reais já estão lá. O erro do lado oposto seria pior: bolha
   * fantasma repetindo o que já foi entregue.
   */
  useEffect(() => {
    if (!pendentes.length) return;
    setPendentes((antes) => conciliarPendentes(antes, mensagens, atual));
    // `pendentes` fica fora das dependências de propósito: ele é o que este
    // efeito escreve, e incluí-lo faria o efeito se disparar em cadeia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mensagens, atual]);

  /** O que a conversa mostra: o que veio do espelho, mais o que ainda não voltou. */
  const naTela = useMemo(() => {
    const provisorias = pendentes
      .filter((p) => p.conversa === atual)
      .map((p) => ({
        tipo: "mensagem",
        direcao: "sai",
        hora: p.hora,
        texto: p.texto,
        enviando: !p.falhou,
        falhou: Boolean(p.falhou),
        motivo: p.motivo || "",
        lido: false,
      }));
    const pilulas = eventos
      .filter((e) => e.conversa === atual)
      .map((e) => ({ tipo: "sistema", dono: e.dono, texto: e.texto, hora: e.hora }));
    if (!provisorias.length && !pilulas.length) return mensagens;
    // As pílulas antes das bolhas pendentes: quem transfere e escreve em
    // seguida fez as duas coisas nessa ordem.
    return mensagens.concat(pilulas, provisorias);
  }, [mensagens, pendentes, eventos, atual]);

  const guardarBaralho = useCallback(async (id, baralho) => {
    await api.conversas.guardarBaralho({ id, baralho }).catch(() => {});
  }, []);

  const estadoDoEscopoAtual = organizacaoDoEstado === organizacaoId;

  return {
    conversas: estadoDoEscopoAtual ? conversas : null,
    modelos: estadoDoEscopoAtual ? modelos : [],
    atual: estadoDoEscopoAtual ? atual : null,
    setAtual,
    mensagens: estadoDoEscopoAtual ? naTela : [],
    equipe: estadoDoEscopoAtual ? equipe : [],
    erro: estadoDoEscopoAtual ? erro : "",
    aviso: estadoDoEscopoAtual ? aviso : "",
    enviar,
    trocarDono,
    guardarBaralho,
  };
}
