> **Comece por [`CLAUDE.md`](CLAUDE.md)**: é o ponto de partida comum a qualquer IA,
> com o estado atual, o vocabulário (contato, lead, negócio) e o que está aberto.
> As regras abaixo continuam valendo e prevalecem sobre qualquer resumo.

# Ambiente de trabalho

- Não usar nem iniciar o WSL local neste projeto. Ele está desativado e não faz
  parte do ambiente operacional, conforme decisão do usuário.
- Usar Windows/PowerShell para trabalho local e SSH para operações Linux na VPS.
- O runtime contínuo de WhatsApp, Bridge, assistente e MCP roda exclusivamente
  na VPS. Não iniciar cópias locais desses serviços para atender conversas reais.
- Caminhos `/mnt/d/...` e remotos Git que apontem para o antigo WSL são referências
  legadas. Não presumir que sejam a fonte atual nem tentar reativar esse ambiente.
- Antes de deploy, conferir o HEAD efetivamente em execução na VPS. Divergência
  entre branch remota e release não autoriza sobrescrever commits de produção.
- Migrations de produção são aplicadas exclusivamente pelo SQL Editor, conforme
  instrução do usuário; não usar CLI, PAT, Management API ou `db push`.
- Migration nova recebe número maior que o da última migration da `main`
  atualizada; duas frentes em paralelo já produziram número repetido.
