import { useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { instanteEmTexto, linhaDoTempo, periodoDaLinha, semNumerosInternos as limpo } from "../../../domain/analiseDaConversa";
import {
  PONTOS_DO_VENDEDOR,
  ROTULO_DO_ALERTA_V2,
  contaDoVendedor,
  criticaDoPonto,
  faixaDaNota,
  linhaDoVendedor,
  nomeDoPonto,
  pontosEmOrdem,
  pontosEmTexto,
  resumoDoVendedorParaCopiar,
  rotuloDoPonto,
  tomDoPonto,
  velocidadeEmTexto,
  vendedorEmTexto,
} from "../../../domain/vendedorV2";
import { Anel, BOTAO, CARTAO, CHIP, Evidencias, OQueFazer, OndeAconteceu, ROTULO } from "./RelatorioDaAnalise";

const TEXTO_DO_TOM = { success: "text-success", warning: "text-warning", danger: "text-danger", faint: "text-sub" };

/**
 * O relatório da Avaliação do vendedor v2 (migration 20261008100000), no
 * desenho aprovado no canvas: a nota do vendedor com a faixa, quem atendeu,
 * o veredito cru, o que fez bem e o que custou a venda, o que fazer agora, os
 * 9 pontos (do que mais custou ao que foi bem, cada um com a crítica e o que
 * um vendedor top teria feito) e onde aconteceu na conversa.
 *
 * Nada é calculado aqui: nota, faixa, cobertura e estados vêm do banco; a
 * crítica e a reescrita, do Analista. Ponto não avaliado aparece como "—" e
 * nunca conta contra.
 */
export function RelatorioDoVendedor({ analise, nome = "", podeAgir, contato, negocio, aoUsarMensagem, aoVerMensagem, aoCriado, aoFechar }) {
  const relatorio = analise.relatorio || {};
  const diagnostico = relatorio.diagnosis || {};
  const nota = relatorio.vendedor_score || null;
  const pontos = useMemo(() => pontosEmOrdem(nota?.criteria || []), [nota]);
  const alertas = relatorio.red_flags || [];
  const acoes = diagnostico.what_to_do_now || [];
  const sugerida = diagnostico.suggested_message?.applicable ? diagnostico.suggested_message.text : null;
  const linha = useMemo(
    () => linhaDoTempo(linhaDoVendedor(analise.linhaDoTempo, diagnostico, alertas), alertas),
    [analise.linhaDoTempo, diagnostico, alertas]
  );
  const [aviso, setAviso] = useState("");

  const verEvidencia = aoVerMensagem
    ? (id) => {
        if (aoVerMensagem(id)) aoFechar?.();
        else setAviso("Essa mensagem não está entre as carregadas na conversa. Role a conversa para cima e tente de novo.");
      }
    : null;
  const usarMensagem = aoUsarMensagem
    ? (texto) => {
        aoUsarMensagem(texto);
        aoFechar?.();
      }
    : null;
  const copiar = async (texto, feito) => {
    try {
      await navigator.clipboard.writeText(texto);
      setAviso(feito);
    } catch {
      setAviso("Não foi possível copiar. Selecione o texto e copie à mão.");
    }
  };

  const meta = [periodoDaLinha(linha), analise.concluidaEm ? `analisada em ${instanteEmTexto(new Date(analise.concluidaEm).getTime())}` : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2 lg:col-span-2">
        <span className="text-[12.5px] text-sub">{meta}</span>
        <button type="button" onClick={() => copiar(resumoDoVendedorParaCopiar({ nome, relatorio }), "Resumo copiado.")} className={BOTAO}>
          <Copy size={15} strokeWidth={2} /> Copiar resumo
        </button>
      </div>

      <CartaoDaNota nota={nota} vendedor={relatorio.seller} velocidade={relatorio.speed} />

      <Veredito diagnostico={diagnostico} faixa={faixaDaNota(nota)} alertas={alertas} aoVer={verEvidencia} />

      {acoes.length > 0 && (
        <div className="lg:col-span-2">
          <OQueFazer
            acoes={acoes}
            sugerida={sugerida}
            podeAgir={podeAgir}
            contato={contato}
            negocio={negocio}
            aoUsarMensagem={usarMensagem}
            aoCopiar={(texto) => copiar(texto, "Mensagem copiada.")}
            aoVer={verEvidencia}
            aoCriado={aoCriado}
          />
        </div>
      )}

      {pontos.length > 0 && (
        <div className="lg:col-span-2">
          <OsNovePontos nota={nota} pontos={pontos} aoVer={verEvidencia} />
        </div>
      )}

      {linha && (
        <div className="lg:col-span-2">
          <OndeAconteceu linha={linha} aoVer={verEvidencia} />
        </div>
      )}

      <p className="text-[12px] leading-[18px] text-sub lg:col-span-2">
        Faixas: <b className="text-success">Vendeu bem</b> de 75 a 100 · <b className="text-warning">Atende, mas não fecha</b> de 50 a 74 ·{" "}
        <b className="text-danger">Atrapalhou a venda</b> abaixo de 50. Com menos de 50% avaliado, a nota não é conclusiva. A crítica é sobre o
        trabalho, nunca sobre a pessoa.
      </p>

      {aviso && (
        <p role="status" className="text-[12px] text-sub lg:col-span-2">
          {aviso}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- a nota

function CartaoDaNota({ nota, vendedor, velocidade }) {
  const faixa = faixaDaNota(nota);
  const conta = contaDoVendedor(nota);
  const quem = vendedorEmTexto(vendedor);
  const tempo = velocidadeEmTexto(velocidade);
  return (
    <section aria-label="Nota do vendedor" className={`${CARTAO} flex flex-col gap-4`}>
      <h2 className={ROTULO}>Nota do vendedor</h2>
      <div className="flex items-center gap-4 lg:gap-5">
        <Anel nota={nota?.score ?? null} cobertura={nota?.coverage ?? 0} baixa={!faixa.conclusiva} />
        <div className="flex min-w-0 flex-col items-start gap-2">
          <span data-faixa className={`rounded-ctl px-2.5 py-[3px] text-[12.5px] font-bold ${CHIP[faixa.tom]}`}>
            {faixa.rotulo}
          </span>
          {nota?.coverage != null && <span className="text-[13px] font-semibold text-signal">{nota.coverage}% avaliado</span>}
        </div>
      </div>
      {nota?.score != null && (
        <p className={`rounded-none px-3.5 py-3 text-[12.5px] leading-[18px] ${faixa.conclusiva ? "bg-surface text-fg" : "bg-warning-soft text-warning"}`}>
          {faixa.conclusiva ? (
            <>
              Fez <b>{String(conta.pontos).replace(".", ",")}</b> dos <b>{conta.peso}</b> pontos que dava para avaliar.
            </>
          ) : (
            "Poucos pontos deram para avaliar: a nota ainda não é conclusiva."
          )}
        </p>
      )}
      <div className="flex flex-col gap-1 border-t border-line pt-3">
        <span className={ROTULO}>Quem atendeu</span>
        <span data-vendedor className="text-[14px] font-semibold text-fg">{quem.nome}</span>
        {quem.nota && <span className="text-[12px] leading-[17px] text-sub">{quem.nota}</span>}
        {tempo && <span className="text-[12px] leading-[17px] text-sub">{tempo}</span>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- o veredito

function Veredito({ diagnostico, faixa, alertas, aoVer }) {
  const veredito = limpo(diagnostico.verdict || diagnostico.summary);
  const bem = diagnostico.did_well || [];
  const custou = diagnostico.cost_the_sale || [];
  return (
    <section className={`${CARTAO} flex h-full flex-col gap-5`}>
      {veredito && (
        <div className="flex flex-col gap-1.5">
          <h2 className={`text-[12px] font-semibold ${TEXTO_DO_TOM[faixa.tom]}`}>Veredito</h2>
          <p className="text-[17px] font-semibold leading-[25px] text-fg lg:text-[20px] lg:leading-[28px]">{veredito}</p>
        </div>
      )}
      {(bem.length > 0 || custou.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Lista titulo="O que fez bem" tom="text-success" itens={bem} vazio="Nada que mereça destaque nesta conversa." aoVer={aoVer} />
          <Lista titulo="O que custou a venda" tom="text-danger" itens={custou} vazio="Nada custou a venda nesta conversa." aoVer={aoVer} />
        </div>
      )}
      {alertas.length > 0 && (
        <ul className="flex flex-col" aria-label="Alertas">
          {alertas.map((alerta) => (
            <li key={alerta.code} className="flex min-h-[40px] items-center gap-3 border-t border-line py-2 text-[13px]">
              <span aria-hidden="true" className="h-2.5 w-2.5 flex-none rounded-full bg-danger" />
              <span className="min-w-0 flex-1">
                <b className="font-semibold text-fg">{ROTULO_DO_ALERTA_V2[alerta.code] || alerta.code}</b>
                {alerta.reason && <span className="text-sub"> · {limpo(alerta.reason)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Lista({ titulo, tom, itens, vazio, aoVer }) {
  return (
    <div className="flex flex-col gap-2 border border-line p-3.5">
      <h3 className={`text-[12px] font-semibold ${tom}`}>{titulo}</h3>
      {itens.length === 0 ? (
        <p className="text-[13px] text-sub">{vazio}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {itens.map((item, indice) => (
            <li key={indice} className="text-[13.5px] leading-[19px] text-fg">
              {limpo(item.title)}
              <Evidencias ids={item.evidence_message_ids} aoVer={aoVer} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- os 9 pontos

function OsNovePontos({ nota, pontos, aoVer }) {
  const conta = contaDoVendedor(nota);
  const LINHA = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 lg:grid-cols-[190px_130px_64px_minmax(0,1fr)_minmax(0,1fr)] lg:gap-x-4";
  return (
    <section className={`${CARTAO} flex flex-col gap-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[16px] font-bold text-fg lg:text-[18px]">Os 9 pontos de um bom vendedor</h2>
        {conta.texto && <span className="text-[12px] tabular-nums text-sub">{conta.texto}</span>}
      </div>
      <div role="table" aria-label="Pontos do vendedor" className="flex flex-col">
        <div role="row" className={`${LINHA} hidden border-b border-line-strong py-2 text-[12px] font-semibold text-sub lg:grid`}>
          <span role="columnheader">Ponto · de onde vem</span>
          <span role="columnheader">Estado</span>
          <span role="columnheader">Pontos</span>
          <span role="columnheader">O que aconteceu</span>
          <span role="columnheader">O que um vendedor top teria feito</span>
        </div>
        {pontos.map((ponto) => {
          const avaliado = ponto.points_awarded != null;
          const bom = avaliado && ponto.status === "bom";
          return (
            <div key={ponto.key} role="row" data-ponto={ponto.key} className={`${LINHA} items-start border-b border-line/60 py-3 last:border-b-0`}>
              <span role="cell" className="flex flex-col">
                <span className={`text-[13.5px] font-semibold ${avaliado ? "text-fg" : "text-sub"}`}>{nomeDoPonto(ponto)}</span>
                <span className="text-[11.5px] text-sub">{PONTOS_DO_VENDEDOR[ponto.key]?.fonte}</span>
              </span>
              <span role="cell">
                <span className={`inline-block whitespace-nowrap rounded-ctl px-2.5 py-[3px] text-[11.5px] font-semibold ${CHIP[tomDoPonto(ponto)]}`}>
                  {rotuloDoPonto(ponto)}
                  {avaliado && <span className="lg:hidden"> · {pontosEmTexto(ponto)}</span>}
                </span>
              </span>
              <span role="cell" className="hidden text-[13px] tabular-nums text-fg lg:block">
                {pontosEmTexto(ponto)}
              </span>
              <span role="cell" className={`col-span-2 text-[13px] leading-[19px] lg:col-span-1 ${avaliado ? "text-fg/85" : "text-sub"}`}>
                {criticaDoPonto(ponto)}
                <Evidencias ids={ponto.evidence_message_ids} aoVer={aoVer} />
              </span>
              <span role="cell" className="col-span-2 text-[13px] leading-[19px] lg:col-span-1">
                {ponto.better ? (
                  <span className="block bg-surface px-3 py-2 text-fg">{limpo(ponto.better)}</span>
                ) : (
                  <span className="text-sub">{bom ? "Manter." : "—"}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[12px] text-sub">“Não avaliado” é o que a conversa não mostra (uma ligação fora do WhatsApp, por exemplo) e nunca conta contra.</p>
    </section>
  );
}
