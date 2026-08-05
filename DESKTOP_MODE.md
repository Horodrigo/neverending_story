# 🎭 Neverending Fantasy Map Studio - Modo Desktop

A partir da **Phase 3e**, a aplicação deixou de abrir o navegador automaticamente ao iniciar. Isso permite uma experiência mais limpa em modo desktop, onde o usuário controla quando abrir o navegador.

## Como Iniciar

### Opção 1: Via Instalador Windows
Execute o instalador `.exe` do `Horodrigo/fantasy_installer`. A aplicação iniciará o servidor localmente.

### Opção 2: Via Node.js Direto
```bash
npm run host
```

## Conectando ao Aplicativo

Após iniciar o servidor, você verá no console:

```
🎭 Neverending Fantasy Map Studio
📍 Abra o navegador em: http://localhost:4173/
🔌 Servidor de sinalização: ws://localhost:8787
```

**Abra seu navegador favorito (Chrome, Firefox, Edge, etc.) e acesse:**
```
http://localhost:4173/
```

## Portas

- **Aplicação Web**: `http://localhost:4173/` (padrão, configurável via `MAPSTUDIO_WEB_PORT`)
- **Servidor de Sinalização WebSocket**: `ws://localhost:8787` (padrão, configurável via `SIGNALING_PORT`)

## Modo de Desenvolvimento

Durante o desenvolvimento, use:

```bash
npm run dev
```

Isso inicia o servidor Vite em `http://localhost:5173/` e permite hot-reload automático.

## Variáveis de Ambiente

- `MAPSTUDIO_WEB_PORT`: Porta do servidor web (padrão: 4173)
- `SIGNALING_PORT`: Porta do servidor de sinalização WebSocket (padrão: 8787)

Exemplo:
```bash
MAPSTUDIO_WEB_PORT=3000 SIGNALING_PORT=9000 npm run host
```

## Benefícios do Modo Desktop

✅ Sem abertura automática de abas (mais limpo)  
✅ Usuário controla quando abrir o navegador  
✅ Múltiplas abas/janelas no navegador para multi-tasking  
✅ Melhor integração com desktops Windows/Mac/Linux  
✅ Caminho para integração Tauri futura (sem dependência de Electron)  

## Roadmap: Tauri Integration (Phase 3e.2+)

No futuro, planeja-se integrar [Tauri](https://tauri.app/) para:
- Criar um executável nativo Windows/Mac/Linux
- Bundar o navegador junto com o app
- Reduzir footprint e melhorar segurança
- Acessar APIs do sistema operacional

**Status**: Planejado para fases posteriores (low priority).
