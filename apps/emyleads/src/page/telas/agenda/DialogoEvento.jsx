import { useEffect, useRef, useState } from "react";
import { Bell, CalendarDays, ChevronDown, Clock3, Eye, Trash2 } from "lucide-react";
import { BotaoPrimario } from "../../ui";
import { Folha, SeletorContato } from "./componentes";
import { eventoParaFormulario, formatarDuracao, horarioDeMinutos, isoLocal, minutosDoHorario } from "./agendaUtils";

const OPCOES_LEMBRETE = [0, 10, 30, 60, 1440];
const ATALHOS_DURACAO = [30, 60, 90, 120];

const TIPOS = [
  { id: "appointment", rotulo: "Compromisso", dica: "Atendimento, visita, ligação marcada." },
  { id: "event", rotulo: "Evento", dica: "Reunião interna, treinamento, algo da equipe." },
  { id: "block", rotulo: "Bloqueio", dica: "Horário indisponível. Os colegas veem só que você está ocupado." },
];

const campo = "min-h-11 w-full rounded-[10px] border border-line bg-bg px-3 text-[15px] text-fg outline-none transition-colors focus:border-accent md:min-h-10 md:text-[13px]";
const rotulo = "mb-1 block text-[13px] font-semibold text-sub md:text-[12px]";

function textoLembrete(minutos) {
  if (minutos === 0) return "Na hora";
  if (minutos < 60) return `${minutos} min antes`;
  if (minutos === 60) return "1 h antes";
  if (minutos === 1440) return "1 dia antes";
  return `${formatarDuracao(minutos)} antes`;
}

/** Duração a partir de início e término; término antes do início é o dia seguinte. */
function duracaoEntre(inicio, fim) {
  const minutos = minutosDoHorario(fim) - minutosDoHorario(inicio);
  return minutos > 0 ? minutos : minutos + 24 * 60;
}

function formularioInicial(evento, abertura, lembretesPadrao) {
  const base = eventoParaFormulario(evento, { ...abertura, lembretes: abertura?.lembretes || lembretesPadrao });
  return {
    ...base,
    titulo: evento ? base.titulo : (abertura?.titulo || ""),
    fimHora: horarioDeMinutos((minutosDoHorario(base.inicio) + base.duracao) % (24 * 60)),
  };
}

function Secao({ icone: Icone, titulo, children }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-sub md:text-[12px]"><Icone size={14} />{titulo}</h3>
      {children}
    </section>
  );
}

/**
 * Criar ou editar um compromisso.
 *
 * Reorganizado pela ordem em que alguém pensa num horário: o que é, quando
 * começa e quando termina, com quem, quem vê. Categoria, status, local, tags
 * e descrição — o que quase ninguém mexe — ficam recolhidos em "Mais
 * detalhes". Antes eram quatro `<select>` com o mesmo peso logo abaixo do
 * título, e só havia duração: quem pensa "das 14h às 15h30" fazia a conta.
 */
export default function DialogoEvento({
  aberto,
  evento,
  abertura,
  categorias,
  contatos,
  lembretesPadrao,
  salvando,
  erro,
  aoFechar,
  aoSalvar,
  aoExcluir,
}) {
  const [form, setForm] = useState(() => formularioInicial(evento, abertura, lembretesPadrao));
  const [detalhes, setDetalhes] = useState(false);
  const editando = Boolean(evento?.id);

  // Reinicia só quando abre ou troca o compromisso. Os lembretes padrão
  // ficam de fora das dependências de propósito: eles chegam num array novo a
  // cada recarga da agenda, e a recarga apagava o que a pessoa estava
  // digitando no meio da frase.
  const lembretesRef = useRef(lembretesPadrao);
  lembretesRef.current = lembretesPadrao;
  useEffect(() => {
    if (!aberto) return;
    setForm(formularioInicial(evento, abertura, lembretesRef.current));
    setDetalhes(Boolean(evento?.descricao || evento?.local || evento?.tags?.length));
  }, [aberto, evento, abertura]);

  if (!aberto) return null;

  const mudar = (chave, valor) => setForm((atual) => ({ ...atual, [chave]: valor }));
  const duracao = duracaoEntre(form.inicio, form.fimHora);
  const viraDia = minutosDoHorario(form.fimHora) <= minutosDoHorario(form.inicio);
  const mudarInicio = (valor) => setForm((atual) => {
    // Mover o início leva o término junto: é o que a pessoa quer em nove de
    // cada dez vezes, e manter o término fixo encolhia a reunião em silêncio.
    const atualDuracao = duracaoEntre(atual.inicio, atual.fimHora);
    return { ...atual, inicio: valor, fimHora: horarioDeMinutos((minutosDoHorario(valor) + atualDuracao) % (24 * 60)) };
  });
  const aplicarDuracao = (minutos) => mudar("fimHora", horarioDeMinutos((minutosDoHorario(form.inicio) + minutos) % (24 * 60)));
  const alternarLembrete = (minutos) => setForm((atual) => ({
    ...atual,
    lembretes: atual.lembretes.includes(minutos)
      ? atual.lembretes.filter((item) => item !== minutos)
      : [...atual.lembretes, minutos].sort((a, b) => a - b),
  }));

  const enviar = (e) => {
    e.preventDefault();
    const inicio = form.diaInteiro ? isoLocal(form.data, "00:00") : isoLocal(form.data, form.inicio);
    const fim = new Date(new Date(inicio).getTime() + (form.diaInteiro ? 24 * 60 : duracao) * 60000).toISOString();
    aoSalvar({
      titulo: form.titulo,
      descricao: form.descricao,
      inicio,
      fim,
      diaInteiro: form.diaInteiro,
      tipo: form.visibilidade === "organization" && form.tipo === "block" ? "event" : form.tipo,
      visibilidade: form.visibilidade,
      categoryId: form.categoryId || categorias[0]?.id,
      contactId: form.contactId || null,
      local: form.local,
      tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      status: form.status,
      lembretes: form.lembretes,
    });
  };

  const tipoAtual = TIPOS.find((tipo) => tipo.id === form.tipo) || TIPOS[0];
  const categoriaAtual = categorias.find((categoria) => categoria.id === form.categoryId) || categorias[0];

  return (
    <Folha
      titulo={editando ? "Editar compromisso" : "Novo compromisso"}
      icone={CalendarDays}
      aoFechar={aoFechar}
      onSubmit={enviar}
      largura="md:max-w-xl"
      rodape={(
        <>
          {editando && (
            <button type="button" onClick={aoExcluir} disabled={salvando} aria-label="Excluir compromisso" className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-[10px] px-2.5 text-[14px] font-medium text-danger hover:bg-danger/10 disabled:opacity-40 md:min-h-9 md:text-[13px]">
              <Trash2 size={16} /><span className="hidden sm:inline">Excluir</span>
            </button>
          )}
          <button type="button" onClick={aoFechar} className="ml-auto hidden min-h-9 cursor-pointer rounded-[10px] px-3 text-[13px] font-medium text-sub hover:text-fg md:block">Cancelar</button>
          <BotaoPrimario type="submit" disabled={salvando} className="!min-h-11 ml-auto !flex-1 !py-2 md:!min-h-9 md:ml-0 md:!flex-none">
            {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Criar compromisso"}
          </BotaoPrimario>
        </>
      )}
    >
      <div className="space-y-5 px-4 py-4 md:px-5">
        <div>
          <label htmlFor="evento-titulo" className="sr-only">Título</label>
          <input
            id="evento-titulo"
            data-autofocus={editando ? undefined : "true"}
            required
            maxLength={240}
            className={`${campo} !min-h-12 text-[17px] font-semibold md:text-[15px]`}
            value={form.titulo}
            onChange={(e) => mudar("titulo", e.target.value)}
            placeholder="Título — ex.: Reunião com a Ana"
          />
          <div role="radiogroup" aria-label="Tipo" className="mt-2 flex gap-1.5">
            {TIPOS.map((tipo) => {
              const bloqueado = tipo.id === "block" && form.visibilidade === "organization";
              return (
                <button
                  key={tipo.id}
                  type="button"
                  role="radio"
                  aria-checked={form.tipo === tipo.id}
                  disabled={bloqueado}
                  title={bloqueado ? "Bloqueio é sempre pessoal" : tipo.dica}
                  onClick={() => mudar("tipo", tipo.id)}
                  className={`min-h-10 flex-1 cursor-pointer rounded-full border px-2 text-[14px] font-medium disabled:cursor-not-allowed disabled:opacity-40 md:min-h-8 md:flex-none md:px-3.5 md:text-[12px] ${form.tipo === tipo.id ? "border-accent bg-accent-soft text-accent-forte" : "border-line text-sub hover:border-line-strong"}`}
                >
                  {tipo.rotulo}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[12px] text-faint md:text-[11px]">{tipoAtual.dica}</p>
        </div>

        <Secao icone={Clock3} titulo="Quando">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input required type="date" aria-label="Data" className={campo} value={form.data} onChange={(e) => mudar("data", e.target.value)} />
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-[10px] border border-line px-3 text-[15px] text-fg md:min-h-10 md:text-[13px]">
              Dia inteiro
              <input type="checkbox" role="switch" checked={form.diaInteiro} onChange={(e) => mudar("diaInteiro", e.target.checked)} className="h-5 w-5 accent-accent" />
            </label>
          </div>
          {!form.diaInteiro && (
            <>
              <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <input required type="time" aria-label="Começa às" className={campo} value={form.inicio} onChange={(e) => mudarInicio(e.target.value)} />
                <span className="text-[14px] text-faint" aria-hidden="true">até</span>
                <input required type="time" aria-label="Termina às" className={campo} value={form.fimHora} onChange={(e) => mudar("fimHora", e.target.value)} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {ATALHOS_DURACAO.map((minutos) => (
                  <button
                    key={minutos}
                    type="button"
                    aria-pressed={duracao === minutos}
                    onClick={() => aplicarDuracao(minutos)}
                    className={`min-h-9 cursor-pointer rounded-full border px-3 text-[13px] font-medium md:min-h-7 md:text-[11.5px] ${duracao === minutos ? "border-accent bg-accent-soft text-accent-forte" : "border-line text-sub hover:border-line-strong"}`}
                  >
                    {formatarDuracao(minutos)}
                  </button>
                ))}
                <span className={`ml-auto text-[12px] md:text-[11px] ${viraDia ? "font-semibold text-warning" : "text-faint"}`}>
                  {formatarDuracao(duracao)}{viraDia ? " · termina no dia seguinte" : ""}
                </span>
              </div>
            </>
          )}
        </Secao>

        <SeletorContato
          rotulo="Cliente (opcional)"
          contatos={contatos}
          valor={form.contactId}
          aoMudar={(id) => mudar("contactId", id)}
        />

        <Secao icone={Eye} titulo="Quem vê">
          <div className="grid gap-2 sm:grid-cols-2">
            {/* Liberado para todo membro desde 03/09/2026: o banco já aceitava,
                e só este botão ainda dizia que era coisa de administrador. */}
            {[
              { id: "personal", titulo: "Só eu", texto: "Os colegas veem apenas “Ocupado”." },
              { id: "organization", titulo: "Toda a equipe", texto: "Todos veem os detalhes. Quem criou e a gestão editam." },
            ].map((opcao) => (
              <button
                key={opcao.id}
                type="button"
                role="radio"
                aria-checked={form.visibilidade === opcao.id}
                onClick={() => setForm((atual) => ({
                  ...atual,
                  visibilidade: opcao.id,
                  tipo: opcao.id === "organization" && atual.tipo === "block" ? "event" : atual.tipo,
                }))}
                className={`min-h-14 cursor-pointer rounded-[11px] border p-3 text-left ${form.visibilidade === opcao.id ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong"}`}
              >
                <span className="block text-[15px] font-semibold text-fg md:text-[13px]">{opcao.titulo}</span>
                <span className="mt-0.5 block text-[13px] leading-5 text-sub md:text-[11.5px] md:leading-4">{opcao.texto}</span>
              </button>
            ))}
          </div>
        </Secao>

        <Secao icone={Bell} titulo="Lembrete">
          <div className="flex flex-wrap gap-1.5">
            {OPCOES_LEMBRETE.map((minutos) => (
              <button
                key={minutos}
                type="button"
                aria-pressed={form.lembretes.includes(minutos)}
                onClick={() => alternarLembrete(minutos)}
                className={`min-h-10 cursor-pointer rounded-full border px-3.5 text-[14px] font-medium md:min-h-8 md:px-3 md:text-[12px] ${form.lembretes.includes(minutos) ? "border-accent bg-accent-soft text-accent-forte" : "border-line text-sub hover:border-line-strong"}`}
              >
                {textoLembrete(minutos)}
              </button>
            ))}
          </div>
          {form.lembretes.length === 0 && <p className="mt-1.5 text-[12px] text-faint md:text-[11px]">Sem lembrete.</p>}
        </Secao>

        <div className="rounded-[12px] border border-line">
          <button
            type="button"
            aria-expanded={detalhes}
            onClick={() => setDetalhes((atual) => !atual)}
            className="flex min-h-12 w-full cursor-pointer items-center gap-2 px-4 text-left text-[14px] font-semibold text-sub md:min-h-11 md:text-[13px]"
          >
            Mais detalhes
            <span className="min-w-0 flex-1 truncate text-[12px] font-normal text-faint md:text-[11px]">
              {[categoriaAtual?.name, form.status === "tentative" ? "Provisório" : null, form.local].filter(Boolean).join(" · ")}
            </span>
            <ChevronDown size={17} className={`flex-none transition-transform ${detalhes ? "rotate-180" : ""}`} />
          </button>
          {detalhes && (
            <div className="space-y-4 border-t border-line p-4">
              <div>
                <span className={rotulo}>Categoria</span>
                <div className="flex flex-wrap gap-1.5">
                  {categorias.map((categoria) => (
                    <button
                      key={categoria.id}
                      type="button"
                      aria-pressed={(form.categoryId || categorias[0]?.id) === categoria.id}
                      onClick={() => mudar("categoryId", categoria.id)}
                      className={`inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[14px] font-medium md:min-h-8 md:text-[12px] ${(form.categoryId || categorias[0]?.id) === categoria.id ? "border-accent bg-accent-soft text-accent-forte" : "border-line text-sub hover:border-line-strong"}`}
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: categoria.color }} />{categoria.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className={rotulo}>Situação</span>
                <div className="flex gap-1.5">
                  {[{ id: "scheduled", rotulo: "Confirmado" }, { id: "tentative", rotulo: "Provisório" }].map((opcao) => (
                    <button
                      key={opcao.id}
                      type="button"
                      aria-pressed={form.status === opcao.id}
                      onClick={() => mudar("status", opcao.id)}
                      className={`min-h-10 cursor-pointer rounded-full border px-3.5 text-[14px] font-medium md:min-h-8 md:text-[12px] ${form.status === opcao.id ? "border-accent bg-accent-soft text-accent-forte" : "border-line text-sub hover:border-line-strong"}`}
                    >
                      {opcao.rotulo}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="evento-local" className={rotulo}>Local ou link</label>
                  <input id="evento-local" className={campo} value={form.local} onChange={(e) => mudar("local", e.target.value)} placeholder="Google Meet, escritório…" />
                </div>
                <div>
                  <label htmlFor="evento-tags" className={rotulo}>Etiquetas</label>
                  <input id="evento-tags" className={campo} value={form.tags} onChange={(e) => mudar("tags", e.target.value)} placeholder="retorno, proposta" />
                </div>
              </div>
              <div>
                <label htmlFor="evento-descricao" className={rotulo}>Descrição</label>
                <textarea id="evento-descricao" className={`${campo} min-h-24 resize-y py-2`} value={form.descricao} onChange={(e) => mudar("descricao", e.target.value)} placeholder="Pauta, observações ou contexto" />
              </div>
            </div>
          )}
        </div>

        {erro && <p role="alert" className="rounded-[10px] border border-danger/25 bg-danger/10 px-3 py-2 text-[13px] text-danger">{erro}</p>}
      </div>
    </Folha>
  );
}
