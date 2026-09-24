/**
 * Contato é todo mundo no CRM; lead é o contato que alguém criou ou
 * transformou em lead (decidido em 24/09/2026, migration 20260926170000).
 *
 * `leadEm` tem três estados, e é por isso que a regra mora num lugar só:
 *
 *   número     - é lead desde então;
 *   null       - é só contato (o chatbot, a IA ou o "não atender IA" criaram);
 *   undefined  - quem entregou o contato não sabe de lead: a extensão, que
 *                guarda os dados no navegador. Ali todo contato continua
 *                sendo lead, como sempre foi.
 */
export const ehLead = (contato) => Boolean(contato) && (contato.leadEm === undefined || contato.leadEm != null);

/** Se a lista distingue lead de contato — só então vale mostrar a escolha. */
export const distingueLead = (contatos = []) => contatos.some((c) => c.leadEm !== undefined);
