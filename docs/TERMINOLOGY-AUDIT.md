# Auditoria de terminologia e contratos

Última análise: **27/08/2026**.

Este documento registra divergências encontradas entre produto, interface, banco,
portal, extensão e runtime. Ele não substitui o [Glossário](GLOSSARY.md); serve
como fila de alinhamento.

## Conclusão

A arquitetura possui separações corretas, mas a mesma palavra ainda representa
coisas diferentes em camadas distintas. O maior risco não é apenas de redação:
essas ambiguidades dificultam diagnosticar por que uma conversa funciona e uma
ação falha.

## Divergências confirmadas

### 1. Saudação e capacidade operacional são tratadas como se fossem a mesma saúde

O runtime consegue receber, gerar e enviar “Bom dia” mesmo quando a skill Tarefas,
o MCP ou a RPC de escrita não estão disponíveis. A interface e as mensagens de
erro precisam tratar essas capacidades separadamente.

Impacto atual: “não consegui concluir com segurança” esconde em qual camada a
criação de tarefa falhou.

### 2. Tarefa possui código em mais de uma camada, mas implantação é independente

Foram encontrados:

- entidade `tasks` no CRM;
- operações `tarefas.*` nos providers;
- skill oficial `tarefas` no catálogo;
- ferramentas `task.read`, `task.prepare` e `task.confirm`;
- MCPs de listar, preparar, obter pendência e criar tarefa;
- migration específica de tarefa do operador.

Essas peças existirem no repositório não comprova que migration, publicação da
skill e versão do runtime estejam todas ativas na VPS. O `STATUS.md` ainda registra
publicação e implantação como pendentes. Essa é a hipótese prioritária para o
teste relatado, mas logs do turno ainda são necessários para fechar a causa.

### 3. Público usa vocabulários técnicos diferentes

- documentos e coleções: `internal` / `external`;
- perfis e contextos: `internal` / `customer`;
- skills: `internal` / `customer` / `both`;
- interface: “Profissionais” / “Clientes”.

As diferenças são válidas no schema atual, porém precisam de tradução central.
Não se deve comparar esses valores diretamente sem saber qual entidade está sendo
tratada.

### 4. Agente, assistente, chatbot e processo do assistente aparecem próximos

Existem templates, perfis de assistente, skills, chatbots e o processo Python do
runtime. Todos podem ser chamados informalmente de “bot” ou “agente”, causando
confusão sobre quem respondeu e quem possui a conversa.

Decisão canônica:

- **assistente** é a experiência conversacional;
- **perfil de assistente** é a configuração da organização;
- **chatbot** é fluxo determinístico;
- **processo do assistente** é o serviço Python;
- **agente** fica reservado ao modelo reutilizável/versionável.

### 5. Gateway e Bridge não são sinônimos

As operações de interface usam o prefixo `gateway.*`, enquanto o runtime possui
um Bridge Go. Gateway é o contrato de acesso; Bridge é o processo que mantém a
sessão não oficial. A documentação anterior frequentemente aproximava os nomes.

### 6. “Conexão” reúne estados que evoluem separadamente

O control plane já possui estados separados para Bridge, WhatsApp, Assistente,
MCP, Agenda e Chatbot. Qualquer selo geral deve ser derivado e nunca ocultar as
dimensões. “Não consultado” também não equivale a “desconectado”.

### 7. Assistente web e assistente do WhatsApp compartilham produto, não execução

O portal usa API Node e pode usar `ANTHROPIC_API_KEY`. O WhatsApp produtivo usa o
runtime da VPS e Claude Code headless. Eles podem consultar a mesma fonte de
verdade, mas não devem ser descritos como uma única sessão ou um único processo.

### 8. “Publicar” possui três pipelines distintos

- documento: muda elegibilidade por público e coleção;
- skill: cria versão no catálogo do Supabase;
- chatbot: ativa versão de fluxo.

Uma confirmação genérica “publicado” é insuficiente para operação e auditoria.

### 9. Arquivos legados continuam visíveis

O runtime contém `mcp-readonly.json` e `mcp-runtime.json`. A presença do nome
`readonly` não prova que ele seja o perfil ativo; scripts e units implantados
determinam a configuração real. Arquivo legado deve ser claramente marcado ou
removido em uma mudança futura controlada.

### 10. Status documental e estado implantado podem divergir

`docs/STATUS.md` e `docs/SPEC-RUNTIME.md` registram commits ainda pendentes de
implantação, enquanto testes manuais posteriores relataram o runtime ativo na
VPS. Sem uma verificação da versão em execução, não é seguro atualizar a
documentação para “implantado”.

## Decisões canônicas adotadas

1. Supabase é fonte de verdade de negócio e permissão.
2. VPS é o único runtime produtivo da conexão atual.
3. Portal é o painel principal; extensão é opcional.
4. Um WhatsApp principal responde; telefones pessoais apenas identificam operadores.
5. Conhecimento informa, skill conduz, ferramenta executa e RPC valida.
6. Tarefa, evento de agenda e nota são entidades diferentes.
7. Uma capacidade só é funcional após teste ponta a ponta e idempotente.

## Próximos alinhamentos recomendados

| Prioridade | Alinhamento | Resultado esperado |
| --- | --- | --- |
| Alta | registrar versão implantada de portal, migrations, skills e runtime | diagnóstico reproduzível |
| Alta | testar criação de tarefa e capturar a etapa exata da falha | causa comprovada |
| Alta | trocar fallback genérico por códigos de falha traduzidos | resposta útil ao operador |
| Média | centralizar tradução de públicos técnicos | UI e contratos consistentes |
| Média | revisar rótulos “Atendente”, “Profissional” e `member` | papel sem ambiguidade |
| Média | marcar configurações MCP legadas | implantação menos sujeita a erro |
| Baixa | aplicar o glossário aos textos das telas | experiência mais previsível |

## Critério para encerrar esta auditoria

A auditoria estará fechada quando cada divergência tiver uma decisão aplicada no
código ou uma justificativa registrada em ADR, e quando o teste “criar uma tarefa
hoje” indicar claramente qual capacidade está ausente em vez de usar um erro
genérico.
