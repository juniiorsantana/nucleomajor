import { useEffect, useMemo, useRef, useState } from "react";
import { MailOpen, PanelRight, Plus, Search, Users } from "lucide-react";
import { CATEGORIAS_DE_MODELO } from "../../data/modelosPadrao";
import { DONOS_CURTOS } from "../../ui/atendimento";
import { nomeCurto } from "../../ui/perfil";
import { formatPhone } from "../../lib/phone";
import { SeloWhatsApp } from "../ui";
import { FichaLateral } from "./conversas/ficha";
import { PainelAtalhos, PainelModelos } from "./conversas/paineis";
import {
  AvatarComDono,
  Bolha,
  Composer,
  DivisorData,
  FaixaAtendimento,
  FaixaNaoLidas,
  LinhaConversa,
  PilulaSistema,
} from "./conversas/pecas";
import { useConversas } from "./conversas/useConversas";

/**
 * Conversas — a caixa de entrada da equipe.
 *
 * Desenhada em `docs/design/conversas/` antes de existir back-end de
 * mensagens, e subiu com histórico de demonstração. Hoje o portal lê conversas
 * de verdade do espelho que a VPS publica (`web/conversasProvider.js`), e a
 * ficha ao lado lê os mesmos negócios, tarefas e notas que a tela de Contatos
 * lê. A tela não mudou na travessia: trocou-se o provider, como estava
 * previsto. O mock (`data/conversasMock.js`) continua servindo a bancada.
 *
 * Ler e escrever funcionam. Escrever não abre porta na VPS: mandar mensagem e
 * atribuir quem atende viram comando na fila que o runtime já consome. Isso
 * tem uma consequência visível, e ela é honesta — enfileirar não é enviar. A
 * bolha nasce com um relógio, ganha o tique quando a mensagem volta do
 * aparelho, e vira alerta com motivo quando o Bridge recusa.
 *
 * Grupo entra na lista com o nome do grupo, e só. Não tem telefone, não tem
 * ficha, não tem dono de atendimento — as três coisas que uma conversa de
 * grupo não tem mesmo, e fingir que tem seria pior que não mostrá-lo.
 *
 * Três colunas, duas somem: a ficha fecha pelo botão do cabeçalho e o menu
 * lateral recolhe na Gestão. Juntas devolvem espaço para a conversa, que é o
 * que se lê o dia inteiro.
 *
 * O que veio do WhatsApp veio de propósito, e o que não veio também: o verde
 * ficou de fora. Aqui verde é sucesso e roxo é a marca — o contador de não
 * lidas é roxo. É o que impede o produto de virar extensão visual do WhatsApp.
 */

const maiuscula = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/**
 * Os filtros: os três donos, o não lido, e os grupos.
 *
 * "Grupos" não é conveniência — em produção grupo é mais da metade da caixa de
 * entrada, e sem uma forma de separá-los a lista de atendimento fica soterrada
 * pelas conversas internas da equipe. É o mesmo filtro lido dos dois lados:
 * quem quer atender esconde grupo, quem quer o assunto do time só vê grupo.
 */
const FILTROS = [
  { id: "tudo", rotulo: "Tudo" },
  { id: "naolidas", rotulo: "Não lidas" },
  { id: "humano", rotulo: maiuscula(DONOS_CURTOS.humano) },
  { id: "ia", rotulo: maiuscula(DONOS_CURTOS.ia) },
  { id: "bot", rotulo: maiuscula(DONOS_CURTOS.bot) },
  { id: "grupos", rotulo: "Grupos" },
];

function passaFiltro(conversa, filtro) {
  if (filtro === "naolidas") return conversa.naoLidas > 0;
  if (filtro === "tudo") return true;
  if (filtro === "grupos") return conversa.grupo === true;
  // Grupo não tem dono de atendimento: ele sobe com o dono padrão da conexão,
  // que é quase sempre "bot". Deixá-lo passar pelos filtros de dono faria a
  // aba do robô virar a lista dos grupos.
  return !conversa.grupo && conversa.dono === filtro;
}

function passaBusca(conversa, termo) {
  if (!termo) return true;
  const alvo =
    `${conversa.nome} ${conversa.empresa} ${conversa.previa} ${conversa.atendenteNome || ""}`
      .toLowerCase();
  return alvo.includes(termo);
}

/** A última coisa que o contato disse — é dela que a tarefa se preenche. */
function ultimaRecebida(mensagens) {
  const ultima = [...mensagens].reverse().find((m) => m.tipo === "mensagem" && m.direcao === "entra");
  return ultima?.texto || "";
}

/* ------------------------------------------------------------------ */

export default function Conversas({ dados, recarregar, aoAbrirContato, sessao }) {
  const {
    conversas,
    modelos,
    atual,
    setAtual,
    mensagens,
    equipe,
    erro,
    aviso,
    enviar,
    trocarDono,
    guardarBaralho,
  } = useConversas(sessao?.organizacaoAtual?.id);

  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("tudo");
  const [rascunho, setRascunho] = useState("");
  const [aba, setAba] = useState(null);
  const [atalho, setAtalho] = useState(null);
  const [fichaAberta, setFichaAberta] = useState(true);

  const fimDaConversa = useRef(null);

  const termo = busca.trim().toLowerCase();
  const visiveis = useMemo(
    () => (conversas || []).filter((c) => passaFiltro(c, filtro) && passaBusca(c, termo)),
    [conversas, filtro, termo]
  );
  const conversa = (conversas || []).find((c) => c.id === atual) || null;

  // A conversa nasce no fim, e não no começo: o que importa é a última
  // mensagem, não a primeira.
  useEffect(() => {
    fimDaConversa.current?.scrollIntoView({ block: "end" });
  }, [mensagens]);

  const contato = dados.contatos.find((c) => c.id === conversa?.contactId) || null;
  const negocio = useMemo(() => {
    if (!contato) return null;
    return (
      dados.negocios
        .filter((n) => n.contactId === contato.id && n.status === "aberto")
        .sort((a, b) => b.atualizadoEm - a.atualizadoEm)[0] || null
    );
  }, [contato, dados.negocios]);
  const tarefa = useMemo(() => {
    if (!contato) return null;
    return (
      dados.tarefas
        .filter((t) => t.contactId === contato.id && !t.concluida)
        .sort((a, b) => (a.venceEm ?? Infinity) - (b.venceEm ?? Infinity))[0] || null
    );
  }, [contato, dados.tarefas]);
  const nota = useMemo(() => {
    if (!contato) return null;
    return (
      dados.notas
        .filter((n) => n.contactId === contato.id)
        .sort((a, b) => b.criadoEm - a.criadoEm)[0] || null
    );
  }, [contato, dados.notas]);
  const etiquetas = useMemo(
    () => dados.tags.filter((t) => (contato?.tags || []).includes(t.id)),
    [contato, dados.tags]
  );

  const eu = nomeCurto(sessao?.usuario?.perfil, "Você");

  const alternarAba = (nome, forcar = false) => {
    setAba((antes) => (!forcar && antes === nome ? null : nome));
    if (nome !== "atalhos") setAtalho(null);
  };

  const mandar = async (texto) => {
    try {
      await enviar(texto);
      setRascunho("");
      setAba(null);
    } catch {
      // O texto fica na caixa de propósito: quem escreveu não deve perder o que
      // escreveu porque o envio falhou. O motivo aparece abaixo dela.
    }
  };

  const abrirAtalho = (qual) => {
    setAba("atalhos");
    setAtalho(qual);
  };

  if (erro) {
    return (
      <div className="m-8 rounded-[10px] border border-danger/40 bg-danger/10 px-4 py-3 text-[13.5px] text-danger">
        {erro}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* Atender pelo telefone é outro produto, não esta tela espremida: a
          conversa só se lê com a lista de um lado e a ficha do outro. No
          celular, o caminho continua sendo o WhatsApp com o painel do
          EmyLeads dentro. */}
      <div className="flex flex-1 items-center justify-center px-8 text-center text-[13px] leading-relaxed text-sub md:hidden">
        Conversas é uma tela de computador — ela precisa da lista, da conversa e
        da ficha lado a lado. No celular, atenda pelo WhatsApp com o painel do
        EmyLeads.
      </div>

      {/* Coluna 1 — a lista */}
      <div className="hidden w-[336px] flex-none flex-col border-r border-line bg-bg md:flex">
        <div className="flex-none px-3.5 pb-2.5 pt-3.5">
          <div className="flex items-center gap-2">
            <h1 className="text-[19px] font-semibold tracking-tight text-fg">Conversas</h1>
            <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10.5px] font-semibold text-sub">
              {visiveis.length}
            </span>
            <button
              title="Nova conversa — ainda sem envio para número novo"
              disabled
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-[9px] text-sub opacity-40"
            >
              <Plus size={17} strokeWidth={2.2} />
            </button>
          </div>

          <div className="relative mt-2.5">
            <Search
              size={16}
              strokeWidth={2}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar conversa ou contato"
              className="w-full rounded-[10px] border border-line bg-bg py-2 pl-9 pr-3 text-[12.5px] text-fg outline-none transition-colors placeholder:text-faint focus:border-accent"
            />
          </div>

          <div className="scrollbar-fina mt-2.5 flex gap-1.5 overflow-x-auto pb-0.5">
            {FILTROS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFiltro(f.id)}
                className={`cursor-pointer whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                  filtro === f.id
                    ? "border-accent bg-accent-soft font-semibold text-accent-forte"
                    : "border-line bg-bg font-medium text-sub hover:border-line-strong hover:text-fg"
                }`}
              >
                {f.rotulo}
              </button>
            ))}
          </div>
        </div>

        <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto">
          {conversas === null ? (
            <div className="px-3.5 py-6 text-[12.5px] text-sub">Carregando…</div>
          ) : visiveis.length === 0 ? (
            <div className="px-3.5 py-6 text-[12.5px] text-sub">
              {conversas.length === 0
                ? "Nenhum contato ainda. Importe do WhatsApp ou crie um em Contatos."
                : "Nada aqui com esse filtro."}
            </div>
          ) : (
            visiveis.map((c) => (
              <LinhaConversa
                key={c.id}
                conversa={c}
                ativa={c.id === atual}
                aoAbrir={() => {
                  setAtual(c.id);
                  setAba(null);
                  setAtalho(null);
                }}
              />
            ))
          )}
        </div>
      </div>

      {/* Coluna 2 — a conversa */}
      <section className="hidden min-w-0 flex-1 flex-col bg-bg md:flex">
        {!conversa ? (
          <div className="flex flex-1 items-center justify-center text-[13.5px] text-sub">
            Escolha uma conversa à esquerda.
          </div>
        ) : (
          <>
            <header className="flex h-[62px] flex-none items-center gap-2.5 border-b border-line px-3.5">
              <AvatarComDono
                nome={conversa.nome}
                dono={conversa.dono}
                grupo={conversa.grupo}
                tamanho={38}
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[14.5px] font-semibold text-fg">{conversa.nome}</span>
                <span className="flex items-center gap-1.5 text-[11.5px] text-sub">
                  {/* Grupo não tem telefone. Formatar o identificador dele como
                      se tivesse daria um número de dezoito dígitos com DDD
                      inventado no cabeçalho da conversa. */}
                  {conversa.grupo ? (
                    <>
                      <Users size={12} strokeWidth={2} className="text-faint" />
                      Grupo
                    </>
                  ) : (
                    conversa.telefone && (
                      <>
                        <SeloWhatsApp tamanho={12} />
                        {formatPhone(conversa.telefone)}
                      </>
                    )
                  )}
                  {conversa.empresa && <span className="truncate">· {conversa.empresa}</span>}
                </span>
              </span>
              <span className="ml-auto flex items-center gap-1">
                <button
                  title="Marcar como não lida — ainda sem rota"
                  disabled
                  className="flex h-8 w-8 items-center justify-center rounded-[9px] text-sub opacity-40"
                >
                  <MailOpen size={17} strokeWidth={1.9} />
                </button>
                {!conversa.grupo && (
                  <button
                    onClick={() => setFichaAberta((v) => !v)}
                    title="Ficha do contato"
                    className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-[9px] transition-colors ${
                      fichaAberta
                        ? "bg-accent-soft text-accent-forte"
                        : "text-sub hover:bg-surface-hover hover:text-fg"
                    }`}
                  >
                    <PanelRight size={17} strokeWidth={1.9} />
                  </button>
                )}
              </span>
            </header>

            {/* O fundo pontilhado é o do desenho, feito com o token de linha —
                assim ele acompanha o tema escuro em vez de ficar claro nele. */}
            <div
              className="scrollbar-fina min-h-0 flex-1 overflow-y-auto bg-surface px-4 pb-4 pt-3"
              style={{
                backgroundImage: "radial-gradient(var(--el-line) 1px, transparent 1px)",
                backgroundSize: "22px 22px",
              }}
            >
              {mensagens.map((m, i) => {
                const chave = `${m.tipo}-${i}`;
                if (m.tipo === "data") return <DivisorData key={chave} texto={m.texto} />;
                if (m.tipo === "naoLidas") return <FaixaNaoLidas key={chave} texto={m.texto} />;
                if (m.tipo === "sistema")
                  return <PilulaSistema key={chave} dono={m.dono} texto={m.texto} />;
                return <Bolha key={chave} mensagem={m} nomeProprio={eu} />;
              })}
              <div ref={fimDaConversa} />
            </div>

            {aba === "modelos" && (
              <PainelModelos
                modelos={modelos}
                categorias={CATEGORIAS_DE_MODELO}
                contato={{ nome: conversa.nome, empresa: conversa.empresa }}
                aoInserir={(texto) => {
                  setRascunho(texto);
                  setAba(null);
                }}
                aoEnviar={mandar}
                aoGuardarBaralho={guardarBaralho}
                aoFechar={() => setAba(null)}
              />
            )}

            {aba === "atalhos" && (
              <PainelAtalhos
                aberto={atalho}
                aoAbrir={setAtalho}
                contactId={conversa.contactId}
                estagios={dados.estagios}
                textoInicial={ultimaRecebida(mensagens)}
                recarregar={recarregar}
                aoFechar={() => {
                  setAba(null);
                  setAtalho(null);
                }}
              />
            )}

            <FaixaAtendimento
              dono={conversa.dono}
              atendenteNome={conversa.atendenteNome}
              equipe={equipe}
              grupo={conversa.grupo}
              aoTrocar={trocarDono}
            />

            <Composer
              rascunho={rascunho}
              aoMudar={setRascunho}
              aoEnviar={() => mandar(rascunho)}
              aba={aba}
              aoAlternarAba={alternarAba}
              aviso={
                aviso ||
                // O aviso de automatismo não vale para grupo: grupo não tem
                // dono de atendimento, e mandar "assuma antes de escrever"
                // apontaria para um botão que a faixa nem oferece ali.
                (!conversa.grupo && conversa.dono !== "humano"
                  ? "Esta conversa está num automatismo — assuma antes de escrever para não sair resposta dobrada."
                  : null)
              }
            />
          </>
        )}
      </section>

      {/* Coluna 3 — a ficha.
          Grupo não tem ficha: ela é do CONTATO, e um grupo não é um. Mostrá-la
          vazia ao lado de um grupo só ocuparia 296px para dizer "nada aqui". */}
      {conversa && !conversa.grupo && fichaAberta && (
        <FichaLateral
          conversa={conversa}
          contato={contato}
          negocio={negocio}
          estagio={dados.estagios.find((e) => e.id === negocio?.stageId) || null}
          tarefa={tarefa}
          nota={nota}
          etiquetas={etiquetas}
          aoFechar={() => setFichaAberta(false)}
          aoAtalho={abrirAtalho}
          aoAbrirFicha={() => contato && aoAbrirContato(contato)}
        />
      )}
    </div>
  );
}
