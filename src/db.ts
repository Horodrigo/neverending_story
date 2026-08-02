import Dexie, { type EntityTable, type Table } from 'dexie'
import type { AssetRecord, BookRecord, MapRecord } from './types'

function createMigrationBookId(): string {
  return `book_${Math.random().toString(36).slice(2, 9)}`
}

class MapStudioDB extends Dexie {
  assets!: EntityTable<AssetRecord, 'id'>
  books!: EntityTable<BookRecord, 'id'>
  maps!: EntityTable<MapRecord, 'id'>

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
  }
}

export const db = new MapStudioDB()
