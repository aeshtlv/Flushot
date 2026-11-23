/**
 * The upload endpoint, checked as the program uses it.
 *
 * This exists because of a specific failure: the nginx server block was published from git, and the
 * repository copy did not carry the one `include` line that creates `/api/shot` — that line was only
 * ever inserted by `deploy/shots/install.sh` on the server. Publishing the file therefore deleted the
 * endpoint. The uploader kept running, the site stayed up, every other check passed, and the only
 * symptom was a key in the program that answered 404 for six hours.
 *
 * So the endpoint is exercised end to end against the real service: a picture is uploaded, fetched
 * back, compared byte for byte, and deleted. That is the only check that can tell "the feature works"
 * from "the feature answers a 404".
 *
 * Reads nothing from the repository on purpose — it can be run against any deployment.
 *
 * Usage: node scripts/check-upload-endpoint.cjs [--host=https://flushot.ink]
 */

const HOST = (/--host=(\S+)/.exec(process.argv.join(' '))?.[1] || 'https://flushot.ink').replace(/\/$/, '')

const problems = []
const notes = []

/**
 * A small valid PNG, built here rather than read from a file: the check has to work on a machine that
 * has nothing but Node, and a 1×1 picture is enough to prove the path.
 */
function tinyPng() {
  const { deflateSync } = require('node:zlib')

  const crcTable = []
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  const crc32 = (buffer) => {
    let c = 0xffffffff
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }

  // One scanline: a filter byte and three RGB bytes.
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour
  const raw = Buffer.from([0, 0x2f, 0x6f, 0xeb])

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

async function main() {
  // 1. The endpoint exists at all. This is the exact request the program makes, minus the picture.
  const health = await fetch(`${HOST}/api/shot/health`).catch((error) => ({ status: 0, text: async () => String(error) }))
  const healthText = await health.text()
  if (health.status !== 200) {
    problems.push(`${HOST}/api/shot/health answered ${health.status} — the upload endpoint is not reachable`)
    console.log(`  x health: ${health.status} ${healthText.slice(0, 120)}`)
  } else {
    let payload = null
    try {
      payload = JSON.parse(healthText)
    } catch {
      problems.push('the health endpoint answered 200 but not JSON')
    }
    if (payload) {
      notes.push(`health: ${payload.files} file(s), accepting ${payload.accepting}, ttl ${payload.ttl}s`)
      if (payload.accepting !== true) problems.push('the endpoint reports it is not accepting uploads')
    }
  }

  // 2. A real upload, exactly as the program sends it: a PNG body, no Content-Length.
  const picture = tinyPng()
  const upload = await fetch(`${HOST}/api/shot`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', 'User-Agent': 'Flushot-upload' },
    body: picture
  }).catch((error) => ({ status: 0, text: async () => String(error) }))
  const uploadText = await upload.text()

  if (upload.status !== 201) {
    problems.push(`POST /api/shot answered ${upload.status}`)
    console.log(`  x upload: ${upload.status} ${uploadText.slice(0, 200)}`)
  } else {
    const saved = JSON.parse(uploadText)
    notes.push(`upload: ${saved.url} (${saved.bytes} bytes, ttl ${saved.ttl}s)`)

    // 3. The link has to serve the picture back, unchanged.
    const back = await fetch(saved.url)
    const body = Buffer.from(await back.arrayBuffer())
    if (back.status !== 200) problems.push(`the uploaded picture answered ${back.status} at its own URL`)
    else if (!body.equals(picture)) problems.push('the picture served back differs from the one uploaded')
    else notes.push('the link serves the same bytes that were uploaded')

    // 4. And it has to be deletable, or the service fills up with test pictures.
    const removed = await fetch(`${HOST}/api/shot/${saved.id}`, { method: 'DELETE' })
    if (removed.status !== 200) problems.push(`deleting the test picture answered ${removed.status}`)
    else notes.push('the test picture was deleted')
  }

  // 5. robots.txt must not have started blocking the endpoint.
  const robots = await fetch(`${HOST}/robots.txt`)
  const robotsText = await robots.text()
  if (/Disallow:\s*\/api\//i.test(robotsText)) problems.push('robots.txt blocks /api/, which the program posts to')

  for (const note of notes) console.log(`  ok    ${note}`)
  if (problems.length) {
    console.log(`\n${problems.length} PROBLEM(S):`)
    for (const problem of problems) console.log(`  x ${problem}`)
    process.exit(1)
  }
  console.log('\nThe upload endpoint answers, stores, serves and deletes.')
}

main().catch((error) => {
  console.error('FAILED', error.message)
  process.exit(1)
})
