import { useEffect, useMemo, useRef, useState } from "react";
import { BookMarked, BookOpen, ChartColumn, Sparkles } from "lucide-react";
import { api } from "../../../data/client";
import { avaliacaoParaTela, desempenhoDoAgente, normalizarPlaybook } from "../../../domain/equipeDeIa";
import { fmtRelativo } from "../../../lib/formato";

const TOM = { success: "text-success", warning: "text-warning", danger: "text-danger", faint: "text-faint", sub: "text-sub" };
const chance = (p) => (p == null ? "Chance de acerto desconhecida" : `Chance de acerto: ${Math.round(p * 100)}%`);

function usePlaybookPublicado() {
  const [playbook, setPlaybook] = useState(undefined);
  useEffect(() => {
    let vivo = true;
    Promise.resolve()
      .then(() => api.playbook.carregar())
      .then((dados) => vivo && setPlaybook(dados))
      .catch(() => vivo && setPlaybook(null));
    return () => {
      vivo = false;
    };
  }, []);
  return playbook;
}

/* ------------------------------------------------------------------------ *
 * Playbook: o que da régua da empresa entra na leitura deste agente.
 * ------------------------------------------------------------------------ */
export function AbaPlaybook({ agent, aoAbrirPlaybook }) {
  const dados = usePlaybookPublicado();
  if (dados === undefined) return <p className="text-[12px] text-sub">Carregando playbook…</p>;
  const pb = normalizarPlaybook(dados?.publicado);
  const publicado = (dados?.versao || 0) > 0;
  return (
    <div className="grid max-w-2xl gap-4">
      <section className="rounded-[12px] border border-line p-4">
        <div className="flex flex-wrap items-center gap-2">
          <BookMarked size={16} className="text-accent-forte" />
          <h3 className="text-[13.5px] font-semibold">Playbook comercial da empresa</h3>
          {publicado ? (
            <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
              versão {dados.versao} · {fmtRelativo(dados.publicadoEm)}
            </span>
          ) : (
            <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-faint">ainda não publicado</span>
          )}
        </div>
        <p className="mt-2 text-[11.5px] leading-5 text-sub">
          O playbook é um só para a empresa inteira. Nas leituras do Jev, as conversas de {agent.name} são avaliadas com ele e
          com o jeito deste agente.
        </p>
        <ul className="mt-3 grid gap-1.5 text-[12px] sm:grid-cols-2">
          <li>
            <strong className="tabular-nums">{pb.objecoes.length}</strong> objeções viram opções do Jev
          </li>
          <li>
            <strong className="tabular-nums">{pb.proximosPassos.length}</strong> próximos passos o Jev procura
          </li>
          <li>
            <strong className="tabular-nums">{pb.criterios.length}</strong> critérios próprios viram perguntas
          </li>
          <li>
            <strong className="tabular-nums">{pb.oferta.length}</strong> itens de oferta registrados
          </li>
        </ul>
        {aoAbrirPlaybook && (
          <button
            type="button"
            onClick={aoAbrirPlaybook}
            className="mt-3 w-full rounded-[8px] border border-line px-3 py-1.5 text-[11.5px] font-semibold hover:border-accent md:w-auto"
          >
            {publicado ? "Editar playbook" : "Criar o playbook"}
          </button>
        )}
      </section>
      <p className="text-[10.5px] leading-4 text-faint">
        Hoje, o que guia as respostas de {agent.name} são o jeito e as habilidades dele. Levar o playbook também para as
        respostas é a próxima etapa.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Conhecimento: as coleções que o público deste agente enxerga.
 * ------------------------------------------------------------------------ */
export function AbaConhecimento({ agent, data, aoAbrirBiblioteca }) {
  const audiencia = agent.audience === "internal" ? "internal" : "external";
  const colecoes = (data?.collections || []).filter((c) => c.audience === audiencia);
  const documentos = (id) => (data?.documentCollections || []).filter((d) => d.collection_id === id).length;
  return (
    <div className="grid max-w-2xl gap-3">
      <p className="text-[11.5px] leading-5 text-sub">
        {agent.name} consulta o conhecimento{" "}
        {agent.audience === "internal" ? "interno da equipe" : "publicado para clientes"}. É o público do agente que decide o que
        ele enxerga; para mudar o conteúdo, use a Biblioteca.
      </p>
      {colecoes.length ? (
        <div className="grid gap-2">
          {colecoes.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-[10px] border border-line p-3">
              <BookOpen size={15} className="shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold">{c.name}</p>
                {c.description ? <p className="truncate text-[10.5px] text-sub">{c.description}</p> : null}
              </div>
              <span className="text-[10.5px] tabular-nums text-faint">
                {documentos(c.id)} {documentos(c.id) === 1 ? "documento" : "documentos"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-[10px] border border-dashed border-line p-4 text-center text-[11px] text-sub">
          Nenhuma coleção para este público ainda.
        </p>
      )}
      {aoAbrirBiblioteca && (
        <button
          type="button"
          onClick={aoAbrirBiblioteca}
          className="w-full rounded-[8px] border border-line px-3 py-1.5 text-[11.5px] font-semibold hover:border-accent md:w-fit"
        >
          Abrir a Biblioteca
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Testar: avaliação do Jev sobre uma conversa de teste.
 * ------------------------------------------------------------------------ */
const EXEMPLO = `Cliente: Oi, quanto custa o plano trimestral?
Empresa: Oi! O trimestral sai por R$ 289 por mês, com avaliação física inclusa.
Cliente: Achei um pouco caro. Vocês têm horário às 6h?
Empresa: Temos sim! Posso te mandar a grade?`;

const ESPERA_MS = 2000;
const TENTATIVAS = 45;

export function motivoDaAvaliacao(motivo) {
  if (motivo === "insights_disabled") return "O Jev não está ligado na VPS desta conexão. Fale com a Major.";
  if (motivo === "expired") return "A VPS não pegou o pedido a tempo. Confira se a conexão do WhatsApp está ligada e tente de novo.";
  if (motivo === "conversation_empty") return "Escreva a conversa de teste antes de avaliar.";
  if (String(motivo).startsWith("jev_")) return `O Jev não respondeu agora (${motivo}). Tente de novo em instantes.`;
  return motivo ? `A avaliação falhou (${motivo}).` : "A avaliação falhou.";
}

export function erroAoPedir(mensagem) {
  const texto = String(mensagem || "");
  if (texto.includes("disabled")) return "A leitura automática está desligada para esta empresa. A Major liga pelo painel da plataforma.";
  if (texto.includes("management required")) return "Só dono ou admin pode pedir a avaliação.";
  if (texto.includes("between 10")) return "A conversa de teste precisa ter entre 10 e 20.000 caracteres.";
  if (texto.includes("no WhatsApp connection")) return "A empresa ainda não tem um WhatsApp conectado.";
  return texto || "Não deu para pedir a avaliação.";
}

export function AvaliacaoDoJev({ agent, canWrite }) {
  const playbook = usePlaybookPublicado();
  const [texto, setTexto] = useState(EXEMPLO);
  const [rodando, setRodando] = useState(false);
  const [grupos, setGrupos] = useState(null);
  const [erro, setErro] = useState("");
  const vivo = useRef(true);
  useEffect(() => () => {
    vivo.current = false;
  }, []);

  const avaliar = async () => {
    setRodando(true);
    setErro("");
    setGrupos(null);
    try {
      const { comandoId } = await api.inteligencia.avaliarTeste({ agentId: agent.id, transcricao: texto });
      for (let i = 0; i < TENTATIVAS && vivo.current; i += 1) {
        await new Promise((r) => setTimeout(r, ESPERA_MS));
        const status = await api.inteligencia.statusAvaliacao({ comandoId });
        if (status.situacao === "completed") {
          setGrupos(avaliacaoParaTela(status.resultado, playbook?.publicado));
          return;
        }
        if (status.situacao === "failed" || status.situacao === "expired") {
          setErro(motivoDaAvaliacao(status.motivo || status.situacao));
          return;
        }
      }
      if (vivo.current) setErro(motivoDaAvaliacao("expired"));
    } catch (falha) {
      setErro(erroAoPedir(falha.message));
    } finally {
      if (vivo.current) setRodando(false);
    }
  };

  return (
    <section className="rounded-[14px] border border-line bg-bg p-4">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-accent-forte" />
        <h3 className="text-[13.5px] font-semibold">Avaliar uma conversa com o Jev</h3>
      </div>
      <p className="mt-1 text-[11.5px] leading-5 text-sub">
        Escreva uma conversa como ela poderia acontecer, com <strong>Cliente:</strong> e <strong>Empresa:</strong> no começo de
        cada linha. O Jev avalia se ela segue o jeito de {agent.name} ("{agent.tone || "sem jeito definido"}") e o playbook
        publicado. Nada é enviado no WhatsApp e a conversa não fica guardada.
      </p>
      <textarea
        aria-label="Conversa de teste"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={8}
        maxLength={20000}
        disabled={!canWrite || rodando}
        className="mt-3 w-full rounded-[10px] border border-line bg-bg p-3 font-mono text-[11.5px] leading-5 outline-none focus:border-accent disabled:bg-surface"
      />
      <div className="mt-2 flex flex-col items-stretch gap-2 md:flex-row md:items-center">
        {!canWrite && <p className="text-[11px] text-faint">Só dono ou admin pode pedir a avaliação.</p>}
        <button
          type="button"
          onClick={avaliar}
          disabled={!canWrite || rodando || texto.trim().length < 10}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[9px] bg-accent px-4 py-2 text-[11.5px] font-semibold text-white disabled:opacity-40 md:ml-auto md:min-h-0"
        >
          <Sparkles size={14} />
          {rodando ? "Avaliando…" : "Avaliar com o Jev"}
        </button>
      </div>
      {erro && (
        <p role="alert" className="mt-3 text-[11.5px] text-danger">
          {erro}
        </p>
      )}
      {grupos && (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {grupos.length === 0 ? (
            <p className="text-[11.5px] text-sub md:col-span-3">O Jev não devolveu respostas que a tela saiba mostrar.</p>
          ) : (
            grupos.map((grupo) => (
              <div key={grupo.titulo} className="rounded-[10px] bg-surface/70 p-3">
                <p className="text-[10.5px] font-semibold text-sub">{grupo.titulo}</p>
                <div className="mt-1.5 flex flex-col gap-1.5">
                  {grupo.itens.map((item) => (
                    <div key={item.chave} className="flex items-baseline gap-2 text-[11.5px]">
                      <span className="min-w-0 flex-1 text-faint">{item.rotulo}</span>
                      <span title={chance(item.chance)} className={`text-right font-medium ${TOM[item.tom] || "text-fg"}`}>
                        {item.valor}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------ *
 * Desempenho: o que as leituras do Jev dizem deste agente.
 * ------------------------------------------------------------------------ */
function Indicador({ rotulo, taxa, bom = "baixo" }) {
  const valor = taxa?.pct;
  const tom = valor == null ? "text-faint" : (bom === "baixo" ? valor <= 20 : valor >= 60) ? "text-success" : "text-warning";
  return (
    <div className="rounded-[10px] border border-line p-3">
      <p className="text-[10.5px] text-sub">{rotulo}</p>
      <p className={`mt-1 text-[20px] font-semibold tabular-nums ${tom}`}>{valor == null ? "—" : `${valor}%`}</p>
      <p className="text-[10px] text-faint">{taxa?.total ? `em ${taxa.total} ${taxa.total === 1 ? "conversa" : "conversas"}` : "sem leitura confiável"}</p>
    </div>
  );
}

function Barra({ partes }) {
  const total = partes.reduce((s, p) => s + p.qtd, 0);
  if (!total) return <p className="text-[11px] text-faint">Sem leituras.</p>;
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface">
        {partes.map((p) => (p.qtd ? <span key={p.rotulo} className={p.cor} style={{ width: `${(p.qtd / total) * 100}%` }} /> : null))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-sub">
        {partes.map((p) => (
          <span key={p.rotulo} className="inline-flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-full ${p.cor}`} />
            {p.rotulo} <strong className="tabular-nums text-fg">{p.qtd}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

export function AbaDesempenho({ agent }) {
  const [leituras, setLeituras] = useState(null);
  useEffect(() => {
    let vivo = true;
    Promise.resolve()
      .then(() => api.inteligencia.leituras({ dias: 30 }))
      .then((linhas) => vivo && setLeituras(linhas || []))
      .catch(() => vivo && setLeituras([]));
    return () => {
      vivo = false;
    };
  }, [agent.id]);
  const portaDeClientes = Boolean(agent.isDefault && agent.audience !== "internal");
  const d = useMemo(
    () => (leituras ? desempenhoDoAgente(leituras, agent.id, { incluirSemAgente: portaDeClientes }) : null),
    [leituras, agent.id, portaDeClientes],
  );

  if (!d) return <p className="text-[12px] text-sub">Carregando leituras…</p>;
  if (!d.conversas) {
    return (
      <div className="max-w-2xl rounded-[12px] border border-dashed border-line p-5 text-center">
        <ChartColumn size={22} className="mx-auto text-faint" />
        <p className="mt-2 text-[12px] text-sub">
          Nenhuma conversa de {agent.name} lida pelo Jev nos últimos 30 dias. A leitura acontece depois que a conversa fica
          parada por uma hora, e só nas empresas com a leitura automática ligada.
        </p>
      </div>
    );
  }
  return (
    <div className="grid max-w-3xl gap-4">
      <p className="text-[11.5px] leading-5 text-sub">
        <strong className="text-fg">{d.conversas}</strong> {d.conversas === 1 ? "conversa lida" : "conversas lidas"} pelo Jev nos
        últimos 30 dias. Cada taxa conta só as respostas em que ele estava confiante (60% ou mais).
        {d.semAgente ? ` Inclui ${d.semAgente} sem agente identificado, que caem na porta de entrada.` : ""}
      </p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Indicador rotulo="Pergunta sem resposta" taxa={d.perguntaSemResposta} />
        <Indicador rotulo="Propôs próximo passo" taxa={d.proposProximoPasso} bom="alto" />
        <Indicador rotulo="Promessa pendente" taxa={d.promessaPendente} />
        <Indicador rotulo="Seguiu o jeito do agente" taxa={d.seguiuOJeito} bom="alto" />
        <Indicador rotulo="Cliente insatisfeito" taxa={d.insatisfeito} />
        <Indicador rotulo="Pediu uma pessoa" taxa={d.pediuPessoa} />
      </div>
      <section className="grid gap-4 rounded-[12px] border border-line p-4 md:grid-cols-2">
        <div>
          <p className="mb-2 text-[11px] font-semibold text-sub">Temperatura dos leads</p>
          <Barra
            partes={[
              { rotulo: "Frio", qtd: d.temperatura.frio, cor: "bg-faint/50" },
              { rotulo: "Morno", qtd: d.temperatura.morno, cor: "bg-warning" },
              { rotulo: "Quente", qtd: d.temperatura.quente, cor: "bg-success" },
            ]}
          />
        </div>
        <div>
          <p className="mb-2 text-[11px] font-semibold text-sub">Quem atendeu</p>
          <Barra
            partes={[
              { rotulo: "Só a IA", qtd: d.quemAtendeu.soIa, cor: "bg-accent" },
              { rotulo: "Só a equipe", qtd: d.quemAtendeu.soEquipe, cor: "bg-success" },
              { rotulo: "IA e equipe", qtd: d.quemAtendeu.ambos, cor: "bg-warning" },
            ]}
          />
        </div>
      </section>
    </div>
  );
}
