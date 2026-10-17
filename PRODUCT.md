# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Três públicos usam o portal (`/app`), principalmente no computador, com a tela aberta durante o expediente:

- **Atendente / recepção** da empresa cliente: responde conversas e leads do WhatsApp, move negócios no funil, agenda e cumpre tarefas.
- **Dono / gestor** da empresa cliente: acompanha leads, equipe e relatórios; configura conhecimento, assistentes de IA, fluxos e conexões.
- **Equipe Major Hub**: a agência opera e configura o portal em nome dos clientes, entrando em várias organizações.

O celular é uso secundário, mas real: o portal tem navegação móvel própria (dock) e precisa continuar operável no telefone.

Fora do portal existe um quarto público, o **cliente final** da empresa, que só conversa pelo WhatsApp com a identidade pública da organização e nunca vê o portal.

## Product Purpose

O Núcleo Major reúne CRM, agenda, conhecimento e automação conversacional no WhatsApp para empresas. Cada organização tem dados, equipe, permissões, assistentes e conexões isolados. O objetivo é que nenhum lead se perca: toda conversa vira contato, o lead entra no funil sozinho, e IA, fluxos e pessoas se revezam no atendimento sem atropelar uns aos outros.

O portal já é funcional. A etapa atual (out/2026) é torná-lo **usável**: menos atrito nas tarefas que se repetem o dia inteiro, sem mudar funcionalidade.

## Positioning

Atendimento no WhatsApp em que IA, fluxos determinísticos e humanos dividem a mesma conversa com regras explícitas de quem responde (pausa da IA quando uma pessoa assume, `/major` na equipe), ligado ao CRM, à agenda e ao funil da própria organização, com o runtime contínuo numa VPS em vez de depender do computador de alguém.

## Operating Context

- Módulos: Assistente pessoal, Conversas, Contatos, Funil, Tarefas, Agenda, Relatórios, Campanhas, Central de Inteligência (conhecimento, assistentes/agentes, skills, simulador, histórico), Fluxos (construtor visual), fila de atendimentos, Conexões, Equipe, Configurações.
- Entrada de leads: conversas no WhatsApp e formulários do Meta (Lead Ads).
- Uma pessoa pode participar de várias organizações com papéis diferentes; a interface muda conforme o papel.
- A extensão Chrome (painel dentro do WhatsApp Web) é opcional; o portal precisa funcionar sem ela.
- Idioma da interface: português do Brasil.

## Capabilities and Constraints

- Stack existente: React 18 + Vite + Tailwind 4 em `apps/emyleads`; tokens de cor em `apps/emyleads/src/ui/theme.css` (variáveis `--el-*`); Supabase com RLS; servidor Node serve o build.
- O mesmo React monta no portal e dentro de um Shadow DOM na extensão (por isso os tokens são declarados em `:root, :host`).
- Escritas sensíveis exigem confirmação e idempotência; falha de ferramenta nunca pode aparecer como sucesso.
- Conhecimento externo só chega ao cliente final se publicado explicitamente.
- Fora do escopo atual: Google Calendar, recorrência completa de agenda, API Oficial do WhatsApp substituindo o Bridge, cobrança por consumo de IA.
- Indefinido: código exato da cor grafite do rebrand (ainda não registrado no repositório).

## Brand Commitments

- Nome exibido na interface: **Núcleo Major**. "EmyLeads" permanece apenas como nome interno do código.
- Rebrand recente para um tom **grafite / cinza**. Direção pedida pelo dono para o redesign: base em tons neutros partindo do preto e branco, cantos retos, flat (sem sombra, sem cartões), minimalista no espírito de um app da Apple. Cor entra só como complemento.

## Evidence on Hand

- Clientes reais operam o portal hoje, com leads importados de campanhas do Meta e conversas reais de WhatsApp. Nomes, telefones e dados de clientes nunca entram em exemplos, mocks ou documentação.
- Documentação canônica do produto: `docs/README.md`, `docs/STATUS.md`, `docs/specs/SPEC-PRODUCT.md`.
- Não há depoimentos, métricas públicas nem estudos de caso registrados; não inventar.

## Product Principles

1. **Nenhum lead se perde.** Toda tela deve deixar claro o que está esperando resposta e quem é responsável.
2. **Quem responde é sempre explícito.** IA, fluxo ou pessoa: o estado de cada conversa precisa ser legível de relance.
3. **Usável vence completo.** A tarefa que se repete cem vezes por dia tem prioridade sobre a configuração usada uma vez.
4. **Nada de sucesso inventado.** Erros e estados pendentes aparecem como são, com o próximo passo.
5. **Funciona sem a extensão e no celular**, mesmo sendo desenhado primeiro para o computador.

## Accessibility & Inclusion

- Alvos de toque de no mínimo 44 px e campos com 16 px no celular (evita zoom no iOS); respeitar `safe-area-inset-bottom`.
- Temas claro e escuro, seguindo o sistema operacional, com a mesma semântica nos dois.
- Respeitar `prefers-reduced-motion`.
