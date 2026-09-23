import { useEffect, useState } from "react";
import { api } from "../../data/client";
import { ListaDoHistorico } from "./Empresa";

/** O histórico de todas as empresas, o mais novo primeiro. Não se apaga. */
export default function Historico({ aoAbrirEmpresa }) {
  const [linhas, setLinhas] = useState(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let ativo = true;
    api.plataforma.historico({ limite: 300 })
      .then((lista) => ativo && setLinhas(lista))
      .catch((e) => {
        if (!ativo) return;
        setLinhas([]);
        setErro(e?.message || "Não foi possível carregar o histórico.");
      });
    return () => { ativo = false; };
  }, []);

  if (linhas === null) return <p className="text-[13px] text-sub">Carregando…</p>;
  return (
    <section className="rounded-[14px] border border-line bg-bg">
      {erro && <p role="alert" className="px-5 py-3 text-[12.5px] text-danger">{erro}</p>}
      <ListaDoHistorico linhas={linhas} aoAbrirEmpresa={aoAbrirEmpresa} />
    </section>
  );
}
