import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, LoaderCircle, Mail, ShieldCheck, UsersRound } from "lucide-react";
import { api } from "../../data/client";
import { fmtData } from "../../lib/formato";
import {
  CORES_DE_PESSOA,
  LIMITE_NOME_CURTO,
  corDaPessoa,
  nomeCurto as nomeCurtoDe,
} from "../../ui/perfil";
import { podeGerenciarEquipe, textoDoPapel } from "../../ui/papeis";
import { CabecalhoTela, Iniciais } from "../ui";

/**
 * Minha conta — o que é seu, separado do que é da empresa.
 *
 * A divisão em duas abas não é arrumação: é a régua do modelo de dados posta
 * na tela. Aba **Perfil** mostra o que mora em `profiles` e acompanha a pessoa
 * por todas as empresas; aba **Organização** mostra o que mora em
 * `organizations` e troca junto com o rodapé. O bloco "Nesta empresa", no fim
 * do Perfil, é a costura entre os dois — vive em `organization_members` e é o
 * único do Perfil que muda quando se troca de empresa, o que o texto do bloco
 * diz com todas as letras.
 *
 * Esta tela NÃO age sobre outras pessoas. Convidar, promover e remover
 * continuam na Equipe. A regra que separa as duas: se o botão mexe com
 * terceiro, é Equipe; se mexe com você, é aqui.
 */

const entrada =
  "w-full rounded-[8px] border border-line bg-bg px-3 py-2 text-[13.5px] text-fg outline-none transition-colors focus:border-accent disabled:bg-surface disabled:text-sub";

function Bloco({ titulo, descricao, children, etiqueta }) {
  return (
    <section className="rounded-[14px] border border-line bg-bg">
      <div className="border-b border-line px-5 py-4">
        <div className="flex items-center gap-2.5">
          <h2 className="text-[15px] font-semibold text-fg">{titulo}</h2>
          {etiqueta}
        </div>
        {descricao && (
          <p className="mt-1 max-w-[640px] text-[12.5px] leading-relaxed text-sub">
            {descricao}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function Rotulo({ children }) {
  return <span className="mb-1.5 block text-[12px] font-medium text-sub">{children}</span>;
}

function Dica({ children }) {
  return <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{children}</p>;
}

function Linha({ titulo, nota, children }) {
  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-3.5 last:border-b-0">
      <div className="min-w-[220px] flex-1">
        <p className="text-[13.5px] font-medium text-fg">{titulo}</p>
        {nota && <p className="mt-0.5 text-[12px] leading-relaxed text-sub">{nota}</p>}
      </div>
      {children}
    </div>
  );
}

function Aba({ ativa, aoClicar, children }) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      className={`cursor-pointer rounded-[9px] px-3.5 py-2 text-[13.5px] transition-colors ${
        ativa
          ? "bg-accent-soft font-semibold text-accent-forte"
          : "font-medium text-sub hover:bg-surface-hover hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */

/**
 * O bloco "Você".
 *
 * A prévia ao lado dos campos existe porque nome curto e cor são escolhas
 * cujo efeito não está aqui — está no cartão do funil e na linha da equipe.
 * Sem ver o resultado, "como você aparece" é uma pergunta abstrata, e campo
 * abstrato fica vazio.
 */
function BlocoVoce({ perfil, aoSalvar, ocupado }) {
  const [nome, setNome] = useState("");
  const [curto, setCurto] = useState("");
  const [cor, setCor] = useState(null);

  useEffect(() => {
    setNome(perfil?.full_name || "");
    setCurto(perfil?.display_name || "");
    setCor(perfil?.color || null);
  }, [perfil?.full_name, perfil?.display_name, perfil?.color]);

  const emEdicao = useMemo(
    () => ({ id: perfil?.id, full_name: nome, display_name: curto, color: cor }),
    [perfil?.id, nome, curto, cor]
  );
  const corEfetiva = corDaPessoa(emEdicao);
  const apelido = nomeCurtoDe(emEdicao, "Você");

  const alterado =
    nome !== (perfil?.full_name || "") ||
    curto !== (perfil?.display_name || "") ||
    (cor || null) !== (perfil?.color || null);
  const longoDemais = curto.trim().length > LIMITE_NOME_CURTO;

  return (
    <Bloco
      titulo="Você"
      descricao="Segue você para todo lado. Trocar de empresa no rodapé não muda nada deste bloco."
    >
      <div className="flex flex-wrap items-start gap-6 px-5 py-5">
        <div className="min-w-[280px] flex-1">
          <label className="block">
            <Rotulo>Nome completo</Rotulo>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Como está no seu documento"
              className={entrada}
            />
            <Dica>Aparece na Equipe, nos convites e nos registros.</Dica>
          </label>

          <label className="mt-4 block">
            <Rotulo>Como você aparece</Rotulo>
            <input
              value={curto}
              onChange={(e) => setCurto(e.target.value)}
              placeholder={nomeCurtoDe({ full_name: nome }, "")}
              className={entrada}
            />
            <Dica>
              Nome curto — é o que o time vê onde o nome inteiro não cabe. Em branco, usamos o
              seu primeiro nome.
            </Dica>
            {longoDemais && (
              <p className="mt-1.5 text-[11.5px] font-medium text-danger">
                Passa de {LIMITE_NOME_CURTO} caracteres.
              </p>
            )}
          </label>

          <div className="mt-4">
            <Rotulo>Sua cor</Rotulo>
            <div className="flex flex-wrap items-center gap-2.5">
              {CORES_DE_PESSOA.map((opcao) => {
                const escolhida = (cor || "").toLowerCase() === opcao;
                return (
                  <button
                    key={opcao}
                    type="button"
                    onClick={() => setCor(escolhida ? null : opcao)}
                    title={escolhida ? "Voltar para a cor automática" : `Usar ${opcao}`}
                    aria-pressed={escolhida}
                    className="h-7 w-7 cursor-pointer rounded-full transition-transform hover:scale-110"
                    style={{
                      background: opcao,
                      boxShadow: escolhida
                        ? `0 0 0 2.5px var(--el-bg), 0 0 0 4.5px ${opcao}`
                        : "none",
                    }}
                  />
                );
              })}
            </div>
            <Dica>
              {cor
                ? "Clique de novo na cor escolhida para voltar à automática."
                : "Escolhida a partir do seu id enquanto você não escolher — por isso já vem diferente da dos outros."}
            </Dica>
          </div>
        </div>

        <div className="min-w-[240px] flex-1 rounded-[10px] bg-surface p-4">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">
            Como o time te vê
          </p>
          <div className="mt-3 flex items-center gap-2.5">
            <Iniciais nome={nome || apelido} tamanho={30} cor={corEfetiva} />
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-medium text-fg">
                {nome || apelido}{" "}
                <span className="text-[11.5px] font-normal text-faint">(você)</span>
              </p>
              <p className="text-[12px] text-sub">na Equipe</p>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2.5">
            <Iniciais nome={apelido} tamanho={24} cor={corEfetiva} />
            <div className="min-w-0">
              <p className="truncate text-[13px] text-fg">{apelido}</p>
              <p className="text-[12px] text-sub">no cartão do lead</p>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2.5">
            <div
              className="min-w-0 flex-1 rounded-[4px] px-2.5 py-1.5"
              style={{ borderLeft: `3px solid ${corEfetiva}`, background: `${corEfetiva}1f` }}
            >
              <p className="truncate text-[12px] font-semibold text-fg">Reunião de proposta</p>
              <p className="text-[11px] text-sub">14:00 · {apelido}</p>
            </div>
            <span className="text-[12px] text-sub">na Agenda</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-line px-5 py-3">
        <button
          type="button"
          disabled={!alterado || longoDemais || ocupado}
          onClick={() => aoSalvar({ nome, nomeCurto: curto, cor })}
          className="flex cursor-pointer items-center gap-2 rounded-[8px] bg-accent px-4 py-2 text-[13px] font-semibold text-white transition-all hover:brightness-110 disabled:cursor-default disabled:opacity-40"
        >
          {ocupado && <LoaderCircle size={14} className="animate-spin" />}
          Salvar
        </button>
        {alterado && !ocupado && (
          <span className="text-[12px] text-faint">Alterações ainda não salvas.</span>
        )}
      </div>
    </Bloco>
  );
}

/* ------------------------------------------------------------------ */

/**
 * A responsabilidade é do MEMBRO, não da conta — e quem escreve é quem
 * administra.
 *
 * `update_member_responsibility` exige `can_manage_org`, então um atendente
 * que visse um campo editável aqui receberia erro do banco ao salvar. Mostrar
 * em leitura, dizendo quem pode mudar, é a única versão honesta.
 */
function BlocoNestaEmpresa({ organizacao, membro, gerencia, aoSalvarResponsabilidade, ocupado }) {
  const [texto, setTexto] = useState("");
  useEffect(() => setTexto(membro?.responsibility || ""), [membro?.responsibility]);
  const alterado = texto !== (membro?.responsibility || "");

  return (
    <Bloco
      titulo="Nesta empresa"
      etiqueta={
        <span className="rounded-[7px] bg-surface px-2.5 py-1 text-[12px] font-semibold text-sub">
          {organizacao?.name}
        </span>
      }
      descricao="Este bloco troca junto com a empresa. Você tem um destes em cada empresa de que participa."
    >
      <Linha titulo="Seu papel" nota="Quem muda papéis é só o dono, na tela de Equipe.">
        <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent-soft px-3 py-1.5 text-[12.5px] font-semibold text-accent-forte">
          {organizacao?.papel === "owner" && <ShieldCheck size={14} />}
          {textoDoPapel(organizacao?.papel)}
        </span>
      </Linha>

      <div className="border-b border-line px-5 py-4">
        <Rotulo>O que você faz aqui</Rotulo>
        <textarea
          value={texto}
          disabled={!gerencia || ocupado}
          onChange={(e) => setTexto(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="Ex.: cuida das vendas, das propostas e do retorno dos leads"
          className={`${entrada} resize-y leading-relaxed`}
        />
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <Dica>
            {gerencia
              ? "O assistente lê isto para decidir a quem passar cada assunto. Escreva como explicaria para alguém que entrou hoje."
              : "Só o dono ou um administrador escreve a responsabilidade — peça a quem administra se estiver desatualizada."}
          </Dica>
          {gerencia && (
            <button
              type="button"
              disabled={!alterado || ocupado}
              onClick={() => aoSalvarResponsabilidade(texto)}
              className="flex-none cursor-pointer rounded-[8px] border border-line px-3 py-2 text-[12.5px] font-semibold text-sub transition-colors hover:border-accent hover:text-accent-forte disabled:cursor-default disabled:opacity-40"
            >
              Salvar responsabilidade
            </button>
          )}
        </div>
      </div>

      <Linha
        titulo="Entrou nesta empresa"
        nota={organizacao?.papel === "owner" ? "Foi quem criou a organização." : null}
      >
        <span className="text-[13px] text-sub">
          {membro?.joined_at ? fmtData(membro.joined_at) : "—"}
        </span>
      </Linha>
    </Bloco>
  );
}

/* ------------------------------------------------------------------ */

function AbaOrganizacao({ sessao, membros, gerencia, aoSalvarNome, aoAbrirEquipe, ocupado }) {
  const organizacao = sessao?.organizacaoAtual;
  const [nome, setNome] = useState("");
  useEffect(() => setNome(organizacao?.name || ""), [organizacao?.name]);

  const limpo = nome.trim();
  const alterado = limpo !== (organizacao?.name || "");
  const tamanhoValido = limpo.length >= 2 && limpo.length <= 120;
  const dono = (membros || []).find((m) => m.role === "owner");
  const ativos = (membros || []).filter((m) => m.status === "active");

  return (
    <>
      <Bloco
        titulo="A empresa"
        descricao="Uma empresa é o cofre: contatos, funil, agenda, conhecimento e chatbots vivem dentro dela e não vazam para outra."
      >
        <div className="grid gap-5 px-5 py-5 md:grid-cols-2">
          <label className="block">
            <Rotulo>Nome da empresa</Rotulo>
            <input
              value={nome}
              disabled={!gerencia || ocupado}
              onChange={(e) => setNome(e.target.value)}
              className={entrada}
            />
            <Dica>
              {gerencia
                ? "Entre 2 e 120 caracteres. Aparece no rodapé e nos convites por e-mail."
                : "Só o dono ou um administrador renomeia a empresa."}
            </Dica>
            {alterado && !tamanhoValido && (
              <p className="mt-1.5 text-[11.5px] font-medium text-danger">
                Precisa ter entre 2 e 120 caracteres.
              </p>
            )}
          </label>

          <label className="block">
            <Rotulo>Identificador</Rotulo>
            <input value={organizacao?.slug || ""} disabled className={entrada} />
            <Dica>Não muda. Convites e links já enviados apontam para ele.</Dica>
          </label>
        </div>

        {gerencia && (
          <div className="flex items-center gap-3 border-t border-line px-5 py-3">
            <button
              type="button"
              disabled={!alterado || !tamanhoValido || ocupado}
              onClick={() => aoSalvarNome(limpo)}
              className="flex cursor-pointer items-center gap-2 rounded-[8px] bg-accent px-4 py-2 text-[13px] font-semibold text-white transition-all hover:brightness-110 disabled:cursor-default disabled:opacity-40"
            >
              {ocupado && <LoaderCircle size={14} className="animate-spin" />}
              Salvar
            </button>
          </div>
        )}
      </Bloco>

      <Bloco
        titulo="Dono"
        descricao="Uma empresa tem exatamente um dono: o único que promove administradores e o único que não pode ser removido."
      >
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <Iniciais
            nome={dono?.profile?.full_name || "?"}
            tamanho={40}
            cor={corDaPessoa(dono?.profile)}
          />
          <div className="min-w-[200px] flex-1">
            <p className="text-[14px] font-semibold text-fg">
              {dono?.profile?.full_name || "Sem nome no perfil"}
              {dono?.user_id === sessao?.usuario?.id && (
                <span className="ml-1.5 text-[11.5px] font-normal text-faint">(você)</span>
              )}
            </p>
            {dono?.joined_at && (
              <p className="mt-0.5 text-[12.5px] text-sub">
                Criou a empresa em {fmtData(dono.joined_at)}
              </p>
            )}
          </div>
        </div>
        <div className="mx-5 mb-4 rounded-[10px] bg-surface px-4 py-3">
          <p className="text-[12px] leading-relaxed text-sub">
            Transferir a empresa para outra pessoa ainda não existe: o banco recusa promover
            alguém a dono. Enquanto isso, o caminho é criar um administrador, que convida e
            remove gente.
          </p>
        </div>
      </Bloco>

      <Bloco
        titulo="Quem tem acesso"
        descricao="Resumo só de leitura. Convidar, mudar papel e remover acontece na tela de Equipe."
      >
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            {ativos.map((membro) => (
              <div key={membro.user_id} className="flex items-center gap-2 rounded-[9px] bg-surface px-2.5 py-1.5">
                <Iniciais
                  nome={membro.profile?.full_name || "?"}
                  tamanho={22}
                  cor={corDaPessoa(membro.profile)}
                />
                <span className="text-[12.5px] font-medium text-fg">
                  {nomeCurtoDe(membro.profile)}
                </span>
                <span className="text-[11.5px] text-sub">{textoDoPapel(membro.role)}</span>
              </div>
            ))}
            {!ativos.length && <span className="text-[13px] text-sub">Carregando…</span>}
          </div>
          <button
            type="button"
            onClick={aoAbrirEquipe}
            className="ml-auto flex flex-none cursor-pointer items-center gap-2 rounded-[8px] border border-line px-3 py-2 text-[13px] font-medium text-sub transition-colors hover:border-accent hover:text-accent-forte"
          >
            <UsersRound size={15} /> Abrir a Equipe
          </button>
        </div>
      </Bloco>
    </>
  );
}

/* ------------------------------------------------------------------ */

export default function MinhaConta({ sessao, atualizarSessao, aoAbrirTela }) {
  const [aba, setAba] = useState("perfil");
  const [membros, setMembros] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [salvo, setSalvo] = useState("");

  const organizacao = sessao?.organizacaoAtual;
  const meuId = sessao?.usuario?.id;
  const gerencia = podeGerenciarEquipe(organizacao?.papel);
  const perfil = sessao?.usuario?.perfil || null;

  const carregar = useCallback(async () => {
    try {
      setMembros(await api.organizacoes.membros());
    } catch (e) {
      // A lista de membros alimenta o resumo e o cartão do dono. Se falhar, o
      // resto da tela (que é sobre você) continua utilizável.
      setMembros([]);
      setErro(e?.message || "Não foi possível carregar a equipe.");
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar, organizacao?.id]);

  const meuMembro = (membros || []).find((m) => m.user_id === meuId) || null;

  const executar = async (acao, mensagem) => {
    setOcupado(true);
    setErro("");
    setSalvo("");
    try {
      await acao();
      setSalvo(mensagem);
    } catch (e) {
      setErro(e?.message || "Não foi possível salvar.");
    } finally {
      setOcupado(false);
    }
  };

  const salvarPerfil = (valores) =>
    executar(async () => {
      await api.perfil.salvar(valores);
      // A sessão carrega o perfil, e é dela que o rodapé e o avatar leem. Sem
      // recarregar, a tela mostraria o nome novo e o resto do app o antigo.
      if (atualizarSessao) await atualizarSessao();
      await carregar();
    }, "Perfil salvo.");

  const salvarNomeDaEmpresa = (nome) =>
    executar(async () => {
      await api.organizacoes.atualizar({ nome });
      if (atualizarSessao) await atualizarSessao();
    }, "Nome da empresa salvo.");

  const salvarResponsabilidade = (responsabilidade) =>
    executar(async () => {
      await api.organizacoes.atualizarResponsabilidade({
        usuarioId: meuId,
        responsabilidade,
      });
      await carregar();
    }, "Responsabilidade salva.");

  return (
    <>
      <CabecalhoTela
        titulo="Minha conta"
        busca={<span />}
        acao={
          <div className="flex items-center gap-1.5">
            <Aba ativa={aba === "perfil"} aoClicar={() => setAba("perfil")}>
              Perfil
            </Aba>
            <Aba ativa={aba === "organizacao"} aoClicar={() => setAba("organizacao")}>
              Organização
            </Aba>
          </div>
        }
      />

      <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <div className="flex max-w-4xl flex-col gap-6">
          {(erro || salvo) && (
            <div
              className={`rounded-[10px] px-4 py-3 text-[13px] ${
                erro
                  ? "border border-danger/40 bg-danger/10 text-danger"
                  : "border border-success/40 bg-success-soft text-success"
              }`}
            >
              <span className="inline-flex items-center gap-2">
                {!erro && <Check size={15} />}
                {erro || salvo}
              </span>
            </div>
          )}

          {aba === "perfil" ? (
            <>
              <BlocoVoce perfil={perfil} aoSalvar={salvarPerfil} ocupado={ocupado} />

              <Bloco
                titulo="Acesso"
                descricao="O e-mail é a sua identidade no Núcleo inteiro: é por ele que você entra e é nele que chegam os convites de outras empresas."
              >
                <Linha titulo={sessao?.usuario?.email || "—"} nota="E-mail de acesso">
                  <Mail size={16} className="text-faint" />
                </Linha>
              </Bloco>

              <BlocoNestaEmpresa
                organizacao={organizacao}
                membro={meuMembro}
                gerencia={gerencia}
                aoSalvarResponsabilidade={salvarResponsabilidade}
                ocupado={ocupado}
              />
            </>
          ) : (
            <AbaOrganizacao
              sessao={sessao}
              membros={membros}
              gerencia={gerencia}
              aoSalvarNome={salvarNomeDaEmpresa}
              aoAbrirEquipe={() => aoAbrirTela?.("equipe")}
              ocupado={ocupado}
            />
          )}
        </div>
      </div>
    </>
  );
}
