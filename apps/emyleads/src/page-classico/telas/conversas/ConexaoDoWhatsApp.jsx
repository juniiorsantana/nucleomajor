import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle, MessageCircle, QrCode, X } from "lucide-react";
import { api } from "../../../data/client";
import { FASES } from "../conexoes/estadoDaConexao";

/**
 * "Conectar meu WhatsApp" de uma empresa que ainda não tem conexão.
 *
 * O número entra aqui porque é ele que a VPS vai aceitar no pareamento: o QR
 * lido por outro celular é recusado. O pedido não sobe nada sozinho — a
 * equipe da Major monta a conexão e o QR aparece depois, nesta mesma tela.
 *
 * `limite` é quantos números a empresa pode ter (`limits.connections`, já com o
 * ajuste da Major). Com 0 não adianta oferecer o formulário: o banco recusaria
 * o pedido depois de a pessoa digitar o número. Sem limite conhecido, o
 * formulário aparece e o banco decide.
 */
export function PedirConexao({ organizationId, podeGerenciar, aoPedir, limite = null }) {
  const [telefone, setTelefone] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  if (limite === 0) {
    return (
      <span role="status" className="text-[12px] text-sub">
        O WhatsApp não está liberado para a sua empresa. Fale com a Major.
      </span>
    );
  }

  if (!podeGerenciar) {
    return (
      <span className="text-[11.5px] text-faint">
        Quem administra a empresa pede a conexão do WhatsApp em Conversas ou em Conexões.
      </span>
    );
  }

  const enviar = async (evento) => {
    evento.preventDefault();
    setEnviando(true);
    setErro("");
    try {
      await api.gateway.solicitar({ organizationId, telefone });
      await aoPedir?.();
    } catch (e) {
      setErro(e?.message || "Não foi possível pedir a conexão.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="flex w-full flex-col items-stretch gap-2 text-left">
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-sub">Número do WhatsApp da empresa</span>
        <input
          type="tel"
          required
          inputMode="tel"
          autoComplete="tel"
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
          placeholder="(65) 99999-9999"
          className="h-10 w-full rounded-[9px] border border-line bg-bg px-3 text-[14px] text-fg outline-none transition-colors placeholder:text-faint focus:border-accent"
        />
      </label>
      {erro && <span role="alert" className="text-[12px] text-danger">{erro}</span>}
      <button type="submit" disabled={enviando || telefone.replace(/\D/g, "").length < 10} className={`${BOTAO_PRIMARIO} justify-center disabled:opacity-40`}>
        {enviando && <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />}
        Conectar meu WhatsApp
      </button>
      <span className="text-center text-[11.5px] text-faint">A gente prepara a conexão e o QR aparece aqui.</span>
    </form>
  );
}

/**
 * O estado vazio de Conversas — que antes era o silêncio.
 *
 * Uma lista vazia dizia "Nenhuma conversa ainda. Comece uma pelo + aqui em
 * cima." mesmo com o WhatsApp desconectado, e quem acabava de criar a conta
 * não tinha como saber que faltava conectar o número. Três estados, um por
 * situação: desconectado (convida a conectar), aguardando leitura (mostra
 * onde está o código) e conectado sem conversa (diz o que vai aparecer).
 *
 * O botão abre o QR aqui mesmo: o pedido de código é um comando do runtime e
 * funciona de qualquer tela. Conexões continua sendo a origem para o resto.
 */
export function EstadoVazioConversas({ resumo, carregado, podeGerenciar, aoConectar, aoVerCodigo, organizationId = "", aoPedirConexao = null, limiteDeConexoes = null }) {
  if (!carregado) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13.5px] text-sub">
        <LoaderCircle size={16} className="mr-2 animate-spin" aria-hidden="true" /> Consultando a conexão…
      </div>
    );
  }

  // Empresa sem conexão nenhuma: até aqui, era o spinner para sempre.
  if (!resumo) {
    return (
      <Vazio icone={<MessageCircle size={26} strokeWidth={1.8} aria-hidden="true" />} tom="accent" titulo="Conecte o WhatsApp da empresa">
        As conversas do número aparecem aqui, e a equipe responde pelo portal.
        <PedirConexao organizationId={organizationId} podeGerenciar={podeGerenciar} aoPedir={aoPedirConexao} limite={limiteDeConexoes} />
      </Vazio>
    );
  }

  if (resumo.fase === FASES.PREPARANDO) {
    return (
      <Vazio icone={<Clock3 size={26} strokeWidth={1.8} aria-hidden="true" />} tom="accent" titulo={resumo.titulo}>
        {resumo.detalhe}
      </Vazio>
    );
  }

  const final4 = String(resumo.numero || "").replace(/\D/g, "").slice(-4);
  const numero = final4 ? `o número final ${final4}` : "o número da empresa";

  if (resumo.fase === FASES.CONECTADO) {
    return (
      <Vazio icone={<CheckCircle2 size={26} strokeWidth={1.8} aria-hidden="true" />} tom="sucesso" titulo="Conectado. Nenhuma conversa ainda.">
        Quando alguém escrever para {numero}, a conversa aparece aqui — e a IA responde, se o atendimento automático estiver ligado.
      </Vazio>
    );
  }

  if (resumo.fase === FASES.PAREANDO) {
    return (
      <Vazio icone={<QrCode size={26} strokeWidth={1.8} aria-hidden="true" />} tom="accent" titulo="Aguardando a leitura do QR">
        Assim que o celular ler o código, as conversas aparecem aqui.
        {podeGerenciar && (
          <button type="button" onClick={aoVerCodigo} className={BOTAO_SECUNDARIO}>
            Ver o código
          </button>
        )}
      </Vazio>
    );
  }

  if (resumo.fase === FASES.DIVERGENTE || resumo.fase === FASES.RUNTIME_PARADO) {
    return (
      <Vazio icone={<AlertTriangle size={26} strokeWidth={1.8} aria-hidden="true" />} tom="erro" titulo={resumo.titulo}>
        {resumo.detalhe}
        <span className="text-[11.5px] text-faint">Detalhes em Conexões.</span>
      </Vazio>
    );
  }

  return (
    <Vazio icone={<MessageCircle size={26} strokeWidth={1.8} aria-hidden="true" />} tom="accent" titulo="O WhatsApp da empresa ainda não está conectado">
      Conecte {numero} para receber conversas aqui e deixar a IA atender os leads.
      {podeGerenciar ? (
        <>
          <button type="button" onClick={aoConectar} className={BOTAO_PRIMARIO}>
            Conectar WhatsApp
          </button>
          <span className="text-[11.5px] text-faint">Leva um minuto: o QR aparece aqui mesmo.</span>
        </>
      ) : (
        <span className="text-[11.5px] text-faint">Conectar o número é permissão de administrador.</span>
      )}
    </Vazio>
  );
}

const BOTAO_PRIMARIO =
  "mt-1.5 inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-[10px] bg-accent px-4 text-[13px] font-semibold text-white transition-colors hover:bg-accent-forte";
const BOTAO_SECUNDARIO =
  "mt-1.5 inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-[10px] border border-line-strong bg-bg px-4 text-[13px] font-semibold text-fg transition-colors hover:border-accent hover:text-accent-forte";

function Vazio({ icone, tom, titulo, children }) {
  const tons = {
    accent: "bg-accent-soft text-accent-forte",
    sucesso: "bg-success-soft text-success",
    erro: "bg-danger/10 text-danger",
  };
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-8">
      <div className="flex max-w-[340px] flex-col items-center gap-2.5 text-center">
        <div className={`flex h-14 w-14 items-center justify-center rounded-[18px] ${tons[tom]}`}>{icone}</div>
        <h2 className="mt-1 text-[15px] font-semibold text-fg [text-wrap:balance]">{titulo}</h2>
        <p className="flex flex-col items-center gap-2.5 text-[13px] leading-relaxed text-sub">{children}</p>
      </div>
    </div>
  );
}

/**
 * Faixa discreta no topo da lista quando há conversas mas o WhatsApp caiu.
 * Sem ela, a sessão encerrada só aparecia em Conexões — e em 08/09/2026 o
 * número ficou 23 horas mudo.
 */
export function FaixaConexao({ resumo, podeGerenciar, aoConectar }) {
  if (!resumo || [FASES.CONECTADO, FASES.PAREANDO, FASES.PREPARANDO].includes(resumo.fase)) return null;
  const erro = resumo.fase === FASES.DIVERGENTE || resumo.fase === FASES.RUNTIME_PARADO;
  return (
    <div
      role="status"
      className={`flex flex-none items-center gap-2 border-b px-3.5 py-2 text-[12px] ${
        erro ? "border-danger/20 bg-danger/5 text-danger" : "border-warning/20 bg-warning/10 text-warning"
      }`}
    >
      <AlertTriangle size={14} className="flex-none" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{erro ? resumo.titulo : "WhatsApp desconectado — ninguém recebe nem responde."}</span>
      {!erro && podeGerenciar && (
        <button type="button" onClick={aoConectar} className="flex-none cursor-pointer font-semibold underline-offset-2 hover:underline">
          Conectar
        </button>
      )}
    </div>
  );
}

/**
 * O QR dentro de Conversas.
 *
 * Mesma leitura que Conexões faz, com a mesma cadência. Ao conectar, o modal
 * diz que conectou e fecha — nada de deixar um QR morto na tela.
 */
export function ModalConectarWhatsApp({ aberto, resumo, qr, pedindo, aoGerar, aoFechar }) {
  useEffect(() => {
    if (!aberto) return undefined;
    const aoTecla = (evento) => {
      if (evento.key === "Escape") aoFechar();
    };
    window.addEventListener("keydown", aoTecla);
    return () => window.removeEventListener("keydown", aoTecla);
  }, [aberto, aoFechar]);

  if (!aberto) return null;
  const conectado = resumo?.fase === FASES.CONECTADO;
  const final4 = String(resumo?.numero || "").replace(/\D/g, "").slice(-4);
  const temCodigo = qr?.status === "awaiting_qr" && qr?.imageData;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-fg/25 p-4"
      onClick={(evento) => {
        if (evento.target === evento.currentTarget) aoFechar();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="conectar-whatsapp-titulo"
        className="w-full max-w-[440px] rounded-[14px] border border-line bg-bg p-5 shadow-[0_8px_24px_rgba(18,23,48,.12)]"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="conectar-whatsapp-titulo" className="text-[14.5px] font-semibold text-fg">
              {conectado ? "WhatsApp conectado" : "Conectar o WhatsApp da empresa"}
            </h2>
            <p className="mt-0.5 text-[12.5px] text-sub">
              {conectado
                ? "As conversas passam a aparecer aqui. Pode fechar."
                : `Leia com o celular do número${final4 ? ` final ${final4}` : ""}. Só esse número é aceito.`}
            </p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-[9px] text-sub transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="mx-auto flex h-[188px] w-[188px] items-center justify-center rounded-[10px] border border-line bg-white">
            {conectado ? (
              <CheckCircle2 size={44} className="text-success" strokeWidth={1.5} aria-hidden="true" />
            ) : temCodigo ? (
              <img src={qr.imageData} alt="QR Code para conectar o WhatsApp" className="h-[176px] w-[176px]" />
            ) : qr?.erro ? (
              <AlertTriangle size={40} className="text-danger" strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <LoaderCircle size={40} className="animate-spin text-faint" strokeWidth={1.5} aria-hidden="true" />
            )}
          </div>
          <div className="text-[12.5px] leading-relaxed text-sub">
            {conectado ? (
              <p className="text-fg">Sessão ativa. Conectar não liga respostas automáticas — o interruptor fica em Conexões.</p>
            ) : qr?.erro ? (
              <>
                <p className="font-semibold text-fg">O código não veio</p>
                <p className="mt-1">{qr.erro || "A VPS não respondeu a tempo."}</p>
                <p className="mt-1 text-[11.5px] text-faint">Tentamos de novo a cada 15 s; ou peça um novo código.</p>
              </>
            ) : (
              <>
                <ol className="list-decimal space-y-1 pl-4">
                  <li>No celular, abra o <b className="font-semibold text-fg">WhatsApp</b>.</li>
                  <li>Toque em <b className="font-semibold text-fg">Aparelhos conectados › Conectar aparelho</b>.</li>
                  <li>Aponte a câmera para o código.</li>
                </ol>
                <p className="mt-2 text-[11.5px] text-faint">
                  {pedindo ? "Pedindo o código à VPS…" : temCodigo ? "O código se renova sozinho enquanto esta janela estiver aberta." : "O código aparece em alguns segundos."}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {conectado ? (
            <button type="button" onClick={aoFechar} className={BOTAO_PRIMARIO}>Pronto</button>
          ) : (
            <>
              <button type="button" onClick={aoFechar} className="inline-flex min-h-10 cursor-pointer items-center rounded-[10px] px-3 text-[13px] font-semibold text-accent-forte hover:bg-accent-soft">
                Fechar
              </button>
              <button type="button" onClick={aoGerar} disabled={pedindo} className={`${BOTAO_SECUNDARIO} disabled:opacity-40`}>
                {pedindo ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <QrCode size={14} aria-hidden="true" />}
                Gerar novo código
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
