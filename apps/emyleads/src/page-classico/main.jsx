import { createRoot } from "react-dom/client";
import "../ui/theme.css";
import AuthGate from "./AuthGate";
import Gestao from "./Gestao";

createRoot(document.getElementById("raiz")).render(
  <AuthGate>{(sessao, atualizarSessao, migracaoPendente) => <Gestao sessao={sessao} atualizarSessao={atualizarSessao} migracaoPendente={migracaoPendente} />}</AuthGate>
);
