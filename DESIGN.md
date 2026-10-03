---
version: 2.0.0
name: Núcleo Major · Sistema Grafite
description: Interface operacional B2B em preto, branco e grafite, com cor só onde ela tem função.
colors:
  background: "#FFFFFF"
  surface: "#F5F5F6"
  surface-hover: "#EDEDEE"
  foreground: "#18181B"
  secondary-text: "#5C5C63"
  faint-text: "#6C6C72"
  border: "#E4E4E6"
  border-strong: "#C2C2C6"
  primary: "#2B2C30"
  primary-strong: "#18181B"
  primary-soft: "#EDEDEE"
  signal: "#2F5BEA"
  signal-soft: "#EBF0FE"
  ia: "#6B4FD8"
  ia-soft: "#F1EEFC"
  flow: "#0A7489"
  flow-soft: "#E6F3F5"
  success: "#2F7A4E"
  warning: "#8F5E00"
  danger: "#B3261E"
typography:
  title: { fontFamily: "Geist, system-ui, sans-serif", fontSize: 28px, fontWeight: 600, lineHeight: 1.15, letterSpacing: -0.03em }
  section: { fontFamily: "Geist, system-ui, sans-serif", fontSize: 20px, fontWeight: 600, lineHeight: 1.2, letterSpacing: -0.02em }
  body-md: { fontFamily: "Geist, system-ui, sans-serif", fontSize: 13px, fontWeight: 400, lineHeight: 1.5 }
  label-md: { fontFamily: "Geist, system-ui, sans-serif", fontSize: 12px, fontWeight: 500, lineHeight: 1.25 }
  data: { fontFamily: "Geist Mono, ui-monospace, monospace", fontSize: 12px, fontWeight: 400, lineHeight: 1.4 }
rounded:
  none: 0px
  control: 2px
  full: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 48px
components:
  rail:
    width: 60px
    backgroundColor: "{colors.surface}"
    activeIndicator: "2px {colors.signal} na borda esquerda"
  mobile-dock:
    backgroundColor: "{colors.background}"
    textColor: "{colors.secondary-text}"
    height: 64px
---

# Núcleo Major · Sistema Grafite

Proposta visual completa, com amostras interativas: https://claude.ai/artifact/USyYKjruZchxAMdod4nSux

## Overview

Portal B2B usado por atendentes, gestores e pela equipe Major Hub durante todo o dia, principalmente no computador. Depois do rebrand, a marca é grafite: a interface parte do preto e branco, com cantos retos, sem sombra e sem cartão, minimalista como um app da Apple. A cor entra só quando comunica algo.

## Colors

Os tokens de execução vivem em `apps/emyleads/src/ui/theme.css` (variáveis `--el-*`, expostas ao Tailwind como `bg-*`, `text-*`, `border-*`).

- **Neutros:** 14 tons com leve viés frio. O grafite da marca (`#2B2C30`, provisório até o código oficial) é a ação principal.
- **Sinal (`signal`):** azul cobalto para o que é novo, não lido, selecionado, em foco ou lido pelo cliente. Sempre em dose pequena, nunca em área grande.
- **Atores (`ia`, `flow`):** violeta é a IA, ciano é o fluxo; a pessoa é o próprio grafite. A mesma cor no ícone, na bolha e na lista.
- **Estado (`success`, `warning`, `danger`):** sempre com palavra ou ícone junto, nunca só a cor.
- Todos os pares de texto passam de 4,5:1 nos dois temas.
- **Tema escuro:** segue o sistema operacional. Por enquanto a ação principal é um grafite levantado (`#636369`) com texto branco; a inversão (botão claro, texto escuro) vem quando os componentes deixarem de fixar `text-white`.

## Typography

Geist para tudo, com Geist Mono para valores, horários e telefones; números tabulares em colunas. Seis tamanhos: 28 (título de tela), 20 (seção), 15 (destaque), 13 (corpo), 12 (apoio), 11 (metadado). Campos no celular usam 16 px.

## Layout

- **Computador:** trilho de ícones à esquerda ("trilho Instrumento"): busca geral, Conversas, Leads, Funil, Agenda, Tarefas; Inteligência e Fluxos com a cor do ator; embaixo, a conexão do WhatsApp com ponto de estado e a organização, que abre Conexões, Equipe e Configurações.
- **Celular (abaixo de 768 px):** dock inferior com quatro destinos frequentes e "Mais". Respeitar `safe-area-inset-bottom` e alvos de toque de no mínimo 44 px.
- Blocos se separam por régua de 1px e espaço, numa grade de 4px.

## Elevation & Depth

Sem sombra. Camada aparece por borda mais forte; modal, por fundo escurecido atrás.

## Shapes

Raio 0 em painéis, listas, menus e modais (`rounded-none`); 2px em botões, campos e etiquetas (`rounded-ctl`); círculo só em avatar, contador e ponto de status (`rounded-full`). Não usar `rounded-[Npx]`.

## Components

- O estado ativo combina filete azul, fundo e `aria-current`; nunca depende só de cor.
- **Quem responde:** todo cabeçalho de conversa mostra se a IA, um fluxo ou uma pessoa está respondendo, e quando a IA volta.
- Contagem azul só para o que é do usuário e está esperando.
- Menus secundários no celular abrem como folha inferior, com rótulos visíveis e fechamento explícito.

## Do's and Don'ts

- Fazer a tela funcionar em escala de cinzas antes de pôr cor.
- Um botão principal grafite por área.
- Preservar zoom do navegador e foco visível (anel azul de sinal).
- Não usar azul como decoração nem em área grande.
- Não usar cartão com sombra para separar conteúdo.
- Não esconder destinos sem um botão "Mais" claramente identificável.
