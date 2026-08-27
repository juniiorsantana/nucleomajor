# SPEC — Arquitetura

Status: arquitetura vigente.

## Visão geral

```text
Navegador ── HTTPS ──> Portal/API Node.js na Hostinger
    │                         │
    │                         ├── SMTP de convites
    │                         └── Supabase Auth/RLS
    │
    └── Supabase HTTPS/Realtime ──> Postgres + Storage

WhatsApp <──> Bridge Go <──> Assistente Python <──> Claude Code
                  │                  │
                  └── SQLite        ├── MCP Núcleo ──> Supabase
                                     └── MCP WhatsApp ──> Bridge

Bridge, assistente, MCP e workers executam na VPS Ubuntu.
```

## Componentes e fronteiras

### Portal e API

O repositório `nucleomajor` contém React/Vite, servidor Node.js, migrations e
catálogo oficial de skills. O servidor entrega arquivos estáticos e mantém
segredos de SMTP e integrações server-side.

### Supabase

É a fonte de verdade para identidade, organizações, CRM, agenda, conhecimento,
skills, campanhas, contextos, handoffs e comandos do runtime. RLS protege o uso
humano; credenciais de robô executam somente RPCs estreitas.

### Runtime da VPS

O repositório `whatsapp-mcp-hardened` contém:

- Bridge Go e sessão do WhatsApp;
- assistente Python e fila durável;
- MCP do Núcleo e do WhatsApp;
- heartbeat, comandos, verificação de operadores e lembretes;
- units systemd por `connection_id`.

Portas internas ficam em `127.0.0.1`. O WSL não é ambiente de produção.

### Extensão

É construída a partir de `apps/emyleads`, mas não participa do runtime da VPS.
Serve para experiência embutida no WhatsApp Web, migração de dados locais e
integração opcional com instalações locais.

## Fluxo interno

1. Bridge recebe a mensagem no WhatsApp principal.
2. O remetente é comparado com operadores verificados.
3. O assistente deriva organização, profissional, cargo e permissões.
4. O runtime resolve skills e conhecimento autorizado.
5. MCP executa consultas ou ações estreitas.
6. Bridge envia uma única resposta pelo WhatsApp principal.

## Fluxo externo

1. Remetente não é operador.
2. RPC de rollout retorna off, pilot ou active.
3. Em pilot, somente contatos selecionados avançam.
4. A campanha e a Recepção são derivadas pelo servidor.
5. Uma skill por vez recebe somente conhecimento externo.
6. Handoff muda a propriedade da conversa e silencia a IA.

## Estado e persistência

- Postgres: estado de negócio e decisões duráveis.
- SQLite do Bridge: sessão, mensagens e idempotência de envio.
- SQLite do assistente: fila e recuperação do processamento.
- Arquivos `0600`: credenciais renováveis do robô.
- systemd: supervisão e reinício dos processos.

## Princípios obrigatórios

- identidade nunca vem apenas do texto enviado ao modelo;
- o modelo não escolhe organização, conexão ou usuário;
- operações com segredo passam pelo servidor ou runtime;
- uma conexão ativa pertence a uma organização;
- logs não registram tokens ou telefones completos;
- falha de validação fecha o acesso, não amplia permissões;
- Bridge e assistente não podem executar simultaneamente no WSL e na VPS.
