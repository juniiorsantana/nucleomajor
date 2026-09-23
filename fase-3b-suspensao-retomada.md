# FASE 3B — Suspensão e retomada

Status: em andamento. Persistência e integração com gateway ainda não implementadas.

## Inspeção da VPS em 07/09/2026

Acesso SSH confirmado com a chave existente da máquina. Checkout ativo:
`/home/nucleo/releases/whatsapp-mcp-hardened/0ae2b38`, sem alterações locais.
Assistente no systemd do usuário `nucleo`: `ActiveState=active`, `NRestarts=0`.
Nenhum serviço foi reiniciado.

Correção do status anterior: a FASE 3A estava comprovada somente no aplicativo.
O atendimento contínuo usa `whatsapp-assistant/chatbot_runtime.py`, um executor
Python separado, que ainda percorre somente a saída padrão. A implementação
equivalente de condições está no checkout isolado `flow-runtime-phase-3`.

`server.py` chama esse executor quando o árbitro decide pelo dono bot. O modo
piloto pode encaminhar diretamente à recepção antes desse trecho; a prova real
precisa confirmar que atravessou o executor de fluxos, não só o agente de IA.

O banco já tem `chatbot_executions` e as RPCs `nucleo_chatbot_execution_claim`
e `nucleo_chatbot_execution_complete`. A conclusão atual grava `sent` e termina
a execução depois da primeira mensagem; não representa uma pausa de IA.
Portanto, a continuação exige protocolo de cursor e confirmação por etapa,
além da ferramenta de conclusão. Apenas acrescentar callback não basta.

## Evidência e dependências

`useChatbotAutomatico.js` entrega routingContext ao gateway depois de executar
o plano. A confirmação dessa chamada significa entrega ao novo dono, não
conclusão da tarefa da IA. Não pode disparar a porta sucesso.

`chatbotRuntime.js` ainda para na primeira mensagem e procura transferência
nos passos restantes. Antes de liberar v3, precisa usar um cursor por execução
para não pular mensagens, etiquetas ou decisões entre essa mensagem e a IA.

Na revisão, um teste demonstrou que adicionar VIP antes de verificar VIP
escolhia o ramo errado. A travessia agora considera as alterações anteriores
à primeira mensagem sem modificar a ficha recebida. Suíte: 593 testes verdes.

## Contrato proposto para implementação

- Persistir execução, organização, conversa, versão imutável do fluxo, cursor,
  revisão e identificador único da suspensão antes de solicitar transferência.
- Resolver destinos sucesso/falha pelas arestas da versão fixada, nunca por IDs
  enviados pelo modelo ou pelo callback.
- Separar confirmação de entrega da conclusão da IA. Só um evento autenticado
  de conclusão pode selecionar sucesso; falha definitiva seleciona falha.
- Correlacionar o evento com organização, conversa, execução e suspensão.
  Consumir uma única vez com transação e revisão esperada.
- Entrega a humano cancela a retomada automática; retorno tardio não reativa
  conversa humana nem execução cancelada.
- Persistir intenção de envio e confirmação separadamente. Resultado incerto
  deve ser reconciliado; não reenviar automaticamente uma mensagem já aceita.
- Expiração e erro devem ter motivos fechados. O prazo ainda precisa ser
  definido junto ao produtor do evento de conclusão da IA.

## Provas pendentes

Retorno duplicado, retorno de outra organização/conversa, versão editada durante
a espera, reinício do processo, entrega humana durante a espera, expiração,
falha de rede com resultado incerto e múltiplas mensagens no caminho.

O contrato permanece proposto até inspeção e integração do produtor de eventos
no runtime da VPS. FASE 3B não está concluída e não foi publicada em produção.
