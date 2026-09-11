# Roteiro de qualificação de leads — o que o agente pergunta, registra e decide

Proposta. Vira o corpo de `pre-qualificacao/instructions.md` (fase 1) e a
referência para `recepcao` e `vendas`. Aqui a linguagem é para gente ler;
na skill, vira instrução direta ao modelo. O que está entre `[[ ]]` é
decisão da empresa com padrão preenchido.

## Princípio

Qualificar não é preencher formulário. É descobrir, em poucas perguntas, se
a Major consegue ajudar e qual é o próximo passo certo — e **registrar cada
dado no momento em que ele aparece**, porque a conversa pode acabar a
qualquer mensagem. Uma pergunta por vez; nenhuma pergunta cuja resposta já
esteja na conversa; nenhuma pergunta que não mude o próximo passo.

## Os cinco dados

Na ordem em que costumam surgir. Não é obrigatório coletar os cinco: com
três (segmento, objetivo, momento) já dá para propor o diagnóstico.

| # | Dado | Chave em `respostas` | Pergunta-modelo (tom Major) | Por que importa |
|---|---|---|---|---|
| 1 | **Segmento e negócio** | `segmento`, `negocio` | "Me conta rapidinho: qual é o seu negócio?" — se a pessoa já disse, não perguntar | Aderência com os nichos; muda tudo o que vem depois |
| 2 | **Objetivo** | `objetivo` | "O que você quer que mude nos próximos meses — mais pacientes, mais casos, mais agenda?" | Separa pedido ("quero um site") de problema ("quero ser encontrado") |
| 3 | **Situação atual de aquisição** | `aquisicao_hoje` | "Hoje, de onde vêm seus clientes? Indicação, Instagram, Google, anúncio?" | Onde está o gargalo; evita prescrever tráfego para quem não converte |
| 4 | **Momento e urgência** | `momento` | "Isso é para agora ou você está planejando para mais adiante?" | Prioridade do retorno da equipe |
| 5 | **Quem decide** | `decisor` | "Você decide isso sozinho ou tem mais alguém que participa?" — só quando fizer sentido (clínica com sócios, escritório) | Evita diagnóstico com quem não pode contratar |

Dados de contato: **nome** sempre que a pessoa se apresentar (ou o nome do
WhatsApp, se não houver outro); **empresa** quando aparecer; **e-mail** só
se a pessoa oferecer ou se for necessário para enviar algo. Telefone nunca
se pede — já é o remetente.

## O que registrar, e quando

A cada dado novo, atualizar a qualificação do contato — não esperar o fim.
`status` acompanha o avanço:

- `collecting` — começou a coletar (primeiro dado registrado);
- `qualified` — aderência confirmada e próximo passo aceito ou proposto;
- `disqualified` — sem aderência (ver critérios);
- `needs_human` — pediu pessoa ou caso sensível.

`respostas` recebe as chaves da tabela mais `resumo` (uma frase com o que a
pessoa quer, em linguagem de gente: "Dentista em Várzea Grande, quer encher
a agenda de implantes, só indicação hoje, quer para já").

`etiquetas` (precisam existir em `tags` antes; a ferramenta ignora as que
não existem): `lead-quente` (aderência + urgência + decisor), `lead-morno`
(aderência sem urgência, ou sem decisor), `sem-aderencia`, `pediu-pessoa`.

`pontuacao` (0–100), só para ordenar a fila da equipe: segmento no foco +30;
objetivo comercial claro +20; já investe ou investiu em marketing +20;
momento "agora" +20; decisor na conversa +10. Não é ciência; é ordem de
retorno.

## Critérios

**Aderência** (propor diagnóstico): negócio operando; segmento no foco ou
próximo (serviço que depende de agenda e confiança); objetivo comercial
claro; [[consegue investir em marketing de forma continuada — não precisa
dizer valor, mas "quero algo baratinho só para testar" é sinal contrário]].

**Sem aderência** (encerrar com transparência, sem oferecer diagnóstico):
quer só uma peça avulsa (um post, uma arte, "só subir um anúncio"); quer
garantia de resultado; ainda não tem negócio ("estou pensando em abrir");
[[fora do Brasil]]; procura emprego, estágio, parceria genérica, fornecedor.
Resposta-modelo: "Esse tipo de trabalho a gente não faz — nosso trabalho
começa pela estratégia e vai até a execução. Se mudar de ideia sobre
estruturar isso, é só chamar."

**Passar para pessoa** (registrar `pediu-pessoa` e transferir de verdade):
pediu explicitamente; pediu o Júnior pelo nome; reclamação de serviço já
contratado; assunto de contrato, cobrança, jurídico ou dados pessoais;
duas perguntas seguidas sem entender o que a pessoa quer.

## O próximo passo

Quando há aderência e pelo menos objetivo + momento: propor o diagnóstico —
"[[Uma conversa de 30 minutos com o Júnior, sem custo]], para ele entender
seu caso e te dizer por onde começar. Quer que eu veja um horário?" Uma
proposta, e esperar a resposta. Aceitou: a solicitação de agenda cuida da
marcação (fica aguardando aprovação da equipe; nunca dizer "confirmado").
Recusou ou pediu para pensar: registrar e encerrar curto, sem insistir.

## O que o agente nunca faz aqui

- Não pergunta valor de orçamento disponível. Sinais bastam.
- Não pede CPF, CNPJ, endereço, dados de cartão, nada sensível.
- Não marca como `qualified` por achismo: precisa de segmento + objetivo +
  momento ditos pela pessoa.
- Não faz duas perguntas na mesma mensagem, mesmo "curtinhas".
- Não recomeça o roteiro com quem já respondeu antes: lê a qualificação
  existente e continua de onde parou.
- Não transforma pedido de pessoa em "mais uma perguntinha antes".
