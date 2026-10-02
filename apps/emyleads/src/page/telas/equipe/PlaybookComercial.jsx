import { useEffect, useMemo, useState } from "react";
import { BookMarked, Check, Lightbulb, Plus, Send, Trash2 } from "lucide-react";
import { api } from "../../../data/client";
import { maskPhone } from "../../../domain/customerAssistant";
import {
  LIMITES,
  MODELOS,
  aplicarModelo,
  chaveUnica,
  limparPlaybook,
  normalizarPlaybook,
  playbookVazio,
  problemaDoPlaybook,
  sinaisParaOPlaybook,
} from "../../../domain/equipeDeIa";
import { fmtRelativo } from "../../../lib/formato";

const entrada =
  "w-full rounded-[9px] border border-line bg-bg px-3 py-2 text-[12.5px] outline-none focus:border-accent disabled:bg-surface disabled:text-faint";

/**
 * Uma parte do playbook que é lista de itens com campos (oferta, objeções,
 * próximos passos, critérios). Cada linha é um item; a chave que o Jev usa é
 * gerada do nome na hora de salvar e nunca aparece para quem edita.
 */
function ListaDeItens({ titulo, ajuda, itens, campos, limite, vazio, novo, aoMudar, disabled }) {
  const trocar = (indice, campo, valor) =>
    aoMudar(itens.map((item, i) => (i === indice ? { ...item, [campo]: valor } : item)));
  const remover = (indice) => aoMudar(itens.filter((_, i) => i !== indice));
  return (
    <section className="rounded-[14px] border border-line bg-bg p-4">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[13.5px] font-semibold">{titulo}</h3>
        <span className="text-[10.5px] tabular-nums text-faint">
          {itens.length}/{limite}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] leading-4 text-sub">{ajuda}</p>
      <div className="mt-3 flex flex-col gap-2">
        {itens.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-line p-3 text-center text-[11px] text-faint">{vazio}</p>
        ) : (
          itens.map((item, indice) => (
            <div key={indice} className="flex items-start gap-2 rounded-[10px] bg-surface/60 p-2">
              <div className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                {campos.map(([campo, placeholder, largo]) => (
                  <input
                    key={campo}
                    aria-label={`${titulo}: ${placeholder}`}
                    disabled={disabled}
                    value={item[campo] || ""}
                    placeholder={placeholder}
                    maxLength={LIMITES.texto}
                    onChange={(e) => trocar(indice, campo, e.target.value)}
                    className={`${entrada} ${largo ? "sm:col-span-2" : ""}`}
                  />
                ))}
              </div>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remover(indice)}
                  aria-label={`Remover de ${titulo}`}
                  className="mt-1 rounded-[7px] p-2.5 text-faint hover:bg-danger/10 hover:text-danger md:mt-1.5 md:p-1.5"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))
        )}
      </div>
      {!disabled && itens.length < limite && (
        <button
          type="button"
          onClick={() => aoMudar([...itens, novo()])}
          className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-line px-2 py-1.5 text-[11.5px] font-semibold text-accent-forte hover:bg-accent-soft md:min-h-0 md:w-auto md:justify-start md:border-0"
        >
          <Plus size={14} />
          Adicionar
        </button>
      )}
    </section>
  );
}

function ListaDeFrases({ titulo, frases, aoMudar, disabled, placeholder }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-sub">{titulo}</p>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {frases.map((frase, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              aria-label={titulo}
              disabled={disabled}
              value={frase}
              placeholder={placeholder}
              maxLength={200}
              onChange={(e) => aoMudar(frases.map((f, j) => (j === i ? e.target.value : f)))}
              className={entrada}
            />
            {!disabled && (
              <button
                type="button"
                aria-label={`Remover de ${titulo}`}
                onClick={() => aoMudar(frases.filter((_, j) => j !== i))}
                className="rounded-[7px] p-2.5 text-faint hover:bg-danger/10 hover:text-danger md:p-1.5"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
        {!disabled && frases.length < LIMITES.clienteIdeal && (
          <button
            type="button"
            onClick={() => aoMudar([...frases, ""])}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-line px-2 py-1 text-[11px] font-semibold text-accent-forte hover:bg-accent-soft md:min-h-0 md:w-fit md:justify-start md:border-0"
          >
            <Plus size={13} />
            Adicionar
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * O que as leituras do Jev dizem para o playbook (últimos 30 dias): as
 * objeções que mais aparecem, com atalho para acrescentar as que faltam, e as
 * conversas cuja objeção não está na lista, para alguém ler.
 */
function SinaisDasConversas({ sinais, carregando, podeAcrescentar, aoAcrescentar }) {
  return (
    <section className="rounded-[14px] border border-accent/25 bg-accent-soft/40 p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Lightbulb size={16} className="text-accent-forte" />
        <h3 className="text-[13.5px] font-semibold">O que as conversas dizem</h3>
        <span className="w-full text-[10.5px] text-faint md:ml-auto md:w-auto">últimos 30 dias · leitura do Jev</span>
      </div>
      {carregando ? (
        <p className="mt-3 text-[11.5px] text-sub">Carregando leituras…</p>
      ) : sinais.objecoes.length === 0 && sinais.totalOutras === 0 ? (
        <p className="mt-3 text-[11.5px] text-sub">
          Ainda não há leituras com objeção. Elas aparecem aqui conforme o Jev lê as conversas.
        </p>
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold text-sub">Objeções que mais aparecem</p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {sinais.objecoes.slice(0, 6).map((o) => (
                <li key={o.chave} className="flex items-center gap-2 text-[12px]">
                  <span className="min-w-0 flex-1 truncate">{o.nome}</span>
                  <span className="tabular-nums text-sub">{o.qtd}</span>
                  {o.doPlaybook ? (
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">no playbook</span>
                  ) : podeAcrescentar ? (
                    <button
                      type="button"
                      onClick={() => aoAcrescentar(o)}
                      className="min-h-[36px] rounded-full border border-accent/40 px-3 py-0.5 text-[10px] font-semibold text-accent-forte hover:bg-bg md:min-h-0 md:px-2"
                    >
                      Acrescentar
                    </button>
                  ) : (
                    <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] text-faint">fora do playbook</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-sub">
              Objeção fora da lista: {sinais.totalOutras} {sinais.totalOutras === 1 ? "conversa" : "conversas"}
            </p>
            {sinais.totalOutras > 0 ? (
              <>
                <p className="mt-1 text-[11px] leading-4 text-sub">
                  O Jev viu uma objeção que não está no playbook. Leia algumas destas conversas e acrescente a que se repetir.
                </p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {sinais.outras.map((c) => (
                    <li key={`${c.telefone}-${c.quando}`} className="text-[11.5px] text-sub">
                      {maskPhone(c.telefone)} · {fmtRelativo(c.quando)}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-1 text-[11px] text-sub">Todas as objeções lidas cabem na lista. Bom sinal.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default function PlaybookComercial({ canWrite }) {
  const [estado, setEstado] = useState(null);
  const [pb, setPb] = useState(playbookVazio());
  const [original, setOriginal] = useState(JSON.stringify(playbookVazio()));
  const [leituras, setLeituras] = useState(null);
  const [salvando, setSalvando] = useState("");
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");

  const carregar = async () => {
    const dados = await api.playbook.carregar();
    const base = Object.keys(dados.rascunho || {}).length ? dados.rascunho : dados.publicado;
    const normal = normalizarPlaybook(base);
    setEstado(dados);
    setPb(normal);
    setOriginal(JSON.stringify(normal));
  };

  useEffect(() => {
    carregar().catch((falha) => setErro(falha.message));
    Promise.resolve()
      .then(() => api.inteligencia.leituras({ dias: 30 }))
      .then((linhas) => setLeituras(linhas || []))
      .catch(() => setLeituras([]));
  }, []);

  const sinais = useMemo(() => sinaisParaOPlaybook(leituras || [], pb), [leituras, pb]);
  const sujo = JSON.stringify(pb) !== original;
  const publicadoDiferente =
    estado && estado.versao > 0 && JSON.stringify(limparPlaybook(pb)) !== JSON.stringify(limparPlaybook(estado.publicado));
  const disabled = !canWrite || Boolean(salvando);
  const parte = (chave) => (valor) => {
    setAviso("");
    setPb((atual) => ({ ...atual, [chave]: valor }));
  };

  const gravar = async (publicar) => {
    const limpo = limparPlaybook(pb);
    const problema = problemaDoPlaybook(limpo);
    if (problema) {
      setErro(problema);
      return;
    }
    setSalvando(publicar ? "publicando" : "salvando");
    setErro("");
    setAviso("");
    try {
      const r = await api.playbook.salvar({ conteudo: limpo, publicar });
      await carregar();
      setAviso(publicar ? `Publicado: versão ${r?.version ?? ""}. O Jev usa esta versão a partir da próxima leitura.` : "Rascunho salvo.");
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setSalvando("");
    }
  };

  const acrescentarObjecao = (objecao) => {
    if (pb.objecoes.length >= LIMITES.objecoes) return;
    const chaves = pb.objecoes.map((o) => o.chave);
    const chave = chaves.includes(objecao.chave) ? chaveUnica(objecao.nome, chaves) : objecao.chave;
    parte("objecoes")([...pb.objecoes, { chave, nome: objecao.nome, resposta: "" }]);
  };

  if (!estado && !erro) {
    return <div className="flex flex-1 items-center justify-center text-[12.5px] text-sub">Carregando playbook…</div>;
  }

  return (
    <div className="scrollbar-fina flex-1 overflow-y-auto p-4 md:p-7">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <BookMarked size={18} className="text-accent-forte" />
            <h2 className="text-[19px] font-semibold tracking-tight">Playbook comercial</h2>
            {estado?.versao > 0 ? (
              <span className="rounded-full bg-success/10 px-2.5 py-0.5 text-[10.5px] font-semibold text-success">
                Publicado · versão {estado.versao} · {fmtRelativo(estado.publicadoEm)}
              </span>
            ) : (
              <span className="rounded-full bg-surface px-2.5 py-0.5 text-[10.5px] font-semibold text-faint">Ainda não publicado</span>
            )}
            {publicadoDiferente && (
              <span className="rounded-full bg-warning/10 px-2.5 py-0.5 text-[10.5px] font-semibold text-warning">
                Há mudanças não publicadas
              </span>
            )}
          </div>
          <p className="line-clamp-3 max-w-2xl text-[12px] leading-5 text-sub md:line-clamp-none">
            A régua comercial da empresa, escrita uma vez. O Jev usa a versão publicada para ler as conversas: as objeções e os
            próximos passos viram as opções dele, e os critérios próprios viram perguntas. O jeito de falar continua no soul de
            cada agente.
          </p>
          {canWrite && (
            <label className="flex w-full flex-col items-stretch gap-1.5 text-[11.5px] text-sub md:w-fit md:flex-row md:items-center md:gap-2">
              Começar de um modelo
              <select
                value=""
                disabled={disabled}
                onChange={(e) => {
                  if (!e.target.value) return;
                  setPb((atual) => aplicarModelo(atual, e.target.value));
                  setAviso("Modelo somado ao que já existia. Revise e ajuste antes de publicar.");
                }}
                className="rounded-[8px] border border-line bg-bg px-2 py-1.5 text-[12px]"
              >
                <option value="">Escolha um segmento…</option>
                {Object.entries(MODELOS).map(([id, modelo]) => (
                  <option key={id} value={id}>
                    {modelo.nome}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>

        <SinaisDasConversas
          sinais={sinais}
          carregando={leituras === null}
          podeAcrescentar={canWrite && pb.objecoes.length < LIMITES.objecoes}
          aoAcrescentar={acrescentarObjecao}
        />

        <ListaDeItens
          titulo="Oferta"
          ajuda="O que a empresa vende: o nome, o preço e o que está incluso."
          itens={pb.oferta}
          campos={[["nome", "Nome do plano ou serviço"], ["preco", "Preço"], ["inclui", "O que inclui", true]]}
          limite={LIMITES.oferta}
          vazio="Nenhum item na oferta."
          novo={() => ({ nome: "", preco: "", inclui: "" })}
          aoMudar={parte("oferta")}
          disabled={disabled}
        />

        <section className="rounded-[14px] border border-line bg-bg p-4">
          <h3 className="text-[13.5px] font-semibold">Cliente ideal</h3>
          <p className="mt-0.5 text-[11px] leading-4 text-sub">Frases curtas sobre quem a empresa quer atender e quem não quer.</p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <ListaDeFrases
              titulo="Atende"
              frases={pb.clienteIdeal.atende}
              placeholder="Ex.: quer treinar com acompanhamento"
              aoMudar={(atende) => parte("clienteIdeal")({ ...pb.clienteIdeal, atende })}
              disabled={disabled}
            />
            <ListaDeFrases
              titulo="Não atende"
              frases={pb.clienteIdeal.naoAtende}
              placeholder="Ex.: menor de 14 anos"
              aoMudar={(naoAtende) => parte("clienteIdeal")({ ...pb.clienteIdeal, naoAtende })}
              disabled={disabled}
            />
          </div>
        </section>

        <ListaDeItens
          titulo="Objeções"
          ajuda="O que o cliente costuma dizer para não fechar, e a resposta que a empresa espera. Vira as opções do Jev."
          itens={pb.objecoes}
          campos={[["nome", "Objeção (ex.: Preço)"], ["resposta", "Resposta esperada da equipe"]]}
          limite={LIMITES.objecoes}
          vazio="Nenhuma objeção. O Jev usa as da Major (preço, horário, confiança…)."
          novo={() => ({ chave: "", nome: "", resposta: "" })}
          aoMudar={parte("objecoes")}
          disabled={disabled}
        />

        <ListaDeItens
          titulo="Próximos passos"
          ajuda="O que conta como avanço: agendar, visitar, aula experimental. O Jev diz qual deles foi oferecido."
          itens={pb.proximosPassos}
          campos={[["nome", "Próximo passo (ex.: Aula experimental)"], ["quando", "Quando oferecer"]]}
          limite={LIMITES.proximosPassos}
          vazio="Nenhum próximo passo."
          novo={() => ({ chave: "", nome: "", quando: "" })}
          aoMudar={parte("proximosPassos")}
          disabled={disabled}
        />

        <ListaDeItens
          titulo="Critérios próprios"
          ajuda="Perguntas de sim ou não que só esta empresa faz. Cada uma vira uma pergunta do Jev em toda conversa."
          itens={pb.criterios}
          campos={[["pergunta", "Pergunta (ex.: Ofereceu a aula experimental?)"], ["sim", "O que conta como sim"]]}
          limite={LIMITES.criterios}
          vazio="Nenhum critério próprio."
          novo={() => ({ chave: "", pergunta: "", sim: "" })}
          aoMudar={parte("criterios")}
          disabled={disabled}
        />
      </div>

      {canWrite && (
        <footer className="playbook-rodape sticky bottom-0 mx-auto mt-4 flex max-w-4xl flex-wrap items-center gap-2 rounded-[12px] border border-line bg-bg/95 px-4 py-3 shadow-sm">
          {erro ? (
            <p role="alert" className="text-[11.5px] text-danger">
              {erro}
            </p>
          ) : aviso ? (
            <p className="text-[11.5px] text-success">{aviso}</p>
          ) : (
            <p className="text-[11px] text-faint">{sujo ? "Alterações não salvas." : "Tudo salvo."}</p>
          )}
          <div className="flex w-full gap-2 md:ml-auto md:w-auto">
            <button
              type="button"
              onClick={() => gravar(false)}
              disabled={disabled || !sujo}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[9px] border border-line px-3 py-2 text-[11.5px] font-semibold disabled:opacity-40 md:min-h-0 md:flex-none"
            >
              <Check size={14} />
              {salvando === "salvando" ? "Salvando…" : "Salvar rascunho"}
            </button>
            <button
              type="button"
              onClick={() => gravar(true)}
              disabled={disabled}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[9px] bg-accent px-4 py-2 text-[11.5px] font-semibold text-white disabled:opacity-40 md:min-h-0 md:flex-none"
            >
              <Send size={14} />
              {salvando === "publicando" ? "Publicando…" : "Publicar"}
            </button>
          </div>
        </footer>
      )}
      {erro && !canWrite ? (
        <p role="alert" className="mx-auto mt-3 max-w-4xl text-[11.5px] text-danger">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
