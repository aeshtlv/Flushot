import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { selectionPixelSize, selectionToImageRect } from '../../shared/geometry'
import type {
  Annotation,
  AnnotationLayerPayload,
  AnnotationTool,
  BitmapPayload,
  OcrOutcome,
  OcrRegion,
  OverlayInit,
  Rect
} from '../../shared/types'
import { fullscreenSelection, planNativeCrop, resultHostPlacement, selectionToDesktopRect, type HostPlacement } from '../../shared/virtualScreen'
import { placeBar, type ChromePlacement } from '../../shared/selectionChrome'
import {
  ANNOTATION_COLORS,
  DEFAULT_STROKE,
  DEFAULT_TEXT_SIZE,
  STROKE_WIDTHS,
  TEXT_SIZE_LABELS,
  TEXT_SIZES,
  nextStepNumber
} from '../../shared/annotate'
import type { SourceBox } from './annotate'
import { clampZoom, fitZoom, needsZoom, stepZoom, zoomLabel } from '../../shared/zoom'
import { AnnotationCanvas } from './AnnotationCanvas'
import { demoSceneUrl } from './demoScene'
import { TextPanel } from './TextPanel'
import {
  ArrowIcon,
  BlurIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  FitIcon,
  LineIcon,
  MoveIcon,
  PenIcon,
  RectIcon,
  RepeatIcon,
  SaveIcon,
  StepIcon,
  TextIcon,
  TextScanIcon,
  UndoIcon,
  ZoomInIcon,
  ZoomOutIcon
} from './icons'
import { useSelection, type Handle } from './useSelection'

type Stage = 'selecting' | 'result' | 'busy'

/** What the text panel is showing: nothing yet, text, or why there is none. */
type TextPanelState = (
  | { status: 'loading' }
  | { status: 'ready'; outcome: OcrOutcome }
  | { status: 'failed'; message: string }
) & {
  /** The fragment that was read, so "try again" repeats the same request. */
  region?: OcrRegion
}

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const TOAST_MS = 2600

/**
 * Demo mode (`?demo=1`) renders the overlay with a synthetic desktop and no
 * IPC. Used by the UI self-test to verify the interface without grabbing the
 * live screen.
 */
const DEMO = new URLSearchParams(window.location.search).has('demo')
/**
 * `?demo=1&stage=result` opens the finished-result screen with a synthetic
 * picture. Used by the UI self-test to check the annotation bar, which is not
 * reachable in demo mode otherwise (no capture happens there).
 */
const DEMO_RESULT = new URLSearchParams(window.location.search).get('stage') === 'result'

/** Padding around the result column, in CSS pixels. Must match `.result-layer`. */
const LAYER_PADDING = 24
/**
 * Height reserved below the picture: the caption, both toolbars and the gaps
 * between them. They never scroll, so the picture must not claim their space.
 */
const RESULT_CHROME = 200

/**
 * The synthetic picture demo mode shows. It lives in its own module because it
 * is a product artefact — it appears on the landing page and in the README — and
 * `scripts/verify-demo-scene.cjs` measures it.
 */
const DEMO_SHOT = demoSceneUrl()
const DEMO_INIT: OverlayInit = {
  display: {
    id: 'demo',
    label: 'Демо-экран',
    bounds: { x: 0, y: 0, width: 1280, height: 720 },
    scaleFactor: 1,
    imageWidth: 1280,
    imageHeight: 720
  },
  settings: {
    theme: 'light',
    backgroundPreset: 'white',
    backgroundColor: '#FFFFFF',
    frameWidth: 64,
    cornerRadius: 12,
    paletteColors: [],
    shadowEnabled: true,
    shadowIntensity: 30,
    shadowBlur: 40,
    shadowOffsetY: 16,
    saveDirectory: '',
    saveMode: 'folder',
    format: 'png',
    jpegQuality: 94,
    hotkey: 'CommandOrControl+Shift+S',
    hotkeyFullscreen: 'CommandOrControl+Shift+3',
    launchAtLogin: false
  },
  hotkey: 'CommandOrControl+Shift+S'
}

export function OverlayApp(): JSX.Element {
  const [init, setInit] = useState<OverlayInit | null>(null)
  const [shotUrl, setShotUrl] = useState<string | null>(null)
  /** Raw frozen screen; painting pixels is much faster than decoding a PNG. */
  const [shot, setShot] = useState<BitmapPayload | null>(null)
  const [stage, setStage] = useState<Stage>('selecting')
  const [preview, setPreview] = useState<string | null>(null)
  /** Real pixel size of the composed result, so the caption never lies. */
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  /**
   * Monitor that shows the result card, as fractions of the desktop.
   *
   * The overlay window spans every monitor, so centring the card would place it
   * on the seam when the selection crossed two screens. Picking one host keeps
   * the whole result — picture, caption and both toolbars — on one monitor.
   */
  const [host, setHost] = useState<HostPlacement | null>(null)
  /**
   * Zoom of the result, or `null` while it is fitted to the monitor.
   *
   * `null` is the default so the picture keeps adapting when the window or the
   * monitor changes; an explicit number means the user chose it and it stays.
   */
  const [zoomValue, setZoomValue] = useState<number | null>(null)
  /** True while the user is dragging the picture to reach another part of it. */
  const [panning, setPanning] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const panFrom = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  /** Annotations drawn on the result, oldest first. */
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [tool, setTool] = useState<AnnotationTool>('arrow')
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0])
  const [stroke, setStroke] = useState<number>(STROKE_WIDTHS[DEFAULT_STROKE])
  const [textSize, setTextSize] = useState<number>(TEXT_SIZES[DEFAULT_TEXT_SIZE])
  const annotateCanvas = useRef<HTMLCanvasElement>(null)
  const toastTimer = useRef<number | null>(null)
  /** Recognized text panel; `null` means it is closed. */
  const [textPanel, setTextPanel] = useState<TextPanelState | null>(null)
  /**
   * The overlay has stopped painting itself, because an action is finishing.
   *
   * Not a loading state: the window is about to be hidden, and the content goes
   * first so nothing is left on screen for the compositor to keep showing.
   */
  const [blanked, setBlanked] = useState(false)
  /** Text recognition has been used in this window, so it is worth keeping warm. */
  const [textUsed, setTextUsed] = useState(false)
  /**
   * The user is picking a fragment of the picture to read text from.
   *
   * Arming the mode instead of recognizing immediately is what makes "select a
   * piece, get its text" possible: the same button used to read the whole picture
   * with no way to ask for less.
   */
  const [ocrPick, setOcrPick] = useState(false)
  /** The fragment being dragged right now, in picture pixels. */
  const [ocrMarquee, setOcrMarquee] = useState<OcrRegion | null>(null)
  /** Where the drag started, in picture pixels. */
  const ocrDrag = useRef<{ x: number; y: number } | null>(null)

  /**
   * Resolve once the current React commit has been painted.
   *
   * Two frames: the first one runs before the pending paint, the second one
   * after it. The timer is the fallback for a window the compositor has stopped
   * drawing — without it a background window would never finish an action.
   */
  const afterPaint = useCallback(
    (): Promise<void> =>
      new Promise<void>((resolve) => {
        let settled = false
        const finish = (): void => {
          if (settled) return
          settled = true
          resolve()
        }
        requestAnimationFrame(() => requestAnimationFrame(finish))
        window.setTimeout(finish, 60)
      }),
    []
  )

  const bounds = useMemo(() => ({ x: 0, y: 0, width: viewport.width, height: viewport.height }), [viewport])
  const selection = useSelection(bounds)

  /**
   * Full-screen round: the region arrives already selected.
   *
   * The effect is keyed on the `init` object rather than on a flag, because every
   * new round replaces that object. That way the selection is applied exactly
   * once per round: pressing Esc and clearing it must not have it reappear, and
   * resizing the window must not silently restore a region the user removed.
   */
  const fullscreenApplied = useRef<OverlayInit | null>(null)
  useEffect(() => {
    if (!init?.fullscreen) return
    if (fullscreenApplied.current === init) return
    // The window reports its final size on the first layout pass; applying before
    // that would produce a selection rounded to a wrong viewport.
    if (viewport.width < 2 || viewport.height < 2) return
    fullscreenApplied.current = init
    selection.setRect(fullscreenSelection(init.display, viewport))
  }, [init, viewport, selection.setRect])

  /** Size of the host monitor in CSS pixels; the whole window when there is none. */
  const hostSize = useMemo(
    () => ({ width: host ? host.width * viewport.width : viewport.width, height: host ? host.height * viewport.height : viewport.height }),
    [host, viewport]
  )

  /**
   * Which monitor a rectangle belongs to. Computed from the descriptor's monitor
   * list, so a single-monitor desktop simply returns nothing and the layer keeps
   * covering the whole window.
   */
  const hostFor = useCallback((): HostPlacement | null => {
    if (!init?.display.monitors || init.display.monitors.length < 2) return null
    return resultHostPlacement(init.display.monitors, init.display.bounds)
  }, [init])

  /**
   * Space the picture may occupy on the host monitor.
   *
   * The caption and both toolbars live below the picture and never scroll, so
   * their height is reserved here. Getting this wrong is what made a two-monitor
   * capture unreadable: the card used a share of the whole desktop instead.
   */
  const area = useMemo(
    () => ({
      width: Math.max(160, hostSize.width - LAYER_PADDING * 2),
      height: Math.max(120, hostSize.height - LAYER_PADDING * 2 - RESULT_CHROME)
    }),
    [hostSize]
  )

  /**
   * The picture's own size in CSS pixels, where 1 means one image pixel per
   * device pixel — the sharpest the preview can possibly be.
   */
  const natural = useMemo(() => {
    if (!size) return null
    const ratio = window.devicePixelRatio || 1
    return { width: size.width / ratio, height: size.height / ratio }
  }, [size])

  const fit = natural ? fitZoom(natural, area) : 1
  const zoom = zoomValue === null ? fit : clampZoom(zoomValue, fit)
  const cardSize = natural ? { width: natural.width * zoom, height: natural.height * zoom } : null

  /**
   * Where the "select an area" hint goes.
   *
   * The overlay spans every monitor, so centring the hint on the window put it
   * on the seam between two screens: the title landed on one monitor and the
   * shortcut line on the other, which read as two broken fragments. It is
   * centred on the primary monitor instead — the same monitor the result card
   * uses, so the hint and the result appear in the same place.
   *
   * The host is derived from the descriptor rather than from `host` state,
   * because that state only exists once a result is being shown; the hint has to
   * be placed while the user is still selecting.
   */
  const hintStyle = useMemo<CSSProperties>(() => {
    const placement = hostFor()
    if (!placement) return {}
    return {
      left: `${(placement.left + placement.width / 2) * 100}%`,
      top: `${(placement.top + placement.height / 2) * 100}%`,
      // The shortcut line is long: on a narrow monitor it must wrap inside the
      // screen instead of running across the bezel.
      maxWidth: `${Math.max(280, Math.round(placement.width * viewport.width - 64))}px`
    }
  }, [hostFor, viewport])

  /**
   * Where the status message goes: the top of the primary monitor.
   *
   * It used to sit at the bottom centre of the overlay window, which is the
   * bottom of the whole desktop — so on two screens it appeared on whichever
   * monitor happened to be there, and on one screen it landed squarely on the
   * action toolbar, hiding «Копировать» and «Сохранить» for the two and a half
   * seconds it was visible. Both toolbars live at the bottom of the result
   * column, so the top of the monitor is the one strip that is reliably free.
   */
  const toastStyle = useMemo<CSSProperties>(() => {
    const placement = hostFor()
    if (!placement) return {}
    return {
      left: `${(placement.left + placement.width / 2) * 100}%`,
      top: `calc(${placement.top * 100}% + 20px)`,
      // A long path must wrap inside the monitor rather than run across the bezel.
      maxWidth: `${Math.max(240, Math.round(placement.width * viewport.width - 48))}px`
    }
  }, [hostFor, viewport])

  /** True when the picture is larger than the monitor and needs zoom controls. */
  const zoomable = Boolean(natural) && needsZoom(fit)
  /** True while a part of the picture is out of view, so dragging pans. */
  const pannable = zoomValue !== null && zoom > fit + 0.001

  // The keydown listener is registered once; reading the rect from a ref keeps
  // it from acting on a stale selection (e.g. Enter pressed right after a drag).
  const rectRef = useRef(selection.rect)
  rectRef.current = selection.rect

  useEffect(() => {
    const onResize = (): void => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (DEMO) {
      setInit(DEMO_INIT)
      setShotUrl(DEMO_SHOT)
      if (DEMO_RESULT) {
        // 1280 × 720 picture plus the 64 px frame on each side.
        setPreview(DEMO_SHOT)
        setSize({ width: 1280 + 128, height: 720 + 128 })
        setStage('result')
      }
      return
    }

    const api = window.flushot
    let objectUrl: string | null = null

    void api.getOverlayInit().then((data) => {
      // Metadata only: the window can be shown right away, the frame follows.
      setInit(data)
      void api.getOverlayShot().then(setShot).catch(() => undefined)
    })
    const unsubscribe = api.onOverlayReset(() => {
      setStage('selecting')
      setPreview(null)
      // The previous picture's numbers must go too: the result card is rendered
      // during the busy phase as well, and a stale "728 × 528" caption under a
      // new capture reads as if the new selection had that size.
      setSize(null)
      setToast(null)
      setAnnotations([])
      setHost(null)
      setZoomValue(null)
      setTextPanel(null)
      setOcrPick(false)
      setOcrMarquee(null)
      setBlanked(false)
      // A reused window must not keep the previous round's full-screen flag: the
      // next round may have been started by the ordinary region hotkey.
      setInit((current) => (current ? { ...current, fullscreen: false } : current))
      selection.reset()
    })

    // Warm windows receive their frame instead of pulling it, which saves a
    // round trip on every hotkey press.
    const stopFrames = api.onOverlayFrame?.((frame) => {
      setInit((current) => (current ? { ...current, display: frame.display, fullscreen: frame.fullscreen } : current))
      setShot(frame.shot)
      setShotUrl(null)
      setStage('selecting')
      setPreview(null)
      setSize(null)
      setToast(null)
      setAnnotations([])
      setHost(null)
      setZoomValue(null)
      setTextPanel(null)
      setOcrPick(false)
      setOcrMarquee(null)
      setBlanked(false)
      selection.reset()
    })

    return () => {
      unsubscribe()
      stopFrames?.()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // selection.reset is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The window is revealed as soon as a frame is ready to paint: metadata on a
  // cold start, a pushed frame on every later hotkey.
  useEffect(() => {
    if (!init || (!shot && !shotUrl)) return
    const api = window.flushot
    if (typeof api?.reportOverlayReady !== 'function') return
    const frame = requestAnimationFrame(() => api.reportOverlayReady())
    return () => cancelAnimationFrame(frame)
  }, [init, shot, shotUrl])
  const showToast = useCallback((text: string, tone: 'ok' | 'error') => {
    setToast({ text, tone })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS)
  }, [])

  const closeOverlay = useCallback(async (): Promise<void> => {
    if (DEMO) {
      setStage('selecting')
      setPreview(null)
      setToast(null)
      return
    }
    await window.flushot.cancelCapture()
  }, [])

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    },
    []
  )

  const resetSelection = useCallback(() => {
    selection.reset()
    setStage('selecting')
    setPreview(null)
    setSize(null)
    setToast(null)
    setAnnotations([])
    setHost(null)
    setZoomValue(null)
    setTextPanel(null)
    setOcrPick(false)
    setOcrMarquee(null)
    setBlanked(false)
  }, [selection])

  const confirmSelection = useCallback(async () => {
    if (!init || !rectRef.current) return
    const rect = rectRef.current
    if (rect.width < 8 || rect.height < 8) return

    if (DEMO) {
      showToast('Демо-режим: снимок не создаётся', 'ok')
      return
    }

    setStage('busy')
    // The result always opens on the primary monitor, so the layer can be placed
    // before the picture is ready — otherwise the card would flash on the seam.
    const placement = hostFor()
    setHost(placement)
    const hostWidth = placement ? placement.width * viewport.width : viewport.width
    try {
      // The selection travels in CSS pixels; the main process maps it to the
      // physical pixels of the frozen screenshot.
      const result = await window.flushot.captureSelection({
        displayId: init.display.id,
        rect,
        viewport: { width: viewport.width, height: viewport.height },
        previewWidth: resultPreviewWidth(hostWidth)
      })

      if (!result.ok) {
        setStage('selecting')
        showToast(result.message, 'error')
        return
      }

      setPreview(result.preview ?? null)
      setSize(result.width && result.height ? { width: result.width, height: result.height } : null)
      setStage('result')
      if (result.message) showToast(result.message, 'ok')
    } catch (error) {
      setStage('selecting')
      showToast(error instanceof Error ? error.message : 'Не удалось создать снимок', 'error')
    }
  }, [hostFor, init, showToast, viewport])

  /**
   * Ctrl+C while the region is being drawn: copy the composed result straight to
   * the clipboard and close the overlay, without the preview step.
   */
  const copySelection = useCallback(async () => {
    if (!init || !rectRef.current) return
    const rect = rectRef.current
    if (rect.width < 8 || rect.height < 8) {
      showToast('Слишком маленькая область — выделите не меньше 8 × 8 пикселей', 'error')
      return
    }

    if (DEMO) {
      showToast('Демо-режим: буфер недоступен', 'ok')
      return
    }

    setStage('busy')
    try {
      const result = await window.flushot.captureSelection({
        displayId: init.display.id,
        rect,
        viewport: { width: viewport.width, height: viewport.height },
        intent: 'copy'
      })

      if (!result.ok) {
        setStage('selecting')
        showToast(result.message, 'error')
        return
      }

      // The overlay is closed by the main process; show the note briefly anyway.
      showToast(result.message, 'ok')
    } catch (error) {
      setStage('selecting')
      showToast(error instanceof Error ? error.message : 'Не удалось скопировать снимок', 'error')
    }
  }, [init, showToast, viewport])

  /**
   * The drawing as raw pixels, cropped to the area that actually has paint on it.
   *
   * `undefined` when nothing was drawn, so the common path stays a buffer copy.
   * The whole canvas used to be encoded to PNG and base64'd here, which blocked
   * the UI thread for 145 ms on a 4K picture and gave main a PNG it had to decode
   * again. Reading bytes of the painted rectangle costs a tenth of that, and the
   * main process can paste them straight into the card.
   */
  const layerPayload = useCallback((): AnnotationLayerPayload | undefined => {
    if (annotations.length === 0) return undefined
    const canvas = annotateCanvas.current
    if (!canvas || canvas.width === 0 || canvas.height === 0) return undefined
    const context = canvas.getContext('2d')
    if (!context) return undefined

    const { width, height } = canvas
    const image = context.getImageData(0, 0, width, height)
    const pixels = new Uint32Array(image.data.buffer, image.data.byteOffset, width * height)

    // Alpha is the high byte of each pixel word, so one comparison per pixel
    // finds the painted area without touching the colour channels.
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < height; y++) {
      const row = y * width
      for (let x = 0; x < width; x++) {
        if (pixels[row + x] >>> 24 === 0) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        maxY = y
      }
    }
    if (maxX < 0) return undefined

    const boxWidth = maxX - minX + 1
    const boxHeight = maxY - minY + 1
    const data = new Uint8Array(boxWidth * boxHeight * 4)
    for (let y = 0; y < boxHeight; y++) {
      const from = ((minY + y) * width + minX) * 4
      data.set(image.data.subarray(from, from + boxWidth * 4), y * boxWidth * 4)
    }
    return { x: minX, y: minY, width: boxWidth, height: boxHeight, data }
  }, [annotations])

  const runAction = useCallback(
    async (action: 'save' | 'copy') => {
      if (DEMO) {
        showToast(action === 'save' ? 'Демо-режим: сохранение недоступно' : 'Демо-режим: буфер недоступен', 'ok')
        return
      }
      // Blank the picture here first, then let the main process hide the window.
      //
      // Hiding alone was not enough: on Windows the compositor can keep the last
      // frame of a transparent, always-on-top window on screen for a moment, so
      // the overlay lingered for up to a second after Ctrl+C. Our own content is
      // what the user sees, so making it invisible is immediate and leaves
      // nothing for the compositor to keep. The frame is waited for on purpose —
      // hiding before it lands would leave the *old* picture as the ghost.
      //
      // "Ask every time" is the exception: there the overlay stays on screen
      // behind the save dialog, so blanking it would make the picture disappear
      // and then come back when the dialog is dismissed.
      const willHide = action === 'copy' || init?.settings.saveMode !== 'ask'
      setStage('busy')
      if (willHide) setBlanked(true)
      await afterPaint()
      window.flushot.concealOverlay(action === 'save')
      try {
        const layer = layerPayload()
        const result =
          action === 'save'
            ? await window.flushot.saveScreenshot(layer)
            : await window.flushot.copyScreenshot(layer)
        if (result.canceled) {
          // The save dialog was dismissed: the overlay is still up, because in
          // "ask every time" mode the main process never hid it.
          setBlanked(false)
          setStage('result')
          return
        }
        setStage('result')
        // Only reaches the user when something went wrong and the main process
        // put the overlay back; on success it is already off the screen.
        if (!result.ok) {
          setBlanked(false)
          showToast(result.message, 'error')
        }
      } catch (error) {
        setBlanked(false)
        setStage('result')
        showToast(error instanceof Error ? error.message : 'Не удалось выполнить действие', 'error')
      }
    },
    [afterPaint, init, layerPayload, showToast]
  )

  /**
   * Recognize the text on the picture.
   *
   * Nothing is hidden here: the panel sits next to the screenshot precisely so
   * the text can be compared with what is behind it.
   */
  const recognizeText = useCallback(async (region?: OcrRegion) => {
    if (DEMO) {
      setTextPanel({ status: 'failed', message: 'Демо-режим: распознавание недоступно' })
      return
    }
    setOcrPick(false)
    setOcrMarquee(null)
    setTextPanel({ status: 'loading', region })
    setTextUsed(true)
    try {
      const outcome = await window.flushot.recognizeText(layerPayload(), region)
      setTextPanel(
        outcome.ok
          ? { status: 'ready', outcome, region }
          : { status: 'failed', message: outcome.error ?? 'Распознать текст не удалось', region }
      )
    } catch (error) {
      setTextPanel({
        status: 'failed',
        message: error instanceof Error ? error.message : 'Распознать текст не удалось'
      })
    }
  }, [layerPayload])

  const copyRecognizedText = useCallback(async (text: string): Promise<string> => {
    try {
      await window.flushot.copyText(text)
      return 'Скопировано'
    } catch {
      return 'Не удалось'
    }
  }, [])

  // Start the engine when it is about to be needed.
  //
  // The worker takes about half a second to load the WinRT types. Warming it on
  // every result would spawn a PowerShell process for every screenshot, most of
  // which are never recognized — so it is started when the pointer reaches the
  // "Текст" button, and kept warm for the rest of the session once the user has
  // actually used it.
  useEffect(() => {
    if (stage !== 'result' || DEMO || !textUsed) return
    window.flushot.warmTextRecognition()
  }, [stage, textUsed])

  // Zoom keys. Kept out of the main handler so a caption being typed is never
  // affected: "+" and "0" are ordinary characters in text.
  useEffect(() => {
    if (stage !== 'result' || !zoomable) return
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return
      if (event.ctrlKey || event.metaKey || event.altKey) return

      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        setZoomValue(stepZoom(zoom, 1, fit))
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        setZoomValue(stepZoom(zoom, -1, fit))
      } else if (event.key === '0') {
        event.preventDefault()
        setZoomValue(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fit, stage, zoom, zoomable])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // `event.code` is the physical key, so the shortcut keeps working on a
      // Russian layout where `event.key` reports `с` instead of `c`.
      const isKey = (code: string, letter: string): boolean =>
        event.code === code || event.key.toLowerCase() === letter

      // Typing in the OCR editor must stay typing. Ctrl+C has to copy the selected
      // words rather than the picture, Ctrl+Z has to undo an edit rather than remove
      // an annotation, and Escape has to give the panel back its focus instead of
      // throwing away corrections that were just made.
      //
      // Ctrl+S is the exception: it is the app's own "save the screenshot" and means
      // the same thing with the caret in a field, so swallowing it would leave the
      // user pressing a key that visibly does nothing.
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') {
        if (event.key === 'Escape') {
          event.preventDefault()
          target?.blur()
          return
        }
        if (!((event.ctrlKey || event.metaKey) && isKey('KeyS', 's'))) return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        // Escape leaves the fragment picker first, then closes the text panel: both
        // are more recent than the result itself, and closing the whole capture
        // because the user changed their mind about selecting would be rude.
        if (ocrPick) {
          setOcrPick(false)
          setOcrMarquee(null)
        } else if (textPanel) setTextPanel(null)
        else if (stage === 'selecting' && selection.rect) resetSelection()
        else void closeOverlay()
        return
      }

      if (stage === 'selecting' && event.key === 'Enter') {
        event.preventDefault()
        void confirmSelection()
        return
      }

      // Copy works while the region is still being drawn, not only on the result.
      if (stage === 'selecting' && (event.ctrlKey || event.metaKey) && isKey('KeyC', 'c')) {
        event.preventDefault()
        void copySelection()
        return
      }

      if (stage === 'result' && (event.ctrlKey || event.metaKey)) {
        // A selection inside the text panel means the user is copying *text*:
        // the browser's own copy has to win, or Ctrl+C would put a picture on the
        // clipboard while the words they highlighted stay unselected.
        if (isKey('KeyC', 'c') && (window.getSelection()?.toString() ?? '') !== '') return
        if (isKey('KeyC', 'c')) {
          event.preventDefault()
          void runAction('copy')
        }
        if (isKey('KeyS', 's')) {
          event.preventDefault()
          void runAction('save')
        }
        if (isKey('KeyZ', 'z')) {
          event.preventDefault()
          setAnnotations((current) => current.slice(0, -1))
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmSelection, copySelection, resetSelection, runAction, stage, textPanel])

  // Ctrl+C is also registered globally while the overlay is open: this fires
  // even when Windows refuses to give the overlay keyboard focus.
  useEffect(() => {
    if (typeof window.flushot?.onCopyShortcut !== 'function') return
    return window.flushot.onCopyShortcut(() => {
      // The OCR editor is a text field, and the global shortcut swallows Ctrl+C
      // before the browser can act on it — so a selected word would copy nothing
      // while the *picture* went to the clipboard. Copy the words instead, which is
      // what "Ctrl+C" means when the caret is in a text field.
      const active = document.activeElement
      if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
        const selected = active.value.slice(active.selectionStart ?? 0, active.selectionEnd ?? 0)
        if (selected) void window.flushot.copyText(selected)
        return
      }
      // On the result screen the card already exists, so copy it instead of
      // composing the selection a second time.
      if (stage === 'result') void runAction('copy')
      else void copySelection()
    })
  }, [copySelection, runAction, stage])

  /**
   * The size the file will really have.
   *
   * On a mixed-DPI desk the old estimate — rectangle × the composite's scale
   * factor — was wrong by up to the ratio between the two screens: a rectangle on
   * a 100 % monitor was reported at 150 % of its true size. The crop plan is the
   * same one the main process uses to assemble the picture, so the badge cannot
   * disagree with the file.
   */
  const pixelSize = useMemo(() => {
    if (!init || !selection.rect) return null
    try {
      const monitors = init.display.monitors
      const sized = monitors?.filter((monitor) => monitor.imageWidth && monitor.imageHeight) ?? []
      if (sized.length > 0) {
        const desktopRect = selectionToDesktopRect(selection.rect, viewport, init.display.bounds)
        const plan = planNativeCrop(
          desktopRect,
          sized.map((monitor) => ({
            id: monitor.id,
            bounds: monitor.bounds,
            // The plan only ever uses the capture size, never this, but the type
            // keeps both because the main process has the real value to hand.
            scaleFactor: init.display.scaleFactor,
            imageWidth: monitor.imageWidth as number,
            imageHeight: monitor.imageHeight as number,
            rotation: monitor.rotation
          }))
        )
        return { width: plan.width, height: plan.height }
      }
      return selectionPixelSize(selection.rect, {
        bounds,
        imageWidth: init.display.imageWidth,
        imageHeight: init.display.imageHeight,
        scaleFactor: init.display.scaleFactor
      })
    } catch {
      return null
    }
  }, [bounds, init, selection.rect, viewport])

  /**
   * The frozen screenshot on an offscreen canvas. The censor tools read their
   * pixels from here, so a blurred region is built from the real screenshot
   * rather than from the downscaled preview.
   */
  const shotCanvas = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = shotCanvas.current ?? document.createElement('canvas')
    shotCanvas.current = canvas

    if (shot) {
      canvas.width = shot.width
      canvas.height = shot.height
      const context = canvas.getContext('2d')
      if (!context) return
      const pixels = new Uint8ClampedArray(shot.data.buffer as ArrayBuffer, shot.data.byteOffset, shot.width * shot.height * 4)
      context.putImageData(new ImageData(pixels, shot.width, shot.height), 0, 0)
      return
    }

    if (!shotUrl) return
    const image = new Image()
    image.onload = () => {
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      canvas.getContext('2d')?.drawImage(image, 0, 0)
    }
    image.src = shotUrl
  }, [shot, shotUrl])

  const frame = init?.settings.frameWidth ?? 0
  /** Picture size in output pixels: the frame is not part of it. */
  const picture = useMemo(() => {
    if (!size) return null
    return {
      width: Math.max(1, size.width - frame * 2),
      height: Math.max(1, size.height - frame * 2)
    }
  }, [size, frame])

  const source: SourceBox | null = useMemo(() => {
    const canvas = shotCanvas.current
    if (!canvas || !init || !selection.rect || canvas.width === 0) return null
    try {
      const area = selectionToImageRect(selection.rect, {
        bounds,
        imageWidth: init.display.imageWidth,
        imageHeight: init.display.imageHeight,
        scaleFactor: init.display.scaleFactor
      })
      return { canvas, x: area.x, y: area.y, width: area.width, height: area.height }
    } catch {
      return null
    }
  }, [bounds, init, selection.rect, shot])

  /**
   * Full-screen round: confirm on its own once the region is in place.
   *
   * The point of the second hotkey is one press and done — asking for Enter on
   * top of it would make it no faster than drawing the region by hand. The result
   * window still opens, so saving, copying and annotating all stay available.
   *
   * Declared above the `!init` early return: a hook after a conditional return
   * changes the hook count between renders, and React rejects that outright.
   */
  const fullscreenConfirmed = useRef<OverlayInit | null>(null)
  useEffect(() => {
    if (!init?.fullscreen || stage !== 'selecting') return
    const area = selection.rect
    if (!area || area.width < 8 || area.height < 8) return
    if (fullscreenConfirmed.current === init) return
    fullscreenConfirmed.current = init
    void confirmSelection()
  }, [confirmSelection, init, selection.rect, stage])

  if (!init) {
    return <div className="overlay-root" />
  }

  const rect = selection.rect
  const ready = rect !== null && rect.width >= 8 && rect.height >= 8
  /** Where the confirm bar and the size badge go; recomputed only when they move. */
  const barSpot = rect ? toolbarPlacement(rect, viewport) : null
  const badgeSpot = rect ? badgePlacement(rect, viewport) : null

  const dimStyle = rect
    ? ({
        '--sel-x': `${rect.x}px`,
        '--sel-y': `${rect.y}px`,
        '--sel-w': `${rect.width}px`,
        '--sel-h': `${rect.height}px`
      } as CSSProperties)
    : {}

  return (
    <div
      className={`overlay-root stage-${stage} ${rect ? 'has-selection' : ''} ${blanked ? 'is-blank' : ''}`}
      style={dimStyle}
      // Monitor rectangles in the overlay's own coordinates, exposed so the
      // self-test can prove the result card stayed on one screen. A combined
      // desktop has no other way to state where the bezels are.
      data-monitors={
        init?.display.monitors
          ? init.display.monitors
              .map((monitor) => {
                const left = monitor.bounds.x - init.display.bounds.x
                const top = monitor.bounds.y - init.display.bounds.y
                // The last field marks the primary monitor: the result must land
                // there, and that is what the self-test asserts.
                return `${left},${top},${monitor.bounds.width},${monitor.bounds.height},${monitor.primary ? 1 : 0}`
              })
              .join(';')
          : ''
      }
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
        if (stage !== 'selecting' || event.button !== 0) return
        const target = event.target as HTMLElement
        if (target.closest('.toolbar') || target.closest('.handle') || target.closest('.result-layer')) return
        event.preventDefault()
        selection.beginCreate(event.clientX, event.clientY)
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <ScreenShot bitmap={shot} url={shotUrl} geometry={init.display} />
      <div className="dim" />

      {stage === 'selecting' && rect && (
        <div
          className="selection"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.stopPropagation()
            event.preventDefault()
            selection.beginMove(event.clientX, event.clientY)
          }}
        >
          {HANDLES.map((handle) => (
            <span
              key={handle}
              className={`handle handle--${handle}`}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.stopPropagation()
                event.preventDefault()
                selection.beginResize(handle, event.clientX, event.clientY)
              }}
            />
          ))}
        </div>
      )}

      {stage === 'selecting' && rect && badgeSpot && (
        <div
          className={`size-badge ${badgeSpot.inside ? 'is-inside' : ''}`}
          style={{ left: badgeSpot.left, top: badgeSpot.top }}
        >
          <span className="size-badge__value">
            {pixelSize ? `${pixelSize.width} × ${pixelSize.height}` : `${Math.round(rect.width)} × ${Math.round(rect.height)}`}
          </span>
          {init.display.scaleFactor !== 1 && <span className="size-badge__hint">{Math.round(init.display.scaleFactor * 100)}%</span>}
        </div>
      )}

      {stage === 'selecting' && !rect && (
        <div className="hint" style={hintStyle}>
          <p className="hint__title">Выделите область экрана</p>
          <p className="hint__subtitle">
            Перетащите мышь, чтобы создать снимок · <kbd>Enter</kbd> — готово · <kbd>Ctrl</kbd>+<kbd>C</kbd> — скопировать ·{' '}
            <kbd>Esc</kbd> — отмена
          </p>
        </div>
      )}

      {stage === 'selecting' && ready && barSpot && (
        <div
          className={`toolbar toolbar--confirm ${barSpot.inside ? 'is-inside' : ''}`}
          style={{ left: barSpot.left, top: barSpot.top }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button className="tb tb--primary" onClick={() => void confirmSelection()} title="Открыть снимок для пометок (Enter)">
            <CheckIcon />
            <span>Создать</span>
          </button>
          {/* Copying straight from the selection is what most people reach for,
              and it used to be invisible: the only way was Ctrl+C, mentioned in
              a tooltip nobody opens. */}
          <button
            className="tb tb--with-key"
            onClick={() => void copySelection()}
            title="Скопировать сразу, без пометок (Ctrl+C)"
          >
            <CopyIcon />
            <span>Копировать</span>
            <kbd className="tb__key">Ctrl+C</kbd>
          </button>
          <span className="tb-divider" />
          <button className="tb" onClick={resetSelection} title="Сбросить выделение (Esc)">
            <RepeatIcon />
          </button>
          <button className="tb" onClick={() => void closeOverlay()} title="Закрыть (Esc)">
            <CloseIcon />
          </button>
        </div>
      )}

      {(stage === 'result' || stage === 'busy') && (
        <div
          className="result-layer"
          // One monitor, expressed in percentages of the desktop so the position
          // survives any rounding between DIP and CSS pixels.
          data-monitor={host ? host.monitor.id : 'all'}
          style={
            host
              ? {
                  left: `${host.left * 100}%`,
                  top: `${host.top * 100}%`,
                  width: `${host.width * 100}%`,
                  height: `${host.height * 100}%`
                }
              : { inset: 0 }
          }
        >
          <div
            className={`result-viewport ${panning ? 'is-panning' : ''} ${pannable ? 'is-pannable' : ''}`}
            ref={viewportRef}
            // Exposed for the self-test: fit is what the card was sized from, and
            // the scroll offsets prove that panning really reaches other parts.
            data-zoom={zoom.toFixed(3)}
            data-fit={fit.toFixed(3)}
            data-zoom-mode={zoomValue === null ? 'fit' : 'manual'}
            onPointerDown={(event) => {
              if (event.button !== 0 && event.button !== 1) return
              const node = viewportRef.current
              if (!node) return
              const onCard = Boolean((event.target as HTMLElement).closest('.result-card'))
              // The left button belongs to the drawing surface; only the middle
              // one pans from on top of the picture.
              if (onCard && event.button !== 1) return
              if (node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight) return
              event.preventDefault()
              panFrom.current = { x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop }
              try {
                // Not every pointer can be captured — a synthetic event from the
                // self-test has no active pointer, and that must not break the drag.
                node.setPointerCapture(event.pointerId)
              } catch {
                // Capturing is an optimisation: without it the drag still works
                // while the pointer stays over the viewport.
              }
              setPanning(true)
            }}
            onPointerMove={(event) => {
              const from = panFrom.current
              const node = viewportRef.current
              if (!from || !node) return
              node.scrollLeft = from.left - (event.clientX - from.x)
              node.scrollTop = from.top - (event.clientY - from.y)
            }}
            onPointerUp={() => {
              panFrom.current = null
              setPanning(false)
            }}
            onPointerCancel={() => {
              panFrom.current = null
              setPanning(false)
            }}
          >
            <div
              className={`result-card ${cardSize ? '' : 'result-card--placeholder'}`}
              // The card is exactly the picture at the current zoom, so a 100 %
              // view is one image pixel per device pixel and the frame around it
              // scales with it.
              style={cardSize ? { width: `${cardSize.width}px`, height: `${cardSize.height}px` } : undefined}
            >
              <div className="result-card__media">
                {preview ? (
                  <img
                    src={preview}
                    alt="Готовый снимок"
                    // The card already carries the exact size; the picture fills it
                    // instead of being stretched by the browser into a soft blur.
                    draggable={false}
                  />
                ) : (
                  <div className="result-card__placeholder" />
                )}

                {picture && size && (
                  <div
                    className="annotate-box"
                    data-annotations={annotations.length}
                    // Exposed for the self-test: the badge numbers are only in the
                    // raster otherwise, so there would be nothing to assert on.
                    data-step-numbers={annotations
                      .filter((annotation) => annotation.tool === 'step')
                      .map((annotation) => (annotation.tool === 'step' ? annotation.number : 0))
                      .join(',')}
                    // Position of the last caption, so the self-test can prove that
                    // the move tool really moved it.
                    data-text-at={lastTextPosition(annotations)}
                    // Endpoints of the last line: the raster cannot be measured, so
                    // "is it exactly horizontal" has to be answerable from here.
                    data-line-at={lastLineSegment(annotations)}
                    style={{
                      left: `${(frame / size.width) * 100}%`,
                      top: `${(frame / size.height) * 100}%`,
                      width: `${(picture.width / size.width) * 100}%`,
                      height: `${(picture.height / size.height) * 100}%`
                    }}
                  >
                    <AnnotationCanvas
                      width={picture.width}
                      height={picture.height}
                      annotations={annotations}
                      tool={tool}
                      color={color}
                      stroke={stroke}
                      textSize={textSize}
                      stepNumber={nextStepNumber(annotations)}
                      source={source}
                      onCommit={(annotation) => setAnnotations((current) => [...current, annotation])}
                      onRemove={(index) => setAnnotations((current) => current.filter((_, at) => at !== index))}
                      canvasRef={annotateCanvas}
                    />

                    {/* The fragment picker sits above the drawing surface and
                        swallows its pointer events while armed, so a drag selects
                        text instead of drawing an arrow. */}
                    {ocrPick && (
                      <div
                        className="ocr-pick"
                        data-ocr-pick={ocrMarquee ? `${ocrMarquee.width}x${ocrMarquee.height}` : 'none'}
                        onPointerDown={(event) => {
                          if (event.button !== 0) return
                          event.stopPropagation()
                          const box = event.currentTarget.getBoundingClientRect()
                          const at = pointInPicture(event, box, picture)
                          ocrDrag.current = at
                          setOcrMarquee({ x: at.x, y: at.y, width: 0, height: 0 })
                          try {
                            event.currentTarget.setPointerCapture(event.pointerId)
                          } catch {
                            // Not every pointer can be captured; the drag still works.
                          }
                        }}
                        onPointerMove={(event) => {
                          const from = ocrDrag.current
                          if (!from) return
                          const box = event.currentTarget.getBoundingClientRect()
                          const to = pointInPicture(event, box, picture)
                          setOcrMarquee({
                            x: Math.min(from.x, to.x),
                            y: Math.min(from.y, to.y),
                            width: Math.abs(to.x - from.x),
                            height: Math.abs(to.y - from.y)
                          })
                        }}
                        onPointerUp={(event) => {
                          const from = ocrDrag.current
                          ocrDrag.current = null
                          setOcrMarquee(null)
                          if (!from) return
                          // Measured from the event, not from state: a fast drag can
                          // release before the last move has been painted.
                          const box = event.currentTarget.getBoundingClientRect()
                          const to = pointInPicture(event, box, picture)
                          const rect = {
                            x: Math.min(from.x, to.x),
                            y: Math.min(from.y, to.y),
                            width: Math.abs(to.x - from.x),
                            height: Math.abs(to.y - from.y)
                          }
                          // A click without a drag means the whole picture.
                          if (rect.width < 8 || rect.height < 8) void recognizeText()
                          else void recognizeText(rect)
                        }}
                        onPointerCancel={() => {
                          ocrDrag.current = null
                          setOcrMarquee(null)
                        }}
                      >
                        {ocrMarquee && ocrMarquee.width > 0 && ocrMarquee.height > 0 ? (
                          <span
                            className="ocr-pick__rect"
                            style={{
                              left: `${(ocrMarquee.x / picture.width) * 100}%`,
                              top: `${(ocrMarquee.y / picture.height) * 100}%`,
                              width: `${(ocrMarquee.width / picture.width) * 100}%`,
                              height: `${(ocrMarquee.height / picture.height) * 100}%`
                            }}
                          />
                        ) : (
                          <span className="ocr-pick__hint">Выделите область с текстом</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {stage === 'busy' && <div className="result-card__busy" />}
            </div>
          </div>
          <div className="result-caption" data-size={size ? `${size.width}×${size.height}` : ''}>
            {size ? (
              <>
                {size.width} × {size.height}
                <span className="result-caption__dot" />
                {formatRatio(size.width, size.height)}
              </>
            ) : (
              <>Готово</>
            )}
            {/* The tester who reported this kept pressing "Создать", because
                nothing on screen said the picture was already finished. The keys
                are on the buttons; this line says what they do without the
                user having to hover anything. */}
            <span className="result-caption__dot" />
            <span className="result-caption__hint">
              <kbd>Ctrl</kbd>+<kbd>C</kbd> скопировать · <kbd>Ctrl</kbd>+<kbd>S</kbd> сохранить
            </span>
          </div>

          <div className="toolbar toolbar--annotate" onPointerDown={(event) => event.stopPropagation()}>
            {(
              [
                ['arrow', ArrowIcon, 'Стрелка'],
                ['line', LineIcon, 'Линия (Shift — ровно)'],
                ['rect', RectIcon, 'Рамка'],
                ['pen', PenIcon, 'Карандаш'],
                ['text', TextIcon, 'Текст'],
                ['step', StepIcon, 'Нумерация шагов'],
                ['move', MoveIcon, 'Перемещение'],
                ['blur', BlurIcon, 'Скрыть область']
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                key={value}
                className={`tb tb--tool ${tool === value ? 'is-active' : ''}`}
                disabled={stage === 'busy'}
                onClick={() => {
                  setTool(value)
                  setOcrPick(false)
                  setOcrMarquee(null)
                }}
                title={label}
                aria-label={label}
                aria-pressed={tool === value}
              >
                <Icon />
              </button>
            ))}

            <span className="tb-divider" />

            {ANNOTATION_COLORS.map((swatch) => (
              <button
                key={swatch}
                className={`swatch ${color === swatch ? 'is-active' : ''}`}
                style={{ background: swatch }}
                disabled={stage === 'busy'}
                onClick={() => setColor(swatch)}
                title={swatch}
                aria-label={`Цвет ${swatch}`}
              />
            ))}

            <span className="tb-divider" />

            {/* Text and step badges get a size control: a "line width" means
                nothing for either, and both are what users enlarge most. The
                move tool creates nothing, so it offers neither. */}
            {tool === 'text' || tool === 'step'
              ? TEXT_SIZES.map((value, index) => (
                  <button
                    key={value}
                    className={`tb tb--text-size ${textSize === value ? 'is-active' : ''}`}
                    disabled={stage === 'busy'}
                    onClick={() => setTextSize(value)}
                    title={tool === 'step' ? `Размер метки: ${TEXT_SIZE_LABELS[index].toLowerCase()}` : TEXT_SIZE_LABELS[index]}
                    aria-label={TEXT_SIZE_LABELS[index]}
                    aria-pressed={textSize === value}
                  >
                    <span className="text-size" style={{ fontSize: 9 + index * 3 }}>
                      A
                    </span>
                  </button>
                ))
              : tool === 'move'
                ? null
                : STROKE_WIDTHS.map((value, index) => (
                    <button
                      key={value}
                      className={`tb tb--stroke ${stroke === value ? 'is-active' : ''}`}
                      disabled={stage === 'busy'}
                      onClick={() => setStroke(value)}
                      title={['Тонкая линия', 'Обычная линия', 'Толстая линия'][index]}
                      aria-label={['Тонкая линия', 'Обычная линия', 'Толстая линия'][index]}
                      aria-pressed={stroke === value}
                    >
                      <span className="stroke-dot" style={{ width: 5 + index * 4, height: 5 + index * 4 }} />
                    </button>
                  ))}

            <span className="tb-divider" />

            <button
              className="tb"
              disabled={stage === 'busy' || annotations.length === 0}
              onClick={() => setAnnotations((current) => current.slice(0, -1))}
              title="Отменить пометку (Ctrl+Z)"
            >
              <UndoIcon />
            </button>
          </div>

          <div className="toolbar toolbar--actions" onPointerDown={(event) => event.stopPropagation()}>
            <button
              className="tb tb--primary tb--with-key"
              disabled={stage === 'busy'}
              onClick={() => void runAction('copy')}
              title="Скопировать в буфер (Ctrl+C)"
            >
              <CopyIcon />
              <span>Копировать</span>
              <kbd className="tb__key">Ctrl+C</kbd>
            </button>
            <button
              className="tb tb--with-key"
              disabled={stage === 'busy'}
              onClick={() => void runAction('save')}
              title="Сохранить (Ctrl+S)"
            >
              <SaveIcon />
              <span>Сохранить</span>
              <kbd className="tb__key">Ctrl+S</kbd>
            </button>

            <span className="tb-divider" />
            <button
              className={`tb ${textPanel || ocrPick ? 'is-active' : ''}`}
              disabled={stage === 'busy'}
              // Arms the fragment picker instead of reading the whole picture: a
              // click on the picture then reads everything, a drag reads only that
              // piece. One button, both answers, no mode the user has to discover.
              onClick={() => {
                setOcrPick((current) => !current)
                setOcrMarquee(null)
              }}
              // The engine needs ~0.5 s to load; reaching for the button is
              // enough warning to start it, and costs nothing when nobody does.
              onPointerEnter={() => window.flushot.warmTextRecognition()}
              title={
                ocrPick
                  ? 'Выделите на снимке область с текстом'
                  : 'Распознать текст: выделите область или кликните по снимку'
              }
            >
              <TextScanIcon />
              <span>Текст</span>
            </button>

            {/* A capture that spans two monitors is bigger than one screen. The
                slider goes from "everything visible" to 100 %, and the picture
                scrolls in between — otherwise half of it could never be edited. */}
            {zoomable && (
              <>
                <span className="tb-divider" />
                <div className="zoom" onPointerDown={(event) => event.stopPropagation()}>
                  <button
                    className="tb tb--zoom"
                    disabled={stage === 'busy' || zoom <= fit + 0.001}
                    onClick={() => setZoomValue(stepZoom(zoom, -1, fit))}
                    title="Уменьшить (−)"
                    aria-label="Уменьшить масштаб"
                  >
                    <ZoomOutIcon />
                  </button>
                  <input
                    type="range"
                    className="zoom__slider"
                    min={Math.round(fit * 100)}
                    max={100}
                    step={1}
                    value={Math.round(zoom * 100)}
                    disabled={stage === 'busy'}
                    onChange={(event) => setZoomValue(clampZoom(Number(event.target.value) / 100, fit))}
                    aria-label="Масштаб"
                  />
                  <button
                    className="tb tb--zoom"
                    disabled={stage === 'busy' || zoom >= 0.999}
                    onClick={() => setZoomValue(stepZoom(zoom, 1, fit))}
                    title="Увеличить (+)"
                    aria-label="Увеличить масштаб"
                  >
                    <ZoomInIcon />
                  </button>
                  <span className="zoom__value" data-zoom-label>
                    {zoomLabel(zoom)}
                  </span>
                  <button
                    className={`tb tb--zoom ${zoomValue === null ? 'is-active' : ''}`}
                    disabled={stage === 'busy'}
                    onClick={() => setZoomValue(null)}
                    title="Вписать в экран (0)"
                    aria-label="Вписать в экран"
                    aria-pressed={zoomValue === null}
                  >
                    <FitIcon />
                  </button>
                </div>
              </>
            )}

            <span className="tb-divider" />
            <button className="tb" disabled={stage === 'busy'} onClick={resetSelection} title="Выделить заново">
              <RepeatIcon />
            </button>
            <button
              className="tb"
              disabled={stage === 'busy'}
              onClick={() => void closeOverlay()}
              title="Отменить (Esc)"
            >
              <CloseIcon />
            </button>
          </div>

          {/* Inside the result layer, not the overlay root: the overlay spans every
              monitor, so a panel anchored to it opened across the seam between two
              screens. The layer is exactly one monitor — the primary one. */}
          {textPanel && (
            <TextPanel
              state={textPanel}
              onCopy={copyRecognizedText}
              onClose={() => setTextPanel(null)}
              onRetry={() => void recognizeText(textPanel.region)}
            />
          )}
        </div>
      )}

      {toast && (
        <div className={`toast toast--${toast.tone}`} role="status" style={toastStyle}>
          <span className="toast__dot" />
          {toast.text}
        </div>
      )}

      <span className="display-tag">
        {init.display.label} · {Math.round(init.display.scaleFactor * 100)}%
      </span>
    </div>
  )
}

/**
 * Frozen screen backdrop. Pixels arrive as raw RGBA, so they are blitted
 * straight onto a canvas instead of being decoded from PNG first. The canvas is
 * sized from the display geometry during the first render, so allocating the
 * backing store does not delay the frame itself.
 */
/** Aspect ratio in short whole numbers, e.g. 1600×900 → 16:9. */
function formatRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const divisor = gcd(width, height) || 1
  const left = width / divisor
  const right = height / divisor
  // A ratio like 1013:569 tells the user nothing, so fall back to a decimal.
  if (left > 40 || right > 40) return `${(width / height).toFixed(2)}:1`
  return `${left}:${right}`
}

function ScreenShot({
  bitmap,
  url,
  geometry
}: {
  bitmap: BitmapPayload | null
  url: string | null
  geometry: { imageWidth: number; imageHeight: number }
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return

    if (bitmap) {
      const { data, width, height } = bitmap
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) return
      const pixels = new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, width * height * 4)
      context.putImageData(new ImageData(pixels, width, height), 0, 0)
      window.flushot?.reportOverlayPainted?.()
      return
    }

    if (!url) return
    const image = new Image()
    image.onload = () => {
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      canvas.getContext('2d')?.drawImage(image, 0, 0)
    }
    image.src = url
  }, [bitmap, url])

  return (
    <canvas
      ref={ref}
      className="screen-shot"
      width={geometry.imageWidth}
      height={geometry.imageHeight}
    />
  )
}

/**
 * Endpoints of the newest line annotation as `x1,y1>x2,y2`.
 *
 * Purely diagnostic: whether the line tool produced a straight segment is not
 * visible in any DOM node, and the raster cannot be measured from the self-test.
 */
function lastLineSegment(annotations: readonly Annotation[]): string {
  for (let index = annotations.length - 1; index >= 0; index--) {
    const annotation = annotations[index]
    if (annotation.tool !== 'line') continue
    const at = (point: { x: number; y: number }): string => `${point.x.toFixed(4)},${point.y.toFixed(4)}`
    return `${at(annotation.from)}>${at(annotation.to)}`
  }
  return ''
}

/**
 * Position of the newest text annotation, as `x,y` rounded to three decimals.
 *
 * Purely diagnostic: the coordinates of a caption only exist in the raster
 * otherwise, so there would be nothing for the self-test to assert on.
 */
function lastTextPosition(annotations: readonly Annotation[]): string {
  for (let index = annotations.length - 1; index >= 0; index--) {
    const annotation = annotations[index]
    if (annotation.tool === 'text') return `${annotation.at.x.toFixed(3)},${annotation.at.y.toFixed(3)}`
  }
  return ''
}

/**
 * Largest CSS width at which the result can be shown without upscaling.
 *
 * One image pixel covers exactly one device pixel, so the card is crisp on both
 * normal and HiDPI screens. The card's own CSS cap still applies: an inline
 * `max-width` would otherwise override it and let a huge capture run off screen.
 */
/**
 * Width in physical pixels that the result preview occupies on screen.
 *
 * The card can be shown at up to 100 %, which on the host monitor means almost
 * its full width — asking for a 720 px preview made the browser stretch it by up
 * to 1.5×, and that is exactly the softness the user sees. The main process never
 * upscales, so asking for more than a small capture needs is harmless.
 */
/** A pointer position, converted from CSS pixels to picture pixels. */
function pointInPicture(
  event: { clientX: number; clientY: number },
  box: { left: number; top: number; width: number; height: number },
  picture: { width: number; height: number }
): { x: number; y: number } {
  const x = box.width > 0 ? ((event.clientX - box.left) / box.width) * picture.width : 0
  const y = box.height > 0 ? ((event.clientY - box.top) / box.height) * picture.height : 0
  return {
    x: Math.round(Math.max(0, Math.min(picture.width, x))),
    y: Math.round(Math.max(0, Math.min(picture.height, y)))
  }
}

function resultPreviewWidth(hostWidth: number): number {
  const ratio = window.devicePixelRatio || 1
  const cssWidth = Math.max(480, hostWidth - LAYER_PADDING * 2)
  return Math.round(Math.min(2560, cssWidth * ratio))
}

/**
 * Placement of the confirm bar and the size badge next to the selection.
 *
 * Both use the same rule, so a full-screen selection keeps its buttons on screen
 * instead of pushing them past the bottom edge: the bar prefers to sit outside
 * the selection and falls back to its inside edge when there is no room.
 */
function toolbarPlacement(rect: Rect, viewport: { width: number; height: number }): ChromePlacement {
  // Height matches `.toolbar` (38 px buttons + 6 px padding + border); width is
  // the widest state of the confirm bar: "Создать", "Копировать" with its key cap,
  // a divider and two icon buttons.
  return placeBar(rect, viewport, { width: 392, height: 52 })
}

function badgePlacement(rect: Rect, viewport: { width: number; height: number }): ChromePlacement {
  return placeBar(rect, viewport, { width: 118, height: 26 }, 12)
}
