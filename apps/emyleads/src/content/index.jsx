import { createRoot } from "react-dom/client";
import css from "../ui/theme.css?inline";
import Painel from "./Painel";
import { registrarSessaoWeb } from "../wa/sessaoWeb";

/**
 * Entrada do content script.
 *
 * Monta dentro de um Shadow DOM: o Tailwind não vaza para o WhatsApp e o CSS
 * do WhatsApp não entra no painel. Sem isso, os dois brigam para sempre.
 */

const ID_HOSPEDEIRO = "emyleads-raiz";

function montar() {
  if (document.getElementById(ID_HOSPEDEIRO)) return;

  const hospedeiro = document.createElement("div");
  hospedeiro.id = ID_HOSPEDEIRO;
  document.body.appendChild(hospedeiro);

  const sombra = hospedeiro.attachShadow({ mode: "open" });

  const folha = new CSSStyleSheet();
  folha.replaceSync(css);
  sombra.adoptedStyleSheets = [folha];

  const container = document.createElement("div");
  container.className = "font-sans text-[13px] leading-normal text-fg antialiased";
  sombra.appendChild(container);

  createRoot(container).render(<Painel />);

  // O content script é o que mais fica para trás: recarregar a extensão não
  // reinjeta nas abas já abertas, só numa recarga da própria aba. Este log é
  // como se descobre isso sem adivinhar.
  console.log(
    `[EmyLeads] painel — build ${typeof __BUILD_STAMP__ === "string" ? __BUILD_STAMP__ : "desconhecido"}`
  );

  // Fora do render de propósito: a tela de Conexões vive noutra aba e precisa
  // saber quem está logado aqui, mesmo que o painel esteja recolhido.
  registrarSessaoWeb();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", montar);
} else {
  montar();
}
