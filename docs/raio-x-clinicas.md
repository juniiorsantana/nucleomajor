# Raio-X de Crescimento da Clínica

Página dos anúncios para clínicas: `/clinicas/raio-x/`, também em `/clinicas`.

Abertura em uma dobra, sem cabeçalho, logo ou rodapé. Todas as etapas têm tema claro fixo. O CTA usa brilho CSS limitado a três ciclos, somente com transform/opacity e desativado por preferência de movimento reduzido. Fontes do sistema, sem biblioteca de animação, imagens na abertura ou dependências externas. O módulo de diagnóstico é pré-carregado.

## Fluxo

Quatro perguntas de qualificação (especialidade, anúncios atuais, disponibilidade de orçamento e papel na decisão), seguidas de oito perguntas operacionais. A referência é R$ 50 por dia, aproximadamente R$ 1.500 em um mês de 30 dias, somente para anúncios.

Quem já investe esse valor ou confirma disponibilidade continua. Quem precisa de valor menor ou ainda não confirmou orçamento recebe um encerramento sem formulário, reunião ou nota; pode revisar respostas.

As oito perguntas operacionais avaliam captação, atendimento, conversão e gestão, duas por área, de 0 a 3, normalizadas para 100. Qualificação não pontua. O resumo aparece antes do formulário; nome, clínica, WhatsApp e autorização liberam a análise completa.

## Para onde vai o lead

`POST /api/clinic-diagnostic` (`src/clinicDiagnostic.mjs`) recalcula o diagnóstico, reaplica o corte de orçamento e entrega à RPC `nucleo_site_lead_receive` com o token da campanha **Raio-X Clínicas** (organização Major). É o mesmo caminho da campanha "Planos do Site" da landing oficial:

1. o contato entra no CRM da Major com origem "Site · Raio-X Clínicas" e vira lead no Funil;
2. a primeira mensagem da campanha sai pelo WhatsApp da Major (`site_lead_welcome` na VPS);
3. a equipe recebe o aviso no WhatsApp com nota, as quatro áreas, as lacunas e clínica/especialidade/faixa de anúncios;
4. a conversa fica com a equipe (etiqueta "Não atender IA").

Se `CAMPAIGN_LEADS_TO` existir, as doze respostas, a conclusão e as UTMs vão também por e-mail. É cópia: falha do e-mail não tira o diagnóstico do visitante. Falha da RPC devolve erro e não libera o diagnóstico.

## Ligar

1. Rodar `scripts/sql/criar-campanha-raio-x-clinicas.sql` no SQL Editor.
2. Fazer um diagnóstico com o próprio WhatsApp e conferir a mensagem e o aviso.

Não há variável nova na Hostinger: o token da campanha é derivado do token da "Planos do Site" (`NUCLEO_LEAD_TOKEN`) como `sha256("raio-x-clinicas:" + sha256(NUCLEO_LEAD_TOKEN))`, e o SQL faz a mesma conta a partir do hash que o banco já guarda. Trocar o token da Planos exige rodar o SQL do Raio-X de novo. `NUCLEO_CLINICAS_LEAD_TOKEN`, se existir, vale no lugar do derivado. Sem nenhum dos dois, a rota responde 503 e nada é gravado.

Verificação: `node --test test/clinicDiagnostic.test.mjs`.
