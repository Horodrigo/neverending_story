# Neverending Fantasy Map Studio

Aplicativo web responsivo para criar mapas de fantasia interativos com múltiplas abas (estilo livro), biblioteca de estruturas persistida localmente e objetos clicáveis com metadados narrativos.

## Stack

- React + TypeScript + Vite
- Fabric.js (canvas, drag/resize/rotate, hover glow)
- Dexie + IndexedDB (persistência local de mapas e assets)
- Marked + DOMPurify (renderização segura de descrição em Markdown)

## Funcionalidades implementadas

- Abas de mapas com estado persistido por página
- Upload de plano de fundo por mapa
- Biblioteca de estruturas com upload local e persistência em IndexedDB
- Carimbo de estruturas no mapa com clique em coordenada
- Modo Edição e Modo Visualização
- Hover highlight (glow) nas estruturas
- Modal narrativo ao clicar no objeto em modo Visualização
- Inspector lateral com título, descrição e link externo por estrutura

## Desenvolvimento local

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy no GitHub Pages

O projeto já inclui workflow em `.github/workflows/deploy-pages.yml`.

Passos no GitHub:

1. Abrir **Settings > Pages**.
2. Em **Build and deployment**, selecionar **GitHub Actions**.
3. Fazer push na branch `main`.

O `vite.config.ts` já está configurado com `base: "/neverending_story/"` para o repositório `Horodrigo/neverending_story`.
