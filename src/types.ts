export interface StructureMeta {
  title: string
  description: string
  link: string
}

export interface AssetRecord {
  id: string
  name: string
  dataUrl: string
  createdAt: number
}

export interface MapRecord {
  id: string
  name: string
  position: number
  json: string | null
  createdAt: number
  updatedAt: number
}

export interface ModalContent extends StructureMeta {}
