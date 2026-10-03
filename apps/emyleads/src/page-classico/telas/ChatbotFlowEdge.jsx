import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from "@xyflow/react";
import { Plus, X } from "lucide-react";

/**
 * A linha entre dois blocos.
 *
 * Nasce cinza e acende quando um bloco de uma das pontas está escolhido, para
 * dar para seguir um caminho com o olho. Com o mouse em cima (ou a linha
 * selecionada) aparecem dois botões: `+` insere um bloco no meio e refaz a
 * ligação, `x` remove.
 */
export function Fio({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected,
  data = {},
}) {
  const [caminho, meioX, meioY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 14,
  });
  const barra = (selected || data.emFoco) && (data.aoInserir || data.aoRemover);

  return (
    <>
      <BaseEdge
        id={id}
        path={caminho}
        markerEnd={markerEnd}
        interactionWidth={22}
        className={`flow-fio ${data.acesa ? "flow-fio--acesa" : ""}`}
      />
      {barra && (
        <EdgeLabelRenderer>
          <div
            className="flow-fio-barra nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${meioX}px, ${meioY}px)` }}
            onMouseEnter={() => data.aoFocar?.(id)}
            onMouseLeave={() => data.aoDesfocar?.(id)}
          >
            {data.aoInserir && (
              <button
                type="button"
                title="Inserir um bloco aqui"
                aria-label="Inserir um bloco nesta ligação"
                onClick={(event) => data.aoInserir(id, event)}
              >
                <Plus size={13} strokeWidth={2.3} />
              </button>
            )}
            {data.aoRemover && (
              <button
                type="button"
                className="flow-fio-barra__risco"
                title="Remover a ligação"
                aria-label="Remover esta ligação"
                onClick={() => data.aoRemover(id)}
              >
                <X size={13} strokeWidth={2.3} />
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const tiposDeFio = { fio: Fio };
