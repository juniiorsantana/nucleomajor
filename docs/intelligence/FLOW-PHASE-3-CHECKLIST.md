# Fechamento da FASE 3 — execução persistida

Estado: em implementação. Esta lista preserva o escopo completo da fase.

## Contrato

Uma execução fixa a definição e sua versão, organização, conexão, contato e
sessão de atendimento. Cada etapa é reservada e confirmada antes da próxima.
Condições leem o contexto depois das alterações anteriores. Mensagens múltiplas
são enviadas em ordem, sem buscar transferências adiante de etapas pendentes.

A transferência IA fixa uma suspensão única. Confirmação de entrega não é
conclusão. Uma ferramenta explícita da IA informa sucesso/falha usando IDs
injetados pelo runtime, nunca escolhidos pelo modelo. O banco resolve a aresta
na definição fixada. Espera padrão: 24 horas; expiração segue falha. Assunção
humana ou encerramento da sessão cancela a retomada automática.

Reserva de envio expirada ou resultado incerto exige reconciliação: não há
reenvio automático. Etapas sem efeito externo podem ser reservadas novamente.

## Evidências exigidas

- [x] Planner por etapa equivalente em JavaScript/Python: linear, E/OU,
  bifurcação, convergência, múltiplas mensagens, etiquetas e terminais.
- [x] Persistência SQL com versão fixada, cursor, revisão e suspensão.
- [x] Reserva/confirmacão idempotentes, concorrência e isolamento tenant/conexão.
- [x] Ferramenta de conclusão validada pelo banco e disponível só quando autorizada.
- [x] Runtime e gateway suspendem/retomam após reinício, sem depender de navegador.
- [x] Providers local/remoto usam a mesma prévia por etapa e reservam execução v3 ao servidor.
- [x] Prova de sucesso, falha, expiração, duplicidade, retorno tardio, humano,
  edição do fluxo durante espera e envio incerto.
- [x] PostgreSQL descartável com cadeia inteira, rollback de fixtures e controle.
- [ ] Suítes completas relevantes, revisão de branches/HEADs e commits.
- [ ] SQL Editor manual com validação read-only e hashes normalizados.
- [ ] Runtime publicado e saúde observada; resultado integrado documentado.

O editor v3 é a FASE 4. A FASE 3 não se considera completa apenas porque o
planner passa testes; persistência, protocolo e consumidor precisam funcionar.

## Evidência em 07/09/2026

Banco e consumidor passaram as provas descritas em
[`README-prova-fluxos.md`](../../scripts/sql/README-prova-fluxos.md). Cada etapa
do caminho de sucesso foi executada em um processo Python novo, com banco real,
sessão SQLite persistida e Bridge fictício em loopback. Isso não é envio real.

O gateway preserva a identidade da suspensão ao receber a origem do piloto e,
quando o executor v3 está habilitado, consulta o chatbot antes do desvio para
Recepção. O worker só injeta os IDs da etapa capturada na fila; uma mensagem
antiga não ganha autorização para a etapa seguinte. Após conclusão confirmada
pelo estado do banco, não envia uma resposta adicional da IA.

A ferramenta `nucleo_concluir_etapa_fluxo` é parte do protocolo de execução,
liberada pelo host somente durante uma suspensão de cliente validada. O modelo
recebe apenas o argumento `sucesso|falha`; não escolhe execução, contato ou
destino. Não amplia as capacidades de negócio da skill nem altera o payload
de inteligência. O banco revalida conexão, telefone, estado e nonce.

Os providers local e remoto expõem `chatbots.prepararEtapa` como prévia sem
efeitos. Não mantêm uma segunda execução v3 no navegador: o preparador
automático ignora v3 com `fluxo-executor-central`, e as escritas legadas recusam
esse documento. A prévia remota não enfileira sincronização. O cursor durável e
os efeitos reais continuam exclusivamente no SQL e no consumidor Python.

Validação local: 600 testes do app, 231 testes Node, 405 testes do assistente
Python e 52 testes MCP passaram. Build web concluído.
Os cenários integrados P/Q provaram falha do modelo, expiração e confirmação
incerta do Bridge, inclusive após reinício de processo.

Pendências antes do aceite operacional: aplicar SQL manualmente, conferir
`validar-fluxos-execucao.sql`, comparar os HEADs local/VPS, publicar o runtime e
observar a jornada na conexão real. Nenhum serviço de produção foi reiniciado
nesta prova. O campo `tudo_confere` da consulta deve ser `true` antes do deploy.
