import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  BotOff,
  CheckCircle2,
  ChevronDown,
  Cloud,
  ExternalLink,
  Globe,
  Link2,
  LoaderCircle,
  MessagesSquare,
  Plus,
  QrCode,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Unplug,
} from "lucide-react";
import { api } from "../../data/client";
import { fmtRelativo } from "../../lib/formato";
import { EXPLICACAO_DO_DONO, OPCOES_DE_DONO, textoDoAtendimento, textoDoDono } from "../../ui/atendimento";
import { BotaoPrimario, CabecalhoTela, Seletor } from "../ui";

const ROTULOS = {
  bridge_starting: "Runtime iniciando",
  whatsapp_disconnected: "WhatsApp desconectado",
  starting_pairing: "Preparando QR Code",
  awaiting_qr: "Aguardando leitura do QR",
  qr_expired: "QR Code expirado",
  connecting: "Conectando ao WhatsApp",
  connected: "WhatsApp conectado",
  reconnecting: "Reconectando",
  logged_out: "Sessão encerrada",
  identity_mismatch: "Número divergente",
  error: "Erro de conexão",
};

const ROTULOS_RUNTIME = {
  online: "Em execução",
  runtime_offline: "Runtime parado",
  revoked: "Conexão revogada",
  error: "Erro no runtime",
};

const EM_PAREAMENTO = ["starting_pairing", "awaiting_qr", "qr_expired"];
const PLATAFORMA_WEB = typeof __EMYLEADS_PLATFORM__ !== "undefined" && __EMYLEADS_PLATFORM__ === "web";

function SeloEstado({ tom = "neutro", children }) {
  const classes = {
    sucesso: "bg-success-soft text-success",
    atencao: "bg-warning/10 text-warning",
    erro: "bg-danger/10 text-danger",
    neutro: "bg-surface-hover text-sub",
  };
  return (
    <span className={`inline-flex flex-none items-center rounded-full px-2.5 py-1 text-[12px] font-medium ${classes[tom]}`}>
      {children}
    </span>
  );
}

function EstadoLinha({ rotulo, valor, tom = "neutro" }) {
  return (
    <div className="flex min-h-11 items-center gap-4 border-b border-line px-5 last:border-0">
      <span className="text-[13px] text-sub">{rotulo}</span>
      <span
        className={`ml-auto text-right text-[13px] font-medium ${
          tom === "sucesso" ? "text-success" : tom === "erro" ? "text-danger" : "text-fg"
        }`}
      >
        {valor}
      </span>
    </div>
  );
}

/**
 * Um cartão por conexão. O que ele precisa deixar claro, e antes não deixava:
 * runtime e sessão do WhatsApp são coisas diferentes, e a sessão do bridge
 * pode ser do mesmo número que o operador usa no WhatsApp Web.
 */
/**
 * Compara a sessão do bridge com a aba do operador.
 *
 * Devolve `null` quando não dá para saber — e "não sei" é uma resposta legítima
 * aqui. Dizer "número diferente" porque o content script ainda não reportou
 * seria inventar um conflito.
 */
function correspondencia(sessaoWeb, phoneMasked) {
  const doBridge = String(phoneMasked || "").replace(/\D/g, "");
  if (!sessaoWeb?.conectado || !sessaoWeb.last4 || !doBridge) return null;
  return sessaoWeb.last4 === doBridge.slice(-4);
}

/**
 * O atendimento desta conexão: quem responde, e a quem cada conversa pertence.
 *
 * Deliberadamente separado da pausa dos chatbots do CRM, que vive na faixa
 * dentro do WhatsApp. São dois automatismos no mesmo número, e foi justamente
 * a confusão entre eles que fez um contato receber duas respostas para a mesma
 * mensagem. Um controle que parecesse "o mesmo botão em outro lugar" faria o
 * operador desligar um achando que desligou os dois.
 */
function BlocoAtendimento({ resumo, ocupado, aoDefinirAutomacao, aoDefinirDono, aoEncerrar }) {
  const [sessoesAbertas, setSessoesAbertas] = useState(false);

  // `undefined` enquanto não se sabe. Pintar "desligada" antes de ler seria
  // mentir exatamente no momento em que alguém confere se ligou.
  if (resumo === undefined) {
    return (
      <div className="flex min-h-11 items-center gap-2 border-b border-line px-5 text-[13px] text-sub">
        <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> Consultando o atendimento…
      </div>
    );
  }
  if (resumo === null) {
    return (
      <EstadoLinha rotulo="Atendimento" valor="Não foi possível consultar" tom="neutro" />
    );
  }

  const ativa = !!resumo.iaAtiva;
  const sessoes = resumo.conversations || [];
  const abertas = resumo.abertas || {};
  const total = Object.values(abertas).reduce((s, n) => s + (n || 0), 0);

  return (
    <div className="border-b border-line">
      <div className="flex flex-wrap items-center gap-3 px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {ativa ? (
              <Bot size={15} className="flex-none text-success" aria-hidden="true" />
            ) : (
              <BotOff size={15} className="flex-none text-sub" aria-hidden="true" />
            )}
            <h3 className="text-[13.5px] font-semibold text-fg">Atendimento automático</h3>
            <SeloEstado tom={ativa ? "sucesso" : "neutro"}>
              {ativa ? "Ligado" : "Desligado"}
            </SeloEstado>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-sub">
            Decide quem responde nesta conexão, mesmo com o navegador fechado. É
            outro controle que a pausa dos chatbots do CRM — desligar um não
            desliga o outro.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={ativa}
          aria-label="Atendimento automático desta conexão"
          onClick={() => aoDefinirAutomacao(!ativa, resumo.donoPadrao)}
          disabled={ocupado === "automacao"}
          className={`relative h-6 w-11 flex-none cursor-pointer rounded-full transition-colors disabled:opacity-40 ${
            ativa ? "bg-success" : "bg-line-strong"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
              ativa ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-fg">Quem atende uma conversa nova</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-sub">
            {ativa
              ? EXPLICACAO_DO_DONO[resumo.donoPadrao] || "Conversa nova nasce sem dono definido."
              : "Com o atendimento desligado, nada responde — o padrão só vale depois de ligar."}
          </p>
        </div>
        <Seletor
          compacto
          valor={resumo.donoPadrao || ""}
          aoMudar={(valor) => valor && aoDefinirAutomacao(ativa, valor)}
          opcoes={OPCOES_DE_DONO}
          rotuloVazio="Escolher…"
        />
      </div>

      <button
        type="button"
        onClick={() => setSessoesAbertas((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 border-t border-line px-5 py-3 text-left transition-colors hover:bg-surface-hover"
      >
        <MessagesSquare size={15} className="flex-none text-sub" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-[12.5px] text-fg">
          {total === 0 ? "Nenhum atendimento aberto" : `${total} em andamento`}
          <span className="text-sub">
            {total > 0 &&
              ` · ${OPCOES_DE_DONO.filter((o) => abertas[o.id])
                .map((o) => `${abertas[o.id]} ${o.curto}`)
                .join(", ")}`}
            {resumo.finalizadas ? ` · ${resumo.finalizadas} finalizados` : ""}
          </span>
        </span>
        <ChevronDown
          size={15}
          className={`flex-none text-sub transition-transform ${sessoesAbertas ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {sessoesAbertas && (
        <div className="border-t border-line">
          {sessoes.length === 0 ? (
            <p className="px-5 py-3 text-[12px] text-sub">
              Nenhuma conversa em andamento nesta conexão.
            </p>
          ) : (
            sessoes.map((sessao) => (
              <div
                key={sessao.sessionId}
                className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2.5 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium text-fg">{sessao.contact}</p>
                  <p className="text-[11.5px] text-sub">
                    {textoDoAtendimento(sessao)} · desde {fmtRelativo(sessao.openedAt)}
                    {sessao.messages ? ` · ${sessao.messages} msg` : ""}
                  </p>
                </div>
                {OPCOES_DE_DONO.filter((o) => o.id !== sessao.owner).map((opcao) => (
                  <button
                    key={opcao.id}
                    type="button"
                    onClick={() => aoDefinirDono(sessao.contact, opcao.id)}
                    disabled={!!ocupado}
                    className="flex-none cursor-pointer rounded-[7px] border border-line px-2 py-1 text-[11.5px] font-medium text-sub transition-colors hover:border-accent hover:text-accent-forte disabled:opacity-40"
                  >
                    {opcao.rotulo}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => aoEncerrar(sessao.contact)}
                  disabled={!!ocupado}
                  title="Finalizar não abandona: a próxima mensagem abre um atendimento novo"
                  className="flex-none cursor-pointer rounded-[7px] px-2 py-1 text-[11.5px] font-medium text-sub transition-colors hover:text-danger disabled:opacity-40"
                >
                  Finalizar
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function CartaoConexao({
  conexao,
  robo,
  prontidao,
  podeGerenciar,
  qr,
  sessaoWeb,
  resumo,
  ocupado,
  aoParear,
  aoReconectar,
  aoRevogar,
  aoRevogarRobo,
  aoDefinirAutomacao,
  aoDefinirDono,
  aoEncerrar,
}) {
  const estado = conexao.connection || {};
  const mesmaConta = correspondencia(sessaoWeb, estado.phoneMasked);
  const conectado = estado.status === "connected";
  const divergente = estado.status === "identity_mismatch";
  const runtimeOnline = conexao.runtime === "online";
  const emPareamento = EM_PAREAMENTO.includes(estado.status);
  const rotuloSessao = runtimeOnline
    ? ROTULOS[estado.status] || "Sem sessão do WhatsApp"
    : "Não consultada";
  const mcpAtivo = robo?.status === "active" && prontidao?.mcp === "configured";
  const agenda = prontidao?.agenda;
  const rotuloAgenda = agenda === "available"
    ? prontidao?.agendaWrite ? "Leitura e escrita disponíveis" : "Somente leitura"
    : agenda === "unavailable" ? "Indisponível no último teste" : "Ainda não testada por um operador";

  const selo = divergente ? (
    <SeloEstado tom="erro">
      <ShieldAlert size={13} className="mr-1.5" aria-hidden="true" />
      Número divergente
    </SeloEstado>
  ) : conectado ? (
    <SeloEstado tom="sucesso">
      <CheckCircle2 size={13} className="mr-1.5" aria-hidden="true" />
      Conectado
    </SeloEstado>
  ) : runtimeOnline ? (
    <SeloEstado tom="atencao">Aguardando conexão</SeloEstado>
  ) : (
    <SeloEstado tom="erro">{ROTULOS_RUNTIME[conexao.runtime] || "Runtime parado"}</SeloEstado>
  );

  return (
    <section className="rounded-[14px] border border-line bg-bg">
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-accent-soft text-accent-forte">
          <Smartphone size={19} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold text-fg">
            {conexao.name || "Conexão sem nome"}
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-sub">
            Sessão do bridge, independente da aba do WhatsApp Web — e podendo ser
            do mesmo número que o operador já usa.
          </p>
        </div>
        {selo}
      </div>

      {divergente && (
        <div className="flex items-start gap-3 border-b border-line bg-danger/5 px-5 py-3 text-[12.5px] leading-relaxed text-danger">
          <ShieldAlert size={17} className="mt-0.5 flex-none" aria-hidden="true" />
          <p>
            O aparelho pareado é {estado.phoneMasked || "outro número"}, mas esta
            conexão esperava {estado.expectedPhoneMasked || "outro número"}. O
            envio está bloqueado. Corrija pelo administrador — parear de novo
            apagaria a sessão de quem está certo.
          </p>
        </div>
      )}

      <div className="grid md:grid-cols-[1fr_310px]">
        <div className="border-b border-line md:border-b-0 md:border-r">
          <EstadoLinha
            rotulo="Bridge"
            valor={ROTULOS_RUNTIME[conexao.runtime] || "Runtime parado"}
            tom={runtimeOnline ? "sucesso" : "erro"}
          />
          <EstadoLinha
            rotulo="WhatsApp"
            valor={rotuloSessao}
            tom={conectado ? "sucesso" : divergente || estado.status === "error" ? "erro" : "neutro"}
          />
          <EstadoLinha rotulo="Host" valor={conexao.host || "local"} />
          {conexao.expectedPhoneMasked && (
            <EstadoLinha rotulo="Número esperado" valor={conexao.expectedPhoneMasked} />
          )}
          {estado.phoneMasked && (
            <EstadoLinha
              rotulo="Número verificado"
              valor={estado.phoneMasked}
              tom={divergente ? "erro" : "sucesso"}
            />
          )}
          {estado.phoneMasked && (
            <EstadoLinha
              rotulo="WhatsApp Web do operador"
              valor={
                mesmaConta === null
                  ? "Sem leitura desta máquina"
                  : mesmaConta
                    ? "Mesmo número — sessões compatíveis"
                    : "Número diferente do bridge"
              }
              tom={mesmaConta === null ? "neutro" : mesmaConta ? "sucesso" : "neutro"}
            />
          )}
          {estado.updatedAt && (
            <EstadoLinha
              rotulo="Última atividade"
              valor={new Date(estado.updatedAt).toLocaleString("pt-BR")}
            />
          )}

          <div className="flex min-h-11 items-center gap-3 border-b border-line px-5">
            <span className="text-[13px] text-sub">MCP do Núcleo</span>
            <span className={`ml-auto text-right text-[13px] font-medium ${mcpAtivo ? "text-success" : "text-fg"}`}>
              {robo?.status === "revoked"
                ? "Credencial revogada"
                : robo?.status !== "active"
                  ? "Credencial não provisionada"
                  : prontidao?.mcp === "configured"
                    ? `Configurado${robo.last_used_at ? ` · usado ${fmtRelativo(robo.last_used_at)}` : ""}`
                    : prontidao ? "Configuração ausente" : "Não foi possível consultar"}
            </span>
            {podeGerenciar && robo?.status === "active" && (
              <button
                type="button"
                onClick={() => {
                  if (confirm("Revogar o acesso de leitura da IA nesta conexão? O atendimento continuará, mas o agente deixará de consultar CRM e agenda até um novo provisionamento.")) {
                    aoRevogarRobo();
                  }
                }}
                disabled={!!ocupado}
                className="cursor-pointer rounded-[7px] px-2 py-1 text-[11.5px] font-semibold text-danger hover:bg-danger/10 disabled:opacity-40"
              >
                Revogar
              </button>
            )}
          </div>
          <EstadoLinha
            rotulo="Agenda"
            valor={rotuloAgenda}
            tom={agenda === "available" ? "sucesso" : agenda === "unavailable" ? "erro" : "neutro"}
          />

          <BlocoAtendimento
            resumo={resumo}
            ocupado={ocupado}
            aoDefinirAutomacao={aoDefinirAutomacao}
            aoDefinirDono={aoDefinirDono}
            aoEncerrar={aoEncerrar}
          />

          <div className="flex flex-wrap items-center gap-2 px-5 py-4">
            {!conectado && !divergente && runtimeOnline && (
              <BotaoPrimario
                onClick={aoParear}
                disabled={!!ocupado || (emPareamento && estado.status !== "qr_expired")}
                className="min-h-11 !py-2.5"
              >
                {ocupado === "parear" ? (
                  <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
                ) : (
                  <QrCode size={16} aria-hidden="true" />
                )}
                {estado.status === "qr_expired" ? "Gerar novo QR" : "Conectar número"}
              </BotaoPrimario>
            )}
            {runtimeOnline && !emPareamento && (
              <button
                type="button"
                onClick={aoReconectar}
                disabled={!!ocupado}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[9px] border border-line px-3.5 text-[13px] font-medium text-sub transition-colors hover:border-line-strong hover:text-fg disabled:opacity-40"
              >
                <RefreshCw size={15} className={ocupado === "reconectar" ? "animate-spin" : ""} aria-hidden="true" />
                Reconectar
              </button>
            )}
            <button
              type="button"
              onClick={aoRevogar}
              disabled={!!ocupado}
              className="ml-auto flex min-h-11 cursor-pointer items-center gap-2 rounded-[9px] px-3 text-[13px] font-medium text-sub hover:text-danger disabled:opacity-40"
            >
              <Unplug size={15} aria-hidden="true" /> Revogar acesso local
            </button>
          </div>
        </div>

        <div className="flex min-h-[280px] items-center justify-center p-5">
          {qr?.status === "awaiting_qr" && qr?.imageData ? (
            <div className="text-center">
              <img
                src={qr.imageData}
                alt={`QR Code para conectar ${conexao.name || "esta conexão"}`}
                className="mx-auto h-52 w-52 rounded-[8px] border border-line bg-white p-2"
              />
              <p className="mt-3 text-[12.5px] font-medium text-fg">Leia em Aparelhos conectados</p>
              <p className="mt-1 text-[11.5px] text-sub">
                O código vale só para esta conexão e é renovado automaticamente.
              </p>
            </div>
          ) : conectado ? (
            <div className="text-center">
              <CheckCircle2 size={40} className="mx-auto text-success" strokeWidth={1.5} aria-hidden="true" />
              <p className="mt-3 text-[13.5px] font-semibold text-fg">Sessão ativa</p>
              <p className="mt-1 max-w-56 text-[12px] leading-relaxed text-sub">
                Conectar não ativa respostas automáticas. A automação continua pausada.
              </p>
            </div>
          ) : (
            <div className="text-center">
              <QrCode size={40} className="mx-auto text-faint" strokeWidth={1.5} aria-hidden="true" />
              <p className="mt-3 text-[13.5px] font-medium text-fg">O QR aparecerá aqui</p>
              <p className="mt-1 max-w-56 text-[12px] leading-relaxed text-sub">
                Inicie a conexão e mantenha esta tela aberta durante a leitura.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function Conexoes({ organizacao, usuario = null }) {
  const organizationId = organizacao?.id || "";
  // Quem está mexendo. Vai junto de toda tomada de conversa: sem isto,
  // "humano" é um booleano anônimo e dois atendentes não se distinguem.
  const atendente = { id: usuario?.id, nome: usuario?.nome || usuario?.email };
  const [estado, setEstado] = useState(null);
  const [sessaoWeb, setSessaoWeb] = useState(null);
  const [qrs, setQrs] = useState({});
  const [resumos, setResumos] = useState({});
  const [robos, setRobos] = useState({});
  const [prontidoes, setProntidoes] = useState({});
  const [codigo, setCodigo] = useState("");
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState("");

  const carregar = useCallback(
    async ({ silencioso = false } = {}) => {
      if (!organizationId) return;
      if (!silencioso) setErro("");
      try {
        // Local ao workspace e escrito pelo content script da aba do WhatsApp.
        // Ausente significa "esta máquina ainda não reportou", nunca "outro
        // número".
        setSessaoWeb(await api.config.ler({ chave: "sessaoWeb.operador" }));
        const proximo = await api.gateway.conexoes({ organizationId });
        // Descarta uma resposta que chegou depois da troca de workspace: sem
        // isto, a tela da empresa nova exibiria conexões da anterior.
        if (proximo.organizationId !== organizationId) return;
        setEstado(proximo);

        if (!silencioso) {
          try {
            const listaRobos = await api.organizacoes.robos();
            setRobos(Object.fromEntries((listaRobos || []).map((item) => [item.connection_id, item])));
          } catch {
            // A conexão continua operável antes de a migration da Fase C ser
            // aplicada; este status é informativo e não pode derrubar a tela.
            setRobos({});
          }
        }

        const pendentes = (proximo.conexoes || []).filter((c) =>
          EM_PAREAMENTO.includes(c.connection?.status)
        );
        const lidos = await Promise.all(
          pendentes.map(async (c) => {
            try {
              return [c.connectionId, await api.gateway.qr({ organizationId, connectionId: c.connectionId })];
            } catch {
              return [c.connectionId, null];
            }
          })
        );
        setQrs(Object.fromEntries(lidos.filter(([, valor]) => valor)));

        // `null` quando a consulta falha, para o cartão dizer "não sei" em vez
        // de "desligado" — a diferença importa justamente quando alguém está
        // conferindo se o atendimento pegou.
        const atendimentos = await Promise.all(
          (proximo.conexoes || []).map(async (c) => {
            try {
              return [
                c.connectionId,
                await api.gateway.resumoAtendimento({ organizationId, connectionId: c.connectionId }),
              ];
            } catch {
              return [c.connectionId, null];
            }
          })
        );
        setResumos(Object.fromEntries(atendimentos));

        const estadosDoAssistente = await Promise.all(
          (proximo.conexoes || []).map(async (c) => {
            try {
              return [
                c.connectionId,
                await api.gateway.prontidao({ organizationId, connectionId: c.connectionId }),
              ];
            } catch {
              return [c.connectionId, null];
            }
          })
        );
        setProntidoes(Object.fromEntries(estadosDoAssistente));
      } catch (e) {
        setErro(e?.message || "Não foi possível consultar as conexões.");
      }
    },
    [organizationId]
  );

  // Trocar de workspace descarrega tudo antes de qualquer nova consulta: a
  // credencial, o polling e o que estava na tela pertenciam à outra empresa.
  useEffect(() => {
    setEstado(null);
    setQrs({});
    setResumos({});
    setRobos({});
    setProntidoes({});
    setErro("");
    if (!organizationId) return undefined;

    let ativo = true;
    carregar();
    const id = setInterval(() => {
      if (ativo && document.visibilityState === "visible") carregar({ silencioso: true });
    }, 2500);
    return () => {
      ativo = false;
      clearInterval(id);
    };
  }, [organizationId, carregar]);

  useEffect(() => {
    if (!PLATAFORMA_WEB || !organizationId) return undefined;
    const aoMudar = (evento) => {
      if (evento.detail?.organizationId === organizationId) carregar({ silencioso: true });
    };
    window.addEventListener("emyleads:connections-changed", aoMudar);
    api.gateway.ativarRealtime({ organizationId }).catch(() => {
      // O polling acima continua funcionando quando Realtime está indisponível.
    });
    return () => window.removeEventListener("emyleads:connections-changed", aoMudar);
  }, [organizationId, carregar]);

  const executar = async (nomeDaAcao, acao) => {
    setOcupado(nomeDaAcao);
    setErro("");
    try {
      await acao();
      await carregar({ silencioso: true });
    } catch (e) {
      setErro(e?.message || "A operação falhou.");
    } finally {
      setOcupado("");
    }
  };

  const vincular = (e) => {
    e.preventDefault();
    executar("bootstrap", async () => {
      await api.gateway.vincular({ organizationId, code: codigo });
      setCodigo("");
    });
  };

  const criar = (e) => {
    e.preventDefault();
    executar("criar", async () => {
      await api.gateway.criar({
        organizationId,
        connectionId: crypto.randomUUID(),
        nome: nome.trim(),
      });
      setNome("");
    });
  };

  const conexoes = useMemo(() => estado?.conexoes || [], [estado]);
  const gatewayOnline = estado?.gateway === "online";

  if (!organizationId) {
    return (
      <>
        <CabecalhoTela titulo="Conexões" busca={<span />} />
        <div className="px-8 py-6 text-[13.5px] text-sub">Selecione uma empresa para ver as conexões.</div>
      </>
    );
  }

  return (
    <>
      <CabecalhoTela
        titulo="Conexões"
        busca={<span />}
        acao={
          <button
            type="button"
            onClick={() => executar("atualizar", () => carregar())}
            disabled={ocupado === "atualizar"}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-line px-4 text-[13.5px] font-medium text-sub transition-colors hover:border-line-strong hover:text-fg disabled:opacity-40"
          >
            <RefreshCw size={16} className={ocupado === "atualizar" ? "animate-spin" : ""} aria-hidden="true" />
            Atualizar
          </button>
        }
      />

      <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="flex max-w-4xl flex-col gap-6">
          <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {erro || `${conexoes.length} conexões nesta empresa`}
          </div>

          {erro && (
            <div className="flex items-start gap-3 rounded-[10px] border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger">
              <AlertTriangle size={17} className="mt-0.5 flex-none" aria-hidden="true" />
              <span>{erro}</span>
            </div>
          )}

          <section className="rounded-[14px] border border-line bg-bg">
            <div className="flex flex-wrap items-start gap-3 px-5 py-4">
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-success-soft text-success">
                <Cloud size={19} strokeWidth={1.75} aria-hidden="true" />
              </div>
              <div className="min-w-[220px] flex-1">
                <h2 className="text-[15px] font-semibold text-fg">API Oficial do WhatsApp</h2>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-sub">
                  Canal hospedado e independente de navegador ligado. A ativação usa a conta Meta Business da empresa e os webhooks do Núcleo Major.
                </p>
              </div>
              <SeloEstado tom="atencao">Aguardando credenciais da Meta</SeloEstado>
            </div>
            <div className="flex items-center gap-3 border-t border-line bg-surface/50 px-5 py-3 text-[11.5px] text-sub">
              <ShieldCheck size={15} className="text-success" />
              O painel já está preparado para esta modalidade; nenhuma extensão será necessária.
            </div>
          </section>

          <section className="rounded-[14px] border border-line bg-bg">
            <div className="flex items-start gap-3 border-b border-line px-5 py-4">
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-accent-soft text-accent-forte">
                <Globe size={19} strokeWidth={1.75} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold text-fg">WhatsApp Web do operador</h2>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-sub">
                  A aba usada pelos atendentes continua sendo o canal humano. Ela é
                  outra sessão do WhatsApp — não necessariamente outro número.
                  {sessaoWeb?.last4
                    ? ` Nesta máquina, o operador está logado em •••• ${sessaoWeb.last4}.`
                    : " Abra o WhatsApp Web para que esta máquina reporte qual número está logado."}
                </p>
              </div>
              <SeloEstado tom="neutro">Canal humano</SeloEstado>
            </div>
          </section>

          {!estado ? (
            <div className="flex items-center gap-3 rounded-[14px] border border-line bg-bg px-5 py-6 text-[13.5px] text-sub">
              <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> Consultando o serviço local…
            </div>
          ) : !estado.vinculado ? (
            <section className="rounded-[14px] border border-line bg-bg">
              <div className="flex items-start gap-3 border-b border-line px-5 py-4">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-accent-soft text-accent-forte">
                  <Link2 size={19} strokeWidth={1.75} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-[15px] font-semibold text-fg">Vincular esta máquina</h2>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-sub">
                    O vínculo vale para <strong>{organizacao?.name}</strong> e só para
                    este navegador. A credencial de envio nunca sai do gateway.
                  </p>
                </div>
                <SeloEstado tom="atencao">Não vinculado</SeloEstado>
              </div>
              <div className="grid gap-5 px-5 py-5 md:grid-cols-[1fr_280px]">
                <div>
                  <h3 className="text-[13.5px] font-semibold text-fg">1. Abra a configuração local</h3>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-sub">
                    A página lista um código por conexão. Ela nunca mostra o token do
                    bridge nem a sessão do WhatsApp.
                  </p>
                  <a
                    href="http://127.0.0.1:8090/setup"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-[9px] border border-line px-3.5 text-[13px] font-medium text-sub transition-colors hover:border-accent hover:text-accent-forte"
                  >
                    <ExternalLink size={15} aria-hidden="true" /> Abrir configuração local
                  </a>
                </div>
                <form onSubmit={vincular}>
                  <label htmlFor="gateway-code" className="mb-1.5 block text-[12.5px] font-medium text-sub">
                    2. Código de vinculação
                  </label>
                  <input
                    id="gateway-code"
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                    placeholder="ABCD-1234"
                    autoComplete="one-time-code"
                    className="h-11 w-full rounded-[9px] border border-line bg-bg px-3 text-[14px] font-medium tracking-[0.08em] text-fg outline-none transition-colors placeholder:tracking-normal placeholder:text-faint focus:border-accent"
                  />
                  <BotaoPrimario
                    type="submit"
                    disabled={!codigo.trim() || ocupado === "bootstrap"}
                    className="mt-3 min-h-11 w-full justify-center !py-2"
                  >
                    {ocupado === "bootstrap" ? (
                      <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <ShieldCheck size={16} aria-hidden="true" />
                    )}
                    Vincular EmyLeads
                  </BotaoPrimario>
                </form>
              </div>
            </section>
          ) : (
            <>
              {!gatewayOnline && (
                <div className="flex items-start gap-3 rounded-[10px] border border-warning/30 bg-warning/10 px-4 py-3 text-[13px] text-warning">
                  <AlertTriangle size={17} className="mt-0.5 flex-none" aria-hidden="true" />
                  <span>
                    O serviço local não respondeu. Isso não significa que as sessões
                    do WhatsApp caíram — significa que não dá para consultá-las agora.
                  </span>
                </div>
              )}

              {conexoes.map((conexao) => (
                <CartaoConexao
                  key={conexao.connectionId}
                  conexao={conexao}
                  robo={robos[conexao.connectionId] || null}
                  prontidao={prontidoes[conexao.connectionId] || null}
                  podeGerenciar={["owner", "admin"].includes(organizacao?.papel)}
                  qr={qrs[conexao.connectionId]}
                  sessaoWeb={sessaoWeb}
                  ocupado={ocupado.endsWith(conexao.connectionId) ? ocupado.split("|")[0] : ""}
                  aoParear={() =>
                    executar(`parear|${conexao.connectionId}`, () =>
                      api.gateway.parear({ organizationId, connectionId: conexao.connectionId })
                    )
                  }
                  aoReconectar={() =>
                    executar(`reconectar|${conexao.connectionId}`, () =>
                      api.gateway.reconectar({ organizationId, connectionId: conexao.connectionId })
                    )
                  }
                  aoRevogar={() =>
                    executar(`revogar|${conexao.connectionId}`, () =>
                      api.gateway.revogar({ organizationId, connectionId: conexao.connectionId })
                    )
                  }
                  aoRevogarRobo={() =>
                    executar(`robo|${conexao.connectionId}`, async () => {
                      await api.organizacoes.revogarRobo({ conexaoId: conexao.connectionId });
                      setRobos((atuais) => ({
                        ...atuais,
                        [conexao.connectionId]: {
                          ...(atuais[conexao.connectionId] || {}),
                          connection_id: conexao.connectionId,
                          status: "revoked",
                          revoked_at: new Date().toISOString(),
                        },
                      }));
                    })
                  }
                  resumo={
                    conexao.connectionId in resumos ? resumos[conexao.connectionId] : undefined
                  }
                  aoDefinirAutomacao={(iaAtiva, defaultOwner) =>
                    executar(`automacao|${conexao.connectionId}`, () =>
                      api.gateway.automacao({
                        organizationId,
                        connectionId: conexao.connectionId,
                        iaAtiva,
                        defaultOwner,
                      })
                    )
                  }
                  aoDefinirDono={(contato, dono) =>
                    executar(`dono|${conexao.connectionId}`, () =>
                      api.gateway.definirDonoConversa({
                        organizationId,
                        connectionId: conexao.connectionId,
                        contato,
                        dono,
                        motivo: "Definido na tela de Conexões",
                        atendente,
                      })
                    )
                  }
                  aoEncerrar={(contato) =>
                    executar(`encerrar|${conexao.connectionId}`, () =>
                      api.gateway.encerrarAtendimento({
                        organizationId,
                        connectionId: conexao.connectionId,
                        contato,
                        motivo: "Finalizado na tela de Conexões",
                      })
                    )
                  }
                />
              ))}

              <section className="rounded-[14px] border border-dashed border-line bg-bg px-5 py-5">
                <h2 className="text-[15px] font-semibold text-fg">Adicionar WhatsApp</h2>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-sub">
                  Cada conexão ganha store, credencial e runtime próprios. O número é
                  confirmado pelo próprio WhatsApp no pareamento — nunca deduzido do
                  e-mail da conta.
                </p>
                <form onSubmit={criar} className="mt-4 flex flex-wrap items-end gap-3">
                  <div className="min-w-[240px] flex-1">
                    <label htmlFor="nova-conexao" className="mb-1.5 block text-[12.5px] font-medium text-sub">
                      Nome da conexão
                    </label>
                    <input
                      id="nova-conexao"
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      placeholder="Comercial, Suporte, Cobrança…"
                      className="h-11 w-full rounded-[9px] border border-line bg-bg px-3 text-[14px] text-fg outline-none transition-colors placeholder:text-faint focus:border-accent"
                    />
                  </div>
                  <BotaoPrimario type="submit" disabled={!nome.trim() || ocupado === "criar"} className="min-h-11 !py-2.5">
                    {ocupado === "criar" ? (
                      <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Plus size={16} aria-hidden="true" />
                    )}
                    Adicionar
                  </BotaoPrimario>
                </form>
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}
