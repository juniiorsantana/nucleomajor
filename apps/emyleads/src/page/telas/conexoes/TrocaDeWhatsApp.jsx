import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, ArrowLeftRight, CheckCircle2, ChevronDown, LoaderCircle } from "lucide-react";
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
  podeRepetir,
  telefoneLegivel,
  telefoneValido,
  textoDaFila,
  textoDoBloqueio,
} from "./regrasDaTroca";

// Com pedido vivo, a tela acompanha a fila de perto; fora disso, só com a
// seção aberta, e devagar. Cada leitura é uma RPC.
const ESPERA_COM_PEDIDO_MS = 3000;
const ESPERA_ABERTA_MS = 15000;

const novaChave = () =>
  globalThis.crypto?.randomUUID?.()
  || Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

const BOTAO_SECUNDARIO =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-ctl border border-line px-3.5 text-[13px] font-medium text-sub transition-colors hover:border-line-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-40";

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

/** O desfecho do último pedido: o que aconteceu e o que falta. */
function Desfecho({ ultimo, liberada, estado, ocupado, aoRepetir, conexao }) {
  if (!ultimo) return null;
  if (ultimo.status === "applied") {
    if (!liberada) {
      return ultimo.kind === "change_number" ? (
        <p className="mb-3 text-[12px] text-faint">
          O número desta conexão foi trocado para o final {ultimo.newLast4} em {fmtDataHora(ultimo.appliedAt)}.
        </p>
      ) : null;
    }
    // Nada aqui é verde: a ação foi aplicada, mas a conexão ainda não atende.
    // Verde só existe no cartão, quando o WhatsApp conecta de fato.
    return (
      <>
        <Caixa tom={ultimo.kind === "change_number" ? "atencao" : "neutro"}>
          {ultimo.kind === "change_number" ? (
            <>
              <p className="font-semibold">Troca aplicada: a conexão agora espera o número final {ultimo.newLast4}.</p>
              <p className="mt-0.5">
                O WhatsApp final {ultimo.oldLast4} saiu desta conexão, mas ela ainda não está pronta: use{" "}
                <b>Conectar WhatsApp</b>, acima, e leia o QR com o celular do número final {ultimo.newLast4}.
                Se o QR for lido por outro número, o envio fica bloqueado.
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">Desconectado em {fmtDataHora(ultimo.appliedAt)}.</p>
              <p className="mt-0.5">
                A conexão está sem número e nada sai por ela. Para voltar, use <b>Conectar WhatsApp</b>, acima,
                ou troque por outro número aqui.
              </p>
            </>
          )}
        </Caixa>
        {ultimo.remoteLogout === false && (
          <Caixa tom="atencao">
            O WhatsApp não confirmou o desligamento. No celular do número final {ultimo.oldLast4}, abra
            Aparelhos conectados e remova o aparelho do Núcleo Major se ele ainda aparecer.
          </Caixa>
        )}
        {/* O QR foi lido pelo número errado depois da troca. O aviso do
            cartão foi escrito para outro caso (a sessão restaurada de outra
            conta); aqui, desconectar e ler de novo é justamente o conserto. */}
        {conexao?.connection?.status === "identity_mismatch" && (
          <Caixa tom="erro">
            <p className="font-semibold">
              O QR foi lido por outro número{conexao.connection.phoneMasked ? ` (${conexao.connection.phoneMasked})` : ""}.
            </p>
            <p className="mt-0.5">
              Nada sai por esta conexão enquanto isso. Para corrigir, escolha <b>Só desconectar</b>, abaixo
              (o aparelho errado sai), e leia o QR de novo com o celular do número final{" "}
              {ultimo.newLast4 || ultimo.oldLast4}.
            </p>
          </Caixa>
        )}
      </>
    );
  }
  const repetivel = podeRepetir(ultimo, estado);
  return (
    <Caixa tom="erro">
      <p className="font-semibold">
        {ultimo.kind === "change_number" ? "A troca de número" : "A desconexão"} não foi aplicada.
      </p>
      <p className="mt-0.5">{motivoDoPedido(ultimo.errorCode || ultimo.status)}</p>
      {repetivel && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => aoRepetir(ultimo.requestId)} disabled={!!ocupado} className={BOTAO_SECUNDARIO}>
            {ocupado === "repetir" && <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />}
            Tentar de novo
          </button>
          <span className="text-[11.5px] opacity-80">Sem confirmar outra vez: vale até 24 horas depois da confirmação.</span>
        </div>
      )}
    </Caixa>
  );
}

/**
 * Trocar ou desconectar o WhatsApp desta conexão, sem SSH.
 *
 * A conexão continua a mesma: conversas, contatos e funil ficam. O caminho é
 * pedir, confirmar e esperar a VPS aplicar — e a tela só diz que deu certo
 * quando o banco diz `applied`. Quem pode, e como confirma, quem decide é o
 * servidor; esta seção só segue o que ele devolve.
 */
export function TrocaDeWhatsApp({ organizationId, conexao, aoMudar = null }) {
  const connectionId = conexao?.connectionId || "";
  const [aberto, setAberto] = useState(false);
  const [estado, setEstado] = useState(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [tipo, setTipo] = useState("change_number");
  const [telefone, setTelefone] = useState("");
  const [importar, setImportar] = useState(false);
  const [codigo, setCodigo] = useState("");
  // O número inteiro que esta tela digitou, para conferir na confirmação. O
  // banco devolve só o final, e é só o final que sobrevive a um recarregar.
  const [digitado, setDigitado] = useState({ requestId: "", numero: "" });
  const chaveRef = useRef("");
  const statusAnteriorRef = useRef("");
  const idTelefone = useId();
  const idCodigo = useId();
  const idImportar = useId();

  const ler = useCallback(async () => {
    if (!organizationId || !connectionId) return null;
    try {
      const proximo = await api.gateway.trocaEstado({ organizationId, connectionId });
      setEstado(proximo || null);
      return proximo;
    } catch (e) {
      setErro(mensagemDaRecusa(e));
      return null;
    }
  }, [organizationId, connectionId]);

  // Uma leitura ao montar: um pedido em andamento aparece mesmo com a seção
  // fechada, e é aberto por isso.
  useEffect(() => {
    setEstado(null);
    ler();
  }, [ler]);

  const leitura = faseDaTroca(estado);
  const pedido = leitura.pedido;
  const liberada = Boolean(estado?.sessionReleasedAt);
  const comPedido = [
    FASES_DA_TROCA.CONFIRMAR,
    FASES_DA_TROCA.APLICANDO,
    FASES_DA_TROCA.AGUARDANDO_OUTRA_PESSOA,
  ].includes(leitura.fase);
  // Aplicada e ainda sem o número conectado: falta ler o QR.
  const aguardandoConexao = leitura.ultimo?.status === "applied" && liberada;
  const destaque = comPedido || aguardandoConexao || podeRepetir(leitura.ultimo, estado);
  const mostrar = aberto || destaque;

  useEffect(() => {
    if (!mostrar) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") ler();
    }, comPedido || aguardandoConexao ? ESPERA_COM_PEDIDO_MS : ESPERA_ABERTA_MS);
    return () => clearInterval(id);
  }, [mostrar, comPedido, aguardandoConexao, ler]);

  // O cartão relê a conexão a cada 2,5 s. Quando o estado dela muda (o QR foi
  // lido, a sessão caiu), esta seção relê também: sem isso, o cartão já diria
  // "conectado" enquanto a seção ainda dizia que falta ler o QR.
  const statusDaConexao = conexao?.connection?.status || "";
  const statusVistoRef = useRef(statusDaConexao);
  useEffect(() => {
    if (statusVistoRef.current === statusDaConexao) return;
    statusVistoRef.current = statusDaConexao;
    ler();
  }, [statusDaConexao, ler]);

  // Aplicado: o cartão precisa reler a conexão para mostrar o número esperado
  // novo e o botão de conectar.
  useEffect(() => {
    const status = estado?.request?.status || "";
    const anterior = statusAnteriorRef.current;
    statusAnteriorRef.current = status;
    if (anterior && anterior !== status && status === "applied") aoMudar?.();
  }, [estado, aoMudar]);

  const executar = async (nome, acao) => {
    setOcupado(nome);
    setErro("");
    setAviso("");
    try {
      await acao();
    } catch (e) {
      setErro(mensagemDaRecusa(e));
    } finally {
      setOcupado("");
      await ler();
    }
  };

  const numero = normalizarTelefone(telefone);
  const numeroOk = tipo === "disconnect" || telefoneValido(numero);

  const iniciar = (evento) => {
    evento?.preventDefault?.();
    if (!numeroOk) return;
    // A chave é do clique: o segundo clique antes da resposta repete a mesma,
    // e o banco devolve o mesmo pedido.
    if (!chaveRef.current) chaveRef.current = novaChave();
    const chave = chaveRef.current;
    executar("iniciar", async () => {
      const novo = await api.gateway.trocaIniciar({
        organizationId,
        connectionId,
        tipo,
        telefone: tipo === "change_number" ? numero : null,
        importarHistorico: tipo === "change_number" && importar,
        chave,
      });
      chaveRef.current = "";
      setDigitado({ requestId: novo?.requestId || "", numero: tipo === "change_number" ? numero : "" });
      setCodigo("");
    });
  };

  const mudarPedido = (mudanca) => {
    chaveRef.current = "";
    mudanca();
  };

  const confirmar = () =>
    executar("confirmar", async () => {
      const resposta = await api.gateway.trocaConfirmar({
        organizationId,
        pedidoId: pedido.requestId,
        codigo: pedido.confirmationMethod === "whatsapp_code" ? codigo : null,
      });
      if (resposta?.confirmed === false) setAviso(mensagemDaConfirmacao(resposta));
      else setCodigo("");
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

  const repetir = (pedidoId) =>
    executar("repetir", () => api.gateway.trocaRepetir({ organizationId, pedidoId }));

  const reenviar = (pedidoId) =>
    executar("reenviar", () => api.gateway.trocaReenviar({ organizationId, pedidoId }));

  const etiqueta = leitura.fase === FASES_DA_TROCA.APLICANDO
    ? "Aplicando"
    : leitura.fase === FASES_DA_TROCA.CONFIRMAR
      ? "Falta confirmar"
      : null;
  const cabecalho = (
    <>
      <ArrowLeftRight size={15} className="flex-none" aria-hidden="true" />
      Trocar ou desconectar o número
      {etiqueta && (
        <span className="ml-1 rounded-ctl bg-warning/10 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[.06em] text-warning">
          {etiqueta}
        </span>
      )}
    </>
  );

  const formulario = (
    <form onSubmit={iniciar} className="flex flex-col gap-3">
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">O que fazer com o WhatsApp desta conexão</legend>
        {[
          ["change_number", "Trocar por outro número", "Esta conexão passa a atender por outro WhatsApp. As conversas ficam."],
          ["disconnect", "Só desconectar", "O número sai desta conexão. Para voltar, conecte de novo pelo QR."],
        ].map(([valor, titulo, descricao]) => (
          <label
            key={valor}
            className={`flex cursor-pointer items-start gap-3 rounded-none border px-3.5 py-3 transition-colors ${
              tipo === valor ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong"
            }`}
          >
            <input
              type="radio"
              name={`troca-${connectionId}`}
              value={valor}
              checked={tipo === valor}
              onChange={() => mudarPedido(() => setTipo(valor))}
              className="mt-1 accent-accent"
            />
            <span>
              <span className="block text-[13px] font-semibold text-fg">{titulo}</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-sub">{descricao}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {tipo === "change_number" && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,280px)_1fr] sm:items-start">
          <div>
            <label htmlFor={idTelefone} className="mb-1.5 block text-[12.5px] font-medium text-sub">
              Número novo, com DDD
            </label>
            <input
              id={idTelefone}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={telefone}
              onChange={(e) => mudarPedido(() => setTelefone(e.target.value))}
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
              onChange={(e) => mudarPedido(() => setImportar(e.target.checked))}
              className="mt-0.5 accent-accent"
            />
            <span className="text-[12px] leading-relaxed text-sub">
              <span className="font-medium text-fg">Trazer as conversas antigas do celular novo</span>
              <span className="block">Deixe desligado se o celular novo tem conversas pessoais.</span>
            </span>
          </label>
        </div>
      )}

      <div>
        <BotaoPrimario type="submit" disabled={!numeroOk || !!ocupado} className="min-h-11 !py-2.5">
          {ocupado === "iniciar" && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
          Continuar
        </BotaoPrimario>
      </div>
    </form>
  );

  let conteudo;
  if (leitura.fase === FASES_DA_TROCA.CARREGANDO) {
    conteudo = (
      <p className="flex items-center gap-2 text-[12.5px] text-sub">
        <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> Consultando…
      </p>
    );
  } else if (leitura.fase === FASES_DA_TROCA.APLICANDO) {
    conteudo = (
      <Caixa tom="neutro">
        <p className="flex items-center gap-2 font-semibold text-fg">
          <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
          {pedido.kind === "change_number"
            ? `Trocando para o número final ${pedido.newLast4}…`
            : `Desconectando o número final ${pedido.oldLast4}…`}
        </p>
        <p className="mt-1">{textoDaFila(pedido, estado?.runtime?.fresh)}</p>
        {podeCancelar(pedido) && (
          <button type="button" onClick={() => cancelar(pedido.requestId)} disabled={!!ocupado} className={`${BOTAO_SECUNDARIO} mt-2`}>
            Cancelar
          </button>
        )}
      </Caixa>
    );
  } else if (leitura.fase === FASES_DA_TROCA.CONFIRMAR) {
    const troca = pedido.kind === "change_number";
    const numeroNovo = digitado.requestId === pedido.requestId && digitado.numero
      ? telefoneLegivel(digitado.numero)
      : `o número final ${pedido.newLast4}`;
    conteudo = pedido.confirmationMethod === "whatsapp_code" ? (
      <div className="flex flex-col gap-3">
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
          <BotaoPrimario type="button" onClick={confirmar} disabled={codigo.length !== 8 || !!ocupado} className="min-h-11 !py-2.5">
            {ocupado === "confirmar" && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
            Confirmar
          </BotaoPrimario>
          <button type="button" onClick={() => reenviar(pedido.requestId)} disabled={!!ocupado || pedido.sendsLeft <= 0} className={BOTAO_SECUNDARIO}>
            Reenviar código
          </button>
          <button type="button" onClick={() => cancelar(pedido.requestId)} disabled={!!ocupado} className={BOTAO_SECUNDARIO}>
            Cancelar
          </button>
        </div>
      </div>
    ) : (
      <div className="rounded-none border border-danger/25 px-4 py-4">
        <p className="text-[13.5px] font-semibold text-fg">
          {troca ? "Trocar o WhatsApp desta conexão?" : "Desconectar o WhatsApp desta conexão?"}
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-sub">
          {troca ? (
            <>
              <li>Sai o número final <b className="text-fg">{pedido.oldLast4}</b>; entra <b className="text-fg tabular-nums">{numeroNovo}</b>.</li>
              <li>Conversas, contatos e funil continuam aqui. Quem escrever para o número antigo não chega mais ao portal.</li>
              <li>Até o número novo ler o QR, nada sai por esta conexão — nem IA, nem fluxos.</li>
              <li>Campanhas, links e a bio com o número antigo precisam ser trocados à parte.</li>
            </>
          ) : (
            <>
              <li>Sai o número final <b className="text-fg">{pedido.oldLast4}</b>; a conexão fica sem número.</li>
              <li>Conversas, contatos e funil continuam aqui.</li>
              <li>Até um número ser conectado de novo, nada sai por esta conexão — nem IA, nem fluxos.</li>
            </>
          )}
        </ul>
        <p className="mt-2 text-[11.5px] text-faint">Esta confirmação vale até {fmtDataHora(pedido.confirmUntil)}.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={confirmar}
            disabled={!!ocupado}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-ctl bg-danger px-4 text-[13px] font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {ocupado === "confirmar" && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
            {troca ? `Trocar para o final ${pedido.newLast4}` : `Desconectar o final ${pedido.oldLast4}`}
          </button>
          <button type="button" onClick={() => cancelar(pedido.requestId)} disabled={!!ocupado} className={BOTAO_SECUNDARIO}>
            Voltar
          </button>
        </div>
      </div>
    );
  } else {
    conteudo = (
      <>
        <Desfecho
          ultimo={leitura.ultimo}
          liberada={liberada}
          estado={estado}
          ocupado={ocupado}
          aoRepetir={repetir}
          conexao={conexao}
        />
        {leitura.fase === FASES_DA_TROCA.AGUARDANDO_OUTRA_PESSOA && (
          <Caixa tom="atencao">
            Outra pessoa da equipe começou uma troca nesta conexão e ainda não confirmou.
            {!leitura.bloqueio && " Começar outra aqui cancela a dela."}
          </Caixa>
        )}
        {leitura.bloqueio ? (
          <p className="text-[12.5px] leading-relaxed text-sub">{textoDoBloqueio(leitura.bloqueio)}</p>
        ) : (
          formulario
        )}
      </>
    );
  }

  return (
    <section className="border-t border-line" aria-label="Trocar ou desconectar o WhatsApp">
      {destaque ? (
        <div className="flex min-h-11 items-center gap-2 px-5 py-3 text-[12.5px] font-medium text-fg">{cabecalho}</div>
      ) : (
        <button
          type="button"
          aria-expanded={mostrar}
          onClick={() => setAberto((valor) => !valor)}
          className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-5 py-3 text-left text-[12.5px] font-medium text-sub transition-colors hover:bg-surface-hover"
        >
          {cabecalho}
          <ChevronDown size={15} className={`ml-auto flex-none transition-transform ${mostrar ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      )}
      {mostrar && (
        <div className="px-5 pb-5">
          {erro && <Caixa tom="erro">{erro}</Caixa>}
          {aviso && <Caixa tom="atencao">{aviso}</Caixa>}
          {conteudo}
        </div>
      )}
    </section>
  );
}
