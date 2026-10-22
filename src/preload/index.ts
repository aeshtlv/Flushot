import { contextBridge, ipcRenderer } from 'electron'
import type {
  ActionResult,
  AnnotationLayerPayload,
  CaptureSelection,
  OverlayFrame,
  OverlayInit,
  OcrOutcome,
  OcrRegion,
  OverlayShot,
  ScreenshotSettings
} from '../shared/types'

const api = {
  // ---- overlay ----
  getOverlayInit: (): Promise<OverlayInit> => ipcRenderer.invoke('overlay:init'),
  /** Frozen frame; resolves as soon as the screen capture has finished. */
  getOverlayShot: (): Promise<OverlayShot> => ipcRenderer.invoke('overlay:shot'),
  /** New frame pushed into an already warm window. */
  onOverlayFrame: (callback: (frame: OverlayFrame) => void): (() => void) => {
    const listener = (_event: unknown, frame: OverlayFrame): void => callback(frame)
    ipcRenderer.on('overlay:frame', listener)
    return () => ipcRenderer.removeListener('overlay:frame', listener)
  },
  captureSelection: (selection: CaptureSelection): Promise<ActionResult> =>
    ipcRenderer.invoke('capture:selection', selection),
  /** `annotations` is the drawing as raw RGBA of the area that has paint, if any. */
  saveScreenshot: (annotations?: AnnotationLayerPayload): Promise<ActionResult> =>
    ipcRenderer.invoke('result:save', annotations),
  copyScreenshot: (annotations?: AnnotationLayerPayload): Promise<ActionResult> =>
    ipcRenderer.invoke('result:copy', annotations),
  /**
   * Take the overlay off the screen right now, before measuring the drawing.
   *
   * Deliberately not awaited and not an `invoke`: the point is that the hide is
   * already in flight while the renderer is still scanning the canvas, so the
   * user sees their desktop again one frame after the click instead of after the
   * whole encode.
   */
  concealOverlay: (keepForDialog?: boolean): void => ipcRenderer.send('overlay:conceal', keepForDialog),
  /** Text on the picture, with the drawing already taken into account. */
  recognizeText: (annotations?: AnnotationLayerPayload, region?: OcrRegion): Promise<OcrOutcome> =>
    ipcRenderer.invoke('result:ocr', annotations, region),
  /** Start the OCR engine in the background; safe to call repeatedly. */
  warmTextRecognition: (): void => ipcRenderer.send('result:warm-ocr'),
  /** Put plain text on the clipboard (recognized text, not a picture). */
  copyText: (text: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('clipboard:write-text', text),
  cancelCapture: (): Promise<void> => ipcRenderer.invoke('capture:cancel'),
  openSettings: (): Promise<void> => ipcRenderer.invoke('settings:open'),
  onOverlayReset: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('overlay:reset', listener)
    return () => ipcRenderer.removeListener('overlay:reset', listener)
  },
  /** Ctrl+C captured by the global shortcut while the overlay is open. */
  onCopyShortcut: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('overlay:copy-shortcut', listener)
    return () => ipcRenderer.removeListener('overlay:copy-shortcut', listener)
  },
  /** First paint of the overlay window, used for latency measurements. */
  reportOverlayReady: (): void => ipcRenderer.send('overlay:ready'),
  /** Moment the frozen frame is on the canvas. */
  reportOverlayPainted: (): void => ipcRenderer.send('overlay:painted'),

  // ---- settings window ----
  getSettings: (): Promise<ScreenshotSettings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: Partial<ScreenshotSettings>): Promise<ScreenshotSettings> =>
    ipcRenderer.invoke('settings:update', patch),
  resetSettings: (): Promise<ScreenshotSettings> => ipcRenderer.invoke('settings:reset'),
  /**
   * Ask whether a combination can really be taken, before saving it.
   *
   * `owner` names the system feature holding it when that is known, because
   * "занята другой программой" is wrong advice for a key Windows reserves.
   */
  probeHotkey: (accelerator: string): Promise<{ free: boolean; owner?: string; hint?: string; ours?: boolean; invalid?: boolean }> =>
    ipcRenderer.invoke('hotkey:probe', accelerator),
  pickDirectory: (): Promise<{ canceled: boolean; path?: string }> => ipcRenderer.invoke('settings:pick-directory'),
  /**
   * Sample card rendered with the current settings.
   *
   * `width` is the CSS width it will be displayed at; the main process renders at
   * that width times the device pixel ratio, so the preview stays sharp when the
   * window is stretched.
   */
  getPreview: (width?: number): Promise<string> => ipcRenderer.invoke('settings:preview', width),
  openSaveFolder: (): Promise<void> => ipcRenderer.invoke('shell:open-folder'),
  getAppInfo: (): Promise<{ version: string; hotkey: string; settingsPath: string }> =>
    ipcRenderer.invoke('app:info'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close')
}

export type FlushotApi = typeof api

contextBridge.exposeInMainWorld('flushot', api)
