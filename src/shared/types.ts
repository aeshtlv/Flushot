export type ThemeMode = 'light' | 'dark'
export type BackgroundPreset = 'white' | 'gray' | 'custom'
export type ImageFormat = 'png' | 'jpeg' | 'webp'
export type SaveMode = 'folder' | 'ask'

/** Persisted user preferences. */
export interface ScreenshotSettings {
  theme: ThemeMode
  backgroundPreset: BackgroundPreset
  /** Custom background colour, `#RRGGBB`. */
  backgroundColor: string
  /** Width of the frame painted around the screenshot, 0–200 px. */
  frameWidth: number
  /** Corner radius of the picture inside the frame, 0–24 px. */
  cornerRadius: number
  /** Extra colours shown in the palette next to the built-in ones. */
  paletteColors: string[]
  shadowEnabled: boolean
  /** 0–60, alpha of the shadow as a percentage. */
  shadowIntensity: number
  /** Blur radius in output pixels, 0–48. */
  shadowBlur: number
  /** Vertical shadow offset in output pixels, 0–24. */
  shadowOffsetY: number
  /** Folder used for automatic saving. */
  saveDirectory: string
  /** Automatically write files with generated names, or ask for a location. */
  saveMode: SaveMode
  format: ImageFormat
  /** Lossy quality for JPEG and WebP, 60–100. */
  jpegQuality: number
  /** Global accelerator that starts a capture, e.g. `CommandOrControl+Shift+S`. */
  hotkey: string
  /**
   * Global accelerator that grabs the whole screen at once, with the region
   * already selected — one key press, no dragging.
   */
  hotkeyFullscreen: string
  /** Start Flushot in the tray when the user logs in to Windows. */
  launchAtLogin: boolean
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

/**
 * Tools offered in the annotation bar.
 *
 * `move` creates nothing: it is the mode in which an existing annotation can be
 * dragged somewhere else. Keeping it a tool (rather than a modifier) means the
 * drawing tools never have to guess whether a drag draws or moves.
 */
export type AnnotationTool = 'arrow' | 'line' | 'rect' | 'pen' | 'text' | 'step' | 'blur' | 'move'

/**
 * Coordinates are normalized to the picture, not to the framed canvas: (0,0) is
 * the top-left corner of the screenshot itself and (1,1) the bottom-right one.
 * That way the same annotation renders correctly at any output size, and the
 * frame can be resized without moving the drawing.
 */
export interface Point {
  x: number
  y: number
}

interface AnnotationBase {
  /** Stroke colour, `#RRGGBB`. */
  color: string
  /** Stroke width as a fraction of the picture's smaller side. */
  width: number
}

export interface ArrowAnnotation extends AnnotationBase {
  tool: 'arrow'
  from: Point
  to: Point
}

/**
 * A straight segment, with no head.
 *
 * Separate from `arrow` because the use cases differ: an arrow points at
 * something, a line underlines it. Dragging with Shift held snaps the segment to
 * 0°, 45° or 90°, which is what makes an underline actually straight.
 */
export interface LineAnnotation extends AnnotationBase {
  tool: 'line'
  from: Point
  to: Point
}

export interface RectAnnotation extends AnnotationBase {
  tool: 'rect'
  from: Point
  to: Point
}

export interface PenAnnotation extends AnnotationBase {
  tool: 'pen'
  points: Point[]
}

export interface TextAnnotation extends AnnotationBase {
  tool: 'text'
  at: Point
  text: string
  /** Font size as a fraction of the picture's smaller side. */
  size: number
}

export interface BlurAnnotation {
  tool: 'blur'
  from: Point
  to: Point
  /** `blur` keeps shapes readable but hidden, `pixelate` is the classic censor. */
  mode: 'blur' | 'pixelate'
}

/**
 * A numbered badge: the "1, 2, 3" of an instruction.
 *
 * The number is stored rather than derived from the position in the list, so
 * undoing an arrow drawn between two badges never renumbers the badges.
 */
export interface StepAnnotation extends AnnotationBase {
  tool: 'step'
  at: Point
  /** Badge diameter as a fraction of the picture's smaller side. */
  size: number
  /** The digit(s) inside the badge, starting at 1. */
  number: number
}

export type Annotation =
  | ArrowAnnotation
  | LineAnnotation
  | RectAnnotation
  | PenAnnotation
  | TextAnnotation
  | StepAnnotation
  | BlurAnnotation

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A monitor as seen by the capture layer. */
export interface DisplayDescriptor {
  id: string
  label: string
  /** Bounds in device-independent pixels (Electron screen coordinates). */
  bounds: Rect
  scaleFactor: number
  /** Physical pixel size of the frozen screenshot served to the overlay. */
  imageWidth: number
  imageHeight: number
  /**
   * Individual monitors inside a combined desktop, in the same DIP space as
   * `bounds`. A single-monitor capture omits it: the descriptor itself is then
   * the only monitor.
   */
  monitors?: MonitorBounds[]
}

/** One physical monitor inside the virtual desktop. */
export interface MonitorBounds {
  id: string
  bounds: Rect
  /** True for the monitor Windows treats as primary; the result card goes there. */
  primary?: boolean
  /**
   * Physical pixel size of this monitor's own capture.
   *
   * Carried through to the overlay so the size badge can report the pixels that
   * will really be written. On a mixed-DPI desk the composite is not a reliable
   * source for that: a 100 % screen is upscaled inside it.
   */
  imageWidth?: number
  imageHeight?: number
  /** Rotation Windows reports: 0, 90, 180 or 270. */
  rotation?: number
}

/** Selection expressed in device-independent pixels relative to a display. */
export interface CaptureSelection {
  displayId: string
  rect: Rect
  /** Actual overlay viewport size in CSS pixels; may differ from display bounds by rounding. */
  viewport?: { width: number; height: number }
  /**
   * `preview` composes the card, shows it and saves it (default).
   * `copy` composes it and puts it straight into the clipboard, then closes the
   * overlay — this is what Ctrl+C does while the region is being selected.
   */
  intent?: 'preview' | 'copy'
  /**
   * Pixel width the result preview will be displayed at, multiplied by the
   * display's device pixel ratio. The preview is rendered at exactly this size,
   * so it is never upscaled on screen and looks as sharp as the saved file.
   */
  previewWidth?: number
}

/** Frozen screen content as raw RGBA pixels (physical resolution). */
export interface BitmapPayload {
  data: Uint8Array
  width: number
  height: number
}

/**
 * The user's drawing, as pixels, ready to be pasted into the composed card.
 *
 * Raw RGBA with an offset, not a base64 PNG: the main process would only have to
 * decode an encoded layer again, and encoding it in the renderer blocked the UI
 * thread for ~150 ms on a 4K picture while the user waited for the save. Only the
 * rectangle that actually carries paint travels, which for a couple of arrows is
 * a few hundred kilobytes instead of a whole screen of pixels.
 */
export interface AnnotationLayerPayload {
  /** Offset inside the picture, in picture pixels. */
  x: number
  y: number
  width: number
  height: number
  /** RGBA, four bytes per pixel, row-major, exactly `width × height × 4` bytes. */
  data: Uint8Array
}

/** Data handed to an overlay window on startup. Kept small on purpose. */
export interface OverlayInit {
  display: DisplayDescriptor
  settings: ScreenshotSettings
  hotkey: string
  /**
   * True when the round was started by the full-screen hotkey: the overlay opens
   * with the whole primary monitor already selected, so the user only has to
   * confirm, copy or annotate.
   */
  fullscreen?: boolean
}

/**
 * The frozen frame itself, fetched separately from `OverlayInit`.
 *
 * Separating the two lets the overlay window appear as soon as the screen is
 * captured, while the ~8 MB bitmap is still in flight, instead of showing
 * nothing for the whole round trip.
 */
export type OverlayShot = BitmapPayload

/** Frame pushed to a warm overlay window on every hotkey press. */
export interface OverlayFrame {
  display: DisplayDescriptor
  shot: OverlayShot
  /** See `OverlayInit.fullscreen`: the region arrives already selected. */
  fullscreen?: boolean
}

export interface ActionResult {
  ok: boolean
  message: string
  path?: string
  canceled?: boolean
  /** Small data-URL preview of the composed result. */
  preview?: string
  /** Pixel size of the composed result, so the UI can show the real numbers. */
  width?: number
  height?: number
}

export interface DisplayCaptureSnapshot {
  display: DisplayDescriptor
  /** Frozen screen content as a PNG buffer at physical resolution. */
  image: Buffer
}

/**
 * A word the OCR engine found, in picture pixels.
 *
 * Boxes are already mapped back from any enlargement done before recognition, so
 * they line up with the picture the user selected.
 */
export interface OcrWord {
  text: string
  x: number
  y: number
  width: number
  height: number
}

export interface OcrLine {
  text: string
  words: OcrWord[]
}

/** What the overlay needs to show the recognized text and let it be copied. */
export interface OcrOutcome {
  ok: boolean
  lines: OcrLine[]
  /** Plain text, one line per recognized line. */
  text?: string
  /** Engine whose reading became the base, e.g. `ru`. */
  lang?: string
  /** Every engine whose text ended up in the result, base first. */
  languages?: string[]
  error?: string
}

/** A rectangle of the picture, in picture pixels, to recognize instead of all of it. */
export interface OcrRegion {
  x: number
  y: number
  width: number
  height: number
}
