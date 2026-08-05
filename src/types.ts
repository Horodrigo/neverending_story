export interface StructureMeta {
  title: string
  description: string
}

export interface PendingJoin {
  id: string
  clientId: string
  bookId: string
  displayName: string
  fingerprint: string
  publicKeyJwk: JsonWebKey
  country: string
  createdAt: number
}

export interface NarratorRoomState {
  bookId: string | null
  narratorName: string
  bookName: string
  lobbyPassword: string | null
  pendingJoins: PendingJoin[]
  aclEntries: LocalAclRecord[]
  isConnected: boolean
  message: string
}

export interface PlayerJoinState {
  status: 'idle' | 'discovering' | 'joining' | 'authenticating' | 'approved' | 'rejected' | 'revoked'
  message: string
  selectedLobbyId: string | null
  lobbyPassword: string
  remoteMapJson: string | null
}

export interface LobbyInfo {
  id: string
  narratorName: string
  bookName: string
  hasPassword: boolean
  mapCount: number
  playerCount: number
  createdAt: number
  joinable: boolean
}

export interface BookRecord {
  id: string
  name: string
  description: string
  hostSecret: string
  inviteToken: string
  inviteUpdatedAt: number
  lobbyPassword: string | null
  isLobbyOpen: boolean
  createdAt: number
  updatedAt: number
}

export interface AssetRecord {
  id: string
  name: string
  dataUrl: string
  createdAt: number
}

export interface MapRecord {
  id: string
  bookId: string
  name: string
  position: number
  json: string | null
  createdAt: number
  updatedAt: number
}

export interface ModalContent extends StructureMeta {}

export interface PlayerIdentityRecord {
  id: string
  publicKeyJwk: JsonWebKey
  privateKeyJwk: JsonWebKey
  fingerprint: string
  createdAt: number
  updatedAt: number
}

export interface LocalAclRecord {
  id: string
  bookId: string
  displayName: string
  fingerprint: string
  publicKeyJwk: JsonWebKey
  country: string
  approvedAt: number
  revokedAt: number | null
}
