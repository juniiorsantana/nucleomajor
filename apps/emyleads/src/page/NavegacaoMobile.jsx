import { useEffect, useId, useRef, useState } from "react";
import { LayoutGrid, X } from "lucide-react";

const PRINCIPAIS = ["conversas", "funil", "agenda", "conhecimento"];

export default function NavegacaoMobile({ telas, ativa, aoTrocar, rodape }) {
  const [aberto, setAberto] = useState(false);
  const dialogo = useRef(null);
  const gatilho = useRef(null);
  const id = useId();
  const principais = PRINCIPAIS.map((chave) => telas.find((t) => t.id === chave)).filter(Boolean);
  const demais = telas.filter((t) => !PRINCIPAIS.includes(t.id));

  useEffect(() => {
    const elemento = dialogo.current;
    if (aberto) elemento?.showModal();
    else if (elemento?.open) elemento.close();
  }, [aberto]);

  useEffect(() => { setAberto(false); }, [ativa]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const aoRedimensionar = () => { if (media.matches) setAberto(false); };
    media.addEventListener("change", aoRedimensionar);
    return () => media.removeEventListener("change", aoRedimensionar);
  }, []);

  const fechar = () => {
    setAberto(false);
    gatilho.current?.focus();
  };
  const navegar = (destino) => {
    fechar();
    aoTrocar(destino);
  };

  return <>
    <nav aria-label="Navegação móvel" className="mobile-dock">
      {principais.map(({ id: destino, rotulo, icone: Icone }) => (
        <button key={destino} type="button" aria-label={rotulo} title={rotulo}
          aria-current={ativa === destino ? "page" : undefined}
          onClick={() => navegar(destino)} className="mobile-dock-item">
          <Icone size={23} strokeWidth={1.9} aria-hidden="true" />
        </button>
      ))}
      <button ref={gatilho} type="button" aria-label="Mais seções" title="Mais seções"
        aria-haspopup="dialog" aria-controls={id} aria-expanded={aberto}
        data-active={demais.some((t) => t.id === ativa) || undefined}
        onClick={() => setAberto(true)} className="mobile-dock-item">
        <LayoutGrid size={23} strokeWidth={1.9} aria-hidden="true" />
      </button>
    </nav>
    <dialog ref={dialogo} id={id} aria-labelledby={`${id}-titulo`} className="mobile-menu"
      onCancel={fechar} onClose={fechar}
      onClick={(event) => { if (event.target === event.currentTarget) fechar(); }}>
      <div className="mobile-menu-surface">
        <header className="mobile-menu-heading">
          <h2 id={`${id}-titulo`}>Todas as seções</h2>
          <button type="button" autoFocus aria-label="Fechar menu" className="ds-icon-button" onClick={fechar}><X size={22} aria-hidden="true" /></button>
        </header>
        <nav aria-label="Outras seções" className="mobile-menu-grid">
          {demais.map(({ id: destino, rotulo, icone: Icone }) => (
            <button key={destino} type="button" aria-current={ativa === destino ? "page" : undefined} onClick={() => navegar(destino)}>
              <Icone size={23} aria-hidden="true" /><span>{rotulo}</span>
            </button>
          ))}
        </nav>
        {rodape && <div className="mobile-menu-account">{rodape}</div>}
      </div>
    </dialog>
  </>;
}
