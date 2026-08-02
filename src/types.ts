export interface StructureMeta {
  title: string
  description: string
  link: string
}

export interface BookRecord {
  id: string
  name: string
  description: string
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
