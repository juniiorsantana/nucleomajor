import { useEffect, useState } from "react";
import { api } from "../data/client";
import { descreverAlertaDoModelo, formatarDataHora } from "./formatos";

const INTERVALO_MS = 60_000;

const TONS = {
  perigo: "border-danger/30 bg-danger/10",
  aviso: "border-warning/30 bg-warning/10",
};

/**
 * O Cláudio dormindo, em cima de todas as telas do painel.
 *
 * Existe porque em 27/09/2026 o login do Claude na VPS venceu e a
 * administração só soube quando alguém tentou marcar reunião. Lê
 * `platform_model_alerts()` a cada minuto; some sozinha quando o agente volta
 * a responder. Erro de leitura não vira faixa: o painel não pode gritar
 * "dormindo" porque a própria consulta falhou.
 */
export default function FaixaDoClaudio({ aoAbrirEmpresa = () => {} }) {
  const [alertas, setAlertas] = useState([]);

  useEffect(() => {
    let vivo = true;
    const carregar = async () => {
      try {
        const lista = await api.plataforma.alertasDoModelo();
        if (vivo) setAlertas(Array.isArray(lista) ? lista : []);
      } catch {
        // Mantém o que já estava na tela; a próxima volta tenta de novo.
      }
    };
    carregar();
    const relogio = setInterval(carregar, INTERVALO_MS);
    return () => {
      vivo = false;
      clearInterval(relogio);
    };
  }, []);

  if (!alertas.length) return null;

  return (
    <div className="flex flex-none flex-col gap-2 px-4 pt-4 md:px-8">
      {alertas.map((alerta) => {
        const texto = descreverAlertaDoModelo(alerta);
        return (
          <div key={alerta.conexaoId} role="alert"
            className={`mx-auto flex w-full max-w-6xl items-start gap-3 rounded-[12px] border px-4 py-3 text-[12.5px] text-fg ${TONS[texto.tom] || TONS.aviso}`}>
            <span className="flex-none text-[20px] leading-none" aria-hidden="true">{texto.emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {alerta.empresaId ? (
                  <button type="button" onClick={() => aoAbrirEmpresa(alerta.empresaId)}
                    className="cursor-pointer text-left hover:underline">
                    {texto.titulo}
                  </button>
                ) : texto.titulo}
              </p>
              <p className="mt-0.5 text-sub">{texto.detalhe}</p>
              <p className="mt-1 text-[11.5px] text-sub">
                {alerta.conexao ? `${alerta.conexao} · ` : ""}
                conexão {alerta.conexaoId} · última resposta boa: {formatarDataHora(alerta.ultimaRespostaEm)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
