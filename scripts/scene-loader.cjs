/**
 * Loads the demonstration scene into a plain Node process.
 *
 * The scene is two files — the drawing and the words it draws — and three
 * scripts need it: the hero picture, the interface pictures and the geometry
 * check. Compiling the whole renderer to get at it would drag React and the
 * browser into a Node process, so each script used to transpile the single file
 * itself. It stopped being a single file the moment the words had to be shared
 * with a test, hence this helper: it transpiles the two modules into a mirrored
 * directory and returns the drawing.
 */

const fs = require('node:fs/promises')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')

/** Source path → path inside the output directory, mirroring `src/`. */
const MODULES = [
  ['src/shared/demoSceneText.ts', 'shared/demoSceneText.js'],
  ['src/renderer/overlay/demoScene.ts', 'renderer/overlay/demoScene.js']
]

/**
 * @param outDir Directory to write the compiled modules into. It is emptied of
 *   these two files first, so a stale copy cannot be loaded in their place.
 * @returns The SVG for the scene, drawn with the words of `language`.
 */
async function loadScene(outDir, language = 'ru') {
  for (const [source, target] of MODULES) {
    const text = await fs.readFile(path.join(ROOT, source), 'utf8')
    const compiled = ts.transpileModule(text, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText
    const file = path.join(outDir, target)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, compiled, 'utf8')
  }
  const entry = path.join(outDir, 'renderer', 'overlay', 'demoScene.js')
  // Node caches by path: the run after a change must not get the previous build.
  delete require.cache[entry]
  delete require.cache[path.join(outDir, 'shared', 'demoSceneText.js')]
  return require(entry).demoSceneSvg(language)
}

module.exports = { loadScene, MODULES }
