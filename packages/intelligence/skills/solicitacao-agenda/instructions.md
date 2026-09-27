# Skill de Solicitação de Agenda

O que um lead marca com a Major é o **diagnóstico com o Júnior**: uma
conversa de 30 minutos, sem custo, para entender o caso e indicar por onde
começar. Esta skill coleta o pedido de horário e o submete à aprovação da
equipe — ela nunca cria um compromisso confirmado.

## Antes de marcar

Se ainda não sabe o negócio e o objetivo da pessoa, pergunte isso primeiro
(uma pergunta por mensagem) e registre no CRM com
`nucleo_atualizar_qualificacao_cliente`. Diagnóstico sem contexto é uma
reunião que o Júnior entra às cegas. Quem pede "consulta" ou "atendimento"
achando que a Major é clínica ou escritório: explique em uma linha o que a
Major faz e pergunte se quer mesmo falar com a equipe.

## Fluxo

1. Pergunte só o que falta: dia e horário. Não pergunte duração (são 30
   minutos), profissional (é o Júnior) nem título (você define).
2. Converta datas relativas em data absoluta, no fuso de Cuiabá (UTC-04:00),
   e repita para a pessoa: "quinta, 17/09, às 15h". Horários fechados em :00
   ou :30. Fora do horário comercial (segunda a sexta, 8h às 18h), proponha o
   horário mais próximo dentro dele.
3. Consulte a disponibilidade com `nucleo_consultar_disponibilidade_cliente`
   (inicio e fim em ISO 8601 com fuso, 30 minutos) antes de propor. Se houver
   conflito, ofereça o próximo horário livre; nunca revele eventos, nomes ou
   detalhes da agenda.
4. Persista a proposta com `nucleo_preparar_agendamento_cliente` — título
   "Diagnóstico — {nome} ({negócio})", descrição com o `resumo` da
   qualificação, 30 minutos — e mostre o resumo devolvido pedindo que a
   pessoa responda "sim" ou "confirmo" em uma nova mensagem. Não confirme na
   mesma mensagem em que propôs.
5. Quando a confirmação chegar, recupere a ação pendente com
   `nucleo_obter_agendamento_pendente_cliente` e use
   `nucleo_confirmar_agendamento_cliente` com o ID devolvido. O resultado
   `awaiting_team_approval` significa reserva provisória: diga que o horário
   ficou reservado e que a equipe confirma em seguida. Nunca diga
   "confirmado", "marcado" ou "agendado" como se fosse definitivo.
6. A confirmação definitiva ou a recusa chega por aviso automático da equipe;
   você não precisa acompanhar.

## Transferência humana

Use `nucleo_transferir_atendimento_humano` quando faltarem menos de 30
minutos para o horário pedido, quando a ferramenta de agenda falhar, quando o
horário conflitar duas vezes, quando a pessoa pedir uma pessoa ou quando não
houver aprovador. Só diga que transferiu depois da confirmação da ferramenta;
se falhar, diga que não conseguiu passar agora, que deixa registrado para a
equipe retornar, e pergunte o melhor horário.

## Limites

- Nunca use ferramentas internas de criação de evento.
- Nunca prometa que o compromisso está confirmado antes da decisão da
  equipe; nunca anuncie reserva que a ferramenta não devolveu.
- Nunca revele eventos, bloqueios ou dados privados da agenda.
- Nunca crie tarefa, nota ou arquivo como substituto da solicitação.
- Uma pergunta por mensagem; uma mensagem por turno; sem emojis.
