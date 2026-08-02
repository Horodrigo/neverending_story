# Neverending Fantasy Map Studio

Aplicação web para montar livros de mapas de fantasia no navegador, com separação de perfil entre Narrador e Jogador.

## O que faz

- organiza mapas em livros
- permite carregar uma imagem de fundo para cada mapa
- permite adicionar estruturas visuais sobre o mapa
- salva dados localmente no navegador
- oferece modo de edição e modo de visualização
- inclui lobby de entrada com aprovação manual do narrador
- usa desafio-resposta criptográfico para autenticação de jogador
- permite revogar jogador e rotacionar link de convite por livro

## Como usar

Na tela inicial, escolha uma das áreas:

- **Narrador**: cria e gerencia livros de mapas
- **Jogador**: entra por convite e acessa somente leitura
- **Sobre**: resumo técnico e autoria

Dentro de um livro do narrador, você pode:

- criar novas páginas de mapa
- enviar imagens para o fundo do mapa
- carregar estruturas para usar como marcadores
- posicionar, mover e configurar cada estrutura

## Execução para Narrador (instalador simples)

Para o modo host sem comandos manuais longos, use o instalador Windows:

1. Baixe o projeto.
2. Execute `installer/windows/Neverending-Host-Installer.ps1`.
3. Abra o atalho **Neverending Map Studio Host** criado na área de trabalho.

Esse atalho inicia automaticamente:
- servidor de sinalização local (`ws://localhost:8787`)
- interface web no navegador (`http://localhost:4173`)

## Desenvolvimento local

```bash
npm install
npm run dev
```

## Servidor de sinalização (rede Narrador/Jogador)

O app usa um servidor WebSocket leve para lobby, ACL e sincronização de estado do mapa.

```bash
npm run signaling
```

Por padrão, o servidor sobe em `ws://localhost:8787`.

## Observação sobre GitHub Pages

`github.io` serve apenas arquivos estáticos. Recursos de sessão em tempo real (lobby, aprovação, revogação e autenticação por desafio-resposta) exigem um processo de sinalização ativo, por isso o modo host roda localmente no computador do narrador.

## Build

```bash
npm run build
```

## Licença

[MIT](./LICENSE)
