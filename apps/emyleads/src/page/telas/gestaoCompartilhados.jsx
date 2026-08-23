import { Check, X } from "lucide-react";
import { fmtMoeda } from "../../lib/formato";

export const ENTRADA_GESTAO =
  "w-full rounded-[8px] border border-line bg-bg px-3 py-2 text-[13px] text-fg outline-none transition-colors focus:border-accent";

export function nomeDoContato(contatos, contactId) {
  return contatos.find((c) => c.id === contactId)?.nome || "Contato sem nome";
}

export function valorInput(valor) {
  return valor == null ? "" : String(valor);
}

export function parseValor(valor) {
  const texto = String(valor || "").trim().replace(/\s/g, "");
  if (!texto) return null;
  const numero = Number(texto.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(numero) ? numero : null;
}

export function dataInput(ts) {
  if (ts == null) return "";
  const d = new Date(ts);
  const dois = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

export function dataParaTimestamp(valor) {
  if (!valor) return null;
  const [ano, mes, dia] = valor.split("-").map(Number);
  const d = new Date(ano, mes - 1, dia, 9, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export function ModalGestao({ titulo, children, aoFechar }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[14px] border border-line bg-bg shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <h2 className="min-w-0 flex-1 text-[16px] font-semibold text-fg">{titulo}</h2>
          <button
            type="button"
            onClick={aoFechar}
            title="Fechar"
            className="cursor-pointer rounded-[8px] p-1 text-sub transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <X size={17} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function CampoFormulario({ rotulo, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[12px] font-medium text-sub">{rotulo}</span>
      {children}
    </label>
  );
}

export function Valor({ valor }) {
  return valor == null ? "—" : fmtMoeda(valor);
}

export function StatusNegocio({ status }) {
  const textos = { aberto: "Aberto", ganho: "Ganho", perdido: "Perdido" };
  const classes = {
    aberto: "bg-accent-soft text-accent-forte",
    ganho: "bg-success-soft text-success",
    perdido: "bg-danger/10 text-danger",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${classes[status] || classes.aberto}`}>
      {textos[status] || status}
    </span>
  );
}

export function EstadoVazio({ titulo, descricao }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-[14px] font-medium text-fg">{titulo}</p>
      {descricao && <p className="mt-1 max-w-sm text-[13px] text-sub">{descricao}</p>}
    </div>
  );
}

export function SeletorEtiquetas({ tags = [], valores = [], aoMudar, rotulo = "Etiquetas" }) {
  const selecionadas = new Set(valores);
  return (
    <div>
      <span className="mb-1 block text-[12px] font-medium text-sub">{rotulo}</span>
      <div className="flex flex-wrap gap-1.5 rounded-[9px] border border-line bg-bg p-2">
        {tags.length === 0 && <span className="text-[12px] text-faint">Nenhuma etiqueta cadastrada.</span>}
        {tags.map((tag) => {
          const marcada = selecionadas.has(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => aoMudar(marcada ? valores.filter((id) => id !== tag.id) : [...valores, tag.id])}
              className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-1 text-[11.5px] transition-colors ${
                marcada ? "border-accent bg-accent-soft text-accent-forte" : "border-line text-sub hover:border-line-strong hover:text-fg"
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: tag.cor }} />
              {tag.nome}
              {marcada && <Check size={12} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
