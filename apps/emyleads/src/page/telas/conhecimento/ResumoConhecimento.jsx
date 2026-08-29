import { AlertTriangle, FileEdit, Lock, MessageCircle, Users } from "lucide-react";
import { DIAS_PARA_REVISAR } from "./conhecimentoDados";

/**
 * Os cinco cartões do topo.
 *
 * Cada um é um filtro, não um enfeite: o número que a pessoa vê é o mesmo
 * conjunto que ela abre ao clicar. Um painel que informa sem levar a lugar
 * nenhum obriga a procurar de novo lá embaixo.
 */
const CARTOES = [
  {
    id: "clientes",
    rotulo: "Conteúdo para clientes",
    apoio: "o assistente pode repetir",
    icone: MessageCircle,
    cor: "var(--el-accent)",
  },
  {
    id: "equipe",
    rotulo: "Conteúdo interno",
    apoio: "só para a equipe",
    icone: Users,
    cor: "var(--el-sub)",
  },
  {
    id: "pessoal",
    rotulo: "Conteúdo pessoal",
    apoio: "só você vê",
    icone: Lock,
    cor: "var(--el-faint)",
  },
  {
    id: "rascunhos",
    rotulo: "Rascunhos",
    apoio: "ainda fora do ar",
    icone: FileEdit,
    cor: "var(--el-warning)",
  },
  {
    id: "revisao",
    rotulo: "Precisam de revisão",
    apoio: `sem alteração há ${DIAS_PARA_REVISAR} d`,
    icone: AlertTriangle,
    cor: "var(--el-danger)",
  },
];

export default function ResumoConhecimento({ total, filtro, onFiltrar }) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
      {CARTOES.map(({ id, rotulo, apoio, icone: Icone, cor }) => {
        const ativo = filtro === id;
        const quantidade = total[id] || 0;
        const vazio = quantidade === 0;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onFiltrar(ativo ? "todos" : id)}
            aria-pressed={ativo}
            className={`flex items-start gap-3 rounded-[12px] border p-3.5 text-left transition-colors ${
              ativo ? "border-accent bg-accent-soft" : "border-line bg-bg hover:bg-surface-hover"
            }`}
          >
            <span
              className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px]"
              // O mesmo truque da agenda: a cor tingida sobre o fundo do tema
              // funciona no claro e no escuro sem uma segunda paleta.
              style={{ backgroundColor: `color-mix(in srgb, ${cor} 14%, var(--el-bg))`, color: cor }}
            >
              <Icone size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <strong
                className="block text-[21px] font-semibold leading-none tabular-nums"
                style={{ color: vazio ? "var(--el-faint)" : cor }}
              >
                {quantidade}
              </strong>
              <span className="mt-1.5 block text-[12px] font-medium leading-4 text-fg">{rotulo}</span>
              <small className="mt-0.5 block text-[10.5px] leading-4 text-faint">{apoio}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}
