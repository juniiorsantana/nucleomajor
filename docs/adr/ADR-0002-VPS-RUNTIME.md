# ADR-0002 — Runtime único na VPS

Estado: aceito em agosto de 2026.

## Contexto

O WSL desligava com o computador e podia deixar Bridge e assistente indisponíveis.
Executar duas cópias também causaria respostas e renovação de credenciais concorrentes.

## Decisão

Bridge, assistente, MCP e workers contínuos executam exclusivamente na VPS. O
WSL é ambiente de desenvolvimento e permanece desligado em produção.

## Consequências

- atendimento funciona com o computador pessoal desligado;
- systemd supervisiona processos por conexão;
- portas internas ficam em loopback;
- sessão do WhatsApp existe em uma única máquina;
- deploy deve preservar estado e reiniciar apenas o serviço alterado.

## Alternativas rejeitadas

- WSL 24/7: dependência do computador e suspensão;
- dois runtimes ativos: duplicidade e corrupção de estado;
- Docker obrigatório: complexidade sem benefício necessário nesta etapa.
