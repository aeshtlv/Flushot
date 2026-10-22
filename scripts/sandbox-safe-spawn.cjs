/**
 * Makes Vite's Windows network-drive detection non-blocking.
 *
 * Vite's first fs.realpath call spawns `net use` through child_process.exec to
 * map network drives. In restricted environments where spawning a process with
 * piped stdio is denied the call throws EPERM before Vite can recover, so the
 * command is answered with an empty result instead (meaning "no network
 * drives", which is what the fallback path assumes anyway).
 *
 * Harmless everywhere else: `net use` output is only used to normalise UNC
 * paths on network shares.
 */
'use strict'

const childProcess = require('node:child_process')
const originalExec = childProcess.exec

childProcess.exec = function patchedExec(command, ...rest) {
  const callback = rest.find((argument) => typeof argument === 'function')
  if (typeof command === 'string' && command.trim().toLowerCase() === 'net use') {
    if (callback) process.nextTick(() => callback(null, '', ''))
    return { on() {}, once() {}, kill() {}, unref() {} }
  }
  return originalExec.call(this, command, ...rest)
}
