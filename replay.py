"""Disk-backed, temporary MJPEG replay. No cloud or third-party dependencies."""
import http.client
import ipaddress
import socket
import tempfile
import threading
import time
from urllib.parse import urlsplit

MAX_BYTES = 2 * 1024**3
sessions = {}
lock = threading.RLock()


def camera_target(url):
    parsed = urlsplit(url)
    if parsed.scheme != 'http' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Replay requires an HTTP LAN MJPEG camera URL')
    address = socket.gethostbyname(parsed.hostname)
    ip = ipaddress.ip_address(address)
    if not ip.is_private or ip.is_loopback or ip.is_unspecified or ip.is_multicast or ip.is_link_local:
        raise ValueError('Replay requires a private LAN camera address')
    return address, parsed.port or 80, (parsed.path or '/') + ('?' + parsed.query if parsed.query else '')


class Recording:
    def __init__(self, target):
        self.file = tempfile.TemporaryFile(prefix='print-replay-')
        self.frames = []
        self.size = 0
        self.updated = time.monotonic()
        self.started = self.updated
        self.closed = False
        self.error = ''
        self.guard = threading.RLock()
        self.target = target

    def close(self):
        with self.guard:
            self.closed = True
            self.frames.clear()
            self.file.close()

    def append(self, frame, now):
        with self.guard:
            if self.closed:
                return False
            if self.size + len(frame) > MAX_BYTES:
                self.error = 'Local replay storage limit reached (2 GiB). Earlier footage remains available.'
                return False
            self.file.seek(self.size)
            self.file.write(frame)
            self.frames.append((self.size, len(frame), now - self.started))
            self.size += len(frame)
            return True

    def frame(self, index):
        with self.guard:
            offset, size, _ = self.frames[index]
            self.file.seek(offset)
            return self.file.read(size)

    def capture(self):
        while not self.closed:
            connection = http.client.HTTPConnection(self.target[0], self.target[1], timeout=10)
            try:
                connection.request('GET', self.target[2])
                response = connection.getresponse()
                if response.status != 200:
                    raise OSError('Camera refused connection')
                buffer = b''
                last = 0
                while not self.closed:
                    chunk = response.read1(65536)
                    if not chunk:
                        raise OSError('Camera stream ended')
                    buffer += chunk
                    while True:
                        start = buffer.find(b'\xff\xd8')
                        end = buffer.find(b'\xff\xd9', max(0, start + 2))
                        if start < 0 or end < 0:
                            break
                        frame, buffer = buffer[start:end + 2], buffer[end + 2:]
                        now = time.monotonic()
                        if now - last >= 0.5:
                            if not self.append(frame, now):
                                return
                            self.error = ''
                            last = now
                    if len(buffer) > 8 * 1024**2:
                        raise OSError('Camera did not provide valid MJPEG frames')
            except (OSError, http.client.HTTPException):
                self.error = 'Camera unavailable; retrying local recording.'
            finally:
                connection.close()
            for _ in range(20):
                if self.closed:
                    return
                time.sleep(0.1)


def update(token, url, active, job=''):
    with lock:
        if not active:
            recording = sessions.pop(token, None)
            if recording:
                recording.close()
            return {'frames': 0}
        recording = sessions.get(token)
        if recording is not None and (recording.url != url or recording.job != job):
            sessions.pop(token).close()
            recording = None
        if recording is None:
            if len(sessions) >= 4:
                raise ValueError('Too many local replay sessions')
            recording = Recording(camera_target(url))
            recording.url = url
            recording.job = job
            sessions[token] = recording
            threading.Thread(target=recording.capture, daemon=True).start()
        recording.updated = time.monotonic()
        with recording.guard:
            return {'frames': len(recording.frames), 'seconds': recording.frames[-1][2] if recording.frames else 0, 'error': recording.error}


def reap():
    while True:
        time.sleep(5)
        with lock:
            for token, recording in list(sessions.items()):
                if time.monotonic() - recording.updated > 90:
                    sessions.pop(token).close()


threading.Thread(target=reap, daemon=True).start()
