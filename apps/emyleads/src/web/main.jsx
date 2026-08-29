import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation, useNavigate } from "react-router-dom";
import "../ui/theme.css";
import AuthGate from "../page/AuthGate";
import Gestao from "../page/Gestao";

const slugToScreen = {
  assistente: "assistente",
  contatos: "contatos",
  funil: "funil",
  tarefas: "tarefas",
  agenda: "agenda",
  conhecimento: "conhecimento",
  nucleo: "conhecimento",
  chatbots: "chatbots",
  conexoes: "conexoes",
  equipe: "equipe",
  configuracoes: "config",
  conta: "conta",
};
const screenToSlug = Object.fromEntries(Object.entries(slugToScreen).map(([slug, screen]) => [screen, slug]));
screenToSlug.conhecimento = "conhecimento";

function WebApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const slug = location.pathname.split("/").filter(Boolean)[0] || "assistente";
  const screen = slugToScreen[slug] || "assistente";

  return (
    <AuthGate>
      {(session, refreshSession) => (
        <Gestao
          sessao={session}
          atualizarSessao={refreshSession}
          migracaoPendente={null}
          telaInicial={screen}
          aoTrocarTela={(next) => navigate(`/${screenToSlug[next] || "assistente"}`)}
        />
      )}
    </AuthGate>
  );
}

createRoot(document.getElementById("raiz")).render(
  <BrowserRouter basename="/app">
    <WebApp />
  </BrowserRouter>,
);
