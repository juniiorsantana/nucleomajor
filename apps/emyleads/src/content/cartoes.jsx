import { useState } from "react";
import {
  Briefcase,
  Building2,
  Check,
  ChevronDown,
  Copy,
  Database,
  Mail,
  MapPin,
  MoveRight,
  Phone,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";
import { api } from "../data/client";
import { fmtData, fmtDataHora, fmtMoeda, fmtVencimento, TONS } from "../lib/formato";
import { formatPhone } from "../lib/phone";
import { camposTecnicosDoContato, fotoPersistidaDoContato, resumoValorTecnico, valorTecnico } from "../lib/contatoTecnico";
import { Cartao, LinhaIcone, Pilula } from "../ui/componentes";
import { EdicaoRapida } from "./CampoEditavel";

/**
 * Os blocos da ficha, cada um num cartão.
 *
 * Empilhados numa rolagem só, em vez de escondidos atrás de abas: num CRM,
 * clicar para descobrir em que pé está o contato é justamente o trabalho que a
 * ficha deveria eliminar.
 */

/* ------------------------------------------------------------------ */
/* Contato                                                             */
/* ------------------------------------------------------------------ */

/**
 * Perfil: quem é, como está classificado, e — só se pedirem — os campos.
 *
 * Os seis campos de contato ocupavam meia tela em linhas de ícone, e quase
 * nenhum deles é consultado durante a conversa: o telefone você já tem (está
 * conversando com ele), e cargo e responsável são consulta rara. Viraram uma
 * linha de resumo, com o resto atrás de um "Detalhes".
 *
 * As tags subiram para cá, logo abaixo do nome. São identidade — "cliente",
 * "lead quente" —, e num cartão próprio lá embaixo gastavam um bloco inteiro
 * para exibir duas palavras.
 */
export function CartaoPerfil({
  contato,
  estagioAtual,
  foto,
  tags,
  recarregar,
}) {
  const [detalhes, setDetalhes] = useState(false);
  const [escolhendoTag, setEscolhendoTag] = useState(false);
  const [tecnicos, setTecnicos] = useState(false);
  const [copiadoTecnico, setCopiadoTecnico] = useState(null);

  const campo = (chave) => ({ contato, campo: chave, aoSalvar: recarregar });
  const marcadas = contato.tags || [];
  const fotoExibida = foto || fotoPersistidaDoContato(contato);
  const camposTecnicos = camposTecnicosDoContato(contato);

  const alternarTag = async (tagId) => {
    const proximas = marcadas.includes(tagId)
      ? marcadas.filter((t) => t !== tagId)
      : [...marcadas, tagId];
    await api.contatos.atualizar({ id: contato.id, patch: { tags: proximas } });
    await recarregar();
  };

  const copiarTecnico = async (chave, valor) => {
    try {
      await navigator.clipboard.writeText(valorTecnico(valor));
      setCopiadoTecnico(chave);
      window.setTimeout(() => setCopiadoTecnico(null), 1200);
    } catch {
      setCopiadoTecnico(null);
    }
  };

  const resumo = [
    contato.telefone ? formatPhone(contato.telefone) : null,
    contato.empresa,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Cartao>
      <div className="flex items-start gap-2.5 px-3 pt-3">
        {fotoExibida ? (
          <img
            src={fotoExibida}
            alt=""
            className="h-10 w-10 flex-none rounded-full object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-accent-soft text-[14px] font-semibold text-accent-forte">
            {(contato.nome || "?").trim().charAt(0).toUpperCase()}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <EdicaoRapida
                {...campo("nome")}
                className="text-[14px] font-semibold text-fg"
                placeholder="Sem nome"
              />
            </div>
            {estagioAtual && <Pilula tom="accent">{estagioAtual}</Pilula>}
          </div>

          <button
            onClick={() => setDetalhes(!detalhes)}
            title="Ver os campos do contato"
            className="mt-0.5 block max-w-full cursor-pointer truncate text-left text-[11.5px] text-sub transition-colors hover:text-fg"
          >
            {resumo || "Sem telefone nem empresa"}
          </button>
        </div>
      </div>

      {/* Tags logo abaixo do perfil, ocupando a largura inteira. */}
      <div className="relative flex flex-wrap items-center gap-1 px-3 pt-2">
        {marcadas.map((id) => {
          const t = tags.find((x) => x.id === id);
          return (
            <span
              key={id}
              className="group/tag inline-flex items-center gap-1 rounded-full py-[2px] pl-2 pr-1.5 text-[11px] font-medium"
              style={{
                color: t?.cor || "var(--el-sub)",
                background: t?.cor ? `${t.cor}1f` : "var(--el-surface-hover)",
              }}
            >
              {t?.nome || id}
              <button
                onClick={() => alternarTag(id)}
                title="Remover tag"
                className="cursor-pointer text-[13px] leading-none opacity-0 transition-opacity group-hover/tag:opacity-70 hover:!opacity-100"
              >
                ×
              </button>
            </span>
          );
        })}

        <button
          onClick={() => setEscolhendoTag(!escolhendoTag)}
          className="cursor-pointer rounded-full border border-dashed border-line-strong px-2 py-[2px] text-[11px] font-medium text-faint transition-colors hover:border-accent hover:text-accent-forte"
        >
          + tag
        </button>

        {escolhendoTag && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setEscolhendoTag(false)}
            />
            <div className="absolute left-3 top-full z-20 mt-1 w-44 overflow-hidden rounded-el border border-line bg-bg shadow-lg">
              {tags.map((t) => {
                const on = marcadas.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => alternarTag(t.id)}
                    className="flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-[11.5px] transition-colors hover:bg-surface-hover"
                  >
                    <span
                      className="h-2 w-2 flex-none rounded-full"
                      style={{ background: t.cor }}
                    />
                    <span className={`flex-1 ${on ? "text-fg" : "text-sub"}`}>
                      {t.nome}
                    </span>
                    {on && <Check size={12} className="text-accent" />}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <button
        onClick={() => setDetalhes(!detalhes)}
        className="mt-1.5 flex w-full cursor-pointer items-center gap-1 px-3 pb-2.5 text-[11.5px] text-sub transition-colors hover:text-fg"
      >
        Detalhes
        <ChevronDown
          size={13}
          className={`transition-transform ${detalhes ? "rotate-180" : ""}`}
        />
      </button>

      {detalhes && (
        <div className="border-t border-line pb-2 pt-1.5">
          <EdicaoRapida
            {...campo("telefone")}
            icone={Phone}
            formatar={formatPhone}
            placeholder="Adicionar telefone"
          />
          <EdicaoRapida
            {...campo("email")}
            icone={Mail}
            placeholder="Adicionar e-mail"
          />
          <EdicaoRapida
            {...campo("empresa")}
            icone={Building2}
            placeholder="Adicionar empresa"
          />
          <EdicaoRapida
            {...campo("origem")}
            icone={MapPin}
            placeholder="Adicionar origem"
          />
          <EdicaoRapida
            {...campo("cargo")}
            icone={Briefcase}
            placeholder="Adicionar cargo"
          />
          <EdicaoRapida
            {...campo("responsavel")}
            icone={UserRound}
            placeholder="Adicionar responsável"
          />
        </div>
      )}

      <div className="border-t border-line">
        <button
          onClick={() => setTecnicos(!tecnicos)}
          className="flex w-full cursor-pointer items-center gap-1.5 px-3 py-2 text-left text-[11px] text-sub transition-colors hover:text-fg"
        >
          <Database size={12} className="text-faint" />
          <span className="flex-1">Dados técnicos · {camposTecnicos.length}</span>
          <ChevronDown size={12} className={`transition-transform ${tecnicos ? "rotate-180" : ""}`} />
        </button>
        {tecnicos && (
          <div className="mx-3 mb-2 rounded-el bg-surface px-2">
            {camposTecnicos.map(([chave, valor]) => (
              <div key={chave} className="flex min-w-0 items-center gap-2 border-b border-line/70 py-1 last:border-b-0">
                <code className="w-16 flex-none text-[9px] text-faint">{chave}</code>
                <code title={valorTecnico(valor)} className="min-w-0 flex-1 truncate text-[10px] text-sub">{resumoValorTecnico(valor)}</code>
                <button type="button" onClick={() => copiarTecnico(chave, valor)} title={`Copiar ${chave}`} className="flex-none cursor-pointer text-faint hover:text-accent-forte">
                  {copiadoTecnico === chave ? "ok" : <Copy size={11} />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Cartao>
  );
}

/* ------------------------------------------------------------------ */
/* Funil                                                               */
/* ------------------------------------------------------------------ */

/**
 * Faixa de progresso no lugar da trilha em setas.
 *
 * Seis estágios em ~356px davam ~56px cada, e o `truncate` cortava tudo em
 * "Negoci…", "Novo l…", "Qualifi…" - seis rótulos ilegíveis para dizer uma
 * posição. Aqui a posição vira barra, e o nome que sobra é o que importa: onde
 * está e para onde vai.
 *
 * Depende de `estagios` chegar na ordem certa. Ver o comentário em Painel.jsx:
 * na extensão a lista vem do IndexedDB em ordem de chave, e ordenar é do
 * chamador.
 */
export function FaixaFunil({ negocios, estagios, contactId, recarregar }) {
  const aberto = negocios.find((n) => n.status === "aberto") || negocios[0] || null;

  const criar = async () => {
    await api.negocios.criar({
      contactId,
      titulo: "Nova oportunidade",
      stageId: estagios[0]?.id,
    });
    await recarregar();
  };

  const Moldura = ({ children }) => (
    <section className="overflow-hidden rounded-el-lg border border-line bg-bg">
      <div className="px-3 pb-1 pt-2.5 text-[9.5px] font-bold uppercase tracking-[0.07em] text-sub">
        Funil de vendas
      </div>
      {children}
    </section>
  );

  if (!aberto) {
    return (
      <Moldura>
      <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
        <span className="flex-1 text-[11px] text-faint">Nenhum negócio registrado</span>
        <button
          onClick={criar}
          className="flex cursor-pointer items-center gap-1 rounded-el border border-line px-2 py-1 text-[11px] font-medium text-accent-forte transition-colors hover:border-accent"
        >
          <Plus size={12} /> Negócio
        </button>
      </div>
      </Moldura>
    );
  }

  const indice = estagios.findIndex((e) => e.id === aberto.stageId);
  const proximo = indice >= 0 ? estagios[indice + 1] : null;

  const mover = async (stageId) => {
    await api.negocios.atualizar({ id: aberto.id, patch: { stageId } });
    await recarregar();
  };

  return (
    <Moldura>
    <div className="px-3 pb-2.5 pt-1">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-sub">{aberto.titulo}</span>
        {aberto.valor != null && (
          <span className="flex-none text-[11.5px] font-semibold text-fg">{fmtMoeda(aberto.valor)}</span>
        )}
        <div className="relative flex-none">
          <select
            value={aberto.stageId}
            onChange={(e) => mover(e.target.value)}
            title="Mover de estágio"
            className="cursor-pointer appearance-none rounded-full bg-accent-soft py-[3px] pl-2.5 pr-6 text-[10.5px] font-semibold text-accent-forte outline-none"
          >
            {estagios.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
          <ChevronDown size={11} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-accent-forte" />
        </div>
      </div>

      <div className="mt-2 flex gap-[3px]">
        {estagios.map((e, k) => (
          <span
            key={e.id}
            title={e.nome}
            className={`h-[5px] flex-1 rounded-full ${k <= indice ? "bg-accent" : "bg-surface-hover"}`}
          />
        ))}
      </div>

      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[10px] text-faint">
          {indice + 1} de {estagios.length}
          {proximo && <> · próximo: <strong className="font-semibold text-sub">{proximo.nome}</strong></>}
        </span>
        {proximo && (
          <button
            type="button"
            onClick={() => mover(proximo.id)}
            className="flex flex-none cursor-pointer items-center gap-1 text-[10.5px] font-semibold text-accent-forte hover:underline"
          >
            Avançar <MoveRight size={11} strokeWidth={2.4} />
          </button>
        )}
      </div>
    </div>
    </Moldura>
  );
}
