import { useCallback, useEffect, useState } from "react";
import { api } from "../../../data/client";

/**
 * O estado dos operadores do WhatsApp, fora de qualquer tela.
 *
 * Isto morava dentro da seção "Operadores do WhatsApp principal", uma tabela
 * separada abaixo da equipe. A seção acabou: quem é operador virou coluna da
 * linha da pessoa, porque vincular um número é uma propriedade DAQUELA pessoa
 * e não um assunto à parte. Só que a lista de linhas não pode carregar cada
 * uma o seu próprio estado — seriam N assinaturas de realtime e N consultas de
 * cinco em cinco segundos. Então o estado sobe para a tela e desce como dado.
 *
 * `ativo` existe porque as rotas de gateway exigem quem administra. Um
 * atendente que montasse este hook receberia erro a cada cinco segundos.
 */
export function useOperadores({ organizacaoId, ativo }) {
  const [conexoes, setConexoes] = useState([]);
  const [conexaoId, setConexaoId] = useState("");
  const [operadores, setOperadores] = useState([]);
  const [aguardando, setAguardando] = useState({});
  const [modoEnvio, setModoEnvio] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const carregarConexoes = useCallback(async () => {
    if (!ativo || !organizacaoId) {
      setConexoes([]);
      setConexaoId("");
      setCarregando(false);
      return;
    }
    setCarregando(true);
    setErro("");
    try {
      const resultado = await api.gateway.conexoes({ organizationId: organizacaoId });
      const lista = (resultado?.conexoes || []).filter((item) => item?.connectionId);
      setConexoes(lista);
      setConexaoId((atual) => (
        lista.some((item) => item.connectionId === atual) ? atual : lista[0]?.connectionId || ""
      ));
      setModoEnvio(resultado?.gateway || "");
      if (lista.length && !["online", "cloud"].includes(resultado?.gateway)) {
        setErro("A VPS não está disponível para enviar códigos agora. Aguarde o sinal do runtime e tente novamente.");
      }
    } catch (e) {
      setConexoes([]);
      setConexaoId("");
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [ativo, organizacaoId]);

  const carregarOperadores = useCallback(async () => {
    if (!conexaoId) {
      setOperadores([]);
      return;
    }
    try {
      const lista = await api.organizacoes.operadores({ connectionId: conexaoId });
      setOperadores(lista);
      // Quem já está ativo não está mais "aguardando", e a espera tem prazo:
      // sem esta limpeza a linha ficaria dizendo "código enviado" para sempre.
      const ativos = new Set(
        lista.filter((item) => item?.status === "active").map((item) => item.user_id),
      );
      setAguardando((atual) => Object.fromEntries(
        Object.entries(atual).filter(([usuarioId, expiraEm]) => (
          !ativos.has(usuarioId) && Number(expiraEm) > Date.now()
        )),
      ));
    } catch (e) {
      setErro(e.message);
      setOperadores([]);
    }
  }, [conexaoId]);

  useEffect(() => { carregarConexoes(); }, [carregarConexoes]);
  useEffect(() => { carregarOperadores(); }, [carregarOperadores]);

  useEffect(() => {
    if (!conexaoId) return undefined;
    const timer = window.setInterval(carregarOperadores, 5000);
    return () => window.clearInterval(timer);
  }, [carregarOperadores, conexaoId]);

  useEffect(() => {
    const plataformaWeb = typeof __EMYLEADS_PLATFORM__ !== "undefined" && __EMYLEADS_PLATFORM__ === "web";
    if (!ativo || !plataformaWeb || !organizacaoId) return undefined;
    const aoMudar = (evento) => {
      if (evento.detail?.organizationId === organizacaoId && evento.detail?.topic === "operators") {
        carregarOperadores();
      }
    };
    window.addEventListener("emyleads:connections-changed", aoMudar);
    api.gateway.ativarRealtime({ organizationId: organizacaoId }).catch(() => {
      // A consulta periódica de cinco segundos permanece como fallback.
    });
    return () => window.removeEventListener("emyleads:connections-changed", aoMudar);
  }, [ativo, organizacaoId, carregarOperadores]);

  /**
   * A VPS responde de forma assíncrona, então o envio é uma espera curta.
   *
   * Dez tentativas de 1,2s cobrem o caso normal; passando disso a solicitação
   * continua valendo e o polling de cinco segundos termina o trabalho.
   */
  const aguardarEnvio = async (comandoId) => {
    for (let tentativa = 0; tentativa < 10; tentativa += 1) {
      if (tentativa > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
      const status = await api.organizacoes.statusVerificacaoOperador({ comandoId });
      if (["completed", "failed", "expired"].includes(status?.status)) return status;
    }
    return { status: "pending" };
  };

  const vincular = async ({ usuarioId, nome, telefone }) => {
    if (!conexaoId || !telefone) return false;
    setOcupado(usuarioId);
    setErro("");
    setAviso("");
    try {
      const desafio = await api.organizacoes.iniciarVerificacaoOperador({
        connectionId: conexaoId,
        usuarioId,
        telefone,
      });
      if (!desafio?.command_id) {
        throw new Error("O Supabase não criou a solicitação de verificação.");
      }
      const resultado = await aguardarEnvio(desafio.command_id);
      if (resultado?.status === "failed") {
        throw new Error("A VPS não conseguiu enviar o código pelo WhatsApp principal. Verifique a conexão e tente novamente.");
      }
      if (resultado?.status === "expired") {
        throw new Error("A solicitação expirou antes do envio. Tente gerar um novo código.");
      }
      setAguardando((atual) => ({ ...atual, [usuarioId]: Date.now() + 10 * 60 * 1000 }));
      setAviso(resultado?.status === "completed"
        ? `Código enviado para ${nome}. A pessoa deve responder pelo próprio WhatsApp ao número principal.`
        : `Solicitação entregue à VPS para ${nome}. A linha atualiza sozinha quando o código sair.`);
      return true;
    } catch (e) {
      setErro(e.message);
      return false;
    } finally {
      setOcupado("");
    }
  };

  const revogar = async (operador) => {
    setOcupado(operador.id);
    setErro("");
    try {
      await api.organizacoes.revogarOperador({ operadorId: operador.id });
      await carregarOperadores();
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado("");
    }
  };

  const operadorDe = (usuarioId) => operadores.find(
    (item) => item.user_id === usuarioId && item.status === "active",
  );

  return {
    conexoes,
    conexaoId,
    setConexaoId,
    conexaoAtiva: conexoes.some((item) => item.connectionId === conexaoId),
    modoEnvio,
    podeEnviar: ["online", "cloud"].includes(modoEnvio),
    carregando,
    ocupado,
    erro,
    aviso,
    aguardando,
    operadorDe,
    vincular,
    revogar,
    limparAviso: () => setAviso(""),
  };
}
