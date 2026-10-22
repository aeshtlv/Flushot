import { describe, expect, it } from 'vitest'
import { resolveLaunchTarget } from '../src/shared/launch'
import { contrastTextColor, nextStepNumber, stepRadius, textFontSize } from '../src/shared/annotate'
import type { Annotation } from '../src/shared/types'

describe('autostart — what Windows launches', () => {
  it('points at the installed exe with --hidden, so login stays in the tray', () => {
    const target = resolveLaunchTarget({
      execPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\Flushot\\Flushot.exe',
      packaged: true,
      appPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\Flushot\\resources\\app.asar'
    })
    expect(target.path).toBe('C:\\Users\\me\\AppData\\Local\\Programs\\Flushot\\Flushot.exe')
    expect(target.args).toEqual(['--hidden'])
  })

  it('uses the portable exe, not the temporary extraction folder', () => {
    // A portable build unpacks into %TEMP% and deletes it on exit; registering
    // that path would leave a dead autostart entry after the first reboot.
    const target = resolveLaunchTarget({
      portable: 'D:\\Tools\\Flushot-1.7.0-portable.exe',
      execPath: 'C:\\Users\\me\\AppData\\Local\\Temp\\1f3a\\Flushot.exe',
      packaged: true,
      appPath: 'C:\\Users\\me\\AppData\\Local\\Temp\\1f3a\\resources\\app.asar'
    })
    expect(target.path).toBe('D:\\Tools\\Flushot-1.7.0-portable.exe')
    expect(target.args).toEqual(['--hidden'])
  })

  it('passes the app directory when running unpackaged', () => {
    const target = resolveLaunchTarget({
      execPath: 'C:\\project\\node_modules\\electron\\dist\\electron.exe',
      packaged: false,
      appPath: 'C:\\project'
    })
    expect(target.path).toContain('electron.exe')
    expect(target.args).toEqual(['C:\\project', '--hidden'])
  })

  it('ignores an empty PORTABLE_EXECUTABLE_FILE', () => {
    const target = resolveLaunchTarget({ portable: '', execPath: 'C:\\app\\Flushot.exe', packaged: true, appPath: 'x' })
    expect(target.path).toBe('C:\\app\\Flushot.exe')
  })
})

describe('numbered steps', () => {
  const step = (number: number): Annotation => ({ tool: 'step', color: '#FF3B30', width: 0.004, at: { x: 0.5, y: 0.5 }, size: 0.05, number })

  it('starts at 1 on an empty picture', () => {
    expect(nextStepNumber([])).toBe(1)
  })

  it('continues after the highest badge', () => {
    expect(nextStepNumber([step(1), step(2)])).toBe(3)
  })

  it('ignores other annotations', () => {
    const arrow: Annotation = { tool: 'arrow', color: '#000000', width: 0.004, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }
    expect(nextStepNumber([arrow, step(1)])).toBe(2)
  })

  it('reuses the number after an undo, so the sequence stays gapless', () => {
    // 1, 2, 3 drawn; the last one undone → the next badge is 3 again.
    const afterUndo = [step(1), step(2)]
    expect(nextStepNumber(afterUndo)).toBe(3)
  })

  it('does not renumber when a badge is missing from the middle', () => {
    // Undo removes the newest annotation only, but the numbering must still be
    // driven by the maximum rather than by the count.
    expect(nextStepNumber([step(1), step(3)])).toBe(4)
  })

  it('scales the badge with the picture, with a readable floor', () => {
    expect(stepRadius(0.05, 1000, 800)).toBe(20)
    expect(stepRadius(0.05, 100, 80)).toBe(8)
  })
})

describe('contrastTextColor', () => {
  it('uses dark digits on light badges', () => {
    expect(contrastTextColor('#FFD60A')).toBe('#111111')
    expect(contrastTextColor('#FFFFFF')).toBe('#111111')
  })

  it('uses light digits on dark badges', () => {
    expect(contrastTextColor('#FF3B30')).toBe('#FFFFFF')
    expect(contrastTextColor('#0A84FF')).toBe('#FFFFFF')
    expect(contrastTextColor('#000000')).toBe('#FFFFFF')
  })

  it('falls back to white on an unparseable colour', () => {
    expect(contrastTextColor('nonsense')).toBe('#FFFFFF')
  })
})

describe('textFontSize', () => {
  it('scales with the shorter side', () => {
    expect(textFontSize(0.05, 1000, 800)).toBe(40)
  })

  it('never goes below a readable 10 px', () => {
    expect(textFontSize(0.01, 100, 100)).toBe(10)
  })
})
