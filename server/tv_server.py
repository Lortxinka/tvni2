#!/usr/bin/env python3
"""TV Плеер — локальный сервер для стриминга видео по домашней сети.

Только стандартная библиотека Python 3.7+. Раздаёт:
  /                 — само приложение (index.html, css/, js/)
  /api/library      — JSON-список видео и субтитров в папке
  /media/<путь>     — файлы с поддержкой HTTP Range (перемотка больших файлов)

Запуск:  python3 server/tv_server.py "/путь/к/видео" [--port 8080]
"""

import argparse
import json
import mimetypes
import os
import socket
import sys
from email.utils import formatdate, parsedate_to_datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

APP_DIR = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir))
APP_FILES = ('index.html', 'css', 'js')

VIDEO_EXT = {'.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi', '.ts', '.m2ts', '.mts',
             '.ogv', '.mpg', '.mpeg', '.3gp', '.wmv'}
SUB_EXT = {'.srt', '.vtt'}

MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/mp4',  # Chromium охотнее играет QuickTime как video/mp4
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.ogv': 'video/ogg',
    '.ts': 'video/mp2t',
    '.m2ts': 'video/mp2t',
    '.mts': 'video/mp2t',
    '.avi': 'video/x-msvideo',
    '.mpg': 'video/mpeg',
    '.mpeg': 'video/mpeg',
    '.3gp': 'video/3gpp',
    '.wmv': 'video/x-ms-wmv',
    '.srt': 'text/plain',   # кодировку (UTF-8 / cp1251) определяет клиент
    '.vtt': 'text/vtt',
}

CHUNK = 256 * 1024


def safe_path(root, rel):
    """Абсолютный путь внутри root или None (защита от ../ и симлинков наружу)."""
    full = os.path.realpath(os.path.join(root, rel.lstrip('/')))
    if full == root or full.startswith(root + os.sep):
        return full
    return None


def scan_library(root):
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith('.'))
        for name in filenames:
            if name.startswith('.'):
                continue
            ext = os.path.splitext(name)[1].lower()
            if ext not in VIDEO_EXT and ext not in SUB_EXT:
                continue
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root).replace(os.sep, '/')
            try:
                rel.encode('utf-8')  # имена с битой кодировкой пропускаем
                st = os.stat(full)
            except (UnicodeEncodeError, OSError):
                continue
            files.append({'path': rel, 'size': st.st_size, 'mtime': int(st.st_mtime)})
    return files


def parse_range(header, size):
    """'bytes=a-b' → (start, end) включительно; None — заголовок игнорируем; 'invalid' → 416."""
    if not header or not header.startswith('bytes='):
        return None
    spec = header[6:].split(',')[0].strip()  # из нескольких диапазонов отдаём первый
    if '-' not in spec:
        return None
    start_s, end_s = spec.split('-', 1)
    try:
        if start_s == '':
            length = int(end_s)
            if length <= 0:
                return 'invalid'
            start, end = max(0, size - length), size - 1
        else:
            start = int(start_s)
            end = int(end_s) if end_s else size - 1
    except ValueError:
        return None
    if start >= size or start > end or start < 0:
        return 'invalid'
    return start, min(end, size - 1)


class Handler(BaseHTTPRequestHandler):
    server_version = 'TVPlayer/1.0'
    protocol_version = 'HTTP/1.1'
    media_root = '.'
    verbose = False

    # ---- служебное ----

    def log_message(self, fmt, *args):
        if self.verbose:
            sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))

    def cors(self):
        # Нужен, если страница открыта с file:// (USB), а видео — с сервера,
        # и чтобы canvas для превью не считался «грязным».
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Range')
        self.send_header('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges')

    def send_plain(self, status, text, head=False, extra=None):
        body = text.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.cors()
        self.end_headers()
        if not head:
            self.wfile.write(body)

    # ---- методы ----

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
        self.send_header('Content-Length', '0')
        self.cors()
        self.end_headers()

    def do_HEAD(self):
        self.route(head=True)

    def do_GET(self):
        self.route(head=False)

    def route(self, head):
        try:
            path = unquote(urlsplit(self.path).path, errors='strict')
        except UnicodeDecodeError:
            return self.send_plain(HTTPStatus.BAD_REQUEST, 'Bad path', head)

        if path == '/api/library':
            return self.send_library(head)
        if path.startswith('/media/'):
            rel = path[len('/media/'):]
            if any(part.startswith('.') for part in rel.split('/')):
                return self.send_plain(HTTPStatus.NOT_FOUND, 'Not found', head)
            full = safe_path(self.media_root, rel)
            return self.send_file(full, head, cache='no-cache')
        if path in ('', '/'):
            path = '/index.html'
        top = path.lstrip('/').split('/')[0]
        if top not in APP_FILES:
            return self.send_plain(HTTPStatus.NOT_FOUND, 'Not found', head)
        return self.send_file(safe_path(APP_DIR, path), head, cache='no-cache')

    def send_library(self, head):
        data = {'name': os.path.basename(self.media_root.rstrip(os.sep)) or self.media_root,
                'files': scan_library(self.media_root)}
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(HTTPStatus.OK)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.cors()
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def send_file(self, full, head, cache):
        if not full or not os.path.isfile(full):
            return self.send_plain(HTTPStatus.NOT_FOUND, 'Not found', head)
        try:
            f = open(full, 'rb')
        except OSError:
            return self.send_plain(HTTPStatus.FORBIDDEN, 'Forbidden', head)
        with f:
            st = os.fstat(f.fileno())
            size = st.st_size
            ext = os.path.splitext(full)[1].lower()
            ctype = MIME.get(ext) or mimetypes.guess_type(full)[0] or 'application/octet-stream'
            last_mod = formatdate(st.st_mtime, usegmt=True)
            etag = '"%x-%x"' % (int(st.st_mtime), size)

            rng = parse_range(self.headers.get('Range'), size)
            # If-Range: файл изменился — отдаём целиком.
            if_range = self.headers.get('If-Range')
            if rng and if_range and if_range != etag and if_range != last_mod:
                rng = None

            if rng == 'invalid':
                return self.send_plain(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE, 'Range not satisfiable',
                                       head, {'Content-Range': 'bytes */%d' % size, 'Accept-Ranges': 'bytes'})

            if rng is None and self.not_modified(etag, st.st_mtime):
                self.send_response(HTTPStatus.NOT_MODIFIED)
                self.send_header('ETag', etag)
                self.cors()
                self.end_headers()
                return

            if rng:
                start, end = rng
                self.send_response(HTTPStatus.PARTIAL_CONTENT)
                self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
            else:
                start, end = 0, size - 1
                self.send_response(HTTPStatus.OK)
            length = end - start + 1 if size else 0
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(length))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Last-Modified', last_mod)
            self.send_header('ETag', etag)
            self.send_header('Cache-Control', cache)
            self.cors()
            self.end_headers()
            if head or not length:
                return
            f.seek(start)
            remaining = length
            try:
                while remaining > 0:
                    chunk = f.read(min(CHUNK, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, socket.timeout):
                # Плеер при перемотке обрывает соединение и делает новый Range-запрос — это норма.
                self.close_connection = True

    def not_modified(self, etag, mtime):
        inm = self.headers.get('If-None-Match')
        if inm:
            return etag in [t.strip() for t in inm.split(',')]
        ims = self.headers.get('If-Modified-Since')
        if ims:
            try:
                return int(mtime) <= parsedate_to_datetime(ims).timestamp()
            except (TypeError, ValueError):
                return False
        return False


def lan_addresses():
    addrs = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))  # пакеты не отправляются, только выбор интерфейса
        addrs.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addrs.add(info[4][0])
    except OSError:
        pass
    return sorted(a for a in addrs if not a.startswith('127.')) or ['127.0.0.1']


def main():
    p = argparse.ArgumentParser(description='TV Плеер: сервер видео для локальной сети')
    p.add_argument('media', help='папка с видео')
    p.add_argument('--port', type=int, default=8080, help='порт (по умолчанию 8080)')
    p.add_argument('--host', default='0.0.0.0', help='адрес прослушивания (по умолчанию все интерфейсы)')
    p.add_argument('-v', '--verbose', action='store_true', help='логировать запросы')
    args = p.parse_args()

    media = os.path.realpath(args.media)
    if not os.path.isdir(media):
        p.error('папка не найдена: %s' % args.media)

    Handler.media_root = media
    Handler.verbose = args.verbose
    ThreadingHTTPServer.daemon_threads = True
    ThreadingHTTPServer.allow_reuse_address = True
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)

    print('TV Плеер — сервер запущен')
    print('  Папка с видео: %s (%d файлов)' % (media, len(scan_library(media))))
    print('  Откройте на телевизоре:')
    for a in lan_addresses():
        print('    http://%s:%d/' % (a, args.port))
    print('  Ctrl+C — остановить')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nОстановлено')
    finally:
        httpd.server_close()


if __name__ == '__main__':
    main()
