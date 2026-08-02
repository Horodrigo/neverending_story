import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Canvas, FabricImage, FabricObject, Shadow } from 'fabric'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { db } from './db'
import type {
  AssetRecord,
  BookRecord,
  MapRecord,
  ModalContent,
  StructureMeta,
} from './types'

type AppScreen = 'home' | 'narrator' | 'player' | 'about' | 'studio'

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

function createInitialMap(bookId: string, name = 'Mapa 1'): MapRecord {
  const now = Date.now()
  return {
    id: uid('map'),
    bookId,
    name,
    position: 0,
    json: null,
    createdAt: now,
    updatedAt: now,
  }
}

function App() {
  const htmlCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasRef = useRef<Canvas | null>(null)
  const isHydratingRef = useRef(false)
  const currentMapIdRef = useRef<string | null>(null)
  const editModeRef = useRef(true)
  const stampAssetIdRef = useRef<string | null>(null)
  const assetsRef = useRef<AssetRecord[]>([])

  const [screen, setScreen] = useState<AppScreen>('home')
  const [assets, setAssets] = useState<AssetRecord[]>([])
  const [books, setBooks] = useState<BookRecord[]>([])
  const [maps, setMaps] = useState<MapRecord[]>([])
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null)
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

  const sortedBooks = useMemo(
    () => [...books].sort((left, right) => right.updatedAt - left.updatedAt),
    [books],
  )

  const currentBook = useMemo(
    () => books.find((book) => book.id === selectedBookId) ?? null,
    [books, selectedBookId],
  )

  const bookMaps = useMemo(
    () =>
      maps
        .filter((map) => map.bookId === selectedBookId)
        .sort((left, right) => left.position - right.position),
    [maps, selectedBookId],
  )

  const playerBooks = useMemo(
    () =>
      sortedBooks.map((book) => ({
        ...book,
        mapCount: maps.filter((map) => map.bookId === book.id).length,
      })),
    [maps, sortedBooks],
  )

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    canvas.clear()
    canvas.backgroundColor = '#0c0f16'
    canvas.setDimensions({
      width: DEFAULT_CANVAS_WIDTH,
      height: DEFAULT_CANVAS_HEIGHT,
    })
    canvas.requestRenderAll()
  }, [])

  const persistCurrentMap = useCallback(async () => {
    const mapId = currentMapIdRef.current
    const canvas = canvasRef.current
    if (!mapId || !canvas || isHydratingRef.current) {
      return
    }

    const now = Date.now()
    const json = JSON.stringify(canvas.toJSON())
    await db.maps.update(mapId, { json, updatedAt: now })
    if (selectedBookId) {
      await db.books.update(selectedBookId, { updatedAt: now })
    }

    setMaps((previous) =>
      previous.map((map) => (map.id === mapId ? { ...map, json, updatedAt: now } : map)),
    )
    if (selectedBookId) {
      setBooks((previous) =>
        previous.map((book) =>
          book.id === selectedBookId ? { ...book, updatedAt: now } : book,
        ),
      )
    }
  }, [selectedBookId])

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
      if (!canvas) {
        return
      }

      if (!mapId) {
        clearCanvas()
        return
      }

      const map = await db.maps.get(mapId)
      isHydratingRef.current = true
      clearCanvas()

      if (map?.json) {
        await canvas.loadFromJSON(map.json)
      }

      applyModeToObjects()
      canvas.requestRenderAll()
      isHydratingRef.current = false
    },
    [applyModeToObjects, clearCanvas],
  )

  const setupInitialState = useCallback(async () => {
    const [assetRows, bookRows, mapRows] = await Promise.all([
      db.assets.orderBy('createdAt').toArray(),
      db.books.orderBy('updatedAt').reverse().toArray(),
      db.maps.orderBy('position').toArray(),
    ])

    setAssets(assetRows)
    setBooks(bookRows)
    setMaps(mapRows)

    if (bookRows.length > 0) {
      const initialBookId = bookRows[0].id
      setSelectedBookId(initialBookId)
      const initialBookMap = mapRows
        .filter((map) => map.bookId === initialBookId)
        .sort((left, right) => left.position - right.position)[0]
      setCurrentMapId(initialBookMap?.id ?? null)
    }
  }, [])

  useEffect(() => {
    void setupInitialState()
  }, [setupInitialState])

  useEffect(() => {
    if (screen !== 'studio') {
      return
    }

    if (bookMaps.length === 0) {
      setCurrentMapId(null)
      return
    }

    if (!currentMapId || !bookMaps.some((map) => map.id === currentMapId)) {
      setCurrentMapId(bookMaps[0].id)
    }
  }, [bookMaps, currentMapId, screen])

  useEffect(() => {
    if (!htmlCanvasRef.current || canvasRef.current || screen !== 'studio') {
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

      const activeObject = canvas.getActiveObject()
      if (!activeObject) {
        setSelectedObject(null)
        return
      }

      setSelectedObject(activeObject)
      setSelectedData(getStructureData(activeObject))
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

        const selectedAsset = assetsRef.current.find(
          (asset) => asset.id === stampAssetIdRef.current,
        )
        if (!selectedAsset) {
          return
        }

        const pointer = canvas.getScenePoint(event.e)
        const image = await FabricImage.fromURL(selectedAsset.dataUrl, {
          crossOrigin: 'anonymous',
        })
        const scale =
          LIBRARY_FIT_SIZE / Math.max(image.width ?? LIBRARY_FIT_SIZE, image.height ?? LIBRARY_FIT_SIZE)

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
  }, [persistCurrentMap, screen])

  useEffect(() => {
    if (screen !== 'studio') {
      return
    }

    void loadMapOnCanvas(currentMapId)
  }, [currentMapId, loadMapOnCanvas, screen])

  useEffect(() => {
    if (screen !== 'studio') {
      return
    }

    applyModeToObjects()
    if (!editMode) {
      setStampAssetId(null)
      canvasRef.current?.discardActiveObject()
      setSelectedObject(null)
    }
  }, [applyModeToObjects, editMode, screen])

  const handleAssetUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) {
      return
    }

    const uploaded = await Promise.all(
      files.map(
        async (file): Promise<AssetRecord> => ({
          id: uid('asset'),
          name: file.name.replace(/\.[^.]+$/, ''),
          dataUrl: await fileToDataURL(file),
          createdAt: Date.now(),
        }),
      ),
    )

    await db.assets.bulkAdd(uploaded)
    setAssets((previous) => [...previous, ...uploaded])
    event.target.value = ''
  }, [])

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
      const scale = Math.min(
        MAX_BACKGROUND_WIDTH / width,
        MAX_BACKGROUND_HEIGHT / height,
        1,
      )

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

      canvas.setDimensions({
        width: width * scale,
        height: height * scale,
      })
      canvas.backgroundImage = background
      canvas.requestRenderAll()
      await persistCurrentMap()
    },
    [persistCurrentMap],
  )

  const handleBackgroundUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) {
        return
      }

      await setBackground(file)
      event.target.value = ''
    },
    [setBackground],
  )

  const openBook = useCallback(
    async (bookId: string) => {
      await persistCurrentMap()
      setSelectedBookId(bookId)
      setScreen('studio')
      setEditMode(true)
      setStampAssetId(null)
      setModalContent(null)
      setSelectedObject(null)

      const nextMap = maps
        .filter((map) => map.bookId === bookId)
        .sort((left, right) => left.position - right.position)[0]
      setCurrentMapId(nextMap?.id ?? null)
    },
    [maps, persistCurrentMap],
  )

  const createBook = useCallback(async () => {
    const now = Date.now()
    const nextBook: BookRecord = {
      id: uid('book'),
      name: `Livro ${books.length + 1}`,
      description: 'Novo livro de mapas para uma campanha em construção.',
      createdAt: now,
      updatedAt: now,
    }
    const nextMap = createInitialMap(nextBook.id)

    await db.transaction('rw', db.books, db.maps, async () => {
      await db.books.add(nextBook)
      await db.maps.add(nextMap)
    })

    setBooks((previous) => [nextBook, ...previous])
    setMaps((previous) => [...previous, nextMap])
    setSelectedBookId(nextBook.id)
    setCurrentMapId(nextMap.id)
    setScreen('studio')
    setEditMode(true)
    setStampAssetId(null)
    setSelectedObject(null)
  }, [books.length])

  const addMapTab = useCallback(async () => {
    if (!selectedBookId) {
      return
    }

    await persistCurrentMap()
    const now = Date.now()
    const nextMap: MapRecord = {
      id: uid('map'),
      bookId: selectedBookId,
      name: `Mapa ${bookMaps.length + 1}`,
      position: bookMaps.length,
      json: null,
      createdAt: now,
      updatedAt: now,
    }

    await db.maps.add(nextMap)
    await db.books.update(selectedBookId, { updatedAt: now })
    setMaps((previous) => [...previous, nextMap])
    setBooks((previous) =>
      previous.map((book) =>
        book.id === selectedBookId ? { ...book, updatedAt: now } : book,
      ),
    )
    setCurrentMapId(nextMap.id)
  }, [bookMaps.length, persistCurrentMap, selectedBookId])

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
      if (bookMaps.length <= 1) {
        return
      }

      const index = bookMaps.findIndex((map) => map.id === id)
      if (index === -1) {
        return
      }

      if (currentMapIdRef.current === id) {
        await persistCurrentMap()
      }

      const nextCurrentMapId =
        currentMapIdRef.current === id
          ? bookMaps[Math.max(0, index - 1)].id
          : currentMapIdRef.current
      const remainingMaps = bookMaps
        .filter((map) => map.id !== id)
        .map((map, position) => ({ ...map, position }))

      await db.transaction('rw', db.maps, async () => {
        await db.maps.delete(id)
        for (const map of remainingMaps) {
          await db.maps.update(map.id, { position: map.position })
        }
      })

      setMaps((previous) => [
        ...previous.filter((map) => map.bookId !== selectedBookId),
        ...remainingMaps,
      ])
      setCurrentMapId(nextCurrentMapId ?? remainingMaps[0]?.id ?? null)
      setSelectedObject(null)
    },
    [bookMaps, persistCurrentMap, selectedBookId],
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

  const goToNarrator = useCallback(async () => {
    await persistCurrentMap()
    setScreen('narrator')
    setStampAssetId(null)
    setSelectedObject(null)
    setModalContent(null)
  }, [persistCurrentMap])

  const renderHome = () => (
    <main className="shell home-shell">
      <section className="home-hero">
        <p className="eyebrow">Neverending Fantasy Map Studio</p>
        <h1>Escolha como deseja entrar no livro de mapas.</h1>
        <p className="home-copy">
          Organize histórias como narrador, visualize campanhas como jogador ou consulte
          informações técnicas do projeto.
        </p>
        <div className="home-actions">
          <button type="button" className="portal-card" onClick={() => setScreen('narrator')}>
            <span className="portal-title">Narrador</span>
            <span className="portal-copy">
              Acesse seus livros de mapas, crie novas histórias e edite cada mapa da campanha.
            </span>
          </button>
          <button type="button" className="portal-card" onClick={() => setScreen('player')}>
            <span className="portal-title">Jogador</span>
            <span className="portal-copy">
              Veja os livros compartilhados em modo somente leitura. O fluxo de acesso será
              detalhado futuramente.
            </span>
          </button>
          <button type="button" className="portal-card" onClick={() => setScreen('about')}>
            <span className="portal-title">Sobre</span>
            <span className="portal-copy">
              Informações essenciais do projeto, autoria, licença e contexto técnico.
            </span>
          </button>
        </div>
      </section>
    </main>
  )

  const renderNarrator = () => (
    <main className="shell screen-shell">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Narrador</p>
          <h2>Livros de mapas criados</h2>
          <p className="screen-copy">
            Gerencie os livros da campanha e abra cada coleção de mapas para edição.
          </p>
        </div>
        <div className="screen-actions">
          <button type="button" className="ghost-button" onClick={() => setScreen('home')}>
            Voltar
          </button>
          <button type="button" className="primary-button" onClick={() => void createBook()}>
            Novo livro
          </button>
        </div>
      </header>

      {sortedBooks.length === 0 ? (
        <section className="empty-state">
          <h3>Iniciar criação de histórias</h3>
          <p>
            Nenhum livro foi criado ainda. Comece um novo volume para reunir mapas, locais e
            anotações da sua campanha.
          </p>
          <button type="button" className="primary-button" onClick={() => void createBook()}>
            Criar primeiro livro
          </button>
        </section>
      ) : (
        <section className="book-grid">
          {sortedBooks.map((book) => {
            const mapCount = maps.filter((map) => map.bookId === book.id).length
            return (
              <article className="book-card" key={book.id}>
                <p className="book-meta">
                  {mapCount} {mapCount === 1 ? 'mapa' : 'mapas'}
                </p>
                <h3>{book.name}</h3>
                <p>{book.description}</p>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void openBook(book.id)}
                >
                  Abrir livro
                </button>
              </article>
            )
          })}
        </section>
      )}
    </main>
  )

  const renderPlayer = () => (
    <main className="shell screen-shell">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Jogador</p>
          <h2>Livros acessiveis em modo visualização</h2>
          <p className="screen-copy">
            Esta tela prepara o fluxo de leitura do jogador. Por enquanto ela exibe apenas a
            estrutura visual da listagem.
          </p>
        </div>
        <button type="button" className="ghost-button" onClick={() => setScreen('home')}>
          Voltar
        </button>
      </header>

      {playerBooks.length === 0 ? (
        <section className="empty-state">
          <h3>Nenhum livro disponivel</h3>
          <p>Quando houver compartilhamento configurado, os livros liberados para jogadores aparecerão aqui.</p>
        </section>
      ) : (
        <section className="book-grid">
          {playerBooks.map((book) => (
            <article className="book-card muted" key={book.id}>
              <p className="book-meta">Somente leitura</p>
              <h3>{book.name}</h3>
              <p>
                {book.mapCount} {book.mapCount === 1 ? 'mapa visível' : 'mapas visíveis'} quando
                o compartilhamento for definido.
              </p>
              <button type="button" className="ghost-button" disabled>
                Em breve
              </button>
            </article>
          ))}
        </section>
      )}
    </main>
  )

  const renderAbout = () => (
    <main className="shell screen-shell">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Sobre</p>
          <h2>Informações técnicas</h2>
          <p className="screen-copy">Resumo público do projeto e da implementação atual.</p>
        </div>
        <button type="button" className="ghost-button" onClick={() => setScreen('home')}>
          Voltar
        </button>
      </header>

      <section className="about-grid">
        <article className="book-card">
          <h3>Projeto</h3>
          <p>Aplicação web para criação e navegação de livros de mapas de fantasia.</p>
        </article>
        <article className="book-card">
          <h3>Developer</h3>
          <p>Rodrigo Viana</p>
        </article>
        <article className="book-card">
          <h3>Licença</h3>
          <p>MIT License</p>
        </article>
        <article className="book-card">
          <h3>Tecnologias</h3>
          <p>React, TypeScript, Vite, Fabric.js, Dexie, IndexedDB e GitHub Pages.</p>
        </article>
      </section>
    </main>
  )

  const renderStudio = () => (
    <>
      <header className="topbar">
        <button type="button" className="ghost-button compact" onClick={() => void goToNarrator()}>
          ← Livros
        </button>
        <div className="brand">Neverending Fantasy Map Studio</div>
        <div className="book-badge">{currentBook?.name ?? 'Livro sem nome'}</div>
        <div className="tabs">
          {bookMaps.map((map) => (
            <button
              type="button"
              className={`tab ${map.id === currentMapId ? 'active' : ''}`}
              key={map.id}
              onClick={() => {
                void switchTab(map.id)
              }}
            >
              <span>{map.name}</span>
              {bookMaps.length > 1 ? (
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
              onClick={() => setSidebarCollapsed((previous) => !previous)}
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
                    setSelectedData((previous) => ({
                      ...previous,
                      title: event.target.value,
                    }))
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
                    setSelectedData((previous) => ({
                      ...previous,
                      description: event.target.value,
                    }))
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
                    setSelectedData((previous) => ({
                      ...previous,
                      link: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="inspector-actions">
                <button type="button" className="btn btn-save" onClick={() => void saveInspector()}>
                  Salvar
                </button>
                <button
                  type="button"
                  className="btn btn-delete"
                  onClick={() => void removeSelectedObject()}
                >
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
              <a
                className="modal-link"
                href={modalContent.link}
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir link ↗
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  )

  if (screen === 'home') {
    return renderHome()
  }

  if (screen === 'narrator') {
    return renderNarrator()
  }

  if (screen === 'player') {
    return renderPlayer()
  }

  if (screen === 'about') {
    return renderAbout()
  }

  return renderStudio()
}

export default App
