import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { api } from "../../data/client";
import { ENTRADA_PAINEL } from "../administracao";
import { formatarData, ORIGEM, situacao, venceEmBreve } from "../formatos";
import { Selo } from "./componentes";

/** Busca por nome, e-mail do dono ou id; filtros por plano e situação. */
export function filtrarEmpresas(empresas, { busca = "", plano = "", estado = "" } = {}) {
  const termo = busca.trim().toLowerCase();
  return empresas.filter((empresa) =>
    (!termo || [empresa.nome, empresa.dono, empresa.id].some((campo) => String(campo || "").toLowerCase().includes(termo)))
    && (!plano || empresa.plano === plano)
    && (!estado || empresa.estado === estado));
}

export default function Empresas({ aoAbrir }) {
  const [empresas, setEmpresas] = useState(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [plano, setPlano] = useState("");
  const [estado, setEstado] = useState("");

  const carregar = async () => {
    setErro("");
    try {
      setEmpresas(await api.plataforma.empresas());
    } catch (e) {
      setEmpresas([]);
      setErro(e?.message || "Não foi possível carregar as empresas.");
    }
  };

  useEffect(() => { carregar(); }, []);

  const planos = useMemo(
    () => [...new Map((empresas || []).map((e) => [e.plano, e.nomePlano])).entries()].filter(([codigo]) => codigo),
    [empresas],
  );
  const visiveis = filtrarEmpresas(empresas || [], { busca, plano, estado });
  const vencendo = (empresas || []).filter((empresa) => venceEmBreve(empresa));

  return (
    <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[20px] font-semibold tracking-tight text-fg md:text-[24px]">Empresas</h1>
          {empresas && <span className="text-[12.5px] text-sub">{empresas.length} no total</span>}
          <button type="button" onClick={carregar} title="Atualizar" aria-label="Atualizar"
            className="ml-auto cursor-pointer rounded-[8px] border border-line bg-bg p-2 text-sub hover:text-fg">
            <RefreshCw size={15} />
          </button>
        </div>

        {vencendo.length > 0 && (
          <div role="status" className="flex items-start gap-2.5 rounded-[12px] border border-warning/30 bg-warning/10 px-4 py-3 text-[12.5px] text-fg">
            <AlertTriangle size={16} className="mt-0.5 flex-none text-warning" aria-hidden="true" />
            <div>
              <strong>Vence em até 7 dias, sem renovação:</strong>{" "}
              {vencendo.map((empresa, i) => (
                <span key={empresa.id}>
                  {i > 0 && ", "}
                  <button type="button" onClick={() => aoAbrir(empresa.id)} className="cursor-pointer font-medium text-accent-forte hover:underline">
                    {empresa.nome}
                  </button>{" "}
                  ({formatarData(empresa.fimDoPeriodo)})
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar empresa"
            placeholder="Buscar por nome ou e-mail do dono" className={`${ENTRADA_PAINEL} min-w-[240px] flex-1 !py-2`} />
          <select value={plano} onChange={(e) => setPlano(e.target.value)} aria-label="Filtrar por plano" className={`${ENTRADA_PAINEL} !py-2`}>
            <option value="">Todos os planos</option>
            {planos.map(([codigo, nome]) => <option key={codigo} value={codigo}>{nome}</option>)}
          </select>
          <select value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Filtrar por situação" className={`${ENTRADA_PAINEL} !py-2`}>
            <option value="">Todas as situações</option>
            <option value="ok">Com acesso</option>
            <option value="past_due">Em atraso</option>
            <option value="blocked">Bloqueadas</option>
          </select>
        </div>

        {erro && <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger/5 px-4 py-3 text-[12.5px] text-danger">{erro}</p>}
        {empresas === null && <p className="text-[13px] text-sub">Carregando…</p>}

        {empresas !== null && !erro && (
          <div className="overflow-x-auto rounded-[14px] border border-line bg-bg">
            <table className="w-full min-w-[860px] text-left text-[12.5px]">
              <thead className="border-b border-line text-[11px] font-semibold uppercase tracking-wide text-faint">
                <tr>
                  <th className="px-4 py-2.5">Empresa</th>
                  <th className="px-3 py-2.5">Plano</th>
                  <th className="px-3 py-2.5">Situação</th>
                  <th className="px-3 py-2.5">Origem</th>
                  <th className="px-3 py-2.5 text-right">WhatsApp</th>
                  <th className="px-3 py-2.5 text-right">Contatos</th>
                  <th className="px-3 py-2.5 text-right">Pessoas</th>
                  <th className="px-3 py-2.5">Último acesso do dono</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visiveis.map((empresa) => {
                  const s = situacao(empresa);
                  return (
                    <tr key={empresa.id} onClick={() => aoAbrir(empresa.id)} className="cursor-pointer hover:bg-surface-hover">
                      <td className="px-4 py-2.5">
                        <button type="button" onClick={(e) => { e.stopPropagation(); aoAbrir(empresa.id); }}
                          className="cursor-pointer text-left font-semibold text-fg hover:text-accent-forte">
                          {empresa.nome}
                        </button>
                        <div className="text-[11.5px] text-sub">{empresa.dono || "sem dono ativo"}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        {empresa.nomePlano || "—"}
                        {empresa.ajustes > 0 && (
                          <span className="ml-1.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-accent-forte">
                            {empresa.ajustes} {empresa.ajustes === 1 ? "ajuste" : "ajustes"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5"><Selo tom={s.tom}>{s.rotulo}</Selo></td>
                      <td className="px-3 py-2.5 text-sub">{ORIGEM[empresa.origem] || empresa.origem || "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {empresa.whatsappEmUso}/{empresa.whatsappLimite ?? "∞"}
                        {empresa.whatsappEmUso > 0 && !empresa.ultimoSinal && (
                          <div className="text-[10.5px] text-warning">sem sinal da VPS</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{empresa.contatos}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{empresa.membros}</td>
                      <td className="px-3 py-2.5 text-sub">{formatarData(empresa.ultimoAcessoDono)}</td>
                    </tr>
                  );
                })}
                {visiveis.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-6 text-center text-sub">Nenhuma empresa com esses filtros.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
