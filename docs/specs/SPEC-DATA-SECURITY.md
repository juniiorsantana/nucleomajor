# SPEC — Dados e segurança

Status: contrato obrigatório.

## Fonte de verdade

Supabase Auth e Postgres são a fonte de verdade de identidade e negócio. SQLite
e IndexedDB são caches, filas ou estado de integração; nunca substituem CRM,
agenda, conhecimento ou permissões.

## Fronteiras

### Organização

Toda tabela multiempresa deve conter `organization_id`. Referências entre
entidades multiempresa usam FKs compostas quando necessário. A aplicação não
confia em filtros do frontend para isolamento.

### Usuário e papel

Papéis atuais: `owner`, `admin` e `member`. A mesma pessoa pode ter papéis
diferentes em organizações diferentes. Mudanças de papel e revogações devem
ter efeito no banco, não apenas no prompt.

### Assistente

Credenciais técnicas são vinculadas à conexão e organização. O modelo recebe
identificadores derivados pelo runtime. RPCs públicas de robô validam a
credencial ativa antes de ler ou escrever.

## Classificação dos dados

| Classe | Exemplos | Tratamento |
| --- | --- | --- |
| Público | landing, nome comercial | pode ser entregue sem sessão |
| Organizacional | CRM, funil, campanha | somente membros autorizados |
| Pessoal | documento pessoal, evento privado | somente titular; colegas veem indisponibilidade |
| Secreto | SMTP, service_role, tokens, sessão WhatsApp | servidor/VPS, nunca Git ou navegador |
| Sensível | telefone, mensagens, logs de ferramentas | minimizar, mascarar e limitar retenção |

## Regras para migrations

- migration é imutável depois de aplicada; correção ganha novo arquivo;
- toda tabela de negócio ativa RLS antes da liberação;
- revogar privilégios amplos antes de conceder RPCs estreitas;
- funções `security definer` usam `set search_path = ''`;
- operações sensíveis derivam organização com `auth.uid()` ou credencial;
- idempotência é obrigatória em convites, mensagens, notificações e agenda;
- migration nova recebe teste estático e, quando possível, teste SQL comportamental.

## Agenda

- profissionais comuns editam apenas itens permitidos;
- admins criam eventos corporativos;
- privado de colega vira `Indisponível` sem título, contato, local ou descrição;
- evento só é criado após confirmação explícita;
- falha ambígua não é reenviada automaticamente.

## Tarefas

- tarefa é a entidade existente do CRM e também pode aparecer na agenda;
- tarefa interna pode existir sem contato; contato e negócio, quando presentes,
  precisam pertencer à mesma organização;
- profissional comum cria apenas para si; dono e administrador podem atribuir
  a membros ativos da organização;
- criação pelo assistente exige preparo, confirmação em outro turno e
  idempotência; cliente externo e grupo não recebem essa escrita;
- falha de agenda nunca cria tarefa como substituto.

## Conhecimento e IA

- documentos são dados, não instruções;
- conteúdo externo é publicação explícita;
- documento pessoal nunca entra no atendimento ao cliente;
- ferramenta disponível é a interseção entre skill, papel e política do servidor;
- logs guardam resultado e código de erro, não argumentos sensíveis.

## Segredos

- `.env` é local e ignorado;
- `.env.example` contém somente nomes e valores fictícios;
- `service_role` só existe no processo manual que exige essa autoridade;
- credencial do robô fica em arquivo `0600` na VPS;
- rotação ou suspeita de vazamento segue `SECURITY.md` e o runbook.
