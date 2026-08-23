/**
 * Os papéis de uma organização, em português, e o que cada um pode.
 *
 * Espelha `private.can_manage_org` e as checagens dentro das funções do
 * Supabase (`20260812130000_initial_saas.sql`). **A autorização de verdade é a
 * do banco** — o que mora aqui é só a interface não oferecer botão que o banco
 * vai recusar. Um botão que sempre dá erro ensina o operador a desconfiar do
 * sistema inteiro.
 *
 * Se a regra do banco mudar, muda aqui junto. Divergir faz a tela mentir nas
 * duas direções: escondendo o que é permitido, ou oferecendo o que não é.
 */

export const PAPEIS = {
  owner: "Dono",
  admin: "Administrador",
  member: "Atendente",
};

export const DESCRICAO_DO_PAPEL = {
  owner: "Controla tudo, inclusive quem administra. Não pode ser removido nem rebaixado por outra pessoa.",
  admin: "Convida e remove pessoas da equipe, e usa o CRM inteiro.",
  member: "Atende conversas e usa o CRM. Não mexe na equipe.",
};

export const textoDoPapel = (papel) => PAPEIS[papel] || papel || "—";

/** Convidar e remover: dono ou administrador (`can_manage_org`). */
export const podeGerenciarEquipe = (papel) => papel === "owner" || papel === "admin";

/**
 * Mudar papel: **só o dono**.
 *
 * `change_organization_member_role` recusa admin com "owner permission
 * required". É mais restrito que convidar de propósito: quem promove decide
 * quem manda, e isso não se delega junto com o resto.
 */
export const podeMudarPapel = (papel) => papel === "owner";

/**
 * Papéis que se pode atribuir a outra pessoa.
 *
 * `owner` fica fora: a função recusa promover outro a dono
 * ("owner transfer requires a separate flow"). Transferir a organização é
 * outro fluxo, que ainda não existe.
 */
export const OPCOES_DE_PAPEL = [
  { id: "member", rotulo: PAPEIS.member },
  { id: "admin", rotulo: PAPEIS.admin },
];

/**
 * O dono não é removível.
 *
 * O `delete` da função filtra `role <> 'owner'`, então remover um dono não dá
 * erro — simplesmente não apaga nada. Uma tela que oferecesse esse botão
 * mostraria sucesso sem ter feito nada, que é pior que recusar.
 */
export const podeRemover = (papelDeQuemOlha, membro, meuId) => {
  if (!podeGerenciarEquipe(papelDeQuemOlha)) return false;
  if (membro.role === "owner") return false;
  if (membro.user_id === meuId && papelDeQuemOlha === "owner") return false;
  return true;
};
