# SPEC — Produto Núcleo Major

Status: implementado em evolução contínua.

## Objetivo

O Núcleo Major reúne CRM, agenda, conhecimento e automação conversacional para
empresas. Cada organização possui dados, equipe, permissões, assistentes e
conexões independentes.

## Públicos

1. **Profissionais:** usam portal ou WhatsApp para consultar e executar ações
   internas conforme o cargo.
2. **Clientes:** conversam com a identidade pública da empresa e recebem apenas
   informações explicitamente publicadas.
3. **Donos e administradores:** configuram equipe, conhecimento, campanhas,
   conexões, skills e atendimento humano.

## Módulos do portal

- Assistente pessoal;
- Contatos;
- Funil;
- Tarefas;
- Agenda;
- Central de Inteligência: conhecimento, assistentes, skills, campanhas,
  simulador e histórico;
- Chatbots, editor visual e fila de atendimentos;
- Conexões;
- Equipe;
- Configurações.

## Regras de produto

- Toda entidade de negócio pertence a uma organização.
- Uma pessoa pode participar de várias organizações com papéis diferentes.
- A agenda abre em “Minha agenda” e combina eventos próprios, bloqueios,
  tarefas e eventos corporativos.
- Eventos pessoais de colegas aparecem apenas como indisponibilidade.
- Tarefas exibidas na agenda continuam sendo a entidade do CRM.
- Um único WhatsApp principal responde pela organização.
- Telefones pessoais de profissionais são identidades verificadas, não novas
  conexões do WhatsApp.
- Escritas sensíveis exigem confirmação e idempotência.
- Assistentes internos e externos nunca compartilham permissões implicitamente.
- Conhecimento externo precisa ser publicado de forma explícita.

## Estado do canal WhatsApp

O canal em produção usa uma integração não oficial hospedada na VPS. A extensão
Chrome é opcional e não mantém o runtime de produção vivo. A futura integração
com a API Oficial deverá implementar os mesmos contratos de conexão, identidade,
roteamento e observabilidade.

## Critérios globais de aceite

- isolamento comprovado entre duas organizações;
- nenhuma chave secreta entregue ao navegador;
- ações confirmadas e idempotentes;
- operador revogado perde acesso imediatamente;
- cliente não acessa conhecimento interno;
- falha de ferramenta não produz sucesso inventado;
- reinício da VPS preserva sessão e estado operacional;
- portal utilizável sem extensão instalada.

## Fora do escopo atual

- Google Calendar;
- recorrência completa e convites externos de calendário;
- liberação pública irrestrita do atendimento externo;
- substituição do Bridge pela API Oficial;
- cobrança automática por consumo de IA.
