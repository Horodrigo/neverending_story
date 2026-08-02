import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, FabricImage, FabricObject, Shadow } from 'fabric'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { db } from './db'
import type { AssetRecord, MapRecord, ModalContent, StructureMeta } from './types'

if (!FabricObject.customProperties.includes('data')) {
  FabricObject.customProperties = [...FabricObject.customProperties, 'data']
}

const DEFAULT_CANVAS_WIDTH = 900
const DEFAULT_CANVAS_HEIGHT = 620
const MAX_BACKGROUND_WIDTH = 900
const MAX_BACKGROUND_HEIGHT = 620
const LIBRARY_FIT_SIZE = 90

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

async function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function getStructureData(object: FabricObject | undefined | null): StructureMeta {
  if (!object) {
    return { title: '', description: '', link: '' }
  }
  const data = object.get('data')
  if (!data || typeof data !== 'object') {
    return { title: '', description: '', link: '' }
  }
  const source = data as Partial<StructureMeta>
  return {
    title: source.title ?? '',
    description: source.description ?? '',
    link: source.link ?? '',
  }
}

function isSafeUrl(url: string): boolean {
  if (!url.trim()) {
    return false
  }
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function markdownToHtml(markdown: string): string {
  const rendered = marked.parse(markdown, { async: false }) as string
  return DOMPurify.sanitize(rendered)
}

function App() {
  const htmlCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasRef = useRef<Canvas | null>(null)
  const isHydratingRef = useRef(false)
  const currentMapIdRef = useRef<string | null>(null)
  const editModeRef = useRef(true)
  const stampAssetIdRef = useRef<string | null>(null)
  const assetsRef = useRef<AssetRecord[]>([])

  const [assets, setAssets] = useState<AssetRecord[]>([])
  const [maps, setMaps] = useState<MapRecord[]>([])
  const [currentMapId, setCurrentMapId] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(true)
  const [stampAssetId, setStampAssetId] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [selectedObject, setSelectedObject] = useState<FabricObject | null>(null)
  const [selectedData, setSelectedData] = useState<StructureMeta>({
    title: '',
    description: '',
    link: '',
  })
  const [modalContent, setModalContent] = useState<ModalContent | null>(null)

  useEffect(() => {
    currentMapIdRef.current = currentMapId
  }, [currentMapId])

  useEffect(() => {
    editModeRef.current = editMode
  }, [editMode])

  useEffect(() => {
    stampAssetIdRef.current = stampAssetId
  }, [stampAssetId])

  useEffect(() => {
    assetsRef.current = assets
  }, [assets])

  const sortedMaps = useMemo(
    () => [...maps].sort((a, b) => a.position - b.position),
    [maps],
  )

  const persistCurrentMap = useCallback(async () => {
    const mapId = currentMapIdRef.current
    const canvas = canvasRef.current
    if (!mapId || !canvas || isHydratingRef.current) {
      return
    }
    const json = canvas.toJSON()
    await db.maps.update(mapId, {
      json: JSON.stringify(json),
      updatedAt: Date.now(),
    })
    setMaps((prev) =>
      prev.map((map) =>
        map.id === mapId ? { ...map, json: JSON.stringify(json), updatedAt: Date.now() } : map,
      ),
    )
  }, [])

  const applyModeToObjects = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    canvas.forEachObject((object) => {
      object.set({
        selectable: editModeRef.current,
        evented: true,
        hasControls: editModeRef.current,
        hasBorders: editModeRef.current,
        lockMovementX: !editModeRef.current,
        lockMovementY: !editModeRef.current,
        hoverCursor: editModeRef.current ? 'move' : 'pointer',
      })
    })
    canvas.selection = editModeRef.current
    canvas.requestRenderAll()
  }, [])

  const loadMapOnCanvas = useCallback(
    async (mapId: string | null) => {
      const canvas = canvasRef.current
      if (!canvas || !mapId) {
        return
      }
      const map = await db.maps.get(mapId)
      isHydratingRef.current = true
      canvas.clear()
      canvas.backgroundColor = '#0c0f16'
      canvas.setDimensions({ width: DEFAULT_CANVAS_WIDTH, height: DEFAULT_CANVAS_HEIGHT })
      if (map?.json) {
        await canvas.loadFromJSON(map.json)
      }
      applyModeToObjects()
      canvas.requestRenderAll()
      isHydratingRef.current = false
    },
    [applyModeToObjects],
  )

  const setupInitialState = useCallback(async () => {
    const [assetRows, mapRows] = await Promise.all([
      db.assets.orderBy('createdAt').toArray(),
      db.maps.orderBy('position').toArray(),
    ])
    setAssets(assetRows)
    if (mapRows.length === 0) {
      const now = Date.now()
      const initialMap: MapRecord = {
        id: uid('map'),
        name: 'Mapa 1',
        position: 0,
        json: null,
        createdAt: now,
        updatedAt: now,
      }
      await db.maps.add(initialMap)
      setMaps([initialMap])
      setCurrentMapId(initialMap.id)
      return
    }
    setMaps(mapRows)
    setCurrentMapId(mapRows[0].id)
  }, [])

  useEffect(() => {
    void setupInitialState()
  }, [setupInitialState])

  useEffect(() => {
    if (!htmlCanvasRef.current || canvasRef.current) {
      return
    }
    const canvas = new Canvas(htmlCanvasRef.current, {
      selection: true,
      backgroundColor: '#0c0f16',
      preserveObjectStacking: true,
    })
    canvasRef.current = canvas

    const onMouseOver = (event: { target?: FabricObject }) => {
      if (!event.target) {
        return
      }
      event.target.set(
        'shadow',
        new Shadow({
          color: 'rgba(255,246,223,0.95)',
          blur: 28,
          offsetX: 0,
          offsetY: 0,
        }),
      )
      canvas.requestRenderAll()
    }

    const onMouseOut = (event: { target?: FabricObject }) => {
      if (!event.target) {
        return
      }
      event.target.set('shadow', null)
      canvas.requestRenderAll()
    }

    const onSelectionUpdate = () => {
      if (!editModeRef.current) {
        setSelectedObject(null)
        return
      }
      const active = canvas.getActiveObject()
      if (!active) {
        setSelectedObject(null)
        return
      }
      setSelectedObject(active)
      setSelectedData(getStructureData(active))
    }

    const onSelectionClear = () => {
      setSelectedObject(null)
    }

    const onObjectModified = () => {
      void persistCurrentMap()
    }

    const onMouseDown = async (event: { target?: FabricObject; e: MouseEvent }) => {
      if (editModeRef.current && stampAssetIdRef.current) {
        if (event.target) {
          return
        }
        const selectedAsset = assetsRef.current.find((asset) => asset.id === stampAssetIdRef.current)
        if (!selectedAsset) {
          return
        }
        const pointer = canvas.getScenePoint(event.e)
        const image = await FabricImage.fromURL(selectedAsset.dataUrl, {
          crossOrigin: 'anonymous',
        })
        const scale = LIBRARY_FIT_SIZE / Math.max(image.width ?? 1, image.height ?? 1)
        image.set({
          left: pointer.x,
          top: pointer.y,
          originX: 'center',
          originY: 'center',
          scaleX: scale,
          scaleY: scale,
          hasControls: true,
          hasBorders: true,
          cornerColor: '#e8a94a',
          cornerStrokeColor: '#151a24',
          borderColor: '#e8a94a',
          transparentCorners: false,
          cornerStyle: 'circle',
          cornerSize: 9,
          data: { title: selectedAsset.name, description: '', link: '' } as StructureMeta,
        })
        canvas.add(image)
        canvas.setActiveObject(image)
        canvas.requestRenderAll()
        setSelectedObject(image)
        setSelectedData(getStructureData(image))
        void persistCurrentMap()
        return
      }

      if (!editModeRef.current && event.target) {
        const data = getStructureData(event.target)
        setModalContent({
          title: data.title || 'Estrutura sem nome',
          description: data.description || '(sem descrição registrada)',
          link: data.link,
        })
      }
    }

    canvas.on('mouse:over', onMouseOver)
    canvas.on('mouse:out', onMouseOut)
    canvas.on('selection:created', onSelectionUpdate)
    canvas.on('selection:updated', onSelectionUpdate)
    canvas.on('selection:cleared', onSelectionClear)
    canvas.on('object:modified', onObjectModified)
    canvas.on('mouse:down', (event) => {
      void onMouseDown(event as { target?: FabricObject; e: MouseEvent })
    })

    return () => {
      canvas.dispose()
      canvasRef.current = null
    }
  }, [persistCurrentMap])

  useEffect(() => {
    void loadMapOnCanvas(currentMapId)
  }, [currentMapId, loadMapOnCanvas])

  useEffect(() => {
    applyModeToObjects()
    if (!editMode) {
      setStampAssetId(null)
      canvasRef.current?.discardActiveObject()
      setSelectedObject(null)
    }
  }, [applyModeToObjects, editMode])

  const handleAssetUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? [])
      if (files.length === 0) {
        return
      }
      const uploaded = await Promise.all(
        files.map(async (file): Promise<AssetRecord> => ({
          id: uid('asset'),
          name: file.name.replace(/\.[^.]+$/, ''),
          dataUrl: await fileToDataURL(file),
          createdAt: Date.now(),
        })),
      )
      await db.assets.bulkAdd(uploaded)
      setAssets((prev) => [...prev, ...uploaded])
      event.target.value = ''
    },
    [],
  )

  const setBackground = useCallback(
    async (file: File) => {
      const canvas = canvasRef.current
      if (!canvas) {
        return
      }
      const dataUrl = await fileToDataURL(file)
      const background = await FabricImage.fromURL(dataUrl, {
        crossOrigin: 'anonymous',
      })
      const width = background.width ?? DEFAULT_CANVAS_WIDTH
      const height = background.height ?? DEFAULT_CANVAS_HEIGHT
      const scale = Math.min(MAX_BACKGROUND_WIDTH / width, MAX_BACKGROUND_HEIGHT / height, 1)
      background.set({
        originX: 'left',
        originY: 'top',
        left: 0,
        top: 0,
        scaleX: scale,
        scaleY: scale,
        selectable: false,
        evented: false,
      })
      canvas.setDimensions({ width: width * scale, height: height * scale })
      canvas.backgroundImage = background
      canvas.requestRenderAll()
      await persistCurrentMap()
    },
    [persistCurrentMap],
  )

  const handleBackgroundUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) {
        return
      }
      await setBackground(file)
      event.target.value = ''
    },
    [setBackground],
  )

  const addMapTab = useCallback(async () => {
    await persistCurrentMap()
    const now = Date.now()
    const next: MapRecord = {
      id: uid('map'),
      name: `Mapa ${maps.length + 1}`,
      position: maps.length,
      json: null,
      createdAt: now,
      updatedAt: now,
    }
    await db.maps.add(next)
    setMaps((prev) => [...prev, next])
    setCurrentMapId(next.id)
  }, [maps.length, persistCurrentMap])

  const switchTab = useCallback(
    async (id: string) => {
      if (id === currentMapIdRef.current) {
        return
      }
      await persistCurrentMap()
      setCurrentMapId(id)
      setSelectedObject(null)
    },
    [persistCurrentMap],
  )

  const closeTab = useCallback(
    async (id: string) => {
      if (maps.length <= 1) {
        return
      }
      const sorted = [...maps].sort((a, b) => a.position - b.position)
      const index = sorted.findIndex((map) => map.id === id)
      if (index === -1) {
        return
      }
      if (currentMapIdRef.current === id) {
        await persistCurrentMap()
      }
      const nextCurrent = currentMapIdRef.current === id ? sorted[Math.max(0, index - 1)].id : currentMapIdRef.current
      const remaining = sorted.filter((map) => map.id !== id).map((map, position) => ({ ...map, position }))
      await db.transaction('rw', db.maps, async () => {
        await db.maps.delete(id)
        for (const map of remaining) {
          await db.maps.update(map.id, { position: map.position })
        }
      })
      setMaps(remaining)
      setCurrentMapId(nextCurrent ?? remaining[0]?.id ?? null)
      setSelectedObject(null)
    },
    [maps, persistCurrentMap],
  )

  const saveInspector = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas || !selectedObject) {
      return
    }
    selectedObject.set('data', selectedData)
    canvas.requestRenderAll()
    await persistCurrentMap()
  }, [persistCurrentMap, selectedData, selectedObject])

  const removeSelectedObject = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas || !selectedObject) {
      return
    }
    canvas.remove(selectedObject)
    setSelectedObject(null)
    await persistCurrentMap()
  }, [persistCurrentMap, selectedObject])

  return (
    <>
      <header className="topbar">
        <div className="brand">Neverending Fantasy Map Studio</div>
        <div className="tabs">
          {sortedMaps.map((map) => (
            <button
              type="button"
              className={`tab ${map.id === currentMapId ? 'active' : ''}`}
              key={map.id}
              onClick={() => {
                void switchTab(map.id)
              }}
            >
              <span>{map.name}</span>
              {sortedMaps.length > 1 ? (
                <span
                  className="close-tab"
                  onClick={(event) => {
                    event.stopPropagation()
                    void closeTab(map.id)
                  }}
                  aria-label={`Fechar ${map.name}`}
                >
                  ✕
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <button type="button" className="tab-add" title="Novo mapa" onClick={() => void addMapTab()}>
          +
        </button>
        <div className="mode-toggle">
          <button
            type="button"
            className={editMode ? 'active' : ''}
            onClick={() => setEditMode(true)}
          >
            ✎ Edição
          </button>
          <button
            type="button"
            className={!editMode ? 'active' : ''}
            onClick={() => setEditMode(false)}
          >
            ▶ Visualização
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-head">
            <span>Estruturas</span>
            <button
              type="button"
              className="collapse-btn"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
            >
              {sidebarCollapsed ? '›' : '‹'}
            </button>
          </div>
          <div className="asset-body">
            <label className="upload-btn">
              + Carregar estrutura
              <input type="file" accept="image/*" multiple hidden onChange={handleAssetUpload} />
            </label>
            <div className="asset-grid">
              {assets.map((asset) => (
                <button
                  type="button"
                  className={`asset-item ${asset.id === stampAssetId ? 'selected' : ''}`}
                  key={asset.id}
                  title="Clique e depois clique no mapa para posicionar"
                  onClick={() =>
                    setStampAssetId((current) => (current === asset.id ? null : asset.id))
                  }
                >
                  <img src={asset.dataUrl} alt={asset.name} />
                  <div className="label">{asset.name}</div>
                </button>
              ))}
            </div>
            {assets.length === 0 ? (
              <div className="asset-empty">
                Nenhuma estrutura ainda.
                <br />
                Envie casas, torres, fogueiras...
              </div>
            ) : null}
            <div className={`stamp-hint ${stampAssetId ? 'active' : ''}`}>
              🖌️ Modo carimbo ativo — clique no mapa para posicionar.
            </div>
          </div>
        </aside>

        <main className={`map-area ${stampAssetId ? 'stamping' : ''}`}>
          <label className="bg-upload-fab">
            🗺️ Carregar plano de fundo
            <input type="file" accept="image/*" hidden onChange={handleBackgroundUpload} />
          </label>
          <div className="canvas-frame">
            <canvas
              id="mapCanvas"
              width={DEFAULT_CANVAS_WIDTH}
              height={DEFAULT_CANVAS_HEIGHT}
              ref={htmlCanvasRef}
            />
          </div>
          <div className="hint-footer">
            Passe o mouse sobre uma estrutura para destacá-la · clique em modo Visualização para
            abrir
          </div>
        </main>

        <aside className={`inspector ${selectedObject && editMode ? 'visible' : ''}`}>
          <h3>Propriedades</h3>
          {selectedObject && editMode ? (
            <>
              <div className="field">
                <label htmlFor="fieldTitle">Título</label>
                <input
                  id="fieldTitle"
                  type="text"
                  value={selectedData.title}
                  placeholder="Ex: Igreja Abandonada"
                  onChange={(event) =>
                    setSelectedData((prev) => ({ ...prev, title: event.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="fieldDescription">Descrição / Notas do Mestre (Markdown)</label>
                <textarea
                  id="fieldDescription"
                  value={selectedData.description}
                  placeholder="Detalhes, lore, gatilhos de narrativa..."
                  onChange={(event) =>
                    setSelectedData((prev) => ({ ...prev, description: event.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="fieldLink">Link externo (opcional)</label>
                <input
                  id="fieldLink"
                  type="url"
                  value={selectedData.link}
                  placeholder="https://..."
                  onChange={(event) =>
                    setSelectedData((prev) => ({ ...prev, link: event.target.value }))
                  }
                />
              </div>
              <div className="inspector-actions">
                <button type="button" className="btn btn-save" onClick={() => void saveInspector()}>
                  Salvar
                </button>
                <button type="button" className="btn btn-delete" onClick={() => void removeSelectedObject()}>
                  Remover
                </button>
              </div>
            </>
          ) : (
            <p className="inspector-empty">Selecione uma estrutura no modo de edição.</p>
          )}
        </aside>
      </div>

      <div
        className={`modal-overlay ${modalContent ? 'visible' : ''}`}
        onClick={() => setModalContent(null)}
      >
        {modalContent ? (
          <div className="modal-scroll" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setModalContent(null)}>
              ✕
            </button>
            <h2 className="modal-title">{modalContent.title}</h2>
            <div
              className="modal-desc"
              dangerouslySetInnerHTML={{ __html: markdownToHtml(modalContent.description) }}
            />
            {isSafeUrl(modalContent.link) ? (
              <a className="modal-link" href={modalContent.link} target="_blank" rel="noopener noreferrer">
                Abrir link ↗
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  )
}

export default App
