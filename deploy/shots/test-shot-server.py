#!/usr/bin/env python3
"""Tests for shot-server.py.

Run with:

    python3 deploy/shots/test-shot-server.py

Nothing here touches the network or the real screenshot directory: every test works
in a temporary directory and on a port the OS picks.

Three things are checked, in order of how likely they are to bite:

1. **Python 3.6 grammar.** The server runs 3.6.8, so a walrus operator or an f-string
   with `=` would be a syntax error in production and a passing test locally. The
   file is parsed with `feature_version=(3, 6)`, which is the only honest way to
   check that without a 3.6 interpreter on hand.
2. **The sniffing.** What a file is called decides the URL and the content type, so
   it must come from the bytes and never from a header.
3. **The HTTP contract.** Upload, reject, delete, report.
"""

import ast
import importlib.util
import io
import json
import os
import shutil
import socket
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(HERE, 'shot-server.py')

PNG = b'\x89PNG\r\n\x1a\n' + b'\x00\x00\x00\rIHDR' + b'\x00' * 40
JPEG = b'\xff\xd8\xff\xe0\x00\x10JFIF\x00' + b'\x00' * 40
WEBP = b'RIFF' + b'\x24\x00\x00\x00' + b'WEBP' + b'VP8 ' + b'\x00' * 40

failures = []


def check(label, condition, detail=''):
    if condition:
        print('  ok    {0}'.format(label))
    else:
        print('  FAIL  {0} {1}'.format(label, detail))
        failures.append(label)


def load_server():
    spec = importlib.util.spec_from_file_location('shot_server', SERVER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_grammar():
    print('\n[1] the file parses as Python 3.6')
    with open(SERVER, 'rb') as handle:
        source = handle.read()
    try:
        # `ast.parse` takes the grammar version; `compile` does not. This rejects a
        # walrus operator, an f-string with `=`, positional-only parameters and a
        # `match` statement — everything 3.6 does not have and 3.12 accepts silently.
        ast.parse(source, filename=SERVER, feature_version=(3, 6))
        check('parses with the 3.6 grammar', True)
    except SyntaxError as error:
        check('parses with the 3.6 grammar', False, '{0} (line {1})'.format(error.msg, error.lineno))

    # The 3.6 grammar check above does not know about library additions, and a
    # docstring that explains *why* something is avoided must not be mistaken for
    # using it. So the identifiers are taken from the parse tree, where comments and
    # strings do not appear at all.
    identifiers = set()
    for node in ast.walk(ast.parse(source, filename=SERVER, feature_version=(3, 6))):
        if isinstance(node, ast.Name):
            identifiers.add(node.id)
        elif isinstance(node, ast.Attribute):
            identifiers.add(node.attr)
    for forbidden, reason in (
        ('ThreadingHTTPServer', 'added in 3.7'),
        ('dataclass', 'added in 3.7'),
        ('asyncio', 'added in 3.4 but a different design in 3.7'),
    ):
        check('does not use {0} ({1})'.format(forbidden, reason), forbidden not in identifiers)

    text = source.decode('utf-8')
    check('does not use capture_output= (3.7)', 'capture_output=' not in text)
    check('does not use from __future__ import annotations (3.7)',
          'from __future__ import annotations' not in text)


def test_sniff(server):
    print('\n[2] what a file is, comes from its bytes')
    for data, expected, label in (
        (PNG, 'png', 'PNG'),
        (JPEG, 'jpg', 'JPEG'),
        (WEBP, 'webp', 'WebP'),
    ):
        check('recognises {0}'.format(label), server.sniff(data) == (expected, 'image/' + ('jpeg' if expected == 'jpg' else expected)))

    check('refuses HTML', server.sniff(b'<html><body>hi</body></html>') is None)
    check('refuses an empty body', server.sniff(b'') is None)
    check('refuses a PNG header with nothing after it', server.sniff(b'\x89PNG\r\n\x1a\n') == ('png', 'image/png'),
          'a bare header is still a PNG by signature; the size limit is what stops it')
    check('refuses RIFF that is not WEBP', server.sniff(b'RIFF\x24\x00\x00\x00WAVE' + b'\x00' * 40) is None)
    check('refuses a truncated WebP header', server.sniff(b'RIFF\x24\x00') is None)


def test_sweep(server, directory):
    print('\n[3] the sweep deletes by age, then by quota')
    server.SHOTS_DIR = directory
    for name in os.listdir(directory):
        os.unlink(os.path.join(directory, name))

    now = time.time()

    def make(name, size, age_seconds):
        path = os.path.join(directory, name)
        with open(path, 'wb') as handle:
            handle.write(b'\x00' * size)
        stamp = now - age_seconds
        os.utime(path, (stamp, stamp))
        return path

    old = make('aaaaaaaaaaaaaaaa.png', 1000, server.TTL_SECONDS + 60)
    fresh = make('bbbbbbbbbbbbbbbb.png', 1000, 60)
    weird = os.path.join(directory, 'not-ours.txt')
    with open(weird, 'w') as handle:
        handle.write('x')

    summary = server.sweep(now=now, quiet=True)
    check('the expired file is gone', not os.path.exists(old))
    check('the fresh file stays', os.path.exists(fresh))
    check('a file that is not ours is untouched', os.path.exists(weird))
    check('the summary counts one expiry', summary['expired'] == 1, str(summary))

    # Quota: three files, cap set below their total, oldest must go first.
    for name in os.listdir(directory):
        os.unlink(os.path.join(directory, name))
    first = make('cccccccccccccccc.png', 400, 300)
    second = make('dddddddddddddddd.png', 400, 200)
    third = make('eeeeeeeeeeeeeeee.png', 400, 100)
    original_cap = server.CAP_BYTES
    server.CAP_BYTES = 900
    try:
        summary = server.sweep(now=now, quiet=True)
    finally:
        server.CAP_BYTES = original_cap
    check('the cap removed exactly one file', summary['quota'] == 1, str(summary))
    check('the oldest went first', not os.path.exists(first))
    check('the newer two survive', os.path.exists(second) and os.path.exists(third))

    for name in os.listdir(directory):
        os.unlink(os.path.join(directory, name))


def test_http(server, directory):
    print('\n[4] the HTTP contract')
    server.SHOTS_DIR = directory
    server.CAP_BYTES = 2 * 1024 * 1024 * 1024
    server.MIN_FREE_BYTES = 0
    server.MAX_BYTES = 3 * 1024 * 1024

    httpd = server.ThreadedHTTPServer(('127.0.0.1', 0), server.ShotHandler)
    port = httpd.server_address[1]
    import threading

    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    base = 'http://127.0.0.1:{0}'.format(port)

    def request(method, path, body=None, headers=None):
        req = urllib.request.Request(base + path, data=body, method=method)
        for key, value in (headers or {}).items():
            req.add_header(key, value)
        try:
            with urllib.request.urlopen(req) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    try:
        status, body = request('GET', '/api/shot/health')
        payload = json.loads(body.decode('utf-8'))
        check('health answers 200', status == 200, str(status))
        check('health reports it is accepting', payload.get('accepting') is True, str(payload))
        check('health reports the TTL', payload.get('ttl') > 0, str(payload))

        status, body = request('POST', '/api/shot', PNG, {'Content-Type': 'image/png'})
        payload = json.loads(body.decode('utf-8'))
        check('a PNG is accepted', status == 201, str(status))
        check('the answer carries a link', payload.get('url', '').startswith('https://flushot.ink/s/'), str(payload))
        check('the link ends in .png', payload.get('url', '').endswith('.png'), str(payload))
        check('the answer says when it expires', payload.get('expiresAt', 0) > time.time(), str(payload))
        stored = os.path.join(directory, payload['id'] + '.png')
        check('the file is on disk', os.path.exists(stored))
        with open(stored, 'rb') as handle:
            check('the stored bytes are the uploaded ones', handle.read() == PNG)

        # The name must not be guessable: two uploads of identical bytes have to get
        # different names, otherwise the second user overwrites the first.
        status, body = request('POST', '/api/shot', PNG)
        second = json.loads(body.decode('utf-8'))
        check('an identical upload gets its own link', second['id'] != payload['id'], str(second))

        status, body = request('POST', '/api/shot', JPEG)
        payload_jpeg = json.loads(body.decode('utf-8'))
        check('a JPEG is accepted and named .jpg', payload_jpeg['url'].endswith('.jpg'), str(payload_jpeg))

        status, body = request('POST', '/api/shot', WEBP)
        payload_webp = json.loads(body.decode('utf-8'))
        check('a WebP is accepted and named .webp', payload_webp['url'].endswith('.webp'), str(payload_webp))

        status, body = request('POST', '/api/shot', b'<html>not an image</html>')
        check('an HTML body is refused', status == 415, str(status))

        big = PNG + b'\x00' * (server.MAX_BYTES + 10)
        status, body = request('POST', '/api/shot', big)
        check('an oversized body is refused', status == 413, str(status))

        status, body = request('POST', '/api/shot', b'')
        check('an empty body is refused', status == 413, str(status))

        status, body = request('POST', '/api/shot', PNG, {'Content-Type': 'image/gif'})
        check('the Content-Type header is ignored and the bytes decide', status == 201, str(status))

        status, body = request('GET', '/api/shot')
        check('GET on the upload address is 405', status == 405, str(status))

        status, body = request('GET', '/nothing-here')
        check('an unknown path is 404', status == 404, str(status))

        status, body = request('DELETE', '/api/shot/' + payload['id'])
        check('a delete removes the file', status == 200 and not os.path.exists(stored), str(status))

        status, body = request('DELETE', '/api/shot/' + payload['id'])
        check('deleting it twice is 404 the second time', status == 404, str(status))

        # The free-space guard is the one that protects the site itself.
        server.MIN_FREE_BYTES = 10 ** 18
        try:
            status, body = request('POST', '/api/shot', PNG)
        finally:
            server.MIN_FREE_BYTES = 0
        check('uploads stop when the disk is nearly full', status == 503, str(status))
        check('and the answer says to come back later', b'no_space' in body, body[:80].decode('utf-8', 'replace'))

        # A full directory evicts rather than refuses: something that expires in ten
        # minutes is worth less than the upload happening now.
        for name in os.listdir(directory):
            os.unlink(os.path.join(directory, name))
        with open(os.path.join(directory, 'ffffffffffffffff.png'), 'wb') as handle:
            handle.write(b'\x00' * 5000)
        old_stamp = time.time() - 600
        os.utime(os.path.join(directory, 'ffffffffffffffff.png'), (old_stamp, old_stamp))
        server.CAP_BYTES = 500
        try:
            status, body = request('POST', '/api/shot', PNG)
        finally:
            server.CAP_BYTES = 2 * 1024 * 1024 * 1024
        check('a full directory accepts by evicting the oldest', status == 201, str(status))
        check('and the evicted file is gone',
              not os.path.exists(os.path.join(directory, 'ffffffffffffffff.png')))

        # The refusal is still reachable: a cap smaller than one file cannot be helped
        # by evicting, and that is a misconfiguration rather than a full disk.
        server.CAP_BYTES = 0
        try:
            status, body = request('POST', '/api/shot', PNG)
        finally:
            server.CAP_BYTES = 2 * 1024 * 1024 * 1024
        check('a cap too small for one file refuses', status == 503, str(status))
        check('and says storage is full', b'full' in body, body[:80].decode('utf-8', 'replace'))
    finally:
        httpd.shutdown()
        httpd.server_close()


def main():
    print('shot-server tests')
    test_grammar()
    server = load_server()
    directory = tempfile.mkdtemp(prefix='flushot-shots-test-')
    try:
        test_sniff(server)
        test_sweep(server, directory)
        test_http(server, directory)
    finally:
        shutil.rmtree(directory, ignore_errors=True)

    if failures:
        print('\n{0} problem(s):'.format(len(failures)))
        for failure in failures:
            print('  x {0}'.format(failure))
        return 1
    print('\nAll shot-server tests passed.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
