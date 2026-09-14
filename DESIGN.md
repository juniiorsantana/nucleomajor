---
version: 1.0.0
name: EmyLeads Product UI
description: Interface operacional B2B, responsiva e orientada a tarefas recorrentes.
colors:
  background: "#FFFFFF"
  surface: "#F4F6F9"
  foreground: "#182438"
  secondary-text: "#53637A"
  border: "#E1E6EE"
  primary: "#2456C7"
  primary-strong: "#1945A5"
  primary-soft: "#EAF0FC"
  success: "#16A34A"
typography:
  heading-md: { fontFamily: "Segoe UI Variable, system-ui, sans-serif", fontSize: 24px, fontWeight: 600, lineHeight: 1.2, letterSpacing: -0.02em }
  body-md: { fontFamily: "Segoe UI Variable, system-ui, sans-serif", fontSize: 13px, fontWeight: 400, lineHeight: 1.5 }
  label-md: { fontFamily: "Segoe UI Variable, system-ui, sans-serif", fontSize: 12px, fontWeight: 600, lineHeight: 1.25 }
rounded:
  sm: 8px
  md: 12px
  lg: 18px
  full: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
components:
  mobile-dock:
    backgroundColor: "{colors.background}"
    textColor: "{colors.secondary-text}"
    rounded: "{rounded.lg}"
    height: 64px
  mobile-dock-active:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary-strong}"
    rounded: "{rounded.md}"
---

# EmyLeads Product UI

## Overview

Portal B2B usado por atendentes e gestores durante todo o dia. A identidade de interface evolui para azul profundo, neutros frios e tipografia nativa legível. A reformulação de cores e tipografia foi solicitada pelo usuário. O símbolo gráfico existente ainda é preservado como asset.

## Colors

Os tokens de execução vivem em `apps/emyleads/src/ui/theme.css`. Azul identifica seleção e ação principal; verde representa sucesso ou estado ativo. Os temas claro e escuro mantêm a mesma semântica. No escuro, o fundo da ação permanece azul escuro para manter texto branco legível; o texto de destaque usa azul claro.

## Typography

Tipografia: Segoe UI Variable em Windows, SF Pro Text em Apple e system-ui como fallback, sem downloads externos. Títulos em 22–24 px; corpo em 14–16 px; rótulos em 12–14 px. Campos móveis usam 16 px. Peso e espaçamento determinam a hierarquia. A adoção completa da escala nas telas legadas é progressiva.

## Layout

Mobile-first abaixo de 768 px. A navegação principal usa uma dock flutuante com quatro destinos frequentes e acesso progressivo aos demais. Respeitar `safe-area-inset-bottom` e alvos de toque de no mínimo 44 px.

## Elevation & Depth

Usar bordas tonais e uma única sombra suave para elementos flutuantes. Conteúdo comum permanece plano.

## Shapes

Raios menores nos controles internos e maiores somente em superfícies flutuantes ou painéis.

## Components

- A dock móvel mostra ícones para Conversas, Funil, Agenda e Inteligência, além de Mais.
- O estado ativo combina cor, fundo e `aria-current`; nunca depende somente de cor.
- Menus secundários abrem como folha inferior, com rótulos visíveis e fechamento explícito.
- A Central de Inteligência abre nos agentes e evidencia quantos estão ativos.

## Do's and Don'ts

- Manter as ações principais na zona inferior alcançável pelo polegar.
- Preservar zoom do navegador e foco visível.
- Não usar faixas horizontais roláveis como navegação principal no celular.
- Não esconder destinos sem um botão Mais claramente identificável.
