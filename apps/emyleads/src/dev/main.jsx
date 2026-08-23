/**
 * Bancada do painel — roda o painel FORA do WhatsApp.
 *
 * Existe porque design não se avalia lendo código: sem isto, cada ajuste de
 * layout custa um build, um recarregar da extensão, um F5 no WhatsApp e uma
 * captura de tela. Aqui é `npm run dev` e recarga instantânea.
 *
 * O que é falso: o transporte (`chrome.runtime`), o `chat-inject` e o
 * esqueleto do WhatsApp — reproduzido só o suficiente para o painel se
 * reconhecer: a raiz `#app`, que ele encolhe, e o cabeçalho de conversa que o
 * modo degradado lê.
 *
 * O que é real: o painel inteiro, o Shadow DOM, os tokens, o IndexedDB e todas
 * as operações do provider.
 */

import { createRoot } from "react-dom/client";
import Painel from "../content/Painel";
import css from "../ui/theme.css?inline";
import {
  instalarChatInjectFalso,
  instalarChromeFalso,
  semearSePreciso,
} from "./stub";

instalarChromeFalso();
instalarChatInjectFalso();

/* --- esqueleto mínimo do WhatsApp -------------------------------------- */

const CONTATO_DEMO = "João Silva";

document.body.style.margin = "0";

const app = document.createElement("div");
app.id = "app";
app.style.cssText =
  "position:absolute;inset:0;background:#eae6df;font-family:system-ui;color:#54656f";
app.innerHTML = [
  '<div id="main" style="height:100%;display:flex;flex-direction:column">',
  '<header style="height:56px;display:flex;align-items:center;gap:12px;',
  'padding:0 16px;background:#f0f2f5;border-bottom:1px solid #d1d7db">',
  '<div style="width:40px;height:40px;border-radius:50%;background:#c4cdd3"></div>',
  `<span dir="auto" title="${CONTATO_DEMO}" style="font-size:16px;color:#111b21">${CONTATO_DEMO}</span>`,
  "</header>",
  '<div style="flex:1;display:flex;align-items:center;justify-content:center;font-size:13px">',
  "área da conversa</div></div>",
].join("");
document.body.appendChild(app);

await semearSePreciso(CONTATO_DEMO);

/* --- mesmo mount do content script, Shadow DOM incluso ----------------- */

const hospedeiro = document.createElement("div");
document.body.appendChild(hospedeiro);
const sombra = hospedeiro.attachShadow({ mode: "open" });

const folha = new CSSStyleSheet();
folha.replaceSync(css);
sombra.adoptedStyleSheets = [folha];

const container = document.createElement("div");
container.className = "font-sans text-[13px] leading-normal text-fg antialiased";
sombra.appendChild(container);

createRoot(container).render(<Painel />);
