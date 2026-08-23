import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Search } from "lucide-react";
import { api } from "../data/client";
import { formatPhone, variantesBR } from "../lib/phone";
import { listarContatos, listarEtiquetas } from "../wa/contatos";

/**
 * Traz contatos do WhatsApp conectado para a base.
 *
 * É a melhor fonte que existe aqui: diferente de planilha, cada registro vem
 * com o `waId` — a identidade real do WhatsApp — e com o telefone já traduzido
 * quando o contato é endereçado por LID. Contato importado por aqui é
 * reconhecido na conversa desde a primeira vez.
 *
 * A tela é toda sobre ESCOLHER, e não sobre importar tudo: uma agenda de
 * WhatsApp tem entregador, parente e grupo de condomínio. Despejar 1400
 * contatos num CRM é pior do que deixá-lo vazio, porque destrói a única coisa
 * que ele tinha de bom — saber quem importa.
 *
 * Só existe dentro do WhatsApp Web, e não na página de gestão, por uma razão
 * dura: o wa-js vive na aba do WhatsApp. Sem aquela aba aberta não há agenda
 * que ler.
 */

const ESCOPOS = [
  { id: "conversas", rotulo: "Conversas" },
  { id: "agenda", rotulo: "Agenda" },
  { id: "etiqueta", rotulo: "Etiquetas" },
];

export default function ImportarWhatsApp({ aoVoltar, recarregar }) {
  const [escopo, setEscopo] = useState("conversas");
  const [etiquetas, setEtiquetas] = useState([]);
  const [etiqueta, setEtiqueta] = useState(null);

  const [itens, setItens] = useState(null);
  const [erro, setErro] = useState(null);
  const [busca, setBusca] = useState("");
  const [marcados, setMarcados] = useState(() => new Set());
  const [conhecidos, setConhecidos] = useState({ wids: new Set(), tels: new Set() });
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState(null);

  // Quem já está na base, para não oferecer duas vezes o mesmo contato.
  useEffect(() => {
    api.contatos
      .listar()
      .then((cs) =>
        setConhecidos({
          wids: new Set(cs.map((c) => c.waId).filter(Boolean)),
          tels: new Set(cs.flatMap((c) => variantesBR(c.telefone))),
        })
      )
      .catch(() => {});
    listarEtiquetas().then(setEtiquetas).catch(() => {});
  }, []);

  useEffect(() => {
    if (escopo === "etiqueta" && !etiqueta) {
      setItens(null);
      return;
    }
    let cancelado = false;
    setItens(null);
    setErro(null);
    setMarcados(new Set());
    listarContatos({ escopo, etiquetaId: etiqueta?.id })
      .then((lista) => !cancelado && setItens(lista))
      .catch((e) => !cancelado && setErro(e?.message || String(e)));
    return () => {
      cancelado = true;
    };
  }, [escopo, etiqueta]);

  const jaTem = (item) =>
    (item.waId && conhecidos.wids.has(item.waId)) ||
    variantesBR(item.telefone).some((f) => conhecidos.tels.has(f));

  const visiveis = useMemo(() => {
    if (!itens) return [];
    const q = busca.trim().toLowerCase();
    const digitos = q.replace(/\D/g, "");
    return itens.filter(
      (i) =>
        !q ||
        i.nome.toLowerCase().includes(q) ||
        (digitos && (i.telefone || "").includes(digitos))
    );
  }, [itens, busca]);

  const novosVisiveis = visiveis.filter((i) => !jaTem(i));
  const todosMarcados =
    novosVisiveis.length > 0 && novosVisiveis.every((i) => marcados.has(i.waId));

  const alternar = (waId) =>
    setMarcados((s) => {
      const n = new Set(s);
      n.has(waId) ? n.delete(waId) : n.add(waId);
      return n;
    });

  const alternarTodos = () =>
    setMarcados((s) => {
      const n = new Set(s);
      novosVisiveis.forEach((i) => (todosMarcados ? n.delete(i.waId) : n.add(i.waId)));
      return n;
    });

  const importar = async () => {
    setImportando(true);
    setErro(null);
    try {
      const escolhidos = (itens || []).filter((i) => marcados.has(i.waId));
      const r = await api.contatos.importarDoWhatsApp({
        itens: escolhidos,
        // Só quando a origem foi uma etiqueta: aí ela vira tag e a organização
        // que já existia na conta atravessa para o CRM.
        etiqueta: escopo === "etiqueta" && etiqueta ? etiqueta : null,
      });
      setResultado(r);
      setMarcados(new Set());
      await recarregar();
      const cs = await api.contatos.listar();
      setConhecidos({
        wids: new Set(cs.map((c) => c.waId).filter(Boolean)),
        tels: new Set(cs.flatMap((c) => variantesBR(c.telefone))),
      });
    } catch (e) {
      setErro(e?.message || String(e));
    } finally {
      setImportando(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-line bg-bg px-2 py-1.5">
        <button
          onClick={aoVoltar}
          title="Voltar para a ficha"
          className="cursor-pointer rounded-el p-1 text-sub transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <ArrowLeft size={15} />
        </button>
        <span className="text-[12.5px] font-semibold text-fg">
          Importar do WhatsApp
        </span>
      </div>

      <div className="flex-none border-b border-line bg-bg px-2 pb-2 pt-1.5">
        <div className="flex gap-1">
          {ESCOPOS.map((e) => (
            <button
              key={e.id}
              onClick={() => {
                setEscopo(e.id);
                setResultado(null);
              }}
              className={`flex-1 cursor-pointer rounded-el py-1 text-[11.5px] font-medium transition-colors ${
                escopo === e.id
                  ? "bg-accent-soft text-accent-forte"
                  : "text-sub hover:bg-surface-hover hover:text-fg"
              }`}
            >
              {e.rotulo}
            </button>
          ))}
        </div>

        {escopo === "etiqueta" && (
          <div className="mt-2 flex flex-wrap gap-1">
            {etiquetas.length === 0 && (
              <p className="text-[11px] text-faint">
                Nenhuma etiqueta nesta conta — elas existem no WhatsApp Business.
              </p>
            )}
            {etiquetas.map((l) => (
              <button
                key={l.id}
                onClick={() => setEtiqueta(etiqueta?.id === l.id ? null : l)}
                className="cursor-pointer rounded-full px-2 py-[2px] text-[11px] font-medium transition-opacity hover:opacity-80"
                style={
                  etiqueta?.id === l.id
                    ? { background: l.cor || "var(--el-accent)", color: "#fff" }
                    : {
                        background: l.cor ? `${l.cor}1f` : "var(--el-surface-hover)",
                        color: l.cor || "var(--el-sub)",
                      }
                }
              >
                {l.nome}
                {l.quantidade != null ? ` · ${l.quantidade}` : ""}
              </button>
            ))}
          </div>
        )}

        <div className="relative mt-2">
          <Search
            size={13}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint"
          />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou número"
            className="w-full rounded-el border border-line bg-bg py-1.5 pl-7 pr-2 text-[12px] text-fg placeholder:text-faint outline-none focus:border-accent"
          />
        </div>
      </div>

      {resultado && (
        <div className="flex-none border-b border-line bg-accent-soft px-3 py-1.5 text-[11.5px] text-accent-forte">
          {resultado.importados} importado
          {resultado.importados === 1 ? "" : "s"}
          {resultado.jaExistiam > 0 && ` · ${resultado.jaExistiam} já estavam na base`}
        </div>
      )}

      {erro && (
        <div className="flex-none border-b border-line bg-danger/10 px-3 py-1.5 text-[11.5px] text-danger">
          {erro}
        </div>
      )}

      <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto">
        {itens === null ? (
          <p className="px-3 py-6 text-center text-[12px] text-sub">
            {escopo === "etiqueta" && !etiqueta
              ? "Escolha uma etiqueta acima."
              : "Lendo o WhatsApp…"}
          </p>
        ) : visiveis.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12px] text-sub">
            Nada encontrado.
          </p>
        ) : (
          <>
            {novosVisiveis.length > 0 && (
              <button
                onClick={alternarTodos}
                className="flex w-full cursor-pointer items-center gap-2 border-b border-line px-3 py-1.5 text-[11.5px] font-medium text-sub transition-colors hover:bg-surface-hover hover:text-fg"
              >
                <span
                  className={`flex h-3.5 w-3.5 flex-none items-center justify-center rounded-[3px] border ${
                    todosMarcados ? "border-accent bg-accent text-white" : "border-line-strong"
                  }`}
                >
                  {todosMarcados && <Check size={9} strokeWidth={3} />}
                </span>
                Selecionar {novosVisiveis.length} novo
                {novosVisiveis.length === 1 ? "" : "s"}
              </button>
            )}

            {visiveis.map((i) => {
              const existe = jaTem(i);
              const marcado = marcados.has(i.waId);
              return (
                <button
                  key={i.waId}
                  disabled={existe}
                  onClick={() => alternar(i.waId)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                    existe ? "opacity-45" : "cursor-pointer hover:bg-surface-hover"
                  }`}
                >
                  <span
                    className={`flex h-3.5 w-3.5 flex-none items-center justify-center rounded-[3px] border ${
                      marcado
                        ? "border-accent bg-accent text-white"
                        : "border-line-strong"
                    }`}
                  >
                    {marcado && <Check size={9} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-fg">
                      {i.nome || (i.telefone ? formatPhone(i.telefone) : "Sem nome")}
                    </span>
                    <span className="block truncate text-[10.5px] text-faint">
                      {existe
                        ? "já está na base"
                        : i.telefone
                          ? formatPhone(i.telefone)
                          : "sem telefone visível"}
                      {i.empresa ? ` · ${i.empresa}` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </>
        )}
      </div>

      <div className="flex-none border-t border-line bg-bg px-3 py-2">
        <button
          disabled={marcados.size === 0 || importando}
          onClick={importar}
          className="w-full cursor-pointer rounded-el bg-accent py-1.5 text-[12.5px] font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
        >
          {importando
            ? "Importando…"
            : marcados.size === 0
              ? "Selecione contatos para importar"
              : `Importar ${marcados.size} contato${marcados.size === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
