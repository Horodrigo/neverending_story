import { createServer } from 'node:http'
import { spawn, exec } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const distDir = path.join(repoRoot, 'dist')
const webPort = Number(process.env.MAPSTUDIO_WEB_PORT || 4173)
const signalingPort = Number(process.env.SIGNALING_PORT || 8787)

if (!fs.existsSync(distDir)) {
  console.error('Build não encontrado. Execute: npm run build')
  process.exit(1)
}

const signalingProcess = spawn(process.execPath, ['signaling/server.mjs'], {
  cwd: repoRoot,
  env: { ...process.env, SIGNALING_PORT: String(signalingPort) },
  stdio: 'inherit',
})

function openInBrowser(url) {
  if (process.platform === 'win32') {
    exec(`start "" "${url}"`)
    return
  }
  if (process.platform === 'darwin') {
    exec(`open "${url}"`)
    return
  }
  exec(`xdg-open "${url}"`)
}

const mimeByExt = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
}

const server = createServer((req, res) => {
  const requestPath = req.url && req.url !== '/' ? req.url : '/index.html'
  const normalized = requestPath.split('?')[0]
  const safePath = normalized.startsWith('/') ? normalized.slice(1) : normalized
  const filePath = path.join(distDir, safePath)

  const sendFile = (targetPath) => {
    fs.readFile(targetPath, (error, content) => {
      if (error) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('Not found')
        return
      }
      const extension = path.extname(targetPath).toLowerCase()
      const mimeType = mimeByExt[extension] || 'application/octet-stream'
      res.writeHead(200, { 'content-type': mimeType })
      res.end(content)
    })
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    sendFile(filePath)
    return
  }

  sendFile(path.join(distDir, 'index.html'))
})

server.listen(webPort, () => {
  const url = `http://localhost:${webPort}/`
  console.log(`App local: ${url}`)
  console.log(`Sinalização: ws://localhost:${signalingPort}`)
  openInBrowser(url)
})

function shutdown() {
  server.close()
  if (!signalingProcess.killed) {
    signalingProcess.kill()
  }
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
signalingProcess.on('exit', () => {
  process.exit(0)
})
