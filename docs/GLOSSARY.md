# Glossário oficial do Núcleo Major

Status: vocabulário canônico do produto, da interface, do banco e do runtime.

Este documento define o significado dos termos usados no Núcleo Major. Quando
um termo aparecer no código, nas telas, nas skills, em prompts ou em conversas
de produto, ele deve conservar o significado registrado aqui.

## Como usar este glossário

- Um conceito possui um nome principal. Sinônimos só devem aparecer quando
  facilitarem a linguagem para o usuário.
- Termos técnicos não devem aparecer nas respostas dos assistentes para clientes
  ou profissionais, salvo quando a pessoa estiver tratando de configuração.
- O estado de um componente não representa o estado de todo o sistema. “WhatsApp
  conectado”, por exemplo, não comprova que MCP, Agenda ou Tarefas estejam
  disponíveis.
- Conhecimento orienta respostas; skill organiza comportamento; ferramenta
  executa uma ação. Os três conceitos não são intercambiáveis.

## Pessoas, empresas e acesso

### Organização

Empresa isolada dentro do produto. É a principal fronteira multiempresa e de
RLS. CRM, agenda, conhecimento, campanhas, conexões e equipe pertencem a uma
organização.

### Conta

Identidade de login no Supabase Auth. Uma conta pode participar de várias
organizações. “Conta” não significa “empresa”.

### Perfil

Dados da pessoa associados à conta, como nome de exibição. Não determina sozinho
as permissões em uma organização.

### Membro

Vínculo entre uma conta e uma organização. O vínculo contém papel,
responsabilidade e estado de participação.

### Profissional

Nome de produto para um membro que trabalha na organização. É a pessoa que usa o
portal, a agenda ou o assistente interno.

### Papel

Nível de autorização do membro na organização. Os valores canônicos são:

- `owner`: dono; controla a organização;
- `admin`: administrador; gerencia operações permitidas;
- `member`: profissional comum; atua nos próprios dados e no que foi compartilhado.

Na interface, usar **Dono**, **Administrador** e **Profissional**. “Atendente”
pode descrever uma função de trabalho, mas não deve substituir o papel técnico
`member`.

### Responsabilidade

Descrição funcional do que o profissional faz na empresa. Ajuda o assistente a
adaptar o contexto, mas não concede permissão. Permissão sempre vem do banco.

### Operador

Profissional com telefone pessoal verificado para conversar com o assistente
interno pelo WhatsApp principal. Operador não é uma nova conexão e seu telefone
não envia respostas em nome da empresa.

### Cliente

Pessoa externa atendida pela organização. No sistema, normalmente corresponde a
um contato do CRM. Não recebe permissões internas por conversar no WhatsApp.

### Lead

Cliente potencial ainda em processo de qualificação ou venda. É um estado de
negócio de um contato, não uma entidade de autenticação.

### Participante

Profissional ou pessoa relacionada a um evento da agenda. Participar de um evento
não torna alguém responsável pelo evento nem amplia seu acesso à organização.

### Responsável

Profissional a quem uma tarefa, negócio, conversa ou evento foi atribuído. Cada
módulo define quais papéis podem alterar essa atribuição.

## CRM

### CRM

Conjunto de contatos, negócios, funil, tarefas, notas, tags e histórico de
relacionamento da organização.

### Contato

Registro de uma pessoa ou empresa atendida no CRM. Pode ter telefone, e-mail,
tags, negócios, tarefas, notas e eventos relacionados.

### Negócio

Oportunidade comercial vinculada a um contato e a uma etapa do funil. Pode ter
valor, responsável e status próprios.

### Funil

Sequência ordenada de etapas comerciais da organização.

### Etapa

Posição de um negócio no funil. A ordem é de negócio e não deve ser inferida pela
ordem alfabética do nome.

### Tarefa

Item operacional do CRM com título, prazo, responsável, conclusão e vínculos
opcionais com contato ou negócio. Pode aparecer na Agenda, mas continua sendo a
mesma tarefa; não é copiada para `calendar_events`.

### Nota

Registro textual associado a um contato. Nota não possui fluxo de confirmação e
não deve substituir tarefa ou evento quando uma ferramenta falhar.

### Tag

Marcador organizacional aplicado a contatos para segmentação, busca ou automação.

### Evento de contato

Registro de histórico do relacionamento, como criação, alteração ou mudança de
etapa. Não é um evento de calendário.

### Linha do tempo do CRM

Visão consolidada de notas, tarefas, negócios e mudanças relevantes de um
contato. Não é a régua de horários da Agenda Major.

### Qualificação

Conjunto estruturado de informações coletadas sobre um cliente, acompanhado por
estado como `collecting`, `qualified`, `disqualified` ou `needs_human`.

## Agenda

### Agenda Major

Módulo de calendário do Núcleo Major com visões Dia, Semana e Mês, disponibilidade,
eventos, bloqueios, participantes, categorias e lembretes.

### Agenda da organização

Contexto compartilhado de calendário de uma empresa. Não é uma única agenda que
expõe todos os detalhes; cada profissional visualiza uma combinação autorizada.

### Minha agenda

Visão inicial do profissional: eventos próprios, bloqueios pessoais, tarefas
próprias e eventos corporativos visíveis.

### Evento de agenda

Compromisso com início, fim, responsável, participantes, visibilidade e dados
opcionais. É diferente de tarefa e de evento de contato.

### Bloqueio

Intervalo que torna o profissional indisponível sem representar necessariamente
uma reunião. Detalhes privados de colegas devem aparecer apenas como
**Indisponível**.

### Evento corporativo

Evento pertencente à organização e visível conforme as regras da empresa. Donos
e administradores possuem as permissões ampliadas definidas no banco.

### Evento pessoal ou privado

Evento cujo conteúdo pertence ao profissional. Colegas podem receber somente a
informação necessária para cálculo de disponibilidade.

### Disponibilidade

Resultado calculado a partir de eventos, bloqueios e regras de agenda. Consultar
disponibilidade não significa criar um evento.

### Categoria da agenda

Classificação configurável da organização usada para cor e resumo de horas. Não
é uma tag do CRM.

### Lembrete

Regra que agenda uma notificação antes de tarefa ou evento. A entrega pode ser
interna ou via WhatsApp, conforme configuração e verificação do telefone.

### Agendamento

Processo completo de coletar dados, consultar disponibilidade, apresentar resumo,
obter confirmação e criar um evento. “Preparar agendamento” não significa que o
evento já existe.

## Assistentes e inteligência

### Assistente

Experiência conversacional que entende uma solicitação, recebe contexto permitido
e pode usar ferramentas. É um conceito de produto; não é sinônimo do processo
Python que o executa.

### Assistente interno

Assistente dos profissionais. Usa identidade verificada, papel, responsabilidade,
CRM, agenda e conhecimento interno conforme permissões.

### Assistente de atendimento

Assistente externo que conversa com clientes usando somente skills e conhecimento
publicados para esse público. Também pode ser chamado de **Assistente da empresa**
na interface.

### Perfil de assistente

Configuração de uma organização para um público: nome apresentado, marca, tom de
voz, saudação, processo, estado ativo e skills vinculadas.

### Agente

Modelo versionável de identidade e comportamento que pode originar um perfil de
assistente. Em textos de produto, preferir “assistente” quando estiver falando da
experiência que conversa com a pessoa.

### Modelo de assistente

Definição central reutilizável pelo Núcleo Major. Pode receber versões sem alterar
automaticamente configurações já publicadas sem o fluxo previsto.

### Skill

Capacidade versionada que define objetivo, gatilhos, etapas, dados obrigatórios,
ferramentas permitidas, limites e transferência. Uma skill orienta uma jornada;
ela não executa banco ou API diretamente.

### Skill oficial

Skill de propriedade da plataforma, mantida em
`packages/intelligence/skills`, validada, publicada e versionada no Supabase.

### Skill privada

Skill criada para uma organização. Não é visível para outras empresas e não pode
ampliar políticas centrais.

### Instruções da skill

Markdown confiável que descreve como conduzir a capacidade. Editar o arquivo não
altera produção até a versão ser validada e publicada.

### Ferramenta

Operação técnica estruturada que consulta ou altera um sistema, como listar
tarefas ou preparar um agendamento. Ferramentas são validadas pelo servidor e
pelas permissões; o modelo não ganha autoridade por pedir uma ferramenta.

### Capacidade

Disponibilidade técnica efetiva de uma ação naquele turno. É a interseção entre
ferramentas implantadas, credencial válida, papel, skill e estado do serviço.

### Conhecimento

Informação consultável pelo assistente. Documento é tratado como dado e nunca
como instrução executável. Conhecimento não cria tarefas, eventos ou negócios.

### Documento de conhecimento

Conteúdo Markdown pertencente a uma organização e a um escopo. Possui versão,
público, estado e publicação.

### Versão de documento

Registro imutável de uma revisão do documento de conhecimento.

### Coleção de conhecimento

Agrupamento que autoriza e organiza documentos para organização, equipe, pessoa
ou campanha. Conteúdo externo precisa estar publicado e vinculado a uma coleção
externa alcançável.

### Escopo de conhecimento

Origem e alcance organizacional do conteúdo:

- `organization`: regras e identidade da empresa;
- `team`: processos compartilhados pela equipe;
- `personal`: referência privada do profissional;
- `campaign`: conteúdo associado a campanha.

### Público do conhecimento

Fronteira de leitura:

- `internal`: profissionais autorizados;
- `external`: atendimento a clientes.

Não confundir com o público de uma skill, que usa `internal`, `customer` ou
`both` no contrato técnico.

### Publicação

Ato explícito de tornar uma versão elegível para consumo. Publicar documento,
skill e chatbot são operações diferentes e possuem versionamentos diferentes.

### Busca contextual

Seleção de trechos relevantes para a mensagem atual, respeitando organização,
público, escopo, coleção e campanha. Não deve despejar todo o acervo no prompt.

### Campanha

Contexto temporário de atendimento com oferta, público, origem, período, skills,
conhecimento e resultado desejado.

### Origem da campanha

Sinal que associa uma conversa a uma campanha, como link, QR, anúncio, tag,
palavra-chave ou regra padrão.

### Contexto de conversa

Estado durável que registra público, campanha, skill e situação atual da jornada.
Não é o histórico textual completo da conversa.

### Sessão de skill

Estado de execução de uma skill em uma conversa, incluindo etapa e expiração.

### Ação pendente

Proposta estruturada ainda não concluída, como tarefa ou evento aguardando
confirmação. Estados canônicos incluem `collecting`, `awaiting_confirmation`,
`executing`, `completed`, `failed`, `cancelled` e `expired`, conforme o tipo.

### Confirmação explícita

Resposta do usuário em outro turno que autoriza executar uma ação pendente
específica. “Sim” sem ação pendente válida não executa nada.

### Idempotência

Garantia de que repetir a mesma confirmação ou requisição não cria efeitos
duplicados.

### Handoff

Transferência de uma conversa da automação para uma pessoa. Enquanto o atendimento
estiver sob responsabilidade humana, a IA permanece silenciosa.

### Fila de atendimento

Lista de handoffs nos estados aguardando, em atendimento e concluído. Não é a fila
interna de processamento do assistente.

### Chatbot

Fluxo visual e determinístico de passos e regras. Pode atuar como porta de entrada
e transferir silenciosamente para o assistente, mas não deve responder à mesma
mensagem junto com ele.

### Versão de chatbot

Snapshot publicável de uma definição de chatbot. O conector pode manter uma cópia
local da versão ativa para tolerar falha temporária de rede.

### Execução de chatbot

Instância idempotente de processamento de um fluxo para uma conversa.

### Simulador

Ambiente de teste da Central de Inteligência que resolve contexto sem alterar CRM,
agenda ou atendimento real.

### Rollout do atendimento externo

Guarda que controla quem recebe automação:

- `off`: desligado;
- `pilot`: somente contatos escolhidos;
- `active`: contatos externos podem ser atendidos.

O modo de rollout é independente do modo de roteamento das skills.

### Modo de roteamento

Forma como o runtime usa o contrato de inteligência:

- `off`: fluxo anterior;
- `shadow`: resolve e audita, sem mudar a resposta;
- `active`: aplica skill, etapa, campanha e ferramentas permitidas.

## WhatsApp, conexão e runtime

### WhatsApp principal

Único número pelo qual a organização envia e recebe as mensagens automatizadas.
Na Major, é identificado visualmente pelo final `8362`.

### Telefone pessoal do operador

Identidade verificada que autoriza um profissional a usar o assistente interno.
Não é número de saída, não é conexão adicional e não hospeda o assistente.

### Conexão

Unidade operacional de um canal WhatsApp pertencente a uma organização. Vincula
número esperado, sessão, credencial técnica, operadores e runtime.

### Instalação

Vínculo de uma máquina ou navegador a uma conexão. Uma instalação não é a própria
sessão do WhatsApp.

### Host

Máquina que executa componentes de integração. Em produção atual, a VPS é o host
do runtime. O computador do usuário não é necessário para mantê-lo ativo.

### Sessão do WhatsApp

Estado autenticado do dispositivo conectado ao WhatsApp. Deve sobreviver ao
reinício do Bridge e não deve ser confundido com sessão de conversa ou login web.

### Bridge

Processo Go que mantém a sessão não oficial do WhatsApp, recebe mensagens,
persiste eventos e expõe APIs locais autenticadas.

### Processo do assistente

Serviço Python que recebe eventos do Bridge, mantém fila durável, resolve o turno
e executa o modelo com as ferramentas permitidas.

### Runtime

Conjunto contínuo de Bridge, processo do assistente, MCP e workers. Em produção,
roda na VPS e é supervisionado pelo systemd.

### Gateway

Contrato usado pelo portal ou pela extensão para consultar e comandar uma
conexão. Dependendo do ambiente, encaminha para APIs locais ou para comandos
duráveis no Supabase. Não é sinônimo de Bridge.

### Conector

Componente opcional que liga um ambiente local ao produto. A extensão Chrome pode
atuar como conector, mas não sustenta o runtime produtivo da VPS.

### VPS

Servidor Linux continuamente ligado que hospeda o runtime de produção.

### WSL

Ambiente Linux local usado no desenvolvimento anterior. Deve permanecer
desativado para a conexão produtiva enquanto a VPS for o runtime único.

### Worker

Processo de segundo plano com responsabilidade específica, como processar
mensagens, lembretes ou comandos. O nome sempre deve vir acompanhado da função.

### Heartbeat

Sinal periódico que registra a saúde dos componentes do runtime no Supabase.
Não é uma mensagem de cliente e não comprova sozinho que todas as ferramentas
estão disponíveis.

### Comando do runtime

Solicitação durável registrada no Supabase para a VPS executar, como verificação
de operador ou mudança de propriedade de atendimento.

## Portal, extensão e armazenamento

### Portal

Aplicação web em `nucleomajor.com/app`. É o painel principal e funciona sem a
extensão.

### API Node.js

Servidor do portal responsável por arquivos web e operações que precisam de
sessão ou segredo, como convites e assistente web.

### Extensão

Aplicação Chrome opcional que injeta o painel do CRM no WhatsApp Web, oferece
experiência local e pode migrar dados legados. Não é o runtime da VPS.

### Painel do WhatsApp

Interface da extensão dentro do WhatsApp Web. Mostra contexto do contato e a
linha do tempo do CRM. Não é a página Conexões do portal.

### Provider

Implementação que entrega uma mesma operação de interface em determinado
ambiente. `WebAdapter` usa Supabase/API; `ChromeAdapter` pode usar service worker,
armazenamento local e gateway.

### Supabase

Plataforma que fornece Auth, Postgres, RLS, Realtime e Storage. É a fonte de
verdade operacional do Núcleo Major.

### IndexedDB

Banco local do navegador usado pela extensão para legado, cache e tolerância
offline. Não é fonte de verdade do SaaS.

### SQLite

Banco local do runtime usado para sessão, fila e idempotência operacional. Não
substitui CRM, agenda, conhecimento ou permissões do Supabase.

## Segurança e contratos técnicos

### Fonte de verdade

Sistema autorizado a decidir o estado de um dado. Supabase é a fonte de verdade
de negócio; SQLite e IndexedDB mantêm apenas integração, cache ou fila.

### RLS

Políticas do Postgres que limitam linhas por usuário, organização e papel. Filtro
de frontend não substitui RLS.

### RPC

Função controlada do Postgres exposta para uma operação específica. Uma RPC
sensível deve derivar identidade e organização da sessão ou credencial.

### MCP

Protocolo e servidor que apresentam ferramentas estruturadas ao modelo. O MCP
traduz capacidades autorizadas; não é a fonte de verdade e não concede permissão
por conta própria.

### Credencial de robô

Sessão técnica renovável, vinculada a uma conexão e organização, usada pelo
runtime para chamar RPCs restritas. Fica em arquivo protegido na VPS.

### Chave publicável

Chave do Supabase permitida no navegador. Sua segurança depende de Auth e RLS.
Não possui autoridade de administração.

### `service_role`

Credencial administrativa do Supabase que ignora RLS. Só deve existir em processo
manual ou servidor autorizado quando indispensável; nunca entra no frontend,
Git, extensão ou prompt.

### Realtime

Entrega de mudanças do Supabase para atualizar o portal. Consulta periódica pode
ser usada como fallback.

### Log de auditoria

Registro de decisão ou execução com identificadores mínimos, duração, resultado e
código de erro. Não deve guardar token, telefone completo ou conteúdo sensível.

### Contrato

Formato e regras que dois componentes concordam em usar. Uma alteração de
contrato pode exigir migration, atualização do runtime e nova publicação de
skill, mesmo quando a interface não muda.

### Schema

Estrutura formal de dados, incluindo campos, tipos, estados e restrições. “Versão
do schema” não é a mesma coisa que versão visual do produto.

### Migration

Arquivo SQL ordenado que altera o schema ou os contratos do Supabase. Aplicar uma
migration muda o banco; apenas criar ou commitar o arquivo não muda produção.

### Implantação

Ato de colocar uma versão em execução no ambiente de destino. Código commitado ou
enviado ao GitHub ainda não está necessariamente implantado na Hostinger ou VPS.

### Produção

Ambiente usado no atendimento real. No estado atual, portal, Supabase e runtime
da VPS são partes separadas de produção e podem possuir versões diferentes.

### Commit

Snapshot versionado do código em um repositório Git. Um commit local não garante
push, deploy, migration aplicada nem serviço reiniciado.

### Branch

Linha de desenvolvimento do Git. `main` é a linha do portal; o runtime ainda usa
seu próprio repositório e fluxo de implantação.

### Modelo de IA

Modelo de linguagem que interpreta e redige. Não possui dados ou permissões por
si só; recebe contexto e ferramentas do produto.

### Provedor de IA

Serviço que oferece acesso ao modelo, como Anthropic ou Google. Trocar provedor
não substitui skills, conhecimento, permissões, MCP ou runtime.

### Claude Code headless

Forma atual de executar o modelo no runtime da VPS por processo autenticado. É
diferente do uso de `ANTHROPIC_API_KEY` pelo assistente web do portal.

### API Oficial do WhatsApp

Integração suportada pela Meta, planejada como modalidade de conexão. Deve
implementar os mesmos contratos de identidade, roteamento e observabilidade do
produto.

### Integração não oficial do WhatsApp

Modalidade atual baseada no protocolo do WhatsApp Web e mantida pelo Bridge.
Funciona na VPS, mas possui risco de bloqueio e de quebra por mudanças externas.

## Estados que não devem ser resumidos como “conectado”

O painel deve mostrar cada dimensão separadamente:

| Dimensão | Exemplos de estado | O que comprova |
| --- | --- | --- |
| Bridge | online, offline, error | processo de integração está acessível |
| WhatsApp | connected, disconnected, awaiting_qr, degraded | sessão do canal está autenticada |
| Assistente | online, offline, error | processo de respostas está executando |
| MCP | configured, not_configured, unavailable | ferramentas podem ser consultadas |
| Agenda | available, unavailable, not_checked | contrato de agenda foi validado |
| Chatbot | online, degraded, not_configured, error | executor de fluxos está pronto |
| Skill | draft, published, archived | versão está elegível para resolução |
| Conhecimento | draft/published e internal/external | conteúdo está elegível para seu público |
| Rollout externo | off, pilot, active | quais clientes podem receber automação |

Uma saudação bem-sucedida comprova apenas recepção, processamento conversacional
e envio. Não comprova que uma ferramenta de escrita está disponível.

## Termos ambíguos a evitar

| Evitar isoladamente | Usar no lugar |
| --- | --- |
| bot | chatbot, assistente interno ou assistente de atendimento |
| usuário | conta, profissional, operador ou cliente |
| agenda | Agenda Major, evento, disponibilidade ou agenda da organização |
| evento | evento de agenda ou evento de contato |
| conectado | indicar o componente e o estado |
| publicado | documento publicado, skill publicada ou chatbot ativo |
| automação | chatbot, assistente ou worker responsável |
| sessão | sessão do WhatsApp, sessão de skill, conversa ou login |
| banco local | IndexedDB da extensão ou SQLite do runtime |
| agente | assistente, perfil de assistente ou modelo de assistente |

## Regra de manutenção

Uma funcionalidade nova só está conceitualmente pronta quando:

1. seu termo está definido aqui;
2. sua entidade e fonte de verdade aparecem no mapa de domínio;
3. seu caminho operacional aparece no mapa de fluxos;
4. seus estados de erro e permissão estão definidos;
5. tela, API, skill, ferramenta e banco usam o mesmo significado.
