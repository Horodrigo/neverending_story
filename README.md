# Neverending Fantasy Map Studio (source)

Este repositório contém **o código-fonte** da aplicação.

## Distribuição

Os usuários finais devem baixar o instalador gerado em:

- `Horodrigo/fantasy_installer`

Este repositório **não publica mais GitHub Pages**.  
Quando há push na `main`, um workflow dispara build no repositório `fantasy_installer`.

## O que a aplicação oferece

- fluxo separado de **Narrador** e **Jogador**
- lobby com descoberta em **/api/lobbies** e aprovação manual do narrador
- ACL por livro/campanha
- autenticação por desafio-resposta com chave local (Web Crypto + IndexedDB)
- modo jogador em leitura

## Desenvolvimento local

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Android (Jogadores somente)

O app Android usa modo **player-only** (sem fluxo de narrador e sem conexão por token).

```bash
npm run android:sync
npm run android:apk:debug
```

APK debug gerado em:

- `android/app/build/outputs/apk/debug/app-debug.apk`

## Segredo necessário para dispatch cross-repo

No repositório `Horodrigo/neverending_story`, configure:

- `CROSS_REPO_PAT_TOKEN`

Esse token precisa de permissão para disparar workflows no repositório `Horodrigo/fantasy_installer`.

## Licença

[MIT](./LICENSE)
