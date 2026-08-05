import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import { Canvas, FabricImage, FabricObject, Shadow } from 'fabric'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { db } from './db'
import {
  buildInviteUri,
  generateNewInviteToken,
  getOrCreateIdentity,
  signChallenge,
} from './crypto'
import type {
  AssetRecord,
  BookRecord,
  LocalAclRecord,
  LobbyInfo,
  MapRecord,
  ModalContent,
  NarratorRoomState,
  PendingJoin,
  PlayerIdentityRecord,
  PlayerJoinState,
  StructureMeta,
} from './types'

type AppScreen = 'home' | 'narrator' | 'player' | 'player-lobby-list' | 'about' | 'studio'
type StudioRole = 'narrator' | 'player'

interface SignalingAclEntry {
  displayName: string
  fingerprint: string
  publicKeyJwk: JsonWebKey
  country: string
  approvedAt: number
  revokedAt: number | null
}

const DEFAULT_CANVAS_WIDTH = 900
const DEFAULT_CANVAS_HEIGHT = 620
const MAX_BACKGROUND_WIDTH = 900
const MAX_BACKGROUND_HEIGHT = 620
const LIBRARY_FIT_SIZE = 90
const DEFAULT_SIGNALING_URL =
  typeof window !== 'undefined'
    ? `ws://${window.location.hostname || 'localhost'}:8787`
    : 'ws://localhost:8787'

function getInitialSignalingUrl(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_SIGNALING_URL
  }
  const fromQuery = new URL(window.location.href).searchParams.get('signaling')
  if (fromQuery && fromQuery.startsWith('ws')) {
    return fromQuery
  }
  return localStorage.getItem('mapstudio_signaling_url') ?? DEFAULT_SIGNALING_URL
}

if (!FabricObject.customProperties.includes('data')) {
  FabricObject.customProperties = [...FabricObject.customProperties, 'data']
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

function createBookSecrets() {
  return {
    hostSecret: `host_${Math.random().toString(36).slice(2, 12)}`,
    inviteToken: `invite_${Math.random().toString(36).slice(2, 14)}`,
    inviteUpdatedAt: Date.now(),
  }
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
    return { title: '', description: '' }
  }
  const data = object.get('data')
  if (!data || typeof data !== 'object') {
    return { title: '', description: '' }
  }
  const source = data as Partial<StructureMeta>
  return {
    title: source.title ?? '',
    description: source.description ?? '',
  }
}

function markdownToHtml(markdown: string): string {
  const rendered = marked.parse(markdown, { async: false }) as string
  return DOMPurify.sanitize(rendered)
}

function App() {
  const htmlCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasRef = useRef<Canvas | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const remoteStateRef = useRef<string | null>(null)
  const isHydratingRef = useRef(false)
  const currentMapIdRef = useRef<string | null>(null)
  const editModeRef = useRef(true)
  const stampAssetIdRef = useRef<string | null>(null)
  const assetsRef = useRef<AssetRecord[]>([])
  const studioRoleRef = useRef<StudioRole>('narrator')
  const persistCurrentMapRef = useRef<() => Promise<void>>(async () => {})

  const [screen, setScreen] = useState<AppScreen>('home')
  const [studioRole, setStudioRole] = useState<StudioRole>('narrator')
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
  })
  const [modalContent, setModalContent] = useState<ModalContent | null>(null)
  const [signalingUrl, setSignalingUrl] = useState(getInitialSignalingUrl)
  const [narratorRoomState, setNarratorRoomState] = useState<NarratorRoomState>({
    bookId: null,
    narratorName: 'Narrador',
    bookName: 'Livro Sem Nome',
    lobbyPassword: null,
    pendingJoins: [],
    aclEntries: [],
    isConnected: false,
    message: '',
  })

  const [playerJoinState, setPlayerJoinState] = useState<PlayerJoinState>({
    status: 'idle',
    message: '',
    selectedLobbyId: null,
    lobbyPassword: '',
    remoteMapJson: null,
  })
  const [playerDisplayName, setPlayerDisplayName] = useState('')
  const [playerIdentity, setPlayerIdentity] = useState<PlayerIdentityRecord | null>(null)
  const [latestInstallerVersion, setLatestInstallerVersion] = useState<string | null>(null)
  const [installerReleaseUrl, setInstallerReleaseUrl] = useState<string | null>(null)
  const [showUpdateNotice, setShowUpdateNotice] = useState(true)
  const [editingBookId, setEditingBookId] = useState<string | null>(null)
  const [editingBookName, setEditingBookName] = useState('')
  const [editingMapId, setEditingMapId] = useState<string | null>(null)
  const [editingMapName, setEditingMapName] = useState('')
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null)
  const [editingAssetName, setEditingAssetName] = useState('')
  const [notesPreview, setNotesPreview] = useState(false)
  const [lobbies, setLobbies] = useState<LobbyInfo[]>([])
  const [lobbiesLoading, setLobbiesLoading] = useState(false)
  const [expandedBookId, setExpandedBookId] = useState<string | null>(null)
  const [zoomLevel, setZoomLevel] = useState(100)

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

  useEffect(() => {
    studioRoleRef.current = studioRole
    // Force editMode to false when studioRole is 'player'
    if (studioRole === 'player') {
      setEditMode(false)
    }
  }, [studioRole])

  useEffect(() => {
    remoteStateRef.current = playerJoinState.remoteMapJson
  }, [playerJoinState.remoteMapJson])

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

  const hasUpdateAvailable = useMemo(() => {
    if (!latestInstallerVersion || !showUpdateNotice) {
      return false
    }
    const latestInstallerMatch = /^installer-(\d+)$/i.exec(latestInstallerVersion)
    const currentInstallerBuildIdRaw = __INSTALLER_BUILD_ID__.trim()
    if (latestInstallerMatch && /^\d+$/.test(currentInstallerBuildIdRaw)) {
      return Number(latestInstallerMatch[1]) > Number(currentInstallerBuildIdRaw)
    }
    if (latestInstallerMatch) {
      return false
    }
    return latestInstallerVersion !== __APP_VERSION__
  }, [latestInstallerVersion, showUpdateNotice])

  const fetchLobbies = useCallback(async () => {
    try {
      const httpUrl = signalingUrl.replace(/^ws/, 'http')
      const response = await fetch(`${httpUrl}/api/lobbies`)
      if (response.ok) {
        const data = (await response.json()) as LobbyInfo[]
        setLobbies(data)
      }
    } catch {
      console.error('Failed to fetch lobbies')
    }
  }, [signalingUrl])

  useEffect(() => {
    localStorage.setItem('mapstudio_signaling_url', signalingUrl)
  }, [signalingUrl])

  useEffect(() => {
    if (screen !== 'player') {
      return
    }
    const invite = new URL(window.location.href).searchParams.get('invite')
    if (invite && !playerJoinState.lobbyPassword) {
      setPlayerJoinState(prev => ({ ...prev, lobbyPassword: invite }))
    }
  }, [playerJoinState.lobbyPassword, screen])

  useEffect(() => {
    if (screen !== 'player-lobby-list') {
      return
    }
    setLobbiesLoading(true)
    void fetchLobbies().then(() => setLobbiesLoading(false))
    const interval = setInterval(
      () => {
        void fetchLobbies()
      },
      3000,
    )
    return () => clearInterval(interval)
  }, [fetchLobbies, screen])

  useEffect(() => {
    let cancelled = false
    const releaseRepo = __INSTALLER_RELEASE_REPO__
    void fetch(`https://api.github.com/repos/${releaseRepo}/releases/latest`)
      .then(async (response) => {
        if (!response.ok) {
          return null
        }
        return (await response.json()) as {
          tag_name?: string
          html_url?: string
        }
      })
      .then((release) => {
        if (!release || cancelled) {
          return
        }
        const tag = release.tag_name ?? ''
        const normalized = tag.replace(/^v/i, '')
        setInstallerReleaseUrl(release.html_url ?? null)
        setLatestInstallerVersion(normalized || null)
      })
      .catch(() => {
        setLatestInstallerVersion(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

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

  const sendNarratorState = useCallback(
    (mapJson: string, mapId: string) => {
      if (studioRoleRef.current !== 'narrator') {
        return
      }
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN || !selectedBookId || !currentBook) {
        return
      }
      if (narratorRoomState.bookId !== selectedBookId) {
        return
      }
      ws.send(
        JSON.stringify({
          type: 'narrator:state-update',
          bookId: selectedBookId,
          hostSecret: currentBook.hostSecret,
          state: {
            mapId,
            mapJson,
            updatedAt: Date.now(),
          },
        }),
      )
    },
    [narratorRoomState.bookId, currentBook, selectedBookId],
  )

  const persistCurrentMap = useCallback(async () => {
    if (studioRoleRef.current !== 'narrator') {
      return
    }
    const mapId = currentMapIdRef.current
    const canvas = canvasRef.current
    if (!mapId || !canvas || isHydratingRef.current) {
      return
    }

    const now = Date.now()
    const canvasJson = canvas.toJSON()
    const mapData = {
      canvasJson,
      width: canvas.width,
      height: canvas.height,
    }
    const json = JSON.stringify(mapData)
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
    sendNarratorState(json, mapId)
  }, [selectedBookId, sendNarratorState])

  useEffect(() => {
    persistCurrentMapRef.current = persistCurrentMap
  }, [persistCurrentMap])

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

  const applyZoom = useCallback((level: number) => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const zoomFactor = level / 100
    canvas.setZoom(zoomFactor)
    canvas.requestRenderAll()
  }, [])

  const handleZoom = useCallback((direction: 'in' | 'out') => {
    setZoomLevel((current) => {
      const zoomLevels = [50, 75, 100, 125, 150, 200]
      const currentIndex = zoomLevels.indexOf(current)
      let newLevel = current

      if (direction === 'in') {
        const nextIndex = currentIndex + 1
        newLevel = nextIndex < zoomLevels.length ? zoomLevels[nextIndex] : zoomLevels[zoomLevels.length - 1]
      } else {
        const prevIndex = currentIndex - 1
        newLevel = prevIndex >= 0 ? zoomLevels[prevIndex] : zoomLevels[0]
      }

      applyZoom(newLevel)
      return newLevel
    })
  }, [applyZoom])

  const loadMapOnCanvas = useCallback(
    async (mapId: string | null) => {
      const canvas = canvasRef.current
      if (!canvas) {
        return
      }
      isHydratingRef.current = true
      clearCanvas()

      if (studioRoleRef.current === 'player') {
        if (remoteStateRef.current) {
          try {
            const parsed = JSON.parse(remoteStateRef.current)
            const canvasJson = parsed.canvasJson || parsed
            const width = parsed.width || DEFAULT_CANVAS_WIDTH
            const height = parsed.height || DEFAULT_CANVAS_HEIGHT
            await canvas.loadFromJSON(canvasJson)
            canvas.setDimensions({ width, height })
          } catch {
            setPlayerJoinState(prev => ({ ...prev, message: 'Falha ao carregar estado recebido do narrador.' }))
          }
        }
        applyModeToObjects()
        applyZoom(100)
        setZoomLevel(100)
        canvas.requestRenderAll()
        isHydratingRef.current = false
        return
      }

      if (!mapId) {
        isHydratingRef.current = false
        return
      }
      const map = await db.maps.get(mapId)
      if (map?.json) {
        try {
          const parsed = JSON.parse(map.json)
          const canvasJson = parsed.canvasJson || parsed
          const width = parsed.width || DEFAULT_CANVAS_WIDTH
          const height = parsed.height || DEFAULT_CANVAS_HEIGHT
          await canvas.loadFromJSON(canvasJson)
          canvas.setDimensions({ width, height })
        } catch {
          setNarratorRoomState(prev => ({ ...prev, message: 'Falha ao carregar mapa salvo localmente.' }))
        }
      }
      applyModeToObjects()
      applyZoom(100)
      setZoomLevel(100)
      canvas.requestRenderAll()
      isHydratingRef.current = false
    },
    [applyModeToObjects, applyZoom, clearCanvas],
  )

  const setupInitialState = useCallback(async () => {
    const [assetRows, bookRows, mapRows] = await Promise.all([
      db.assets.orderBy('createdAt').toArray(),
      db.books.orderBy('updatedAt').reverse().toArray(),
      db.maps.orderBy('position').toArray(),
    ])

    setAssets(assetRows)
    setBooks(
      bookRows.map((book) => ({
        ...book,
        hostSecret: book.hostSecret || createBookSecrets().hostSecret,
        inviteToken: book.inviteToken || createBookSecrets().inviteToken,
        inviteUpdatedAt: book.inviteUpdatedAt || Date.now(),
      })),
    )
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
    if (!selectedBookId || studioRole !== 'narrator') {
      setNarratorRoomState(prev => ({ ...prev, aclEntries: [] }))
      return
    }
    void db.localAcl
      .where('bookId')
      .equals(selectedBookId)
      .toArray()
      .then((entries) =>
        setNarratorRoomState(prev => ({ ...prev, aclEntries: entries.sort((left, right) => right.approvedAt - left.approvedAt) })),
      )
  }, [selectedBookId, studioRole])

  useEffect(() => {
    if (screen !== 'studio') {
      return
    }
    if (studioRole === 'narrator') {
      if (bookMaps.length === 0) {
        setCurrentMapId(null)
        return
      }
      if (!currentMapId || !bookMaps.some((map) => map.id === currentMapId)) {
        setCurrentMapId(bookMaps[0].id)
      }
    }
  }, [bookMaps, currentMapId, screen, studioRole])

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
      void persistCurrentMapRef.current()
    }

    const onMouseDown = async (event: { target?: FabricObject; e: MouseEvent }) => {
      if (studioRoleRef.current === 'player') {
        if (event.target) {
          const data = getStructureData(event.target)
          setModalContent({
            title: data.title || 'Estrutura sem nome',
            description: data.description || '(sem descrição registrada)',
          })
        }
        return
      }

      if (editModeRef.current && stampAssetIdRef.current) {
        const canvasBackground = canvas.backgroundImage as FabricObject | undefined
        if (event.target && event.target !== canvasBackground) {
          return
        }
        const selectedAsset = assetsRef.current.find(
          (asset) => asset.id === stampAssetIdRef.current,
        )
        if (!selectedAsset) {
          return
        }

        if (typeof canvas.getScenePoint !== 'function') {
          return
        }
        const pointer = canvas.getScenePoint(event.e)
        const image = await FabricImage.fromURL(selectedAsset.dataUrl, {
          crossOrigin: 'anonymous',
        })
        const scale =
          LIBRARY_FIT_SIZE /
          Math.max(image.width ?? LIBRARY_FIT_SIZE, image.height ?? LIBRARY_FIT_SIZE)
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
          data: { title: selectedAsset.name, description: '' } as StructureMeta,
        })
        canvas.add(image)
        canvas.setActiveObject(image)
        canvas.requestRenderAll()
        setSelectedObject(image)
        setSelectedData(getStructureData(image))
        void persistCurrentMapRef.current()
        return
      }

      if (!editModeRef.current && event.target) {
        const data = getStructureData(event.target)
        setModalContent({
          title: data.title || 'Estrutura sem nome',
          description: data.description || '(sem descrição registrada)',
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
  }, [screen])

  useEffect(() => {
    if (screen !== 'studio') {
      return
    }
    void loadMapOnCanvas(currentMapId)
  }, [currentMapId, loadMapOnCanvas, playerJoinState.remoteMapJson, screen, studioRole])

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

  const closeSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setNarratorRoomState(prev => ({ ...prev, bookId: null }))
    setNarratorRoomState(prev => ({ ...prev, pendingJoins: [] }))
  }, [])

  const applyAclUpdate = useCallback(
    async (bookId: string, acl: SignalingAclEntry[]) => {
      const now = Date.now()
      const localEntries: LocalAclRecord[] = acl.map((entry) => ({
        id: `${bookId}_${entry.fingerprint}`,
        bookId,
        displayName: entry.displayName,
        fingerprint: entry.fingerprint,
        publicKeyJwk: entry.publicKeyJwk,
        country: entry.country || 'Desconhecido',
        approvedAt: entry.approvedAt || now,
        revokedAt: entry.revokedAt || null,
      }))
      await db.transaction('rw', db.localAcl, async () => {
        await db.localAcl.where('bookId').equals(bookId).delete()
        if (localEntries.length > 0) {
          await db.localAcl.bulkAdd(localEntries)
        }
      })
      if (bookId === selectedBookId) {
        setNarratorRoomState(prev => ({ ...prev, aclEntries: localEntries.sort((left, right) => right.approvedAt - left.approvedAt) }))
      }
    },
    [selectedBookId],
  )

   const connectNarratorRoom = useCallback(
    async (book: BookRecord) => {
      closeSocket()
      const ws = new WebSocket(signalingUrl)
      wsRef.current = ws
      setNarratorRoomState(prev => ({ ...prev, message: 'Conectando ao servidor de sinalização...' }))

      ws.onopen = () => {
        setNarratorRoomState(prev => ({ ...prev, message: 'Conectado. Abrindo sala do livro...' }))
        ws.send(
          JSON.stringify({
            type: 'narrator:open-room',
            bookId: book.id,
            hostSecret: book.hostSecret,
            inviteToken: book.inviteToken,
            narratorName: book.name || 'Narrador',
            bookName: book.name,
          }),
        )
      }

      ws.onmessage = (event) => {
        const payload = JSON.parse(event.data) as {
          type: string
          pending?: PendingJoin | PendingJoin[]
          pendingId?: string
          inviteToken?: string
          acl?: SignalingAclEntry[]
          bookId?: string
          message?: string
        }

        if (payload.type === 'room:opened') {
          setNarratorRoomState(prev => ({ ...prev, bookId: book.id }))
          setNarratorRoomState(prev => ({ ...prev, message: 'Sala ativa. Convites e lobby em tempo real habilitados.' }))
          const initialPending = Array.isArray(payload.pending)
            ? payload.pending
            : payload.pending
              ? [payload.pending]
              : []
          setNarratorRoomState(prev => ({ ...prev, pendingJoins: initialPending }))
          if (payload.acl) {
            void applyAclUpdate(book.id, payload.acl)
          }
          return
        }

        if (payload.type === 'room:pending-join' && payload.pending && !Array.isArray(payload.pending)) {
          setNarratorRoomState((previous) => ({ ...previous, pendingJoins: [payload.pending as PendingJoin, ...previous.pendingJoins] }))
          return
        }

        if (payload.type === 'room:invite-rotated' && payload.inviteToken) {
          setNarratorRoomState(prev => ({ ...prev, message: 'Link de convite rotacionado com sucesso.' }))
          setBooks((previous) =>
            previous.map((candidate) =>
              candidate.id === book.id
                ? {
                    ...candidate,
                    inviteToken: payload.inviteToken!,
                    inviteUpdatedAt: Date.now(),
                  }
                : candidate,
            ),
          )
          return
        }

        if (payload.type === 'room:acl-updated' && payload.acl) {
          void applyAclUpdate(book.id, payload.acl)
          return
        }

        if (payload.type === 'server:error') {
          setNarratorRoomState(prev => ({ ...prev, message: payload.message || 'Erro de rede no servidor de sinalização.' }))
        }
      }

      ws.onerror = () => {
        setNarratorRoomState(prev => ({ ...prev, message: 'Falha ao conectar no servidor de sinalização.' }))
      }

      ws.onclose = () => {
        setNarratorRoomState(prev => ({ ...prev, bookId: null }))
      }
    },
    [applyAclUpdate, closeSocket, signalingUrl],
  )

  const rotateInvite = useCallback(
    async (book: BookRecord) => {
      const inviteToken = await generateNewInviteToken()
      const now = Date.now()
      await db.books.update(book.id, { inviteToken, inviteUpdatedAt: now, updatedAt: now })
      setBooks((previous) =>
        previous.map((candidate) =>
          candidate.id === book.id
            ? { ...candidate, inviteToken, inviteUpdatedAt: now, updatedAt: now }
            : candidate,
        ),
      )

      if (
        wsRef.current &&
        wsRef.current.readyState === WebSocket.OPEN &&
        narratorRoomState.bookId === book.id
      ) {
        wsRef.current.send(
          JSON.stringify({
            type: 'narrator:rotate-invite',
            bookId: book.id,
            hostSecret: book.hostSecret,
            inviteToken,
          }),
        )
      }
    },
    [narratorRoomState.bookId],
  )

  const approveJoin = useCallback(
    (pending: PendingJoin) => {
      const ws = wsRef.current
      const book = books.find((item) => item.id === pending.bookId)
      if (!ws || ws.readyState !== WebSocket.OPEN || !book) {
        return
      }
      ws.send(
        JSON.stringify({
          type: 'narrator:approve-player',
          bookId: pending.bookId,
          hostSecret: book.hostSecret,
          pendingId: pending.id,
        }),
      )
      setNarratorRoomState((previous) => ({ ...previous, pendingJoins: previous.pendingJoins.filter((entry) => entry.id !== pending.id) }))
    },
    [books],
  )

  const rejectJoin = useCallback(
    (pending: PendingJoin) => {
      const ws = wsRef.current
      const book = books.find((item) => item.id === pending.bookId)
      if (!ws || ws.readyState !== WebSocket.OPEN || !book) {
        return
      }
      ws.send(
        JSON.stringify({
          type: 'narrator:reject-player',
          bookId: pending.bookId,
          hostSecret: book.hostSecret,
          pendingId: pending.id,
        }),
      )
      setNarratorRoomState((previous) => ({ ...previous, pendingJoins: previous.pendingJoins.filter((entry) => entry.id !== pending.id) }))
    },
    [books],
  )

  const revokePlayer = useCallback(
    (entry: LocalAclRecord) => {
      const ws = wsRef.current
      const book = books.find((item) => item.id === entry.bookId)
      if (!ws || ws.readyState !== WebSocket.OPEN || !book) {
        return
      }
      ws.send(
        JSON.stringify({
          type: 'narrator:revoke-player',
          bookId: entry.bookId,
          hostSecret: book.hostSecret,
          fingerprint: entry.fingerprint,
        }),
      )
    },
    [books],
  )

  const joinAsPlayer = useCallback(
    async (path: 'lobby-id' | 'token', data: { lobbyId?: string; token?: string } = {}) => {
      if (!playerDisplayName.trim()) {
        setPlayerJoinState(prev => ({ ...prev, message: 'Informe um nome de exibição antes de conectar.' }))
        return
      }

      if (path === 'token' && !playerJoinState.lobbyPassword.trim()) {
        setPlayerJoinState(prev => ({ ...prev, message: 'Informe o token de convite do narrador.' }))
        return
      }

      const identity = await getOrCreateIdentity()
      setPlayerIdentity(identity)
      closeSocket()
      setPlayerJoinState(prev => ({ ...prev, message: 'Conectando ao lobby da campanha...' }))

      const ws = new WebSocket(signalingUrl)
      wsRef.current = ws
      ws.onopen = () => {
        if (path === 'lobby-id') {
          ws.send(
            JSON.stringify({
              type: 'player:join-via-lobby-id',
              bookId: data.lobbyId,
              displayName: playerDisplayName.trim(),
              fingerprint: identity.fingerprint,
              publicKeyJwk: identity.publicKeyJwk,
            }),
          )
        } else {
          ws.send(
            JSON.stringify({
              type: 'player:join-request',
              inviteToken: playerJoinState.lobbyPassword.trim(),
              displayName: playerDisplayName.trim(),
              fingerprint: identity.fingerprint,
              publicKeyJwk: identity.publicKeyJwk,
            }),
          )
        }
      }

      ws.onmessage = (event) => {
        const payload = JSON.parse(event.data) as {
          type: string
          reason?: string
          challenge?: string
          pendingId?: string
          bookId?: string
          state?: { mapJson?: string }
          message?: string
        }

        if (payload.type === 'room:waiting-host') {
          setPlayerJoinState(prev => ({ ...prev, message: payload.message || 'Aguardando aprovação do narrador.' }))
          return
        }

        if (payload.type === 'room:challenge' && payload.challenge && payload.pendingId && payload.bookId) {
          void signChallenge(identity.privateKeyJwk, payload.challenge).then((signature) => {
            ws.send(
              JSON.stringify({
                type: 'player:challenge-response',
                bookId: payload.bookId,
                pendingId: payload.pendingId,
                signature,
              }),
            )
            setPlayerJoinState(prev => ({ ...prev, message: 'Desafio respondido. Validando assinatura...' }))
          })
          return
        }

        if (payload.type === 'room:approved') {
          setStudioRole('player')
          setEditMode(false)
          setScreen('studio')
          setSelectedBookId(payload.bookId ?? null)
          setCurrentMapId(null)
          setPlayerJoinState(prev => ({ ...prev, remoteMapJson: payload.state?.mapJson ?? null }))
          setPlayerJoinState(prev => ({ ...prev, message: 'Aprovado pelo narrador. Sessão em modo somente leitura ativa.' }))
          return
        }

        if (payload.type === 'room:state') {
          setPlayerJoinState(prev => ({ ...prev, remoteMapJson: payload.state?.mapJson ?? null }))
          return
        }

        if (payload.type === 'room:revoked') {
          setPlayerJoinState(prev => ({ ...prev, message: payload.reason || 'Acesso revogado pelo narrador.' }))
          setScreen('player-lobby-list')
          setStudioRole('player')
          setPlayerJoinState(prev => ({ ...prev, remoteMapJson: null }))
          return
        }

        if (payload.type === 'room:rejected') {
          setPlayerJoinState(prev => ({ ...prev, message: payload.reason || 'Acesso rejeitado.' }))
          setScreen('player-lobby-list')
        }
      }

      ws.onerror = () => {
        setPlayerJoinState(prev => ({ ...prev, message: 'Falha ao conectar no servidor de sinalização.' }))
      }

      ws.onclose = () => {
        if (studioRoleRef.current === 'player') {
          setPlayerJoinState(prev => ({ ...prev, message: 'Conexão encerrada. Reconecte para voltar ao mapa do narrador.' }))
        }
      }
    },
    [closeSocket, playerDisplayName, playerJoinState.lobbyPassword, signalingUrl],
  )

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
      if (studioRoleRef.current !== 'narrator') {
        return
      }
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
      if (studioRoleRef.current === 'narrator') {
        await persistCurrentMap()
      }
      setStudioRole('narrator')
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
    const secrets = createBookSecrets()
    const nextBook: BookRecord = {
      id: uid('book'),
      name: `Livro ${books.length + 1}`,
      description: 'Novo livro de mapas para uma campanha em construção.',
      hostSecret: secrets.hostSecret,
      inviteToken: secrets.inviteToken,
      inviteUpdatedAt: secrets.inviteUpdatedAt,
      lobbyPassword: null,
      isLobbyOpen: true,
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
    setStudioRole('narrator')
    setEditMode(true)
    setStampAssetId(null)
    setSelectedObject(null)
  }, [books.length])

  const addMapTab = useCallback(async () => {
    if (studioRoleRef.current !== 'narrator' || !selectedBookId) {
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
      if (studioRoleRef.current === 'narrator') {
        await persistCurrentMap()
      }
      setCurrentMapId(id)
      setSelectedObject(null)
    },
    [persistCurrentMap],
  )

  const closeTab = useCallback(
    async (id: string) => {
      if (studioRoleRef.current !== 'narrator' || bookMaps.length <= 1) {
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
    if (studioRoleRef.current !== 'narrator') {
      return
    }
    const canvas = canvasRef.current
    if (!canvas || !selectedObject) {
      return
    }
    selectedObject.set('data', selectedData)
    canvas.requestRenderAll()
    await persistCurrentMap()
  }, [persistCurrentMap, selectedData, selectedObject])

  const removeSelectedObject = useCallback(async () => {
    if (studioRoleRef.current !== 'narrator') {
      return
    }
    const canvas = canvasRef.current
    if (!canvas || !selectedObject) {
      return
    }
    canvas.remove(selectedObject)
    setSelectedObject(null)
    await persistCurrentMap()
  }, [persistCurrentMap, selectedObject])

  const goToNarrator = useCallback(async () => {
    if (studioRoleRef.current === 'narrator') {
      await persistCurrentMap()
    }
    setScreen('narrator')
    setStudioRole('narrator')
    setStampAssetId(null)
    setSelectedObject(null)
    setModalContent(null)
  }, [persistCurrentMap])

  const getInviteLink = useCallback((book: BookRecord) => {
    return buildInviteUri(window.location.href.split('?')[0], book.inviteToken)
  }, [])

  const saveBookName = useCallback(async () => {
    if (!editingBookId) return
    const trimmed = editingBookName.trim()
    if (trimmed) {
      const now = Date.now()
      await db.books.update(editingBookId, { name: trimmed, updatedAt: now })
      setBooks((prev) => prev.map((b) => (b.id === editingBookId ? { ...b, name: trimmed, updatedAt: now } : b)))
    }
    setEditingBookId(null)
  }, [editingBookId, editingBookName])

  const startEditBookName = useCallback((book: BookRecord) => {
    setEditingBookId(book.id)
    setEditingBookName(book.name)
  }, [])

  const saveMapName = useCallback(async () => {
    if (!editingMapId) return
    const trimmed = editingMapName.trim()
    if (trimmed) {
      await db.maps.update(editingMapId, { name: trimmed })
      setMaps((prev) => prev.map((m) => (m.id === editingMapId ? { ...m, name: trimmed } : m)))
    }
    setEditingMapId(null)
  }, [editingMapId, editingMapName])

  const saveAssetName = useCallback(async () => {
    if (!editingAssetId) return
    const trimmed = editingAssetName.trim()
    if (trimmed) {
      await db.assets.update(editingAssetId, { name: trimmed })
      setAssets((prev) => prev.map((a) => (a.id === editingAssetId ? { ...a, name: trimmed } : a)))
    }
    setEditingAssetId(null)
  }, [editingAssetId, editingAssetName])

  const insertImageIntoNotes = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return
      const dataUrl = await fileToDataURL(file)
      const mdImage = `\n![${file.name.replace(/\.[^.]+$/, '')}](${dataUrl})\n`
      setSelectedData((prev) => ({ ...prev, description: prev.description + mdImage }))
      event.target.value = ''
    },
    [],
  )

  const renderHome = () => (
    <main className="shell home-shell">
      <section className="home-hero">
        {hasUpdateAvailable ? (
          <div className="update-banner">
            <strong>Nova versão disponível:</strong> {latestInstallerVersion}
            <div className="update-actions">
              {installerReleaseUrl ? (
                <a href={installerReleaseUrl} target="_blank" rel="noopener noreferrer">
                  Atualizar
                </a>
              ) : null}
              <button type="button" onClick={() => setShowUpdateNotice(false)}>
                Agora não
              </button>
            </div>
          </div>
        ) : null}
        <p className="eyebrow">Neverending Fantasy Map Studio</p>
        <h1>Escolha como deseja entrar no livro de mapas.</h1>
        <p className="home-copy">
          Aplicação instalada em desktop: narrador e jogador usam o navegador local, com sessão
          em tempo real e autenticação por chave.
        </p>
        <div className="home-actions">
          <button type="button" className="portal-card" onClick={() => setScreen('narrator')}>
            <span className="portal-title">Narrador</span>
            <span className="portal-copy">
              Gerencia livros, aprova entrada de jogadores e mantém o estado oficial do mapa.
            </span>
          </button>
          <button type="button" className="portal-card" onClick={() => setScreen('player')}>
            <span className="portal-title">Jogador</span>
            <span className="portal-copy">
              Entra por convite com autenticação criptográfica e recebe mapa em modo leitura.
            </span>
          </button>
          <button type="button" className="portal-card" onClick={() => setScreen('about')}>
            <span className="portal-title">Sobre</span>
            <span className="portal-copy">
              Informações técnicas, licença e arquitetura de rede da aplicação.
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
            Gerencie campanhas, controle ACL por livro e distribua convite ativo.
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

      <section className="network-shell">
        <label>
          Servidor de sinalização
          <input
            value={signalingUrl}
            onChange={(event) => setSignalingUrl(event.target.value)}
            placeholder="ws://localhost:8787"
          />
        </label>
        <p>{narratorRoomState.message || 'Conecte um livro para habilitar lobby e sincronização.'}</p>
        <small>
          P2P completo: configure STUN/TURN no host. Priorize Cloudflare quando disponível; para
          POC, use fallback gratuito com limites de tráfego.
        </small>
      </section>

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
        <section className="book-list-compact">
          {sortedBooks.map((book) => {
            const mapCount = maps.filter((map) => map.bookId === book.id).length
            const bookAcl = narratorRoomState.aclEntries.filter((entry) => entry.bookId === book.id)
            const bookPending = narratorRoomState.pendingJoins.filter((entry) => entry.bookId === book.id)
            const isExpanded = expandedBookId === book.id
            const lastUpdated = new Date(book.updatedAt).toLocaleString('pt-BR')

            return (
              <div className={`book-item ${isExpanded ? 'expanded' : ''}`} key={book.id}>
                <div
                  className="book-item-header"
                  onClick={() => setExpandedBookId(isExpanded ? null : book.id)}
                >
                  <span className="book-expand-arrow">{isExpanded ? '▼' : '▶'}</span>
                  <div className="book-item-title">
                    {editingBookId === book.id ? (
                      <input
                        className="inline-edit"
                        autoFocus
                        value={editingBookName}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setEditingBookName(event.target.value)}
                        onBlur={() => void saveBookName()}
                        onKeyDown={(event) => {
                         if (event.key === 'Enter') void saveBookName()
                         if (event.key === 'Escape') setEditingBookId(null)
                         event.stopPropagation()
                        }}
                      />
                    ) : (
                      <h4
                        className="book-name"
                        onDoubleClick={(event) => {
                         event.stopPropagation()
                         startEditBookName(book)
                        }}
                        title="Duplo clique para renomear"
                      >
                        {book.name}
                      </h4>
                    )}
                  </div>
                  <span className="book-time">{lastUpdated}</span>
                  {bookPending.length > 0 && (
                    <span className="pending-badge">{bookPending.length}</span>
                  )}
                </div>

                {isExpanded && (
                  <div className="book-actions">
                    <button type="button" className="primary-button" onClick={() => void openBook(book.id)}>
                      📖 Abrir
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => void connectNarratorRoom(book)}
                    >
                      🔌 Conectar ao Lobby
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => startEditBookName(book)}
                    >
                      ⚙️ Editar
                    </button>

                    <div className="book-meta" style={{ marginTop: '12px' }}>
                      {mapCount} {mapCount === 1 ? 'mapa' : 'mapas'} · ACL ({bookAcl.length}) · Pendente ({bookPending.length})
                    </div>

                    {bookPending.length > 0 && (
                      <div className="invite-box">
                        <p>Solicitações pendentes:</p>
                        <ul>
                         {bookPending.map((pending) => (
                           <li key={pending.id}>
                             <span>
                               {pending.displayName} · {pending.country}
                             </span>
                             <div>
                               <button type="button" className="ghost-button" onClick={() => approveJoin(pending)}>
                                 ✓ Aprovar
                               </button>
                               <button type="button" className="ghost-button" onClick={() => rejectJoin(pending)}>
                                 ✕ Rejeitar
                               </button>
                             </div>
                           </li>
                         ))}
                        </ul>
                      </div>
                    )}

                    <div className="invite-box">
                      <p>Convite ativo:</p>
                      <code>{getInviteLink(book)}</code>
                      <button type="button" className="ghost-button" onClick={() => void rotateInvite(book)}>
                        Rotacionar link
                      </button>
                    </div>

                    {bookAcl.length > 0 && (
                      <div className="invite-box">
                        <p>Jogadores autorizado ({bookAcl.length}):</p>
                        <ul>
                          {bookAcl.map((entry) => (
                            <li key={entry.id}>
                              <span>{entry.displayName} · {entry.country}</span>
                              <button type="button" className="ghost-button" onClick={() => revokePlayer(entry)}>
                                Revogar
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
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
          <h2>Entrada autenticada por convite</h2>
          <p className="screen-copy">
            O jogador entra no lobby, aguarda aprovação manual do narrador e autentica via
            desafio-resposta com chave local.
          </p>
        </div>
        <button type="button" className="ghost-button" onClick={() => setScreen('home')}>
          Voltar
        </button>
      </header>

      <section className="player-join-card">
        <label>
          Servidor de sinalização
          <input
            value={signalingUrl}
            onChange={(event) => setSignalingUrl(event.target.value)}
            placeholder="ws://localhost:8787"
          />
        </label>
        <label>
          Nome do jogador
          <input
            value={playerDisplayName}
            onChange={(event) => setPlayerDisplayName(event.target.value)}
            placeholder="Ex: Eldrin"
          />
        </label>
        <div className="player-tabs">
          <button
            type="button"
            className="tab-button active"
            onClick={() => setScreen('player-lobby-list')}
          >
            🔍 Descobrir Salas
          </button>
        </div>
        <label>
          Token de convite
          <input
           value={playerJoinState.lobbyPassword}
           onChange={(event) => setPlayerJoinState(prev => ({ ...prev, lobbyPassword: event.target.value }))}
            placeholder="invite_xxx..."
          />
        </label>
        <button type="button" className="primary-button" onClick={() => void joinAsPlayer('token', { token: playerJoinState.lobbyPassword })}>
          Entrar na campanha
        </button>
        <p>{playerJoinState.message}</p>
        {playerIdentity ? (
          <small>Identidade local: {playerIdentity.fingerprint}</small>
        ) : null}
      </section>

      <section className="book-grid">
        {playerBooks.map((book) => (
          <article className="book-card muted" key={book.id}>
            <p className="book-meta">Somente leitura</p>
            <h3>{book.name}</h3>
            <p>
              {book.mapCount} {book.mapCount === 1 ? 'mapa preparado' : 'mapas preparados'} para
              sessão de jogo.
            </p>
          </article>
        ))}
      </section>
    </main>
  )

  const renderPlayerLobbyList = () => (
    <main className="shell screen-shell">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Salas Ativas</p>
          <h2>Descubra Campanhas</h2>
          <p className="screen-copy">
            Encontre e entre em lobbies de narração. Selecione uma campanha para solicitar entrada.
          </p>
        </div>
        <button type="button" className="ghost-button" onClick={() => setScreen('player')}>
          Voltar
        </button>
      </header>

      {lobbiesLoading && lobbies.length === 0 ? (
        <section className="loading-state">
          <p>⏳ Carregando salas...</p>
        </section>
      ) : lobbies.length === 0 ? (
        <section className="empty-state">
          <h3>Nenhuma sala ativa no momento</h3>
          <p>Convide um narrador ou cole o token de convite manualmente.</p>
          <button type="button" className="ghost-button" onClick={() => setScreen('player')}>
            Voltar ao Token Manual
          </button>
        </section>
      ) : (
        <section className="lobby-grid">
          {lobbies.map((lobby) => (
            <article
              className={`lobby-card ${lobby.joinable ? '' : 'full'}`}
              key={lobby.id}
            >
              <div className="lobby-header">
                <h3>{lobby.bookName}</h3>
                <p className="narrador-name">🎭 {lobby.narratorName}</p>
              </div>
              <div className="lobby-stats">
                <span>🗺️ {lobby.mapCount} {lobby.mapCount === 1 ? 'mapa' : 'mapas'}</span>
                <span>👥 {lobby.playerCount}/10 jogadores</span>
              </div>
              <p className="lobby-created">
                Criada {Math.floor((Date.now() - lobby.createdAt) / 1000)}s atrás
              </p>
              <button
                type="button"
                className={lobby.joinable ? 'primary-button' : 'disabled-button'}
                disabled={!lobby.joinable}
                onClick={() => void joinAsPlayer('lobby-id', { lobbyId: lobby.id })}
              >
                {lobby.joinable ? 'Solicitar Entrada' : 'Sala Cheia'}
              </button>
            </article>
          ))}
        </section>
      )}

      <section className="player-fallback">
        <hr />
        <label>
          <strong>Ou cole um token de convite:</strong>
          <input
            value={playerJoinState.lobbyPassword}
            onChange={(event) => setPlayerJoinState(prev => ({ ...prev, lobbyPassword: event.target.value }))}
            placeholder="invite_xxx..."
          />
        </label>
        <button type="button" className="ghost-button" onClick={() => void joinAsPlayer('token', { token: playerJoinState.lobbyPassword })}>
          Conectar com Token
        </button>
      </section>
    </main>
  )

  const renderAbout = () => (
    <main className="shell screen-shell">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Sobre</p>
          <h2>Informações técnicas</h2>
          <p className="screen-copy">
            Arquitetura atual com separação entre narrador e jogador em rede.
          </p>
        </div>
        <button type="button" className="ghost-button" onClick={() => setScreen('home')}>
          Voltar
        </button>
      </header>
      <section className="about-grid">
        <article className="book-card">
          <h3>Developer</h3>
          <p>Rodrigo Viana</p>
        </article>
        <article className="book-card">
          <h3>Licença</h3>
          <p>MIT License</p>
        </article>
        <article className="book-card">
          <h3>Versão instalada</h3>
          <p>Atual: {__APP_VERSION__}</p>
          <p>Última publicada: {latestInstallerVersion ?? 'indisponível'}</p>
          {installerReleaseUrl ? (
            <p>
              <a href={installerReleaseUrl} target="_blank" rel="noopener noreferrer">
                Ver release do instalador
              </a>
            </p>
          ) : null}
        </article>
        <article className="book-card">
          <h3>Rede</h3>
          <p>
            Sinalização por WebSocket com lobby, ACL, rotação de convites, aprovação manual e
            sincronização em tempo real do estado do mapa.
          </p>
        </article>
        <article className="book-card">
          <h3>ICE (STUN/TURN)</h3>
          <p>
            Configure STUN/TURN no host para P2P amplo. Cloudflare pode ser usado quando disponível
            na conta; para POC, mantenha fallback gratuito com limitações.
          </p>
        </article>
        <article className="book-card">
          <h3>Identidade</h3>
          <p>
            Jogador usa chave assimétrica local no navegador (Web Crypto + IndexedDB) para
            desafio-resposta.
          </p>
        </article>
      </section>
    </main>
  )

  const isNarratorStudio = studioRole === 'narrator'

  const renderStudio = () => (
    <>
      <header className="topbar">
        <button type="button" className="ghost-button compact" onClick={() => void goToNarrator()}>
          ← Livros
        </button>
        <div className="brand">Neverending Fantasy Map Studio</div>
        <div className="book-badge">
          {isNarratorStudio ? currentBook?.name ?? 'Livro sem nome' : 'Modo Jogador (leitura)'}
        </div>
        {!isNarratorStudio && (
          <div className="player-read-only-badge">🔒 Modo Somente Leitura</div>
        )}
        {isNarratorStudio ? (
          <>
            <div className="tabs">
              {bookMaps.map((map) => (
                <button
                  type="button"
                  className={`tab ${map.id === currentMapId ? 'active' : ''}`}
                  key={map.id}
                  onClick={() => {
                    if (editingMapId !== map.id) void switchTab(map.id)
                  }}
                >
                  {editingMapId === map.id ? (
                    <input
                      className="tab-rename-input"
                      autoFocus
                      value={editingMapName}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setEditingMapName(event.target.value)}
                      onBlur={() => void saveMapName()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void saveMapName()
                        if (event.key === 'Escape') setEditingMapId(null)
                        event.stopPropagation()
                      }}
                    />
                  ) : (
                    <span
                      onDoubleClick={(event) => {
                        event.stopPropagation()
                        setEditingMapId(map.id)
                        setEditingMapName(map.name)
                      }}
                      title="Duplo clique para renomear"
                    >
                      {map.name}
                    </span>
                  )}
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
            <button
              type="button"
              className="tab-add"
              title="Novo mapa"
              onClick={() => void addMapTab()}
            >
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
          </>
        ) : (
          <div className="player-badge">Somente visualização · sem edição de objetos</div>
        )}
      </header>

      <div className="workspace">
        {isNarratorStudio ? (
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
                  <div
                    className={`asset-item ${asset.id === stampAssetId ? 'selected' : ''}`}
                    key={asset.id}
                  >
                    <button
                      type="button"
                      className="asset-thumb"
                      title="Clique e depois clique no mapa para posicionar"
                      onClick={() =>
                        setStampAssetId((current) => (current === asset.id ? null : asset.id))
                      }
                    >
                      <img src={asset.dataUrl} alt={asset.name} />
                    </button>
                    {editingAssetId === asset.id ? (
                      <input
                        className="asset-name-input"
                        autoFocus
                        value={editingAssetName}
                        onChange={(event) => setEditingAssetName(event.target.value)}
                        onBlur={() => void saveAssetName()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void saveAssetName()
                          if (event.key === 'Escape') setEditingAssetId(null)
                        }}
                      />
                    ) : (
                      <div
                        className="label editable-label"
                        title="Duplo clique para renomear"
                        onDoubleClick={() => {
                          setEditingAssetId(asset.id)
                          setEditingAssetName(asset.name)
                        }}
                      >
                        {asset.name}
                      </div>
                    )}
                  </div>
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
        ) : null}

        <main className={`map-area ${stampAssetId ? 'stamping' : ''}`}>
          {isNarratorStudio ? (
            <label className="bg-upload-fab">
              🗺️ Carregar plano de fundo
              <input type="file" accept="image/*" hidden onChange={handleBackgroundUpload} />
            </label>
          ) : null}
          <div className="canvas-frame">
            <canvas
              id="mapCanvas"
              width={DEFAULT_CANVAS_WIDTH}
              height={DEFAULT_CANVAS_HEIGHT}
              ref={htmlCanvasRef}
            />
            <div className="zoom-controls">
              <button
                type="button"
                className="zoom-button"
                onClick={() => handleZoom('out')}
                title="Diminuir zoom"
              >
                −
              </button>
              <span className="zoom-level">{zoomLevel}%</span>
              <button
                type="button"
                className="zoom-button"
                onClick={() => handleZoom('in')}
                title="Aumentar zoom"
              >
                +
              </button>
            </div>
          </div>
          <div className="hint-footer">
            Passe o mouse sobre uma estrutura para destacá-la · clique para abrir detalhes
          </div>
        </main>

        {isNarratorStudio ? (
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
                      <div className="field-header">
                        <label htmlFor="fieldDescription">Notas do Mestre (Markdown)</label>
                        <button
                          type="button"
                          className="preview-toggle"
                          onClick={() => setNotesPreview((prev) => !prev)}
                        >
                          {notesPreview ? 'Editar' : 'Pré-ver'}
                        </button>
                      </div>
                      {notesPreview ? (
                        <div
                          className="notes-preview"
                          dangerouslySetInnerHTML={{ __html: markdownToHtml(selectedData.description) }}
                        />
                      ) : (
                        <textarea
                          id="fieldDescription"
                          value={selectedData.description}
                          placeholder="Detalhes, lore, gatilhos de narrativa... Markdown suportado."
                          onChange={(event) =>
                            setSelectedData((previous) => ({
                              ...previous,
                              description: event.target.value,
                            }))
                          }
                        />
                      )}
                      <label className="insert-image-btn">
                        📎 Inserir imagem
                        <input type="file" accept="image/*" hidden onChange={insertImageIntoNotes} />
                      </label>
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
        ) : null}
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
          </div>
        ) : null}
      </div>
    </>
  )

  useEffect(() => {
    return () => {
      closeSocket()
    }
  }, [closeSocket])

  if (screen === 'home') {
    return renderHome()
  }
  if (screen === 'narrator') {
    return renderNarrator()
  }
  if (screen === 'player') {
    return renderPlayer()
  }
  if (screen === 'player-lobby-list') {
    return renderPlayerLobbyList()
  }
  if (screen === 'about') {
    return renderAbout()
  }
  return renderStudio()
}

export default App
