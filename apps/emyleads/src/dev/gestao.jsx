/**
 * Bancada da página de gestão — a tela cheia, fora da extensão.
 *
 * Aqui não há esqueleto de WhatsApp: a gestão roda numa aba própria e não
 * depende dele. Só o transporte é falso.
 */

import { useCallback, useState } from "react";
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
const sessaoInicial = await api.auth.estado();
const telaInicial = new URLSearchParams(window.location.search).get("tela") || null;

/**
 * A sessão fica em estado, e não numa constante, porque telas que ESCREVEM no
 * perfil ou na empresa pedem a sessão de volta depois de salvar. Com uma
 * constante, salvar o nome funcionava no banco e a bancada continuava
 * mostrando o valor velho — a tela parecia quebrada justamente onde não
 * estava.
 */
function Bancada() {
  const [sessao, setSessao] = useState(sessaoInicial);
  const atualizarSessao = useCallback(async (novo) => {
    const proximo = novo === undefined ? await api.auth.estado() : novo;
    setSessao(proximo);
    return proximo;
  }, []);

  return <Gestao sessao={sessao} atualizarSessao={atualizarSessao} telaInicial={telaInicial} />;
}

createRoot(document.getElementById("raiz")).render(<Bancada />);
