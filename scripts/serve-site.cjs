/**
 * Minimal static server for previewing `site/` locally.
 *
 * The site works from the file system too, but a real HTTP origin is closer to
 * production and is the only way to check it from a phone on the same network.
 * No dependencies: Node's own http and fs are enough for a folder of static files.
 *
 * Usage: node scripts/serve-site.cjs [--port 8080] [--dir site]
 */

const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const ROOT = path.join(__dirname, '..')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
  '.exe': 'application/vnd.microsoft.portable-executable'
}

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const port = Number(argument('port', 8080))
const directory = path.resolve(ROOT, argument('dir', 'site'))

function localAddresses() {
  const addresses = []
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const entry of interfaces || []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address)
    }
  }
  return addresses
}

const server = http.createServer((request, response) => {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  } catch {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Bad request')
    return
  }

  if (pathname.endsWith('/')) pathname += 'index.html'
  const target = path.join(directory, pathname)

  // Refuse anything that escapes the folder, e.g. /../../secrets.
  if (!target.startsWith(directory)) {
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Forbidden')
    return
  }

  fs.stat(target, (error, stats) => {
    if (error || !stats.isFile()) {
      // A missing page gets the real 404 page, which is what a host would serve.
      const notFound = path.join(directory, '404.html')
      fs.readFile(notFound, (missingError, body) => {
        response.writeHead(404, { 'content-type': MIME['.html'] })
        response.end(missingError ? 'Not found' : body)
      })
      return
    }

    const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream'
    response.writeHead(200, {
      'content-type': type,
      'content-length': stats.size,
      'cache-control': 'no-cache'
    })
    fs.createReadStream(target).pipe(response)
  })
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Порт ${port} занят. Попробуйте: node scripts/serve-site.cjs --port ${port + 1}`)
  } else {
    console.error('Не удалось запустить сервер:', error.message)
  }
  process.exit(1)
})

server.listen(port, () => {
  console.log(`Сайт:  http://127.0.0.1:${port}/`)
  const addresses = localAddresses()
  if (addresses.length > 0) {
    console.log('Телефон в той же сети:')
    for (const address of addresses) console.log(`  http://${address}:${port}/`)
  }
  console.log(`Папка: ${directory}`)
  console.log('Остановить: Ctrl + C')
})
