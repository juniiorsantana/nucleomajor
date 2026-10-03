import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation, useNavigate } from "react-router-dom";
import "../ui/theme.css";
import { painelEscolhido } from "./painel";
import { TrocaDePainel } from "./TrocaDePainel";

// Dois painéis, um código cada: o novo (Sistema Grafite, src/page) e o
// antigo (cópia congelada, src/page-classico). Só o escolhido é baixado.
const PAINEL = painelEscolhido();
document.documentElement.dataset.painel = PAINEL;
if (PAINEL === "novo") {
  import("@fontsource-variable/geist");
  import("@fontsource-variable/geist-mono");
}
const AuthGate = lazy(() => (PAINEL === "novo" ? import("../page/AuthGate") : import("../page-classico/AuthGate")));
const Gestao = lazy(() => (PAINEL === "novo" ? import("../page/Gestao") : import("../page-classico/Gestao")));

/*
 * Todo destino do menu precisa de slug aqui, e a falta de um não dá erro — dá
 * um bug silencioso.
 *
 * "Conversas" ficou de fora desta tabela quando a tela nasceu. Clicar nela
 * trocava a tela e em seguida navegava para `screenToSlug["conversas"]`, que
 * era `undefined` e caía no fallback: a URL virava outra coisa, o efeito de
 * `telaInicial` devolvia a tela, e só o SEGUNDO clique ficava — porque aí a
 * URL já estava no fallback e não mudava mais.
 */
const slugToScreen = {
  conversas: "conversas",
  contatos: "contatos",
  campanhas: "campanhas",
  funil: "funil",
  relatorios: "relatorios",
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
  // `/assistente` guardado nos favoritos de alguém cai aqui e vira Conversas,
  // em vez de tela em branco.
  const slug = location.pathname.split("/").filter(Boolean)[0] || "conversas";
  const screen = slugToScreen[slug] || "conversas";

  return (
    <AuthGate>
      {(session, refreshSession) => (
        <Gestao
          sessao={session}
          atualizarSessao={refreshSession}
          migracaoPendente={null}
          telaInicial={screen}
          aoTrocarTela={(next) => navigate(`/${screenToSlug[next] || "conversas"}`)}
        />
      )}
    </AuthGate>
  );
}

createRoot(document.getElementById("raiz")).render(
  <BrowserRouter basename="/app">
    <Suspense fallback={null}>
      <WebApp />
    </Suspense>
    <TrocaDePainel painel={PAINEL} />
  </BrowserRouter>,
);
