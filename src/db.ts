import Dexie, { type EntityTable, type Table } from 'dexie'
import type {
  AssetRecord,
  BookRecord,
  LocalAclRecord,
  MapRecord,
  PlayerIdentityRecord,
} from './types'

function createMigrationBookId(): string {
  return `book_${Math.random().toString(36).slice(2, 9)}`
}

class MapStudioDB extends Dexie {
  assets!: EntityTable<AssetRecord, 'id'>
  books!: EntityTable<BookRecord, 'id'>
  maps!: EntityTable<MapRecord, 'id'>
  identities!: EntityTable<PlayerIdentityRecord, 'id'>
  localAcl!: EntityTable<LocalAclRecord, 'id'>

  constructor() {
    super('neverending_map_studio')
    this.version(1).stores({
      assets: 'id, name, createdAt',
      maps: 'id, position, updatedAt',
    })
    this.version(2)
      .stores({
        assets: 'id, name, createdAt',
        books: 'id, createdAt, updatedAt',
        maps: 'id, bookId, position, updatedAt',
      })
      .upgrade(async (tx) => {
        const booksTable = tx.table('books') as Table<BookRecord, string>
        const mapsTable = tx.table('maps') as Table<MapRecord, string>
        const legacyMaps = await mapsTable.toArray()

        if (legacyMaps.length === 0) {
          return
        }

        const defaultBookId = createMigrationBookId()
        const now = Date.now()

        await booksTable.add({
          id: defaultBookId,
          name: 'Livro 1',
          description: 'Livro migrado da versao inicial do estúdio.',
          hostSecret: `host_${Math.random().toString(36).slice(2, 9)}`,
          inviteToken: `invite_${Math.random().toString(36).slice(2, 12)}`,
          inviteUpdatedAt: now,
          createdAt: now,
          updatedAt: now,
        })

        for (const [index, map] of legacyMaps.entries()) {
          await mapsTable.update(map.id, {
            bookId: defaultBookId,
            position: Number.isFinite(map.position) ? map.position : index,
            updatedAt: map.updatedAt ?? now,
          })
        }
      })
    this.version(3)
      .stores({
        assets: 'id, name, createdAt',
        books: 'id, updatedAt',
        maps: 'id, bookId, position, updatedAt',
        identities: 'id, fingerprint, updatedAt',
        localAcl: 'id, bookId, fingerprint, revokedAt',
      })
      .upgrade(async (tx) => {
        const booksTable = tx.table('books') as Table<BookRecord, string>
        const books = await booksTable.toArray()
        const now = Date.now()
        for (const book of books) {
          await booksTable.update(book.id, {
            hostSecret: book.hostSecret || `host_${Math.random().toString(36).slice(2, 9)}`,
            inviteToken:
              book.inviteToken || `invite_${Math.random().toString(36).slice(2, 12)}`,
            inviteUpdatedAt: book.inviteUpdatedAt || now,
          })
        }
      })
  }
}

export const db = new MapStudioDB()
