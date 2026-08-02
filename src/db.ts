import Dexie, { type EntityTable } from 'dexie'
import type { AssetRecord, MapRecord } from './types'

class MapStudioDB extends Dexie {
  assets!: EntityTable<AssetRecord, 'id'>
  maps!: EntityTable<MapRecord, 'id'>

  constructor() {
    super('neverending_map_studio')
    this.version(1).stores({
      assets: 'id, name, createdAt',
      maps: 'id, position, updatedAt',
    })
  }
}

export const db = new MapStudioDB()
