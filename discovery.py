import ipaddress
import json
import re
import socket
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
    def do_GET(self):
        url = urlsplit(self.path)
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
