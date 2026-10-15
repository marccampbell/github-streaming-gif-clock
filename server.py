"""An incrementally delivered GIF clock, for testing GitHub's image proxy."""
import io
import time
import uuid
import re
from pathlib import Path
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 480, 120
PALETTE = [15, 23, 42, 74, 222, 128, 226, 232, 240] + [0] * (768 - 9)

def frame(sequence, label='LIVE'):
    im = Image.new('P', (WIDTH, HEIGHT), 0)
    im.putpalette(PALETTE)
    draw = ImageDraw.Draw(im)
    font = ImageFont.load_default(size=27)
    now = datetime.now(timezone.utc).strftime('%H:%M:%S UTC')
    draw.text((18, 12), now, fill=1, font=font)
    draw.text((18, 52), f'{label} frame {sequence}', fill=2, font=font)
    draw.rectangle((18, 100, 18 + sequence % 440, 107), fill=1)
    out = io.BytesIO()
    im.save(out, format='GIF', duration=1000, optimize=False)
    data = out.getvalue()
    palette_length = 3 * (2 ** ((data[10] & 7) + 1)) if data[10] & 128 else 0
    split = 13 + palette_length
    return data[:split], data[split:-1]

class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith('/clips/'):
            name = path.removeprefix('/clips/')
            file = Path(__file__).parent / 'clips' / name
            if not re.fullmatch(r'[A-Za-z0-9-]+\.gif', name) or not file.is_file():
                self.send_error(404)
                return
            body = file.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'image/gif')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
            self.end_headers()
            self.wfile.write(body)
            return
        if urlsplit(self.path).path == '/control.gif':
            header, content = frame(0, 'CONTROL')
            body = header + b'!\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00' + content
            body += b''.join(frame(i, 'CONTROL')[1] for i in range(1, 5)) + b';'
            self.send_response(200)
            self.send_header('Content-Type', 'image/gif')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
            return
        if urlsplit(self.path).path != '/clock.gif':
            body = b'<html><body><h1>Streaming GIF clock</h1><p>One new server-generated frame per second.</p><img src="/clock.gif?direct=1"></body></html>'
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        connection = uuid.uuid4().hex[:8]
        print(f'OPEN {connection} {self.path} {self.headers.get("User-Agent")}', flush=True)
        self.send_response(200)
        self.send_header('Content-Type', 'image/gif')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('X-Accel-Buffering', 'no')
        self.send_header('Transfer-Encoding', 'chunked')
        self.end_headers()
        def chunk(data):
            self.wfile.write(f'{len(data):X}\r\n'.encode() + data + b'\r\n')
            self.wfile.flush()
        try:
            header, content = frame(0)
            chunk(header)
            chunk(content)
            start = time.monotonic()
            # Bounded at one hour to keep the experiment's resource use finite.
            for sequence in range(1, 3601):
                time.sleep(max(0, start + sequence - time.monotonic()))
                _, content = frame(sequence)
                chunk(content)
                if sequence % 10 == 0:
                    print(f'FRAME {connection} {sequence} {len(content)} bytes', flush=True)
            chunk(b';')
            self.wfile.write(b'0\r\n\r\n')
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            print(f'CLOSE {connection}', flush=True)

if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 8765), Handler).serve_forever()
