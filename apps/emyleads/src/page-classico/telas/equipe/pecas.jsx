import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Mail,
  MoreVertical,
  Pencil,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { fmtRelativo } from "../../../lib/formato";
import { corDaPessoa } from "../../../ui/perfil";
import { DESCRICAO_DO_PAPEL, OPCOES_DE_PAPEL, textoDoPapel } from "../../../ui/papeis";
import { Iniciais } from "../../ui";

/**
 * Uma lista só: quem tem acesso e quem foi convidado moram na mesma tabela.
 *
 * Antes eram três blocos empilhados — convites, operadores do WhatsApp e a
 * equipe — e a mesma pessoa aparecia em dois deles. A pergunta "quem trabalha
 * aqui" precisava ser respondida somando blocos. Agora cada pessoa é uma linha
 * e cada coluna é uma propriedade dela; o convite é a linha de quem ainda não
 * entrou.
 *
 * A coluna WhatsApp só existe para quem administra, porque é ela que carrega
 * as ações — um atendente não vincula número de ninguém, nem do próprio.
 */
export function colunasDaEquipe(gerencia) {
  return gerencia
    ? "grid grid-cols-[minmax(200px,1.4fr)_148px_minmax(180px,1.6fr)_150px_40px] items-center gap-3.5 px-5"
    : "grid grid-cols-[minmax(200px,1.4fr)_148px_minmax(180px,1.6fr)] items-center gap-3.5 px-5";
}

/* ------------------------------------------------------------------ */

/**
 * O menu de "•••" da linha.
 *
 * Remover alguém e revogar o WhatsApp dela são ações raras e destrutivas: como
 * botões visíveis, ocupariam a linha inteira o tempo todo para serem usadas
 * uma vez por semestre. Escondidas atrás do menu, a linha fica com 56px e as
 * ações continuam a um clique.
 */
export function MenuLinha({ itens, rotulo }) {
  const [aberto, setAberto] = useState(false);
  const caixaRef = useRef(null);

  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (!caixaRef.current?.contains(e.target)) setAberto(false); };
    const escapa = (e) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", escapa);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", escapa);
    };
  }, [aberto]);

  if (!itens.length) return <span />;

  return (
    <div ref={caixaRef} className="relative flex justify-end">
      <button
        type="button"
        aria-label={rotulo}
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
        className="cursor-pointer rounded-[8px] p-1.5 text-faint transition-colors hover:bg-surface-hover hover:text-fg"
      >
        <MoreVertical size={16} strokeWidth={2} />
      </button>
      {aberto && (
        <div className="absolute right-0 top-full z-30 mt-1 min-w-[210px] overflow-hidden rounded-[10px] border border-line bg-bg py-1 shadow-xl">
          {itens.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={item.desabilitado}
              onClick={() => { setAberto(false); item.aoEscolher(); }}
              className={`flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-[12.5px] font-medium transition-colors disabled:cursor-default disabled:opacity-40 ${
                item.perigo
                  ? "text-danger hover:bg-danger/10"
                  : "text-sub hover:bg-surface-hover hover:text-fg"
              }`}
            >
              <item.icone size={14} className="flex-none" />
              {item.rotulo}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * O papel como pílula, e a descrição como tooltip.
 *
 * A coluna "Pode" gastava um terço da largura para repetir três frases fixas
 * que ninguém relê depois da primeira semana — e ainda assim cortava as três.
 * O texto não sumiu: virou o `title` da pílula, onde é consultado por quem
 * ainda não sabe e ignorado por quem já sabe.
 */
export function PapelDoMembro({ membro, nome, editavel, ocupado, aoMudar }) {
  const dono = membro.role === "owner";
  const descricao = DESCRICAO_DO_PAPEL[membro.role];

  if (!editavel) {
    return (
      <span
        title={descricao}
        className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${
          dono ? "bg-accent-soft text-accent-forte" : "bg-surface-hover text-sub"
        }`}
      >
        {dono && <ShieldCheck size={12} />}
        {textoDoPapel(membro.role)}
      </span>
    );
  }

  return (
    <span
      title={descricao}
      className="relative inline-flex w-fit items-center gap-1 rounded-full bg-surface-hover py-1 pl-2.5 pr-7 text-[12px] font-semibold text-fg transition-colors hover:bg-line"
    >
      {textoDoPapel(membro.role)}
      <ChevronDown size={12} className="absolute right-2.5 text-faint" />
      <select
        value={membro.role}
        disabled={ocupado}
        aria-label={`Papel de ${nome}`}
        onChange={(e) => aoMudar(membro.user_id, e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {OPCOES_DE_PAPEL.map((opcao) => (
          <option key={opcao.id} value={opcao.id}>{opcao.rotulo}</option>
        ))}
      </select>
    </span>
  );
}

/* ------------------------------------------------------------------ */

/**
 * A responsabilidade escrita na própria coluna.
 *
 * Era um formulário inteiro por linha — rótulo, campo largo e botão "Salvar
 * responsabilidade" — empilhado abaixo dos dados da pessoa. Sozinho, dobrava a
 * altura da linha. Como texto que vira campo ao ser clicado, ele ocupa o
 * espaço de uma frase e continua editável no mesmo lugar onde é lido.
 *
 * Salva ao sair do campo e no Enter; Escape desiste. Não há botão porque não
 * há dúvida sobre o que está sendo salvo: é a frase que está debaixo do cursor.
 */
export function CelulaResponsabilidade({ membro, nome, editavel, ocupado, aoSalvar }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(membro.responsibility || "");

  useEffect(() => { setValor(membro.responsibility || ""); }, [membro.responsibility]);

  const texto = String(membro.responsibility || "").trim();

  const encerrar = (salvando) => {
    setEditando(false);
    const limpo = valor.trim();
    if (salvando && limpo !== texto) aoSalvar(membro.user_id, limpo);
    else setValor(membro.responsibility || "");
  };

  if (editando) {
    return (
      <input
        autoFocus
        value={valor}
        maxLength={1000}
        disabled={ocupado}
        aria-label={`Responsabilidade de ${nome}`}
        onChange={(e) => setValor(e.target.value)}
        onBlur={() => encerrar(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); encerrar(true); }
          if (e.key === "Escape") { e.preventDefault(); encerrar(false); }
        }}
        placeholder="Ex.: cuida das vendas, propostas e retorno dos leads"
        className="w-full rounded-[7px] border border-accent bg-bg px-2 py-1 text-[12.5px] text-fg outline-none"
      />
    );
  }

  if (!editavel) {
    return (
      <span className={`truncate text-[12.5px] ${texto ? "text-sub" : "text-faint"}`} title={texto}>
        {texto || "Ainda não definida"}
      </span>
    );
  }

  return (
    <button
      type="button"
      title={texto || "Definir o que essa pessoa faz"}
      onClick={() => setEditando(true)}
      className={`flex w-full min-w-0 cursor-text items-center gap-1.5 rounded-[7px] px-2 py-1 text-left text-[12.5px] transition-colors hover:bg-surface-hover ${
        texto ? "text-sub" : "text-faint"
      }`}
    >
      {!texto && <Pencil size={12} className="flex-none" />}
      <span className="truncate">{texto || "Definir o que essa pessoa faz"}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */

/** Verificado, esperando ou nada — o número nunca aparece inteiro. */
export function CelulaWhatsApp({ operador, aguardando }) {
  if (operador) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11.5px] tabular-nums text-success">
        <CheckCircle2 size={13} className="flex-none" />
        •••• {String(operador.phone_e164 || "").slice(-4)}
      </span>
    );
  }
  if (aguardando) {
    return <span className="text-[11.5px] text-accent-forte">código enviado</span>;
  }
  return <span className="text-[11.5px] text-faint">não vinculado</span>;
}

/* ------------------------------------------------------------------ */

export function LinhaMembro({
  membro,
  colunas,
  gerencia,
  souEu,
  papelEditavel,
  removivel,
  operador,
  aguardando,
  ocupado,
  aoMudarPapel,
  aoSalvarResponsabilidade,
  aoVincularWhatsApp,
  aoRevogarWhatsApp,
  aoRemover,
  acoesWhatsApp,
}) {
  const nome = membro.profile?.full_name?.trim() || "Sem nome no perfil";
  const itens = [];
  if (acoesWhatsApp) {
    itens.push(operador
      ? {
        id: "revogar",
        rotulo: "Revogar o WhatsApp",
        icone: X,
        perigo: true,
        aoEscolher: () => aoRevogarWhatsApp(operador, nome),
      }
      : {
        id: "vincular",
        rotulo: "Vincular o WhatsApp",
        icone: RefreshCw,
        aoEscolher: () => aoVincularWhatsApp(membro),
      });
  }
  if (removivel) {
    itens.push({
      id: "remover",
      rotulo: "Remover da equipe",
      icone: X,
      perigo: true,
      aoEscolher: () => aoRemover(membro),
    });
  }

  return (
    <div className={`${colunas} border-t border-line py-2.5 first:border-t-0`}>
      <div className="flex min-w-0 items-center gap-2.5">
        <Iniciais nome={nome} tamanho={32} cor={corDaPessoa(membro.profile)} />
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium text-fg">
            {nome}
            {souEu && <span className="ml-1.5 text-[11.5px] font-normal text-faint">(você)</span>}
          </p>
          <p className="truncate text-[11.5px] text-sub">
            {membro.status === "active" ? "" : "Suspenso · "}
            entrou {fmtRelativo(membro.joined_at)}
          </p>
        </div>
      </div>

      <PapelDoMembro
        membro={membro}
        nome={nome}
        editavel={papelEditavel}
        ocupado={ocupado}
        aoMudar={aoMudarPapel}
      />

      <CelulaResponsabilidade
        membro={membro}
        nome={nome}
        editavel={gerencia}
        ocupado={ocupado}
        aoSalvar={aoSalvarResponsabilidade}
      />

      {gerencia && <CelulaWhatsApp operador={operador} aguardando={aguardando} />}
      {gerencia && <MenuLinha itens={itens} rotulo={`Ações de ${nome}`} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * O convite é uma linha da mesma lista, não uma segunda tabela.
 *
 * Quem olha a Equipe quer saber quem trabalha ali — e alguém convidado ontem é
 * parte dessa resposta, mesmo sem ter entrado. Numa tabela apartada, a pessoa
 * só aparecia para quem rolava até ela.
 */
export function LinhaConvite({ convite, colunas, situacao, ocupado, aoReenviar, aoCancelar }) {
  return (
    <div className={`${colunas} border-t border-line bg-surface/60 py-2.5`}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-surface-hover text-faint">
          <Mail size={14} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13.5px] text-sub">{convite.invited_email}</p>
          <p className="truncate text-[11.5px] text-faint">
            <span className={situacao.classe}>{situacao.rotulo}</span>
            {situacao.prazo && ` · ${situacao.prazo}`}
          </p>
        </div>
      </div>

      <span className="inline-flex w-fit items-center rounded-full bg-surface-hover px-2.5 py-1 text-[12px] font-semibold text-sub">
        {textoDoPapel(convite.invited_role)}
      </span>

      <span className="truncate text-[12.5px] text-faint">definida quando entrar</span>

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={ocupado}
          onClick={() => aoReenviar(convite)}
          className="cursor-pointer rounded-[7px] border border-line px-2 py-1 text-[11px] font-semibold text-sub transition-colors hover:border-accent hover:text-accent-forte disabled:opacity-40"
        >
          Reenviar
        </button>
        <button
          type="button"
          disabled={ocupado}
          aria-label={`Cancelar o convite de ${convite.invited_email}`}
          onClick={() => aoCancelar(convite)}
          className="cursor-pointer rounded-[7px] p-1 text-faint transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40"
        >
          <X size={13} />
        </button>
      </div>

      <span />
    </div>
  );
}
