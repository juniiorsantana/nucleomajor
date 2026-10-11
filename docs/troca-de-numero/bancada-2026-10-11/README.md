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
