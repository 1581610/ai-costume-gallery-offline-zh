"""Serve the gallery on a stable loopback origin; reuse our own server."""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit
import webbrowser
import json
import urllib.request

ROOT = Path(__file__).resolve().parents[1]

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path == '/__costume_index_health':
            data=json.dumps({'app':'costume-index','root':str(ROOT)}).encode('utf-8')
            self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
        path = unquote(urlsplit(self.path).path)
        target = (ROOT/path.lstrip('/')).resolve()
        allowed = target == ROOT or target == ROOT/'index.html' or target.is_relative_to(ROOT/'assets/images') or target.is_relative_to(ROOT/'assets/thumbnails') or target.is_relative_to(ROOT/'assets/previews')
        if not allowed or target.is_dir() and target != ROOT:
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        self.send_error(405)

    def log_message(self, *args):
        pass

class Server(ThreadingHTTPServer):
    request_queue_size = 128
    allow_reuse_address = False

def main():
    url='http://127.0.0.1:8919/'
    try:
        server=Server(('127.0.0.1',8919), Handler)
    except OSError:
        try:
            with urllib.request.urlopen(url+'__costume_index_health',timeout=1) as r: health=json.load(r)
            if health=={'app':'costume-index','root':str(ROOT)}:
                webbrowser.open(url);return
        except Exception:
            pass
        raise SystemExit('Port 8919 is in use by another program. Close it, or open index.html directly.')
    with server:
        print('Costume gallery:',url,'\nClose this window or press Ctrl+C to stop.',flush=True)
        webbrowser.open(url)
        try:server.serve_forever()
        except KeyboardInterrupt:pass

if __name__ == '__main__':
    main()
