/**
 * Ações de criação, do lado do painel.
 *
 * Os formulários em si moraram aqui até a tela de Conversas passar a precisar
 * dos mesmos três. Desceram para `ui/formularios.jsx` em vez de virar cópia:
 * `page/` não importa de `content/`, então o que as duas superfícies usam vive
 * na camada que as duas alcançam.
 *
 * O reexport fica porque o painel chama `Formularios` daqui desde o começo, e
 * mudar o import de `Painel.jsx` junto seria mexer em duas coisas para
 * resolver uma.
 */

export { Formularios } from "../ui/formularios";
