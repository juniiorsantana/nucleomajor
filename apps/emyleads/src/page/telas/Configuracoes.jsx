import { useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { api } from "../../data/client";
import { corDoEstagio } from "../../domain/types";
import { paraSlug } from "../../lib/texto";
import { BotaoPrimario, CabecalhoTela, PilulaEstagio } from "../ui";

const PLATAFORMA_WEB = typeof __EMYLEADS_PLATFORM__ !== "undefined" && __EMYLEADS_PLATFORM__ === "web";

/**
 * Configurações — o funil e as tags do SEU processo, não do meu.
 *
 * Os seis estágios que vieram por padrão são um chute razoável, e chute
 * razoável é a pior coisa para deixar fixa: todo negócio criado antes de
 * ajustar isso nasce no molde errado. Por isso esta tela veio antes do Funil.
 */

const CORES_SUGERIDAS = [
  "#4f3cfc",
  "#16a34a",
  "#dc2626",
  "#b45309",
  "#0369a1",
  "#7c3aed",
  "#0f766e",
  "#667085",
];

function Bloco({ titulo, descricao, children, acao }) {
  return (
    <section className="rounded-[14px] border border-line bg-bg">
      <div className="flex items-start gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-fg">{titulo}</h2>
          {descricao && (
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-sub">
              {descricao}
            </p>
          )}
        </div>
        {acao}
      </div>
      {children}
    </section>
  );
}

const entrada =
  "rounded-[8px] border border-line bg-bg px-3 py-1.5 text-[13.5px] text-fg outline-none transition-colors focus:border-accent";

/* ------------------------------------------------------------------ */

function Estagios({ estagios, recarregar }) {
  const [novo, setNovo] = useState("");
  const [removendo, setRemovendo] = useState(null); // {estagio, quantidade}
  const [destino, setDestino] = useState("");
  const [erro, setErro] = useState(null);

  const ordenados = [...estagios].sort((a, b) => a.ordem - b.ordem);

  /** Renumera todos: `ordem` é posição, e posição com buraco não é posição. */
  const salvarOrdem = async (lista) => {
    await api.estagios.salvar({
      estagios: lista.map((e, i) => ({ ...e, ordem: i })),
    });
    await recarregar();
  };

  const mover = (indice, passo) => {
    const alvo = indice + passo;
    if (alvo < 0 || alvo >= ordenados.length) return;
    const lista = [...ordenados];
    [lista[indice], lista[alvo]] = [lista[alvo], lista[indice]];
    salvarOrdem(lista);
  };

  const renomear = async (estagio, nome) => {
    if (!nome.trim() || nome === estagio.nome) return;
    // O id NÃO muda: ele é a referência que os negócios guardam. Regenerar o
    // slug no rename mandaria todo mundo para um estágio inexistente.
    await api.estagios.salvar({ estagios: [{ ...estagio, nome: nome.trim() }] });
    await recarregar();
  };

  const adicionar = async (e) => {
    e.preventDefault();
    const nome = novo.trim();
    if (!nome) return;
    const id = paraSlug(nome);
    if (!id || estagios.some((x) => x.id === id)) {
      setErro("Já existe um estágio com esse nome.");
      return;
    }
    setErro(null);
    await api.estagios.salvar({
      estagios: [{ id, nome, ordem: ordenados.length }],
    });
    setNovo("");
    await recarregar();
  };

  const pedirRemocao = async (estagio) => {
    if (estagios.length <= 2) {
      setErro("O funil precisa de pelo menos dois estágios.");
      return;
    }
    setErro(null);
    try {
      await api.estagios.remover({ id: estagio.id });
      await recarregar();
    } catch (err) {
      if (err.codigo === "estagio-com-negocios") {
        setRemovendo({ estagio, quantidade: err.quantidade });
        setDestino(ordenados.find((e) => e.id !== estagio.id)?.id || "");
      } else {
        setErro(err.message);
      }
    }
  };

  const confirmarRemocao = async () => {
    await api.estagios.remover({ id: removendo.estagio.id, moverPara: destino });
    setRemovendo(null);
    await recarregar();
  };

  return (
    <Bloco
      titulo="Estágios do funil"
      descricao="A ordem aqui é a ordem do funil, e a cor da pílula vem da posição. Renomear é seguro: os negócios seguem o estágio."
    >
      <div className="divide-y divide-line">
        {ordenados.map((e, i) => (
          <div key={e.id} className="flex items-center gap-3 px-5 py-2.5">
            <span className="w-6 text-[12.5px] tabular-nums text-faint">
              {i + 1}
            </span>
            <PilulaEstagio nome={e.nome} cor={corDoEstagio(i)} />
            <input
              defaultValue={e.nome}
              onBlur={(ev) => renomear(e, ev.target.value)}
              onKeyDown={(ev) => ev.key === "Enter" && ev.target.blur()}
              className={`${entrada} ml-auto w-56`}
            />
            <button
              onClick={() => mover(i, -1)}
              disabled={i === 0}
              title="Subir"
              className="cursor-pointer rounded-[8px] p-1.5 text-sub transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-25"
            >
              <ArrowUp size={16} />
            </button>
            <button
              onClick={() => mover(i, 1)}
              disabled={i === ordenados.length - 1}
              title="Descer"
              className="cursor-pointer rounded-[8px] p-1.5 text-sub transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-25"
            >
              <ArrowDown size={16} />
            </button>
            <button
              onClick={() => pedirRemocao(e)}
              title="Remover estágio"
              className="cursor-pointer rounded-[8px] p-1.5 text-sub transition-colors hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      {removendo && (
        <div className="border-t border-line bg-warning/5 px-5 py-4">
          <p className="text-[13.5px] text-fg">
            <b>{removendo.estagio.nome}</b> tem {removendo.quantidade} negócio(s).
            Para onde eles vão?
          </p>
          <div className="mt-3 flex items-center gap-2">
            <select
              value={destino}
              onChange={(ev) => setDestino(ev.target.value)}
              className={`${entrada} cursor-pointer`}
            >
              {ordenados
                .filter((e) => e.id !== removendo.estagio.id)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
            </select>
            <BotaoPrimario onClick={confirmarRemocao} className="!py-2">
              Mover e remover
            </BotaoPrimario>
            <button
              onClick={() => setRemovendo(null)}
              className="cursor-pointer px-2 text-[13.5px] text-sub hover:text-fg"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <form
        onSubmit={adicionar}
        className="flex items-center gap-2 border-t border-line px-5 py-3"
      >
        <input
          value={novo}
          onChange={(ev) => setNovo(ev.target.value)}
          placeholder="Nome do novo estágio"
          className={`${entrada} w-56`}
        />
        <button
          type="submit"
          className="flex cursor-pointer items-center gap-1.5 rounded-[8px] border border-line px-3 py-1.5 text-[13.5px] font-medium text-sub transition-colors hover:border-accent hover:text-accent-forte"
        >
          <Plus size={15} /> Adicionar
        </button>
        {erro && <span className="text-[12.5px] text-danger">{erro}</span>}
      </form>
    </Bloco>
  );
}

/* ------------------------------------------------------------------ */

function Tags({ tags, recarregar }) {
  const [novo, setNovo] = useState("");
  const [erro, setErro] = useState(null);

  const salvar = async (tag, patch) => {
    await api.tags.salvar({ tags: [{ ...tag, ...patch }] });
    await recarregar();
  };

  const remover = async (tag) => {
    const r = await api.tags.remover({ id: tag.id });
    if (r.contatosAfetados)
      setErro(`"${tag.nome}" foi tirada de ${r.contatosAfetados} contato(s).`);
    await recarregar();
  };

  const adicionar = async (e) => {
    e.preventDefault();
    const nome = novo.trim();
    if (!nome) return;
    const id = paraSlug(nome);
    if (!id || tags.some((t) => t.id === id)) {
      setErro("Já existe uma tag com esse nome.");
      return;
    }
    setErro(null);
    await api.tags.salvar({
      tags: [{ id, nome, cor: CORES_SUGERIDAS[tags.length % CORES_SUGERIDAS.length] }],
    });
    setNovo("");
    await recarregar();
  };

  return (
    <Bloco
      titulo="Tags"
      descricao="Classificam o contato, não o negócio. Etiquetas importadas do WhatsApp Business aparecem aqui."
    >
      <div className="divide-y divide-line">
        {tags.length === 0 && (
          <p className="px-5 py-6 text-center text-[13.5px] text-sub">
            Nenhuma tag ainda.
          </p>
        )}
        {tags.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-5 py-2.5">
            <input
              type="color"
              value={t.cor || "#667085"}
              onChange={(ev) => salvar(t, { cor: ev.target.value })}
              title="Cor da tag"
              className="h-7 w-7 cursor-pointer rounded-full border border-line bg-transparent p-0"
            />
            <span
              className="inline-flex items-center rounded-[8px] px-2.5 py-1 text-[12.5px] font-medium"
              style={{ color: t.cor, background: `${t.cor}1f` }}
            >
              {t.nome}
            </span>
            <input
              defaultValue={t.nome}
              onBlur={(ev) =>
                ev.target.value.trim() &&
                ev.target.value !== t.nome &&
                salvar(t, { nome: ev.target.value.trim() })
              }
              onKeyDown={(ev) => ev.key === "Enter" && ev.target.blur()}
              className={`${entrada} ml-auto w-56`}
            />
            <button
              onClick={() => remover(t)}
              title="Remover tag"
              className="cursor-pointer rounded-[8px] p-1.5 text-sub transition-colors hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      <form
        onSubmit={adicionar}
        className="flex items-center gap-2 border-t border-line px-5 py-3"
      >
        <input
          value={novo}
          onChange={(ev) => setNovo(ev.target.value)}
          placeholder="Nome da nova tag"
          className={`${entrada} w-56`}
        />
        <button
          type="submit"
          className="flex cursor-pointer items-center gap-1.5 rounded-[8px] border border-line px-3 py-1.5 text-[13.5px] font-medium text-sub transition-colors hover:border-accent hover:text-accent-forte"
        >
          <Plus size={15} /> Adicionar
        </button>
        {erro && <span className="text-[12.5px] text-sub">{erro}</span>}
      </form>
    </Bloco>
  );
}

/* ------------------------------------------------------------------ */

function Dados({ recarregar }) {
  const arquivo = useRef(null);
  const [aviso, setAviso] = useState(null);

  const exportar = async () => {
    const pacote = await api.dados.exportar();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(pacote, null, 2)], { type: "application/json" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `emyleads-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setAviso("Backup baixado.");
  };

  const restaurar = async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    ev.target.value = "";
    if (
      !confirm(
        "Restaurar sobrescreve registros com o mesmo id e mantém o resto. Continuar?"
      )
    )
      return;
    try {
      const pacote = JSON.parse(await f.text());
      const c = await api.dados.importar({ pacote });
      setAviso(
        `Restaurado: ${c.contatos} contatos, ${c.negocios} negócios, ${c.tarefas} tarefas, ${c.notas} notas.`
      );
      await recarregar();
    } catch (err) {
      setAviso(`Falhou: ${err.message}`);
    }
  };

  const apagar = async () => {
    if (!confirm("Apagar TODOS os contatos, negócios, tarefas e notas?")) return;
    if (!confirm("Não dá para desfazer. Tem certeza?")) return;
    await api.dados.apagar();
    setAviso("Base apagada.");
    await recarregar();
  };

  return (
    <Bloco
      titulo="Dados"
      descricao={PLATAFORMA_WEB
        ? "A fonte de verdade é o Supabase da organização. Você pode baixar uma cópia; restauração e exclusão total exigem validação administrativa."
        : "Tudo fica neste navegador. Sem backup, formatar a máquina apaga a base — exporte de vez em quando."}
    >
      <div className="flex flex-wrap items-center gap-2 px-5 py-4">
        <button
          onClick={exportar}
          className="flex cursor-pointer items-center gap-2 rounded-[8px] border border-line px-3 py-2 text-[13.5px] font-medium text-sub transition-colors hover:border-line-strong hover:text-fg"
        >
          <Download size={16} /> Exportar backup
        </button>
        {!PLATAFORMA_WEB && <button
          onClick={() => arquivo.current?.click()}
          className="flex cursor-pointer items-center gap-2 rounded-[8px] border border-line px-3 py-2 text-[13.5px] font-medium text-sub transition-colors hover:border-line-strong hover:text-fg"
        >
          <Upload size={16} /> Restaurar
        </button>}
        <input
          ref={arquivo}
          type="file"
          accept="application/json,.json"
          onChange={restaurar}
          className="hidden"
        />
        {!PLATAFORMA_WEB && <button
          onClick={apagar}
          className="ml-auto cursor-pointer rounded-[8px] border border-line px-3 py-2 text-[13.5px] font-medium text-danger transition-colors hover:border-danger/50"
        >
          Apagar tudo
        </button>}
      </div>
      {aviso && (
        <p className="border-t border-line px-5 py-2.5 text-[12.5px] text-sub">
          {aviso}
        </p>
      )}
    </Bloco>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Qual build está rodando.
 *
 * Parece supérfluo até a primeira vez que alguém diz "atualizei e não mudou
 * nada". Sem isto, essa frase não é verificável: a versão do manifest é fixa e
 * recarregar a extensão não recarrega o content script das abas já abertas.
 * Com o carimbo, basta comparar com o que o último build imprimiu.
 */
function Build() {
  const carimbo = typeof __BUILD_STAMP__ === "string" ? __BUILD_STAMP__ : "desconhecido";
  return (
    <Bloco
      titulo="Build carregado"
      descricao="Compare com o horário do último build. Se não bater, o Chrome ainda está com o código antigo — recarregue a extensão e, depois, a aba do WhatsApp Web."
    >
      <div className="px-5 py-4">
        <code className="rounded-[6px] bg-surface-hover px-2.5 py-1.5 text-[12.5px] text-fg">
          {carimbo}
        </code>
      </div>
    </Bloco>
  );
}

export default function Configuracoes({ dados, recarregar }) {
  return (
    <>
      <CabecalhoTela titulo="Configurações" busca={<span />} acao={<span />} />
      <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="flex max-w-4xl flex-col gap-6">
          <Estagios estagios={dados.estagios} recarregar={recarregar} />
          <Tags tags={dados.tags} recarregar={recarregar} />
          <Dados recarregar={recarregar} />
          <Build />
        </div>
      </div>
    </>
  );
}
