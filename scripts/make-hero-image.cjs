/**
 * Builds the hero image and the framed sample for the site and the README.
 *
 * Why this exists: the previous hero was `sample-framed.png`, produced by the
 * self-test from a capture of the live primary display. That is fine as a test
 * artefact and wrong as marketing — it publishes whatever happened to be open on
 * the author's desktop. Here the same pipeline runs on the synthetic demo scene,
 * so the picture is a real Flushot output (real frame, real shadow, real radius,
 * same code path) of content that was designed for publication.
 *
 * The imaging module does not depend on Electron, so it is compiled and called
 * from plain Node.
 *
 * Usage: node scripts/make-hero-image.cjs
 */

const path = require('node:path')
const fs = require('node:fs/promises')
const { execFileSync } = require('node:child_process')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..')
const BUILD = path.join(ROOT, '.tmp', 'imaging-build')
const OUT = path.join(ROOT, 'docs')

/** Compile only what the compositor needs. Pulling in main/index.ts would drag
 *  Electron into a plain Node process. */
function compileImaging() {
  const files = [
    'src/main/imaging/compose.ts',
    'src/main/imaging/layout.ts',
    'src/main/imaging/raster.ts',
    'src/main/imaging/annotations.ts',
    'src/main/imaging/color.ts',
    'src/shared/settings.ts',
    'src/shared/types.ts',
    'src/shared/annotate.ts',
    'src/shared/hotkey.ts'
  ]

  execFileSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
      ...files,
      '--outDir',
      BUILD,
      '--module',
      'commonjs',
      '--target',
      'ES2022',
      '--moduleResolution',
      'node',
      '--esModuleInterop',
      '--skipLibCheck',
      '--strict',
      'false'
    ],
    { cwd: ROOT, stdio: 'pipe' }
  )
}

function loadImaging() {
  // The compiled tree mirrors src/, so the compositor lands here.
  const compose = require(path.join(BUILD, 'main', 'imaging', 'compose.js'))
  const settings = require(path.join(BUILD, 'shared', 'settings.js'))
  return { compose, settings }
}

async function main() {
  await fs.rm(BUILD, { recursive: true, force: true })
  compileImaging()

  const { compose, settings: settingsModule } = loadImaging()

  // The scene, rendered at 2x so the framed result stays sharp when the site
  // shows it at 820 CSS pixels on a high-density display.
  const sceneSource = await fs.readFile(path.join(ROOT, 'src', 'renderer', 'overlay', 'demoScene.ts'), 'utf8')
  const ts = require('typescript')
  const compiledScene = ts.transpileModule(sceneSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText
  const sceneFile = path.join(BUILD, 'demoScene.cjs')
  await fs.writeFile(sceneFile, compiledScene, 'utf8')
  const svg = require(sceneFile).demoSceneSvg()

  const scenePng = await sharp(Buffer.from(svg))
    .resize({ width: 2560, kernel: 'lanczos3' })
    .png()
    .toBuffer()

  // Real settings, exactly as a fresh install ships them.
  const defaults = settingsModule.defaultSettings(OUT)

  // No overrides: the picture must show exactly what a fresh install produces.
  // The scene is drawn at 2x, so the frame lands at 2x too and the result reads
  // as a high-density capture rather than a zoomed one.
  const composed = await compose.composeScreenshot(
    scenePng,
    compose.composeOptionsFromSettings(defaults)
  )

  const heroPath = path.join(OUT, 'hero-framed.png')
  await fs.writeFile(heroPath, composed)

  const meta = await sharp(heroPath).metadata()
  const stat = await fs.stat(heroPath)
  console.log(`hero-framed.png  ${meta.width}×${meta.height}  ${(stat.size / 1024).toFixed(0)} KB`)
  console.log(`frame ${defaults.frameWidth}px, radius ${defaults.cornerRadius}, shadow ${defaults.shadowEnabled ? 'on' : 'off'}`)

  await fs.rm(BUILD, { recursive: true, force: true })
}

main().catch((error) => {
  console.error('FAILED', error)
  process.exit(1)
})
