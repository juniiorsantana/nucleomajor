# Desconectar primeiro, escolher o número depois (bancada, 11/10/2026)

Capturas da bancada local (`npm run dev` em `apps/emyleads`, página
`dev-gestao.html?tela=conexoes&troca=direct&vinculado=1`), branch
`feat/conectar-whatsapp-simples`. **Tudo é sintético:** o banco, a VPS e o
Bridge são dublês em memória (`src/dev/trocaDev.js`), os números são
inventados e o QR é um desenho fixo da bancada.

## Por que mudou

Em 10/10/2026, na primeira troca de verdade (a 8362 da Major), o dono abriu
"Trocar ou desconectar o número", escolheu **Só desconectar**, viu o QR do
número antigo e só então percebeu que queria outro número. Voltou à seção,
escolheu **Trocar por outro número** com aquele QR aberto, e o QR do número
novo nunca veio: o Bridge ficou preso em "pareamento em andamento" (corrigido
no runtime, `643f1f7`). A pergunta "qual número?" estava no lugar errado:
antes de desconectar, quando ninguém ainda pensou nisso.

Agora são dois momentos, cada um com uma ação:

1. **Desconectar**, com o WhatsApp de pé. Sem número, sem escolha.
2. **Conectar**, quando o dono quiser voltar: o número desta conexão (o QR
   aparece direto) ou outro (confere o número inteiro, a VPS troca, e o QR do
   número novo aparece sozinho).

## As telas

| Arquivo | O que mostra |
|---|---|
| `01-conectado-um-botao-so.jpg` | Conectado: uma ação só, "Desconectar este WhatsApp" |
| `02-desconectar-o-que-acontece.jpg` | Antes de qualquer pedido, o que acontece; nada de número |
| `03-desconectando.jpg` | A VPS aplicando; nada de sucesso ainda |
| `04-desconectado-conectar.jpg` | Desconectado: "•••• 8362 · ainda não conectado" e "Conectar WhatsApp" |
| `05-qual-numero.jpg` | "Qual WhatsApp você vai conectar?": o desta conexão ou outro |
| `06-outro-numero.jpg` | Outro número, com DDD; trazer as conversas antigas fica desligado |
| `07-conferir-o-numero-inteiro.jpg` | O número inteiro para conferir e o que muda (links, bio, campanhas) |
| `08-preparando-o-numero-novo.jpg` | A VPS trocando; sem "Conectar WhatsApp" enquanto isso |
| `09-qr-com-atalho-para-trocar.jpg` | O QR, com o atalho "Vai usar o celular de outro número? Trocar o número" |
| `10-conectado-no-numero-novo.jpg` | Lido o QR pelo número novo: "Conectado •••• 7777" |

O QR do número novo (entre `08` e `10`) aparece sozinho, sem clique: a bancada
o lê em 6 s, rápido demais para a captura. O teste
`TrocaDeWhatsApp.interactive.test.jsx` prende esse passo ("outro número:
confere o número inteiro, troca, e o QR do número novo aparece sozinho").

## O nome da conexão (11/10/2026)

Depois da troca para o final 5324, o dono conectou o número novo e o cartão
seguiu dizendo "WhatsApp principal (8362)": o nome é um texto gravado na
conexão, e a troca não mexe nele. O único campo de nome na tela era o de
"Adicionar WhatsApp", que cria outra conexão. Agora um lápis ao lado do nome
abre o editor; ele só aparece para quem administra a empresa. Foi o dono que
pediu o lápis, sem texto. No celular, o nome quebra a linha em vez de ser
cortado.

| Arquivo | O que mostra |
|---|---|
| `11-lapis-ao-lado-do-nome.jpg` | O lápis ao lado do nome |
| `12-mudar-o-nome.jpg` | O editor: o nome já sem o número, e o aviso de que o número não precisa estar nele |
| `13-nome-novo.jpg` | Salvo: "Atendimento Major", e o número na linha de baixo |
| `14-celular-nome-novo.png` | O mesmo no celular (390 px): o nome inteiro, em duas linhas, com o lápis |
