import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, Power, QrCode } from "lucide-react";
import { api } from "../../../data/client";
import { fmtDataHora } from "../../../lib/formato";
import { BotaoPrimario } from "../../ui";
import {
  FASES_DA_TROCA,
  faseDaTroca,
  mensagemDaConfirmacao,
  mensagemDaRecusa,
  motivoDoPedido,
  normalizarTelefone,
  podeCancelar,
  podeDesconectar,
  podeEscolherOutroNumero,
  podeRepetir,
  telefoneLegivel,
  telefoneValido,
  textoDaFila,
} from "./regrasDaTroca";

// Com pedido vivo, a tela acompanha a fila de perto. Fora disso ela relê
// quando o cartão muda de estado, e não precisa de laço próprio.
const ESPERA_COM_PEDIDO_MS = 3000;

const novaChave = () =>
  globalThis.crypto?.randomUUID?.()
  || Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

const BOTAO_SECUNDARIO =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-ctl border border-line px-3.5 text-[13px] font-medium text-sub transition-colors hover:border-line-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-40";

const BOTAO_PERIGO =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-ctl bg-danger px-4 text-[13px] font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40";

function Caixa({ tom = "neutro", children }) {
  const cores = {
    neutro: "border-line text-sub",
    atencao: "border-warning/30 bg-warning/10 text-warning",
    erro: "border-danger/25 bg-danger/5 text-danger",
    sucesso: "border-success/25 bg-success-soft text-success",
  };
  return (
    <div className={`mb-3 flex items-start gap-3 rounded-none border px-4 py-3 text-[12.5px] leading-relaxed ${cores[tom]}`}>
      {tom === "erro" || tom === "atencao" ? (
        <AlertTriangle size={17} className="mt-0.5 flex-none" aria-hidden="true" />
      ) : tom === "sucesso" ? (
        <CheckCircle2 size={17} className="mt-0.5 flex-none" aria-hidden="true" />
      ) : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * A troca voluntária de WhatsApp, do lado do cartão: o que o banco diz e o
 * que dá para fazer agora.
 *
 * São duas ações, cada uma no seu momento: **desconectar**, com o WhatsApp de
 * pé; e, na hora de **conectar** de novo, escolher o número — o desta
 * conexão ou outro. Até 11/10/2026 as duas eram uma escolha só, feita antes
 * de desconectar ("Trocar por outro número" ou "Só desconectar"). O dono da
 * Major desconectou, viu o QR do número antigo e só então trocou: a pergunta
 * "qual número?" estava no lugar errado.
 *
 * Quem decide se pode é o banco; isto só segue o que ele devolve. A tela só
 * diz que deu certo quando o banco diz `applied`. `ativa` desliga tudo, sem
 * nenhuma leitura: conexão local, ou quem não administra a empresa.
 */
export function useTrocaDeWhatsApp({ organizationId, conexao, ativa = true, aoMudar = null, aoTrocar = null }) {
  const connectionId = conexao?.connectionId || "";
  const statusDoCartao = conexao?.connection?.status || "";
  const [estado, setEstado] = useState(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState("");
  // O número inteiro que esta tela digitou. O banco devolve só o final, e é
  // só o final que sobrevive a um recarregar.
  const [digitado, setDigitado] = useState({ requestId: "", numero: "" });
  // A chave é da intenção: o segundo clique antes da resposta repete a mesma,
  // e o banco devolve o mesmo pedido. Mexer no formulário começa outra.
  const chaveRef = useRef("");
  // A troca pedida por esta tela. Aplicada, o QR do número novo é pedido sem
  // ninguém precisar clicar de novo.
  const trocaDaquiRef = useRef("");
  const vistoRef = useRef(null);

  const ler = useCallback(async () => {
    if (!ativa || !organizationId || !connectionId) return null;
    try {
      const proximo = await api.gateway.trocaEstado({ organizationId, connectionId });
      setEstado(proximo || null);
      return proximo;
    } catch (e) {
      setErro(mensagemDaRecusa(e));
      return null;
    }
  }, [ativa, organizationId, connectionId]);

  useEffect(() => {
    setEstado(null);
    ler();
  }, [ler]);

  const leitura = faseDaTroca(estado);
  const pedido = leitura.pedido;
  const ultimo = leitura.ultimo;
  const liberada = Boolean(estado?.sessionReleasedAt);
  const emAndamento = [
    FASES_DA_TROCA.CONFIRMAR,
    FASES_DA_TROCA.APLICANDO,
    FASES_DA_TROCA.AGUARDANDO_OUTRA_PESSOA,
  ].includes(leitura.fase);
  // O banco já desconectou, mas o cartão vem do sinal da VPS, que chega a cada
  // ~20 s: até ele virar, a tela continua dizendo "desconectando", e não
  // "conectado" embaixo de "desconectado".
  const esperandoCartao = Boolean(
    ultimo?.status === "applied" && ultimo.kind === "disconnect" && liberada && statusDoCartao === "connected"
  );

  useEffect(() => {
    if (!ativa || !emAndamento) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") ler();
    }, ESPERA_COM_PEDIDO_MS);
    return () => clearInterval(id);
  }, [ativa, emAndamento, ler]);

  // O cartão relê a conexão a cada 2,5 s. Quando o estado dela muda (o QR foi
  // lido, a sessão caiu, a VPS desconectou), a troca relê também.
  const statusVistoRef = useRef(statusDoCartao);
  useEffect(() => {
    if (statusVistoRef.current === statusDoCartao) return;
    statusVistoRef.current = statusDoCartao;
    ler();
  }, [statusDoCartao, ler]);

  // Aplicado: o cartão relê para mostrar o número novo e, se a troca foi
  // pedida aqui, o QR é pedido em seguida.
  useEffect(() => {
    if (!estado) return;
    const atual = estado.request;
    const marca = atual ? `${atual.requestId}:${atual.status}` : "";
    const anterior = vistoRef.current;
    vistoRef.current = marca;
    if (anterior === null || anterior === marca || atual?.status !== "applied") return;
    aoMudar?.();
    if (atual.kind === "change_number" && atual.requestId === trocaDaquiRef.current) {
      trocaDaquiRef.current = "";
      aoTrocar?.(atual);
    }
  }, [estado, aoMudar, aoTrocar]);

  /** Devolve `true` quando a ação passou, para o painel se fechar. */
  const executar = async (nome, acao) => {
    setOcupado(nome);
    setErro("");
    setAviso("");
    let passou = false;
    try {
      await acao();
      passou = true;
    } catch (e) {
      setErro(mensagemDaRecusa(e));
    } finally {
      setOcupado("");
      await ler();
    }
    return passou;
  };

  const pedir = (tipo, numero = null, importar = false) =>
    executar(tipo === "disconnect" ? "desconectar" : "trocar", async () => {
      if (!chaveRef.current) chaveRef.current = novaChave();
      const novo = await api.gateway.trocaIniciar({
        organizationId,
        connectionId,
        tipo,
        telefone: tipo === "change_number" ? numero : null,
        importarHistorico: tipo === "change_number" && importar,
        chave: chaveRef.current,
      });
      chaveRef.current = "";
      setDigitado({ requestId: novo?.requestId || "", numero: tipo === "change_number" ? numero : "" });
      if (tipo === "change_number") trocaDaquiRef.current = novo?.requestId || "";
      // Na liberação direta, quem pediu já confirmou na tela: leu o que
      // acontece e clicou. O banco ainda separa os dois passos, porque o modo
      // com código precisa deles, e a tela os faz em sequência.
      if (novo?.status === "awaiting_confirmation" && novo?.confirmationMethod === "direct") {
        const resposta = await api.gateway.trocaConfirmar({
          organizationId,
          pedidoId: novo.requestId,
          codigo: null,
        });
        if (resposta?.confirmed === false && resposta.result !== "not-awaiting-confirmation") {
          setAviso(mensagemDaConfirmacao(resposta));
        }
      }
    });

  const confirmarPendente = (codigo = null) =>
    executar("confirmar", async () => {
      const resposta = await api.gateway.trocaConfirmar({
        organizationId,
        pedidoId: pedido.requestId,
        codigo: pedido.confirmationMethod === "whatsapp_code" ? codigo : null,
      });
      if (resposta?.confirmed === false) setAviso(mensagemDaConfirmacao(resposta));
      else if (pedido.kind === "change_number") trocaDaquiRef.current = pedido.requestId;
    });

  const cancelar = (pedidoId) =>
    executar("cancelar", async () => {
      const resposta = await api.gateway.trocaCancelar({ organizationId, pedidoId });
      if (resposta?.cancelled === false) {
        setAviso(resposta.result === "in-progress"
          ? "A VPS já começou a aplicar; não dá mais para cancelar."
          : "Este pedido não pode mais ser cancelado.");
      }
    });

  const repetir = (alvo) =>
    executar("repetir", async () => {
      await api.gateway.trocaRepetir({ organizationId, pedidoId: alvo.requestId });
      if (alvo.kind === "change_number") trocaDaquiRef.current = alvo.requestId;
    });

  const reenviar = (pedidoId) =>
    executar("reenviar", () => api.gateway.trocaReenviar({ organizationId, pedidoId }));

  const pronta = ativa && Boolean(estado);
  return {
    ativa: pronta,
    estado,
    leitura,
    pedido,
    ultimo,
    liberada,
    emAndamento,
    esperandoCartao,
    erro,
    aviso,
    ocupado,
    digitado,
    podeDesconectar: pronta && !emAndamento && !esperandoCartao && podeDesconectar(estado),
    podeEscolherOutroNumero: pronta && !emAndamento && podeEscolherOutroNumero(estado),
    desconectar: () => pedir("disconnect"),
    trocarPara: (numero, importar = false) => pedir("change_number", numero, importar),
    novaIntencao: () => {
      chaveRef.current = "";
    },
    limpar: () => {
      setErro("");
      setAviso("");
    },
    confirmarPendente,
    cancelar,
    repetir,
    reenviar,
  };
}

/**
 * Desconectar o WhatsApp desta conexão: um botão discreto e, antes de
 * qualquer pedido, o que acontece. A escolha do número fica para a hora de
 * conectar de novo.
 */
export function DesconectarWhatsApp({ troca, final4, aberto, aoAbrir, aoFechar }) {
  if (!aberto) {
    return (
      <div className="px-5 pb-4">
        <button
          type="button"
          onClick={() => {
            troca.limpar();
            troca.novaIntencao();
            aoAbrir();
          }}
          className={BOTAO_SECUNDARIO}
        >
          <Power size={15} aria-hidden="true" />
          Desconectar este WhatsApp
        </button>
      </div>
    );
  }
  const desconectando = troca.ocupado === "desconectar";
  return (
    <div className="mx-5 mb-4 rounded-none border border-danger/25 px-4 py-4">
      <p className="text-[13.5px] font-semibold text-fg">
        Desconectar o WhatsApp{final4 ? ` final ${final4}` : ""}?
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-sub">
        <li>A IA e os fluxos param de responder até um WhatsApp ser conectado de novo.</li>
        <li>Conversas, contatos e funil continuam aqui.</li>
        <li>
          Para voltar, toque em <b className="text-fg">Conectar WhatsApp</b>: dá para usar o mesmo número
          ou outro.
        </li>
      </ul>
      {troca.erro && <div className="mt-3"><Caixa tom="erro">{troca.erro}</Caixa></div>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={async () => {
            if (await troca.desconectar()) aoFechar();
          }}
          disabled={!!troca.ocupado}
          className={BOTAO_PERIGO}
        >
          {desconectando && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
          Desconectar
        </button>
        <button type="button" onClick={aoFechar} disabled={!!troca.ocupado} className={BOTAO_SECUNDARIO}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/**
 * Qual WhatsApp conectar: o número desta conexão (o QR aparece direto) ou
 * outro (confere o número inteiro, troca, e o QR do número novo aparece
 * sozinho quando a VPS aplicar).
 */
export function EscolherNumero({ troca, final4, outroPrimeiro = false, aoMesmoNumero, aoFechar }) {
  const [outro, setOutro] = useState(outroPrimeiro || !final4);
  const [telefone, setTelefone] = useState("");
  const [importar, setImportar] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const idTelefone = useId();
  const idImportar = useId();
  const numero = normalizarTelefone(telefone);
  const numeroOk = telefoneValido(numero);

  const mudar = (mudanca) => {
    troca.novaIntencao();
    troca.limpar();
    mudanca();
  };

  if (conferindo) {
    const trocando = troca.ocupado === "trocar";
    return (
      <div className="mx-5 mb-4 rounded-none border border-line-strong px-4 py-4">
        <p className="text-[13.5px] font-semibold text-fg">
          Conectar o <span className="tabular-nums">{telefoneLegivel(numero)}</span>?
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-sub">
          <li>Esta conexão passa a atender por esse número. Conversas, contatos e funil continuam aqui.</li>
          {final4 && <li>Quem escrever para o final {final4} não chega mais ao portal.</li>}
          <li>Campanhas, links e a bio com o número antigo precisam ser trocados à parte.</li>
          <li>
            {importar
              ? "As conversas antigas deste celular também entram no portal."
              : "Só entram as conversas de agora em diante; as antigas deste celular ficam de fora."}
          </li>
        </ul>
        {troca.erro && <div className="mt-3"><Caixa tom="erro">{troca.erro}</Caixa></div>}
        {troca.aviso && <div className="mt-3"><Caixa tom="atencao">{troca.aviso}</Caixa></div>}
        <div className="mt-3 flex flex-wrap gap-2">
          <BotaoPrimario
            type="button"
            onClick={async () => {
              if (await troca.trocarPara(numero, importar)) aoFechar();
            }}
            disabled={!!troca.ocupado}
            className="min-h-11 !py-2.5"
          >
            {trocando ? (
              <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <QrCode size={16} aria-hidden="true" />
            )}
            Confirmar e mostrar o QR
          </BotaoPrimario>
          <button
            type="button"
            onClick={() => mudar(() => setConferindo(false))}
            disabled={!!troca.ocupado}
            className={BOTAO_SECUNDARIO}
          >
            Corrigir o número
          </button>
        </div>
      </div>
    );
  }

  const opcao = (ativo, titulo, descricao, aoEscolher) => (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-none border px-3.5 py-3 transition-colors ${
        ativo ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong"
      }`}
    >
      <input type="radio" name={`numero-${idTelefone}`} checked={ativo} onChange={aoEscolher} className="mt-1 accent-accent" />
      <span>
        <span className="block text-[13px] font-semibold text-fg">{titulo}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-sub">{descricao}</span>
      </span>
    </label>
  );

  return (
    <form
      onSubmit={(evento) => {
        evento.preventDefault();
        if (!outro) {
          aoFechar();
          aoMesmoNumero();
          return;
        }
        if (numeroOk) setConferindo(true);
      }}
      className="mx-5 mb-4 flex flex-col gap-3 rounded-none border border-line-strong px-4 py-4"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[13.5px] font-semibold text-fg">Qual WhatsApp você vai conectar?</legend>
        {final4 && opcao(!outro, `O número final ${final4}`, "O número desta conexão. O QR aparece em seguida.", () =>
          mudar(() => setOutro(false))
        )}
        {opcao(outro, "Outro número", "Esta conexão passa a atender por outro WhatsApp. As conversas ficam.", () =>
          mudar(() => setOutro(true))
        )}
      </fieldset>

      {outro && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,280px)_1fr] sm:items-start">
          <div>
            <label htmlFor={idTelefone} className="mb-1.5 block text-[12.5px] font-medium text-sub">
              Número com DDD
            </label>
            <input
              id={idTelefone}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={telefone}
              onChange={(e) => mudar(() => setTelefone(e.target.value))}
              placeholder="(65) 99999-7777"
              aria-invalid={telefone && !numeroOk ? "true" : "false"}
              className="h-11 w-full rounded-ctl border border-line bg-bg px-3 text-[14px] tabular-nums text-fg outline-none transition-colors placeholder:text-faint focus:border-accent"
            />
            {telefone && !numeroOk && (
              <p className="mt-1 text-[11.5px] text-danger">Digite o DDD e o número, por exemplo (65) 99999-7777.</p>
            )}
          </div>
          <label htmlFor={idImportar} className="flex cursor-pointer items-start gap-2.5 pt-1 sm:pt-7">
            <input
              id={idImportar}
              type="checkbox"
              checked={importar}
              onChange={(e) => mudar(() => setImportar(e.target.checked))}
              className="mt-0.5 accent-accent"
            />
            <span className="text-[12px] leading-relaxed text-sub">
              <span className="font-medium text-fg">Trazer as conversas antigas deste celular</span>
              <span className="block">Deixe desligado se ele tem conversas pessoais.</span>
            </span>
          </label>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <BotaoPrimario type="submit" disabled={(outro && !numeroOk) || !!troca.ocupado} className="min-h-11 !py-2.5">
          {!outro && <QrCode size={16} aria-hidden="true" />}
          {outro ? "Continuar" : "Mostrar o QR Code"}
        </BotaoPrimario>
        <button type="button" onClick={aoFechar} className={BOTAO_SECUNDARIO}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/**
 * O que está acontecendo com a troca agora: desconectando, preparando o
 * número novo, esperando o código, a falha que dá para repetir e o desfecho.
 * Nada aqui é verde: verde só existe no cartão, quando o WhatsApp conecta.
 *
 * `mostrarMensagens` fica falso enquanto um painel (desconectar, escolher o
 * número) está aberto: a recusa aparece dentro dele, perto do clique.
 */
export function AndamentoDaTroca({ troca, mostrarMensagens = true }) {
  const [codigo, setCodigo] = useState("");
  const idCodigo = useId();
  if (!troca.ativa) return null;
  const { leitura, pedido, ultimo, estado, ocupado } = troca;
  const blocos = [];

  if (mostrarMensagens && troca.erro) blocos.push(<Caixa key="erro" tom="erro">{troca.erro}</Caixa>);
  if (mostrarMensagens && troca.aviso) blocos.push(<Caixa key="aviso" tom="atencao">{troca.aviso}</Caixa>);

  if (leitura.fase === FASES_DA_TROCA.APLICANDO || troca.esperandoCartao) {
    const alvo = pedido || ultimo;
    const numeroNovo = alvo.kind === "change_number"
      && troca.digitado.requestId === alvo.requestId && troca.digitado.numero
      ? telefoneLegivel(troca.digitado.numero)
      : `o número final ${alvo.newLast4}`;
    blocos.push(
      <Caixa key="andamento" tom="neutro">
        <p className="flex items-center gap-2 font-semibold text-fg">
          <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
          {alvo.kind === "change_number"
            ? `Preparando a conexão para ${numeroNovo}…`
            : `Desconectando o WhatsApp final ${alvo.oldLast4}…`}
        </p>
        <p className="mt-1">
          {troca.esperandoCartao
            ? "Já foi desconectado; o cartão atualiza em alguns segundos."
            : alvo.kind === "change_number"
              ? `${textoDaFila(alvo, estado?.runtime?.fresh)} O QR aparece aqui assim que terminar.`
              : textoDaFila(alvo, estado?.runtime?.fresh)}
        </p>
        {pedido && podeCancelar(pedido) && (
          <button
            type="button"
            onClick={() => troca.cancelar(pedido.requestId)}
            disabled={!!ocupado}
            className={`${BOTAO_SECUNDARIO} mt-2`}
          >
            Cancelar
          </button>
        )}
      </Caixa>
    );
  } else if (leitura.fase === FASES_DA_TROCA.CONFIRMAR) {
    const ehTroca = pedido.kind === "change_number";
    blocos.push(
      pedido.confirmationMethod === "whatsapp_code" ? (
        <div key="codigo" className="mb-3 flex flex-col gap-3">
          <Caixa tom="neutro">
            <p className="font-semibold text-fg">Confirme no WhatsApp final {pedido.oldLast4}</p>
            <p className="mt-0.5">
              Mandamos um código de 8 caracteres para a conversa desse número com ele mesmo (aparece como
              "Você" ou com o seu nome). Abra o WhatsApp do número final {pedido.oldLast4} e digite o código aqui.
            </p>
            {pedido.errorCode && <p className="mt-1 text-danger">{motivoDoPedido(pedido.errorCode)}</p>}
          </Caixa>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor={idCodigo} className="mb-1.5 block text-[12.5px] font-medium text-sub">Código</label>
              <input
                id={idCodigo}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 8))}
                autoComplete="one-time-code"
                className="h-11 w-[150px] rounded-ctl border border-line bg-bg px-3 font-mono text-[15px] uppercase tracking-[0.12em] text-fg outline-none focus:border-accent"
              />
            </div>
            <BotaoPrimario
              type="button"
              onClick={() => troca.confirmarPendente(codigo)}
              disabled={codigo.length !== 8 || !!ocupado}
              className="min-h-11 !py-2.5"
            >
              {ocupado === "confirmar" && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
              Confirmar
            </BotaoPrimario>
            <button
              type="button"
              onClick={() => troca.reenviar(pedido.requestId)}
              disabled={!!ocupado || pedido.sendsLeft <= 0}
              className={BOTAO_SECUNDARIO}
            >
              Reenviar código
            </button>
            <button type="button" onClick={() => troca.cancelar(pedido.requestId)} disabled={!!ocupado} className={BOTAO_SECUNDARIO}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        // Pedido e confirmação são feitos em sequência; este caso só aparece
        // se a página foi fechada entre os dois.
        <Caixa key="confirmar" tom="atencao">
          <p className="font-semibold">
            {ehTroca
              ? `Falta confirmar a troca para o número final ${pedido.newLast4}.`
              : `Falta confirmar: desconectar o WhatsApp final ${pedido.oldLast4}.`}
          </p>
          <p className="mt-0.5">A confirmação vale até {fmtDataHora(pedido.confirmUntil)}.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => troca.confirmarPendente()} disabled={!!ocupado} className={BOTAO_SECUNDARIO}>
              {ocupado === "confirmar" && <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />}
              Confirmar
            </button>
            <button type="button" onClick={() => troca.cancelar(pedido.requestId)} disabled={!!ocupado} className={BOTAO_SECUNDARIO}>
              Cancelar
            </button>
          </div>
        </Caixa>
      )
    );
  } else if (leitura.fase === FASES_DA_TROCA.AGUARDANDO_OUTRA_PESSOA) {
    blocos.push(
      <Caixa key="outra-pessoa" tom="atencao">
        Outra pessoa da equipe começou a desconectar ou trocar este WhatsApp e ainda não confirmou.
      </Caixa>
    );
  } else if (ultimo && ["failed", "expired"].includes(ultimo.status)) {
    const repetivel = podeRepetir(ultimo, estado);
    blocos.push(
      <Caixa key="falha" tom="erro">
        <p className="font-semibold">
          {ultimo.kind === "change_number" ? "A troca de número" : "A desconexão"} não foi aplicada.
        </p>
        <p className="mt-0.5">{motivoDoPedido(ultimo.errorCode || ultimo.status)}</p>
        {repetivel && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => troca.repetir(ultimo)} disabled={!!ocupado} className={BOTAO_SECUNDARIO}>
              {ocupado === "repetir" && <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />}
              Tentar de novo
            </button>
          </div>
        )}
      </Caixa>
    );
  } else if (ultimo?.status === "applied" && troca.liberada) {
    blocos.push(
      <p key="desfecho" className="mb-3 text-[12px] leading-relaxed text-faint">
        {ultimo.kind === "change_number"
          ? `Número trocado para o final ${ultimo.newLast4} em ${fmtDataHora(ultimo.appliedAt)}.`
          : `Desconectado em ${fmtDataHora(ultimo.appliedAt)}.`}
      </p>
    );
    if (ultimo.remoteLogout === false) {
      blocos.push(
        <Caixa key="aparelho" tom="atencao">
          O WhatsApp não confirmou o desligamento. No celular do número final {ultimo.oldLast4}, abra
          Aparelhos conectados e remova o aparelho do Núcleo Major se ele ainda aparecer.
        </Caixa>
      );
    }
  }

  return blocos.length ? <div className="px-5">{blocos}</div> : null;
}
