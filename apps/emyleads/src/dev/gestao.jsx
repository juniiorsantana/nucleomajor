/**
 * Bancada da página de gestão — a tela cheia, fora da extensão.
 *
 * Aqui não há esqueleto de WhatsApp: a gestão roda numa aba própria e não
 * depende dele. Só o transporte é falso.
 */

import { createRoot } from "react-dom/client";
import { api } from "../data/client";
import Gestao from "../page/Gestao";
import "../ui/theme.css";
import { instalarChromeFalso, semearSePreciso } from "./stub";

instalarChromeFalso();
await semearSePreciso();

// A bancada precisa da sessão pela mesma razão que a extensão precisa: telas
// escopadas por workspace — Conexões, hoje — não conseguem nem começar sem
// saber de qual empresa são. Renderizar sem ela testaria uma tela que não
// existe em produção.
const sessao = await api.auth.estado();

createRoot(document.getElementById("raiz")).render(
  <Gestao sessao={sessao} atualizarSessao={async () => sessao} />
);
