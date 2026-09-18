"""Disk-backed, temporary MJPEG replay. No cloud or third-party dependencies."""
import http.client
import hashlib
import ipaddress
import socket
import tempfile
import threading
import time
from urllib.parse import urlsplit

MAX_BYTES = 2 * 1024**3
REPLAY_FPS = 6
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
        self.completed = False
        self.capture_stop = threading.Event()
        self.error = ''
        self.guard = threading.RLock()
        self.target = target

    def close(self):
        with self.guard:
            self.capture_stop.set()
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

    def capture(self, capture_stop):
        while not capture_stop.is_set():
            connection = http.client.HTTPConnection(self.target[0], self.target[1], timeout=10)
            try:
                connection.request('GET', self.target[2])
                response = connection.getresponse()
                if response.status != 200:
                    raise OSError('Camera refused connection')
                buffer = b''
                last = 0
                while not capture_stop.is_set():
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
                        if now - last >= 1 / REPLAY_FPS:
                            with self.guard:
                                if capture_stop.is_set() or not self.append(frame, now):
                                    return
                            self.error = ''
                            last = now
                    if len(buffer) > 8 * 1024**2:
                        raise OSError('Camera did not provide valid MJPEG frames')
            except (OSError, http.client.HTTPException):
                with self.guard:
                    if capture_stop.is_set():
                        return
                    self.error = 'Camera unavailable; retrying local recording.'
            finally:
                connection.close()
            for _ in range(20):
                if capture_stop.is_set():
                    return
                time.sleep(0.1)


def update(token, url, active, job='', delete=False, printer=''):
    if printer:
        token = hashlib.sha256(printer.encode()).hexdigest()[:32]
    with lock:
        recording = sessions.get(token)
        if delete:
            if recording:
                recording.close()
            return {'id': token, 'frames': 0, 'recording': False}
        if active and recording is not None and (recording.completed or recording.url != url or recording.job != job):
            sessions.pop(token).close()
            recording = None
        if recording is None and active:
            if sum(not item.closed for item in sessions.values()) >= 4:
                raise ValueError('Too many local replay sessions')
            recording = Recording(camera_target(url))
            recording.url = url
            recording.job = job
            sessions[token] = recording
            threading.Thread(target=recording.capture, args=(recording.capture_stop,), daemon=True).start()
        if recording is None:
            return {'id': token, 'frames': 0, 'recording': False}
        recording.updated = time.monotonic()
        with recording.guard:
            if not active:
                recording.completed = True
                recording.capture_stop.set()
                recording.error = ''
            elif recording.capture_stop.is_set() and not recording.closed:
                recording.capture_stop = threading.Event()
                threading.Thread(target=recording.capture, args=(recording.capture_stop,), daemon=True).start()
            return {'id': token, 'frames': len(recording.frames), 'seconds': recording.frames[-1][2] if recording.frames else 0,
                    'error': recording.error, 'recording': active and not recording.closed}


def expire_captures():
    with lock:
        for recording in sessions.values():
            if time.monotonic() - recording.updated > 90:
                with recording.guard:
                    recording.capture_stop.set()


def reap():
    while True:
        time.sleep(5)
        expire_captures()


threading.Thread(target=reap, daemon=True).start()
