import { useEffect, useState } from "react";
import { Save, Sparkles } from "lucide-react";
import { api } from "../../../data/client";

/**
 * O que a IA precisa saber da campanha: oferta, público, sinais de origem,
 * habilidades e conhecimento.
 *
 * Morava na aba "Campanhas" da Central de Inteligência; veio para a tela
 * Campanhas para existir um lugar só. Só aparece para quem tem Inteligência —
 * quem não tem IA não tem o que configurar aqui. O que se grava não mudou:
 * `api.inteligencia.salvarCampanha`, com os mesmos campos de antes.
 */

const lista = (valor) => String(valor || "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);

export const CAMPANHA_VAZIA = {
  id: null, nome: "", status: "draft", objetivo: "", oferta: "", publico: "", resultado: "",
  padrao: false, fontes: "keyword:", skillIds: [], collectionIds: [],
};

function rascunhoDa(campanha, dados) {
  return {
    id: campanha.id,
    nome: campanha.name,
    status: campanha.status,
    objetivo: campanha.objective || "",
    oferta: campanha.offer || "",
    publico: campanha.audience_description || "",
    resultado: campanha.desired_outcome || "",
    padrao: Boolean(campanha.is_default),
    fontes: dados.sources.filter((item) => item.campaign_id === campanha.id).map((item) => `${item.source_type}:${item.source_value}`).join("\n"),
    skillIds: dados.campaignSkills.filter((item) => item.campaign_id === campanha.id).map((item) => item.skill_id),
    collectionIds: dados.campaignCollections.filter((item) => item.campaign_id === campanha.id).map((item) => item.collection_id),
  };
}

function Escolhas({ titulo, itens, marcados, aoMudar, desabilitado }) {
  if (!itens.length) return null;
  return (
    <div>
      <p className="mb-2 text-[12px] font-medium text-sub">{titulo}</p>
      <div className="flex flex-wrap gap-2">
        {itens.map((item) => (
          <label key={item.id} className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[12px] text-fg">
            <input
              type="checkbox"
              disabled={desabilitado}
              checked={marcados.includes(item.id)}
              onChange={(e) => aoMudar(e.target.checked ? [...marcados, item.id] : marcados.filter((id) => id !== item.id))}
            />
            {item.name}
          </label>
        ))}
      </div>
    </div>
  );
}

const CAMPO = "mt-1 w-full rounded-ctl border border-line bg-bg px-3 py-2 text-[13px] font-normal text-fg";

/**
 * `campanhaId` nulo é campanha nova. `aoSalvar` recebe o nome, para a tela
 * recarregar a lista e reabrir a campanha salva.
 */
export default function IaDaCampanha({ campanhaId, podeEditar, aoSalvar }) {
  const [dados, setDados] = useState(null);
  const [rascunho, setRascunho] = useState(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setErro("");
    api.inteligencia
      .carregar()
      .then((carregados) => {
        if (!vivo) return;
        setDados(carregados);
        const campanha = campanhaId ? carregados.campaigns.find((item) => item.id === campanhaId) : null;
        setRascunho(campanha ? rascunhoDa(campanha, carregados) : { ...CAMPANHA_VAZIA });
      })
      .catch((falha) => vivo && setErro(falha?.message || "Não deu para carregar a IA da campanha."));
    return () => {
      vivo = false;
    };
  }, [campanhaId]);

  const assistente = dados?.profiles.find((item) => item.audience === "customer" && item.is_default);

  const salvar = async () => {
    if (!assistente) {
      setErro("Nenhum assistente de clientes está marcado como padrão nesta organização.");
      return;
    }
    setSalvando(true);
    setErro("");
    try {
      const fontes = lista(rascunho.fontes).map((linha, indice) => {
        const at = linha.indexOf(":");
        return {
          tipo: at > 0 ? linha.slice(0, at).trim() : "keyword",
          valor: at > 0 ? linha.slice(at + 1).trim() : linha,
          prioridade: indice * 10 + 10,
        };
      });
      await api.inteligencia.salvarCampanha({ ...rascunho, profileId: assistente.id, fontes });
      await aoSalvar?.(rascunho.nome);
    } catch (falha) {
      setErro(falha?.message || "Não deu para salvar.");
    } finally {
      setSalvando(false);
    }
  };

  if (erro && !rascunho) return <p className="text-[13px] text-danger">{erro}</p>;
  if (!rascunho) return <p className="text-[13px] text-sub">Carregando…</p>;

  const mudar = (campo) => (e) => setRascunho({ ...rascunho, [campo]: e.target.value });
  const novo = !rascunho.id;

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-[1fr_170px]">
          <label className="text-[12px] font-medium text-sub">
            Nome
            <input disabled={!podeEditar} value={rascunho.nome} onChange={mudar("nome")} className={CAMPO} />
          </label>
          <label className="text-[12px] font-medium text-sub">
            Status
            <select disabled={!podeEditar} value={rascunho.status} onChange={mudar("status")} className={CAMPO}>
              <option value="draft">Rascunho</option>
              <option value="test">Em teste</option>
              <option value="active">Ativa</option>
              <option value="paused">Pausada</option>
              <option value="closed">Encerrada</option>
            </select>
          </label>
        </div>
      {[
        ["objetivo", "Objetivo", "O que a campanha quer que o lead faça."],
        ["oferta", "Oferta autorizada", "O que a IA pode oferecer, e nada além disso."],
        ["publico", "Público", "Para quem é a campanha."],
        ["resultado", "Resultado esperado", "Quando a conversa deu certo."],
      ].map(([campo, rotulo, dica]) => (
        <label key={campo} className="text-[12px] font-medium text-sub">
          {rotulo}
          <span className="ml-2 font-normal text-faint">{dica}</span>
          <textarea disabled={!podeEditar} value={rascunho[campo]} onChange={mudar(campo)} className={`${CAMPO} min-h-16`} />
        </label>
      ))}
      <label className="text-[12px] font-medium text-sub">
        Sinais de origem
        <span className="ml-2 font-normal text-faint">Como a IA reconhece que a conversa veio desta campanha. Um por linha.</span>
        <textarea
          disabled={!podeEditar}
          value={rascunho.fontes}
          onChange={mudar("fontes")}
          placeholder={"ad:meta-123\nkeyword:quero saber"}
          className={`${CAMPO} min-h-20 font-mono text-[12px]`}
        />
      </label>
      <Escolhas
        titulo="Habilidades que a IA usa nesta campanha"
        itens={(dados.skills || []).filter((item) => item.audience !== "internal")}
        marcados={rascunho.skillIds}
        desabilitado={!podeEditar}
        aoMudar={(skillIds) => setRascunho({ ...rascunho, skillIds })}
      />
      <Escolhas
        titulo="Conhecimento que a IA consulta"
        itens={(dados.collections || []).filter((item) => item.audience === "external")}
        marcados={rascunho.collectionIds}
        desabilitado={!podeEditar}
        aoMudar={(collectionIds) => setRascunho({ ...rascunho, collectionIds })}
      />
      <label className="flex items-center gap-2 text-[12.5px] text-sub">
        <input type="checkbox" disabled={!podeEditar} checked={rascunho.padrao} onChange={(e) => setRascunho({ ...rascunho, padrao: e.target.checked })} />
        Campanha padrão quando nenhum sinal corresponder
      </label>
      {erro && <p className="text-[12.5px] text-danger">{erro}</p>}
      {podeEditar && (
        <button
          type="button"
          onClick={salvar}
          disabled={salvando || !rascunho.nome.trim()}
          className="ml-auto inline-flex cursor-pointer items-center gap-2 rounded-ctl bg-accent px-4 py-2.5 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-40"
        >
          {novo ? <Sparkles size={15} /> : <Save size={15} />}
          {salvando ? "Salvando…" : novo ? "Criar campanha" : "Salvar IA da campanha"}
        </button>
      )}
    </div>
  );
}
