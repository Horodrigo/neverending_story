import { db } from './db'
import type { PlayerIdentityRecord } from './types'

const IDENTITY_ID = 'player-default'

function toBase64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
  const bytes = atob(padded)
  return new Uint8Array([...bytes].map((char) => char.charCodeAt(0)))
}

async function fingerprintPublicKey(publicKeyJwk: JsonWebKey): Promise<string> {
  const serialized = JSON.stringify(publicKeyJwk)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized))
  return toBase64Url(new Uint8Array(digest)).slice(0, 18)
}

export async function getOrCreateIdentity(): Promise<PlayerIdentityRecord> {
  const existing = await db.identities.get(IDENTITY_ID)
  if (existing) {
    return existing
  }

  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true,
    ['sign', 'verify'],
  )

  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey)
  const now = Date.now()
  const identity: PlayerIdentityRecord = {
    id: IDENTITY_ID,
    publicKeyJwk,
    privateKeyJwk,
    fingerprint: await fingerprintPublicKey(publicKeyJwk),
    createdAt: now,
    updatedAt: now,
  }
  await db.identities.put(identity)
  return identity
}

export async function signChallenge(
  privateKeyJwk: JsonWebKey,
  challengeBase64Url: string,
): Promise<string> {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const challengeBytes = fromBase64Url(challengeBase64Url)
  const challengeBuffer = challengeBytes.buffer.slice(
    challengeBytes.byteOffset,
    challengeBytes.byteOffset + challengeBytes.byteLength,
  ) as ArrayBuffer
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    challengeBuffer,
  )
  return toBase64Url(new Uint8Array(signature))
}

export async function generateNewInviteToken(): Promise<string> {
  const randomBytes = crypto.getRandomValues(new Uint8Array(18))
  return `invite_${toBase64Url(randomBytes)}`
}

export function buildInviteUri(baseUrl: string, inviteToken: string): string {
  const url = new URL(baseUrl)
  url.searchParams.set('invite', inviteToken)
  return url.toString()
}
