#!/usr/bin/env python3
"""The upload endpoint behind flushot.ink.

A screenshot is POSTed here, written to disk under a random name, and answered with
a link that stops working after an hour. nginx serves the files themselves straight
from disk; this process only ever accepts uploads and answers questions about
itself. That split is deliberate: the read path is a static file, so it costs nothing
and keeps working even if this process is down.

Written for Python 3.6 because that is what the server has. No f-string
self-documenting syntax, no walrus operator, no dataclasses, no
http.server.ThreadingHTTPServer (3.7) — `socketserver.ThreadingMixIn` is used
instead. Anything added here has to keep running on 3.6.

    python3 shot-server.py            # serve on 127.0.0.1:8099
    python3 shot-server.py --sweep    # delete expired files, print a summary

The sweep is meant to be run every minute by a systemd timer, and it is the only
thing that deletes anything: the TTL is enforced by the clock, not by a request.
"""

import base64
import json
import os
import re
import secrets
import shutil
import socketserver
import sys
import time
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer

# --------------------------------------------------------------------- constants

SHOTS_DIR = os.environ.get('FLUSHOT_SHOTS_DIR', '/var/lib/flushot-shots')

HOST = os.environ.get('FLUSHOT_SHOTS_HOST', '127.0.0.1')
PORT = int(os.environ.get('FLUSHOT_SHOTS_PORT', '8099'))

# A link lives for an hour. Stated in the API response and in the documentation, so
# a client never has to guess.
TTL_SECONDS = int(os.environ.get('FLUSHOT_SHOTS_TTL', str(60 * 60)))

# The hard ceiling on the directory. The quota is enforced both ways: the sweep
# trims the directory down to this, and an upload is refused rather than allowed to
# push past it. Links die of old age first, so in normal use this is never reached.
CAP_BYTES = int(os.environ.get('FLUSHOT_SHOTS_CAP', str(2 * 1024 * 1024 * 1024)))

# Below this much free space on the filesystem, uploads are refused. This is the
# guard that matters: the directory failing is an inconvenience, the filesystem
# filling up takes the site and the system down with it.
MIN_FREE_BYTES = int(os.environ.get('FLUSHOT_SHOTS_MIN_FREE', str(1536 * 1024 * 1024)))

# One screenshot. The client sends the finished card, which is a few hundred
# kilobytes to two megabytes; three is the ceiling with room for a 4K capture.
MAX_BYTES = int(os.environ.get('FLUSHOT_SHOTS_MAX_BODY', str(3 * 1024 * 1024)))

# A refused body is still read and discarded up to this size, so the client gets the
# 413 rather than a reset connection. Anything larger is dropped unread.
HARD_MAX_BYTES = int(os.environ.get('FLUSHOT_SHOTS_HARD_MAX', str(32 * 1024 * 1024)))

# Files are named by what they actually contain, never by what the request claims.
# `extension` becomes the URL suffix, so it has to come from the bytes.
SIGNATURES = (
    (b'\x89PNG\r\n\x1a\n', 'png', 'image/png'),
    (b'\xff\xd8\xff', 'jpg', 'image/jpeg'),
)

ID_RE = re.compile(r'^[A-Za-z0-9_-]{16}$')
NAME_RE = re.compile(r'^[A-Za-z0-9_-]{16}\.(png|jpg|webp)$')


def sniff(data):
    """(extension, content type) for the bytes, or None when it is not an image.

    The extension is chosen here and nowhere else. Trusting a client header would let
    anyone store an HTML page under a `.png` link on this domain, which is a hosted
    phishing page with our certificate on it.
    """
    for signature, extension, content_type in SIGNATURES:
        if data.startswith(signature):
            return extension, content_type
    # WebP is a RIFF container: `RIFF`, a little-endian length, then `WEBP`.
    if len(data) >= 12 and data[0:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'webp', 'image/webp'
    return None


def ensure_dir():
    if not os.path.isdir(SHOTS_DIR):
        os.makedirs(SHOTS_DIR, 0o750)
    return SHOTS_DIR


def directory_usage():
    """(bytes, file count) for the files this endpoint owns.

    Only names matching the pattern are counted and only they are ever deleted: this
    directory must not become a place where a stray file is silently removed.
    """
    total = 0
    count = 0
    try:
        entries = os.listdir(SHOTS_DIR)
    except FileNotFoundError:
        return 0, 0
    for name in entries:
        if not NAME_RE.match(name):
            continue
        try:
            total += os.path.getsize(os.path.join(SHOTS_DIR, name))
            count += 1
        except OSError:
            continue
    return total, count


def free_bytes():
    return shutil.disk_usage(SHOTS_DIR).free


def new_name(extension):
    # 12 random bytes as URL-safe base64 without padding: 16 characters, 96 bits.
    # The name is the only thing protecting a picture, so it must not be guessable
    # and must not be sequential.
    for _ in range(8):
        candidate = '{0}.{1}'.format(secrets.token_urlsafe(12), extension)
        if not os.path.exists(os.path.join(SHOTS_DIR, candidate)):
            return candidate
    raise RuntimeError('could not find a free file name')


def sweep(now=None, quiet=False):
    """Delete expired files, then trim to the cap. Returns a summary dict."""
    ensure_dir()
    now = time.time() if now is None else now
    removed_expired = 0
    removed_quota = 0
    freed = 0

    kept = []
    for name in os.listdir(SHOTS_DIR):
        if not NAME_RE.match(name):
            continue
        path = os.path.join(SHOTS_DIR, name)
        try:
            stat = os.stat(path)
        except OSError:
            continue
        if now - stat.st_mtime > TTL_SECONDS:
            try:
                os.unlink(path)
                removed_expired += 1
                freed += stat.st_size
            except OSError:
                continue
        else:
            kept.append((stat.st_mtime, stat.st_size, path))

    # Oldest first, so the cap removes what is closest to expiring anyway.
    kept.sort()
    total = sum(size for _, size, _ in kept)
    for _, size, path in kept:
        if total <= CAP_BYTES:
            break
        try:
            os.unlink(path)
            removed_quota += 1
            freed += size
            total -= size
        except OSError:
            continue

    summary = {
        'expired': removed_expired,
        'quota': removed_quota,
        'freed': freed,
        'remaining': total,
        'free': free_bytes()
    }
    if not quiet:
        print(
            'sweep: removed {0} expired and {1} over quota, freed {2} bytes, '
            '{3} bytes left, {4} free on disk'.format(
                removed_expired, removed_quota, freed, total, summary['free']
            )
        )
    return summary


# ------------------------------------------------------------------------ handler


class ShotHandler(BaseHTTPRequestHandler):
    server_version = 'flushot-shots'
    sys_version = ''
    # The protocol version decides whether keep-alive is used; nginx proxies with
    # HTTP/1.1, so it has to be 1.1 or every request costs a new connection.
    protocol_version = 'HTTP/1.1'

    # ---------------------------------------------------------------- utilities

    def log_message(self, fmt, *args):
        sys.stdout.write(
            '{0} {1}\n'.format(time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), fmt % args)
        )
        sys.stdout.flush()

    def send_json(self, status, payload, extra_headers=None):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Robots-Tag', 'noindex')
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def drain(self, length):
        """Read and throw away up to `length` bytes of a body we are refusing.

        Without this the client is still sending when the refusal is written, and it
        sees a reset connection instead of the 413. Nginx normally rejects an
        oversized body before it gets here; this is what makes the endpoint behave
        the same way when it is called directly.
        """
        remaining = length
        while remaining > 0:
            chunk = self.rfile.read(min(65536, remaining))
            if not chunk:
                break
            remaining -= len(chunk)

    def read_body(self):
        """(body, error) — exactly one of them is not None."""
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except (TypeError, ValueError):
            return None, 'size'
        if length <= 0:
            return None, 'size'
        if length > MAX_BYTES:
            # A body of a few megabytes is drained so the answer can be read. Beyond
            # that the connection is closed instead: reading 500 MB to say "too big"
            # would be the denial of service the limit exists to prevent.
            if length <= HARD_MAX_BYTES:
                self.drain(length)
            else:
                self.close_connection = True
            return None, 'size'
        chunks = []
        remaining = length
        while remaining > 0:
            chunk = self.rfile.read(min(65536, remaining))
            if not chunk:
                return None, 'size'
            chunks.append(chunk)
            remaining -= len(chunk)
        return b''.join(chunks), None

    # ------------------------------------------------------------------- routes

    def do_GET(self):
        if self.path in ('/api/shot/health', '/api/shot/health/'):
            total, count = directory_usage()
            self.send_json(
                200,
                {
                    'ok': True,
                    'files': count,
                    'bytes': total,
                    'cap': CAP_BYTES,
                    'ttl': TTL_SECONDS,
                    'free': free_bytes(),
                    'minFree': MIN_FREE_BYTES,
                    'accepting': free_bytes() >= MIN_FREE_BYTES and total < CAP_BYTES
                }
            )
            return
        if self.path == '/api/shot' or self.path.startswith('/api/shot/'):
            self.send_json(405, {'error': 'method', 'message': 'Use POST to upload.'})
            return
        self.send_json(404, {'error': 'not_found'})

    def do_DELETE(self):
        # A takedown endpoint. Someone whose picture was uploaded without consent has
        # to be able to get rid of it without asking, and the name is unguessable, so
        # knowing it is proof enough of knowing the link.
        match = re.match(r'^/api/shot/([A-Za-z0-9_-]{16})$', self.path)
        if not match:
            self.send_json(404, {'error': 'not_found'})
            return
        identifier = match.group(1)
        for name in os.listdir(SHOTS_DIR) if os.path.isdir(SHOTS_DIR) else []:
            if name.startswith(identifier + '.'):
                try:
                    os.unlink(os.path.join(SHOTS_DIR, name))
                except OSError:
                    self.send_json(500, {'error': 'delete_failed'})
                    return
                self.send_json(200, {'ok': True, 'deleted': identifier})
                return
        self.send_json(404, {'error': 'not_found'})

    def do_POST(self):
        if self.path != '/api/shot' and self.path != '/api/shot/':
            self.send_json(404, {'error': 'not_found'})
            return

        ensure_dir()
        total, _count = directory_usage()
        free = free_bytes()
        if free < MIN_FREE_BYTES:
            self.log_message('refused: %d bytes free, below the %d floor', free, MIN_FREE_BYTES)
            self.send_json(503, {'error': 'no_space', 'message': 'Not accepting uploads right now.'}, {'Retry-After': '300'})
            return
        if total >= CAP_BYTES:
            # The directory is full, so the oldest files go first: evicting something
            # that expires in ten minutes is better than refusing a fresh upload. Only
            # when even an empty directory cannot hold one file is the request
            # refused, which means the cap is misconfigured.
            sweep(quiet=True)
            total, _count = directory_usage()
            if total >= CAP_BYTES:
                self.log_message('refused: directory at %d bytes, cap %d', total, CAP_BYTES)
                self.send_json(503, {'error': 'full', 'message': 'Storage is full.'}, {'Retry-After': '600'})
                return

        data, error = self.read_body()
        if error is not None:
            self.send_json(
                413,
                {'error': 'size', 'message': 'Send an image of at most {0} bytes.'.format(MAX_BYTES)}
            )
            return

        kind = sniff(data)
        if kind is None:
            self.send_json(415, {'error': 'type', 'message': 'Only PNG, JPEG and WebP are accepted.'})
            return
        extension, content_type = kind

        name = new_name(extension)
        path = os.path.join(SHOTS_DIR, name)
        # Written to a temporary name in the same directory and renamed, so nginx can
        # never serve a half-written file: a rename within one filesystem is atomic.
        temporary = os.path.join(SHOTS_DIR, '.incoming-' + name)
        try:
            # `O_BINARY` is a no-op on Linux and essential on Windows: without it
            # `os.open` opens in text mode there and every `\n` in the image is
            # rewritten to `\r\n`, so the file on disk is not the file that was sent.
            # Caught by the byte comparison in the tests, which is why they compare
            # bytes rather than sizes.
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
            if hasattr(os, 'O_BINARY'):
                flags |= os.O_BINARY
            handle = os.open(temporary, flags, 0o644)
            try:
                # `os.write` may write fewer bytes than asked, so this loops rather
                # than assuming one call is enough.
                offset = 0
                while offset < len(data):
                    offset += os.write(handle, data[offset:])
            finally:
                os.close(handle)
            os.rename(temporary, path)
        except OSError:
            try:
                os.unlink(temporary)
            except OSError:
                pass
            self.log_message('write failed: %s', traceback.format_exc(limit=1).replace('\n', ' '))
            self.send_json(500, {'error': 'write_failed'})
            return

        identifier = name.rsplit('.', 1)[0]
        expires = int(time.time() + TTL_SECONDS)
        self.log_message(
            'stored %s (%s, %d bytes, expires %s)',
            name,
            content_type,
            len(data),
            time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(expires))
        )
        self.send_json(
            201,
            {
                'id': identifier,
                'url': 'https://flushot.ink/s/{0}'.format(name),
                'format': extension,
                'bytes': len(data),
                'expiresAt': expires,
                'ttl': TTL_SECONDS
            }
        )


class ThreadedHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True
    # A flood of kept-alive connections must not pin a thread each forever.
    request_queue_size = 64


def main():
    if '--sweep' in sys.argv:
        sweep()
        return 0
    if '--health' in sys.argv:
        total, count = directory_usage()
        print(
            json.dumps(
                {
                    'files': count,
                    'bytes': total,
                    'cap': CAP_BYTES,
                    'free': free_bytes(),
                    'minFree': MIN_FREE_BYTES,
                    'accepting': free_bytes() >= MIN_FREE_BYTES and total < CAP_BYTES
                }
            )
        )
        return 0

    ensure_dir()
    server = ThreadedHTTPServer((HOST, PORT), ShotHandler)
    sys.stderr.write(
        'flushot-shots listening on {0}:{1}, directory {2}, ttl {3}s, cap {4} bytes\n'.format(
            HOST, PORT, SHOTS_DIR, TTL_SECONDS, CAP_BYTES
        )
    )
    sys.stderr.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
