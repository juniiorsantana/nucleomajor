import { useEffect, useRef, useState } from "react";
import { api } from "../data/client";
import { LinhaIcone } from "../ui/componentes";

/**
 * Campo da ficha que edita no lugar.
 *
 * Existe por um motivo de design, não de funcionalidade: sem ele, todo campo
 * não preenchido vira um traço que é beco sem saída, e uma ficha cheia de
 * traços parece formulário abandonado. Com edição no lugar, campo vazio deixa
 * de ser ausência e vira convite — daí o texto ser "Adicionar telefone" em vez
 * de "—".
 *
 * Salva ao sair do campo ou no Enter; Esc desfaz. Sem botão de salvar: não há
 * como confirmar sem querer, então o botão só ocuparia espaço.
 *
 * Duas formas de exibição, mesma mecânica: com `icone`, vira linha de dado
 * (ícone + valor); sem ícone, vira texto puro com a classe que vier — é assim
 * que o nome do contato fica editável sem parecer um campo.
 */
export function EdicaoRapida({
  contato,
  campo,
  aoSalvar,
  icone,
  formatar,
  placeholder = "Adicionar",
  className = "",
}) {
  const bruto = contato[campo] ?? "";
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(bruto);
  const [salvando, setSalvando] = useState(false);
  const entrada = useRef(null);

  useEffect(() => {
    if (!editando) setValor(bruto);
  }, [bruto, editando]);

  useEffect(() => {
    if (editando) {
      entrada.current?.focus();
      entrada.current?.select();
    }
  }, [editando]);

  const gravar = async () => {
    const novo = valor.trim();
    setEditando(false);
    if (novo === String(bruto)) return;

    setSalvando(true);
    try {
      await api.contatos.atualizar({ id: contato.id, patch: { [campo]: novo } });
      await aoSalvar?.();
    } catch (err) {
      console.warn(`[EmyLeads] não consegui salvar ${campo}:`, err);
      setValor(bruto);
    } finally {
      setSalvando(false);
    }
  };

  const aoTeclar = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      gravar();
    }
    if (e.key === "Escape") {
      setValor(bruto);
      setEditando(false);
    }
  };

  if (editando) {
    const input = (
      <input
        ref={entrada}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onBlur={gravar}
        onKeyDown={aoTeclar}
        className={`w-full min-w-0 rounded-[4px] border border-accent bg-bg px-1 py-0.5 outline-none ${
          icone ? "text-[12.5px] text-fg" : className
        }`}
      />
    );
    return icone ? (
      <LinhaIcone icone={icone}>{input}</LinhaIcone>
    ) : (
      <div className="pr-2">{input}</div>
    );
  }

  const exibido = bruto ? (formatar ? formatar(bruto) : bruto) : null;
  const abrir = () => setEditando(true);

  if (icone) {
    return (
      <LinhaIcone
        icone={icone}
        aoClicar={abrir}
        titulo={`Editar ${campo}`}
        vazio={!exibido}
      >
        <span className={salvando ? "opacity-50" : ""}>
          {exibido || placeholder}
        </span>
      </LinhaIcone>
    );
  }

  return (
    <button
      onClick={abrir}
      title={`Editar ${campo}`}
      className={`w-full cursor-text truncate rounded-[4px] text-left transition-colors hover:bg-surface-hover ${className} ${
        exibido ? "" : "text-faint"
      } ${salvando ? "opacity-50" : ""}`}
    >
      {exibido || placeholder}
    </button>
  );
}
