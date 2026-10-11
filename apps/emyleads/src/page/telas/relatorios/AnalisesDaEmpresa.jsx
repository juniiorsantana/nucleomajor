import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { api } from "../../../data/client";
import { NOME_DO_TIPO, analiseDoBanco } from "../../../domain/analiseDaConversa";
import { DialogoDaAnalise, textoDaOrigem } from "../conversas/AnaliseDaConversa";

const dia = (valor) =>
  valor ? new Date(valor).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";

/** Quem foi analisado: o contato, ou só o final do telefone quando não há um. */
export function quemFoiAnalisado(analise) {
  if (analise.contatoId && analise.nomeDoContato) return analise.nomeDoContato;
  const final4 = String(analise.telefone || "").replace(/\D/g, "").slice(-4);
  return final4 ? `Sem contato · •••• ${final4}` : "Sem contato";
}

/**
 * As análises das conversas da empresa, inclusive as que não têm contato.
 *
 * É o caminho para abrir uma análise sem a conversa: o dono decidiu, em
 * 11/10/2026, que as análises ficam mesmo quando o WhatsApp de onde vieram
 * sair (ADR-0007). A lista mostra de qual WhatsApp veio cada uma, sem dizer
 * "removido": isso só a remoção, quando existir, vai poder afirmar.
 */
export function AnalisesDaEmpresa() {
  const [estado, setEstado] = useState({ carregando: true, erro: "", lista: [] });
  const [atual, setAtual] = useState(null);

  useEffect(() => {
    let vivo = true;
    Promise.resolve()
      .then(() => api.conversas.analisesDaEmpresa({ limite: 50 }))
      .then((linhas) => {
        if (!vivo) return;
        const lista = (linhas || []).map(analiseDoBanco).filter((analise) => analise.situacao === "done" && analise.resultado);
        setEstado({ carregando: false, erro: "", lista });
      })
      .catch((falha) => {
        if (vivo) setEstado({ carregando: false, erro: falha?.message || "Não foi possível carregar as análises.", lista: [] });
      });
    return () => {
      vivo = false;
    };
  }, []);

  const abrir = async (analise) => {
    setAtual(analise);
    try {
      const completa = analiseDoBanco(await api.conversas.analise({ analiseId: analise.id }));
      if (completa) {
        setAtual((anterior) =>
          anterior?.id === completa.id
            ? { ...completa, origem: completa.origem || anterior.origem, nomeDoContato: anterior.nomeDoContato, telefone: anterior.telefone }
            : anterior
        );
      }
    } catch {
      // Sem a consulta, fica o que a lista trouxe.
    }
  };

  if (estado.carregando) {
    return (
      <p className="flex items-center justify-center gap-2 py-6 text-[12.5px] text-faint">
        <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
        Carregando as análises…
      </p>
    );
  }
  if (estado.erro) {
    return <p role="alert" className="py-6 text-center text-[12.5px] text-danger">{estado.erro}</p>;
  }
  if (estado.lista.length === 0) {
    return <p className="py-6 text-center text-[12.5px] text-faint">Nenhuma análise de conversa ainda.</p>;
  }

  return (
    <>
      <ul className="flex flex-col">
        {estado.lista.map((analise) => (
          <li key={analise.id} className="border-b border-line last:border-0">
            <button
              type="button"
              onClick={() => abrir(analise)}
              className="flex w-full cursor-pointer items-center gap-3 px-1 py-2.5 text-left text-[12.5px] transition-colors hover:bg-surface"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-fg">{quemFoiAnalisado(analise)}</span>
                <span className="block truncate text-[11.5px] text-sub">
                  {[NOME_DO_TIPO[analise.tipo] || "Análise", dia(analise.concluidaEm), textoDaOrigem(analise.origem)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {analise.notaDoAtendimento != null && (
                <span className="flex-none text-[11.5px] font-semibold tabular-nums text-sub">{analise.notaDoAtendimento}/100</span>
              )}
              <span className={`flex-none text-[11px] font-semibold ${analise.salvaEm ? "text-success" : "text-faint"}`}>
                {analise.salvaEm ? "Salva" : "Rascunho"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {atual && (
        <DialogoDaAnalise
          conversa={{ id: null, nome: quemFoiAnalisado(atual) }}
          fase="ver"
          atual={atual}
          creditos={null}
          pedindo={false}
          erro=""
          podePedir={false}
          contexto={{ contato: null, negocio: null, estagios: [], etiquetas: [] }}
          aoPedir={() => {}}
          aoRefazer={() => {}}
          aoSalvar={async () => {}}
          aoAplicar={async () => {}}
          aoFechar={() => setAtual(null)}
        />
      )}
    </>
  );
}
