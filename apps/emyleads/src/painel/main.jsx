import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation, useNavigate } from "react-router-dom";
import "../ui/theme.css";
import PainelApp from "./PainelApp";

function PainelComRotas() {
  const location = useLocation();
  const navigate = useNavigate();
  return <PainelApp caminho={location.pathname} aoNavegar={(caminho) => navigate(caminho)} />;
}

createRoot(document.getElementById("raiz")).render(
  <BrowserRouter>
    <PainelComRotas />
  </BrowserRouter>,
);
