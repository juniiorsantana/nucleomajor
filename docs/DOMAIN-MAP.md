# Mapa de domínio e responsabilidades

Status: referência canônica de entidades e autoridade.

Este mapa responde quatro perguntas: o que existe, onde é armazenado, quem pode
alterar e qual componente é responsável. Nomes de tabelas são detalhes técnicos;
os conceitos de produto permanecem os definidos no [Glossário](GLOSSARY.md).

## Identidade e organizações

| Conceito | Fonte de verdade | Estruturas principais | Autoridade de escrita |
| --- | --- | --- | --- |
| Conta | Supabase Auth | `auth.users` | titular e Auth |
| Perfil | Supabase | `profiles` | titular conforme RLS |
| Organização | Supabase | `organizations` | criação controlada e plataforma |
| Membro, papel e responsabilidade | Supabase | `organization_members` | owner/admin e RPCs autorizadas |
| Convite | Supabase + API Node | `organization_invites` | owner/admin; API envia e-mail |
| Plano e ativação | Supabase | `saas_plans`, `organization_subscriptions`, `onboarding_access_grants` | plataforma |
| Administrador da plataforma | Supabase | `platform_admins` | plataforma |

Invariante: uma conta pode participar de várias organizações; permissões sempre
dependem do vínculo atual, nunca apenas do perfil da pessoa.

## CRM

| Conceito | Fonte de verdade | Estruturas principais | Observação |
| --- | --- | --- | --- |
| Contato | Supabase | `contacts` | cliente/lead da organização |
| Negócio | Supabase | `deals` | oportunidade ligada a contato e etapa |
| Funil e etapa | Supabase | `stages` | a coluna de ordem decide a sequência |
| Tarefa | Supabase | `tasks` | mesma entidade quando exibida na agenda |
| Nota | Supabase | `notes` | registro textual; não substitui tarefa |
| Tag | Supabase | `tags`, `contact_tags` | marcador do CRM |
| Histórico do contato | Supabase | `contact_events` | base da linha do tempo do CRM |
| Qualificação | Supabase | `contact_qualifications` | dados estruturados do atendimento |

O IndexedDB da extensão pode manter dados legados durante migração ou cache, mas
não é autoridade do CRM multiempresa.

## Agenda

| Conceito | Fonte de verdade | Estruturas principais | Autoridade |
| --- | --- | --- | --- |
| Agenda da organização | Supabase | `organization_calendars` | organização |
| Evento | Supabase | `calendar_events` | conforme papel, autoria e visibilidade |
| Participante | Supabase | `calendar_event_participants` | fluxo de criação autorizado |
| Categoria | Supabase | `calendar_categories` | configuração da organização |
| Preferência pessoal | Supabase | `calendar_member_preferences` | próprio profissional |
| Lembrete | Supabase | `calendar_reminders` | evento/tarefa e worker autorizado |
| Telefone de notificação | Supabase | `calendar_phone_verifications` | titular após verificação |
| Ação pendente interna | Supabase | `assistant_pending_actions` | RPCs estreitas do runtime |
| Ação pendente de cliente | Supabase | `customer_pending_actions` | fluxo externo controlado |
| Idempotência de agendamento | Supabase | `calendar_operator_bookings`, `calendar_agent_bookings` | RPC de confirmação |

Invariante: falha de agenda não cria tarefa, nota ou Markdown como substituto.

## Central de Inteligência

| Conceito | Fonte de desenvolvimento | Fonte usada em produção | Estruturas principais |
| --- | --- | --- | --- |
| Modelo de assistente | código/migrations | Supabase | `assistant_templates`, `assistant_template_versions` |
| Perfil de assistente | portal | Supabase | `assistant_profiles` |
| Skill oficial | `packages/intelligence/skills` | Supabase após publicação | `skill_definitions`, `skill_versions` |
| Skill privada | portal | Supabase | `skill_definitions`, `skill_versions` |
| Vínculo de skill | portal | Supabase | `assistant_profile_skills`, `campaign_skills` |
| Documento | portal/Markdown | Supabase | `knowledge_documents`, `knowledge_document_versions` |
| Coleção | portal | Supabase | `knowledge_collections`, `knowledge_document_collections` |
| Campanha | portal | Supabase | `organization_campaigns`, `campaign_sources` |
| Conhecimento de campanha | portal | Supabase | `campaign_knowledge_collections` |
| Contexto resolvido | runtime/RPC | Supabase | `conversation_intelligence_contexts` |
| Sessão de skill | runtime/RPC | Supabase | `conversation_skill_sessions` |
| Auditoria | runtime/RPC | Supabase | `intelligence_audit_log` |
| Simulação | portal/RPC | Supabase | `intelligence_simulations` |

Invariantes:

- arquivos de skill não são lidos diretamente pelo runtime de produção;
- publicar é necessário para criar uma versão consumível;
- documento externo exige publicação e coleção externa alcançável;
- ferramenta efetiva é a interseção entre skill, papel, runtime e política.

## Conversas, chatbot e atendimento humano

| Conceito | Fonte de verdade | Estruturas principais | Responsável |
| --- | --- | --- | --- |
| Conversa do assistente web | Supabase | `assistant_threads`, `assistant_messages` | API Node + usuário autenticado |
| Execução de ferramenta web | Supabase | `assistant_tool_runs` | API Node + confirmação |
| Definição de chatbot | Supabase | `chatbot_definitions`, `chatbot_versions` | portal |
| Execução de chatbot | Supabase + cache operacional | `chatbot_executions` | executor da VPS |
| Sessão de fluxo | Supabase | `chatbot_flow_sessions` | executor |
| Transferência chatbot → IA | Supabase | `chatbot_ai_handoffs` | árbitro/runtime |
| Handoff humano | Supabase | `customer_handoff_requests` | runtime e owner/admin |
| Piloto externo | Supabase | `customer_assistant_pilot_contacts` | owner/admin |

Invariante: chatbot, assistente e humano possuem propriedade exclusiva da resposta
em cada turno. Dois componentes não devem responder à mesma mensagem.

## WhatsApp e runtime

| Conceito | Fonte de verdade operacional | Estruturas principais | Processo responsável |
| --- | --- | --- | --- |
| Conexão | Supabase | `whatsapp_connections` | portal e RPCs autorizadas |
| Host/instalação | Supabase | `connection_hosts`, `connection_installations` | gateway/control plane |
| Sessão do dispositivo | Supabase + SQLite/arquivos locais | `whatsapp_device_sessions` | Bridge |
| Evento de conexão | Supabase | `connection_events` | Bridge/gateway |
| Operador verificado | Supabase | `whatsapp_connection_operators` | verificação controlada |
| Desafio de verificação | Supabase | `whatsapp_operator_verifications` | runtime e RPCs |
| Credencial técnica | Supabase + arquivo `0600` | `connection_robot_credentials` | provisionamento/runtime |
| Saúde do runtime | Supabase | `connection_runtime_status` | heartbeat da VPS |
| Comando durável | Supabase | `connection_runtime_commands` | portal produz; VPS consome |
| Sessão e mensagens WhatsApp | SQLite/estado protegido | bancos do Bridge | Bridge |
| Fila de processamento | SQLite | banco do assistente | assistente Python |

O estado local protege continuidade e idempotência da integração. Estado de
negócio e permissões continuam no Supabase.

## Superfícies do produto

| Superfície | Papel | Pode funcionar sem extensão? | Pode manter o WhatsApp ativo? |
| --- | --- | --- | --- |
| Portal `/app` | painel principal | sim | não; apenas comanda/observa o runtime |
| API Node.js | convites e operações server-side do portal | sim | não |
| Extensão Chrome | CRM dentro do WhatsApp Web e conector opcional | não se aplica | não para a conexão produtiva da VPS |
| Runtime da VPS | receber, decidir, usar ferramentas e responder | sim | sim |
| Supabase | identidade, dados, contratos e control plane | sim | não sozinho |

## Autoridade por camada

```text
Usuário/cliente fornece intenção e dados
        ↓
Interface ou Bridge identifica o canal
        ↓
Servidor/runtime deriva conta, organização e conexão
        ↓
Skill limita o comportamento permitido
        ↓
MCP apresenta apenas ferramentas autorizadas
        ↓
RPC/RLS valida novamente identidade, papel e estado
        ↓
Postgres confirma o efeito durável
```

O modelo pode propor uma ação, mas não determina tenant, identidade, permissão,
destinatário ou sucesso.
