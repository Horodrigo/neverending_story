import { createServer } from 'node:http'
import { webcrypto } from 'node:crypto'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.SIGNALING_PORT || 8787)
const rooms = new Map()
const clients = new Map()

function randomToken(prefix) {
  const bytes = new Uint8Array(18)
  webcrypto.getRandomValues(bytes)
  const base64 = Buffer.from(bytes).toString('base64url')
  return `${prefix}_${base64}`
}

function send(socket, payload) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload))
  }
}

function getCountryFromRequest(req) {
  const forwarded = req.headers['cf-ipcountry']
  if (typeof forwarded === 'string' && forwarded.length > 1) {
    return forwarded
  }
  return 'Desconhecido'
}

async function verifySignature(publicKeyJwk, challengeB64, signatureB64) {
  const publicKey = await webcrypto.subtle.importKey(
    'jwk',
    publicKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )
  const verified = await webcrypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    Buffer.from(signatureB64, 'base64url'),
    Buffer.from(challengeB64, 'base64url'),
  )
  return verified
}

function ensureRoom(bookId) {
  if (!rooms.has(bookId)) {
    rooms.set(bookId, {
      bookId,
      inviteToken: randomToken('invite'),
      hostSecret: null,
      hostClientId: null,
      pending: new Map(),
      acl: new Map(),
      players: new Map(),
      state: null,
      updatedAt: Date.now(),
    })
  }
  return rooms.get(bookId)
}

function roomParticipants(room) {
  const participants = []
  if (room.hostClientId && clients.get(room.hostClientId)) {
    participants.push({ clientId: room.hostClientId, role: 'narrator' })
  }
  for (const playerClientId of room.players.keys()) {
    if (clients.get(playerClientId)) {
      participants.push({ clientId: playerClientId, role: 'player' })
    }
  }
  return participants
}

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }
  res.writeHead(404)
  res.end('Not found')
})

const wss = new WebSocketServer({ server })

wss.on('connection', (socket, req) => {
  const clientId = randomToken('client')
  clients.set(clientId, { socket, role: null, bookId: null })
  send(socket, { type: 'server:connected', clientId })

  socket.on('message', async (raw) => {
    let payload
    try {
      payload = JSON.parse(raw.toString())
    } catch {
      send(socket, { type: 'server:error', message: 'Payload JSON inválido.' })
      return
    }

    const client = clients.get(clientId)
    if (!client) {
      return
    }

    if (payload.type === 'narrator:open-room') {
      const room = ensureRoom(payload.bookId)
      room.hostClientId = clientId
      room.hostSecret = payload.hostSecret
      room.inviteToken = payload.inviteToken || room.inviteToken
      room.updatedAt = Date.now()
      client.role = 'narrator'
      client.bookId = payload.bookId

      send(socket, {
        type: 'room:opened',
        clientId,
        bookId: room.bookId,
        inviteToken: room.inviteToken,
        pending: [...room.pending.values()],
        acl: [...room.acl.values()],
        participants: roomParticipants(room),
      })
      return
    }

    if (payload.type === 'narrator:rotate-invite') {
      const room = ensureRoom(payload.bookId)
      if (room.hostClientId !== clientId || room.hostSecret !== payload.hostSecret) {
        send(socket, { type: 'server:error', message: 'Host inválido para rotacionar convite.' })
        return
      }
      room.inviteToken = payload.inviteToken || randomToken('invite')
      room.updatedAt = Date.now()
      send(socket, { type: 'room:invite-rotated', inviteToken: room.inviteToken })
      return
    }

    if (payload.type === 'player:join-request') {
      const country = getCountryFromRequest(req)
      const room = [...rooms.values()].find((candidate) => candidate.inviteToken === payload.inviteToken)
      if (!room) {
        send(socket, { type: 'room:rejected', reason: 'Invite inválido ou expirado.' })
        return
      }
      client.role = 'player'
      client.bookId = room.bookId

      const pendingId = randomToken('pending')
      const challengeBytes = new Uint8Array(24)
      webcrypto.getRandomValues(challengeBytes)
      const challenge = Buffer.from(challengeBytes).toString('base64url')
      const pendingEntry = {
        id: pendingId,
        clientId,
        bookId: room.bookId,
        displayName: payload.displayName,
        fingerprint: payload.fingerprint,
        publicKeyJwk: payload.publicKeyJwk,
        country,
        challenge,
        createdAt: Date.now(),
      }

      room.pending.set(pendingId, pendingEntry)
      if (room.hostClientId && clients.get(room.hostClientId)) {
        send(clients.get(room.hostClientId).socket, {
          type: 'room:pending-join',
          pending: pendingEntry,
        })
      } else {
        send(socket, {
          type: 'room:waiting-host',
          message: 'Aguardando narrador abrir a sala para aprovação.',
        })
      }
      return
    }

    if (payload.type === 'narrator:approve-player') {
      const room = ensureRoom(payload.bookId)
      if (room.hostClientId !== clientId || room.hostSecret !== payload.hostSecret) {
        send(socket, { type: 'server:error', message: 'Host inválido para aprovar jogador.' })
        return
      }
      const pending = room.pending.get(payload.pendingId)
      if (!pending) {
        send(socket, { type: 'server:error', message: 'Solicitação não encontrada.' })
        return
      }

      room.acl.set(pending.fingerprint, {
        displayName: pending.displayName,
        fingerprint: pending.fingerprint,
        publicKeyJwk: pending.publicKeyJwk,
        country: pending.country,
        approvedAt: Date.now(),
        revokedAt: null,
      })
      const target = clients.get(pending.clientId)
      if (!target) {
        room.pending.delete(payload.pendingId)
        send(socket, { type: 'server:error', message: 'Jogador desconectado antes da aprovação.' })
        return
      }
      send(target.socket, {
        type: 'room:challenge',
        bookId: room.bookId,
        pendingId: pending.id,
        challenge: pending.challenge,
      })
      send(socket, { type: 'room:acl-updated', acl: [...room.acl.values()] })
      return
    }

    if (payload.type === 'narrator:reject-player') {
      const room = ensureRoom(payload.bookId)
      if (room.hostClientId !== clientId || room.hostSecret !== payload.hostSecret) {
        send(socket, { type: 'server:error', message: 'Host inválido para rejeitar jogador.' })
        return
      }
      const pending = room.pending.get(payload.pendingId)
      if (!pending) {
        return
      }
      room.pending.delete(payload.pendingId)
      const target = clients.get(pending.clientId)
      if (target) {
        send(target.socket, {
          type: 'room:rejected',
          reason: 'Entrada recusada pelo narrador.',
        })
      }
      return
    }

    if (payload.type === 'player:challenge-response') {
      const room = ensureRoom(payload.bookId)
      const pending = room.pending.get(payload.pendingId)
      if (!pending || pending.clientId !== clientId) {
        send(socket, { type: 'room:rejected', reason: 'Desafio inválido ou expirado.' })
        return
      }

      const verified = await verifySignature(
        pending.publicKeyJwk,
        pending.challenge,
        payload.signature,
      )
      if (!verified) {
        send(socket, { type: 'room:rejected', reason: 'Falha na autenticação criptográfica.' })
        room.pending.delete(payload.pendingId)
        return
      }

      room.pending.delete(payload.pendingId)
      room.players.set(clientId, {
        clientId,
        displayName: pending.displayName,
        fingerprint: pending.fingerprint,
      })
      send(socket, {
        type: 'room:approved',
        clientId,
        bookId: room.bookId,
        state: room.state,
        participants: roomParticipants(room),
      })
      if (room.hostClientId && clients.get(room.hostClientId)) {
        send(clients.get(room.hostClientId).socket, {
          type: 'room:player-joined',
          clientId,
          player: {
            displayName: pending.displayName,
            fingerprint: pending.fingerprint,
            country: pending.country,
          },
        })
      }
      return
    }

    if (payload.type === 'narrator:revoke-player') {
      const room = ensureRoom(payload.bookId)
      if (room.hostClientId !== clientId || room.hostSecret !== payload.hostSecret) {
        send(socket, { type: 'server:error', message: 'Host inválido para revogar jogador.' })
        return
      }
      const acl = room.acl.get(payload.fingerprint)
      if (!acl) {
        return
      }
      acl.revokedAt = Date.now()
      room.acl.set(payload.fingerprint, acl)
      for (const [playerClientId, player] of room.players.entries()) {
        if (player.fingerprint === payload.fingerprint) {
          send(clients.get(playerClientId).socket, {
            type: 'room:revoked',
            reason: 'Acesso revogado pelo narrador.',
          })
          room.players.delete(playerClientId)
        }
      }
      send(socket, { type: 'room:acl-updated', acl: [...room.acl.values()] })
      return
    }

    if (payload.type === 'narrator:state-update') {
      const room = ensureRoom(payload.bookId)
      if (room.hostClientId !== clientId || room.hostSecret !== payload.hostSecret) {
        send(socket, { type: 'server:error', message: 'Host inválido para sincronização.' })
        return
      }
      room.state = payload.state
      room.updatedAt = Date.now()
      for (const playerClientId of room.players.keys()) {
        send(clients.get(playerClientId).socket, {
          type: 'room:state',
          state: room.state,
        })
      }
      return
    }

    if (payload.type === 'webrtc:signal') {
      const room = ensureRoom(payload.bookId)
      if (client.bookId !== room.bookId) {
        send(socket, { type: 'server:error', message: 'Cliente fora da sala para sinalização WebRTC.' })
        return
      }
      const targetClient = clients.get(payload.toClientId)
      if (!targetClient || targetClient.bookId !== room.bookId) {
        send(socket, { type: 'server:error', message: 'Peer alvo não está ativo na sala.' })
        return
      }
      send(targetClient.socket, {
        type: 'webrtc:signal',
        bookId: room.bookId,
        fromClientId: clientId,
        signal: payload.signal,
      })
      return
    }
  })

  socket.on('close', () => {
    const client = clients.get(clientId)
    if (!client) {
      return
    }

    if (client.role === 'narrator' && client.bookId && rooms.has(client.bookId)) {
      const room = rooms.get(client.bookId)
      room.hostClientId = null
    }
    if (client.role === 'player' && client.bookId && rooms.has(client.bookId)) {
      const room = rooms.get(client.bookId)
      room.players.delete(clientId)
      if (room.hostClientId && clients.get(room.hostClientId)) {
        send(clients.get(room.hostClientId).socket, {
          type: 'room:player-left',
          clientId,
        })
      }
    }
    clients.delete(clientId)
  })
})

server.listen(PORT, () => {
  console.log(`Signaling server running on http://localhost:${PORT}`)
})
