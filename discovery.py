import ipaddress
import json
import re
import socket
import replay
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit


def discover(address):
    # Only contact LAN IPv4 targets, never multicast or public services.
    target = socket.gethostbyname(address)
    ip = ipaddress.IPv4Address(target)
    if not (ip.is_private and not ip.is_loopback and not ip.is_unspecified and not ip.is_multicast):
        raise ValueError('A LAN printer address is required')
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.connect((target, 3000))
        probe.settimeout(0.7)
        for _ in range(3):
            probe.send(b'M99999')
            try:
                data = json.loads(probe.recv(65535))
                serial = data.get('Data', {}).get('MainboardID') or data.get('MainboardID')
                if isinstance(serial, str) and re.fullmatch(r'[0-9a-fA-F]{8,64}', serial):
                    return serial
            except (socket.timeout, ValueError, AttributeError):
                continue
    raise TimeoutError('Printer did not answer discovery')


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != '/api/replay':
            self.send_error(404)
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 8192:
                raise ValueError('Invalid request size')
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict) or not re.fullmatch(r'[a-f0-9]{32}', str(data.get('id', ''))):
                raise ValueError('Invalid replay ID')
            if not isinstance(data.get('active'), bool):
                raise ValueError('Invalid recording state')
            if not isinstance(data.get('delete', False), bool):
                raise ValueError('Invalid delete action')
            printer = data.get('printer', '')
            if not isinstance(printer, str) or len(printer) > 512:
                raise ValueError('Invalid printer identity')
            payload = replay.update(data['id'], data.get('url', ''), data['active'], data.get('job', ''), data.get('delete', False), printer)
            self.reply(json.dumps(payload).encode(), 'application/json')
        except (ValueError, OSError, TypeError) as error:
            self.reply(json.dumps({'error': str(error)}).encode(), 'application/json', 400)

    def reply(self, body, content_type, status=200):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path in ('/api/replay/frame', '/api/replay/time'):
            query = parse_qs(url.query)
            try:
                with replay.lock:
                    recording = replay.sessions[query.get('id', [''])[0]]
                    index = int(query.get('index', ['0'])[0])
                    if index < 0:
                        raise ValueError('Invalid index')
                    if url.path == '/api/replay/time':
                        with recording.guard:
                            body = json.dumps({'seconds': recording.frames[index][2]}).encode()
                    else:
                        body = recording.frame(index)
                self.reply(body, 'application/json' if url.path.endswith('/time') else 'image/jpeg')
            except (KeyError, IndexError, ValueError):
                self.send_error(404)
            return
        if url.path != '/api/discover':
            self.send_error(404)
            return
        address = parse_qs(url.query).get('ip', [''])[0]
        try:
            if not re.fullmatch(r'[A-Za-z0-9.-]{1,253}', address):
                raise ValueError('Invalid printer address')
            payload, status = {'serialNumber': discover(address)}, 200
        except ValueError as error:
            payload, status = {'error': str(error)}, 400
        except OSError:
            payload, status = {'error': 'Printer did not answer discovery'}, 504
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', 8081), Handler).serve_forever()
