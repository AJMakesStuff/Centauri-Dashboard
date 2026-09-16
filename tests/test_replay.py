import unittest
from unittest.mock import patch
import replay


class ReplayTests(unittest.TestCase):
    def tearDown(self):
        for recording in replay.sessions.values():
            recording.close()
        replay.sessions.clear()

    def test_disk_frames_seek_and_delete(self):
        recording = replay.Recording(('192.168.1.2', 80, '/'))
        recording.append(b'first', recording.started + 1)
        recording.append(b'second', recording.started + 2)
        self.assertEqual(recording.frame(0), b'first')
        self.assertEqual(recording.frame(1), b'second')
        replay.sessions['test'] = recording
        replay.update('test', '', False)
        self.assertTrue(recording.file.closed)
        self.assertNotIn('test', replay.sessions)
        self.assertFalse(recording.append(b'late', 3))

    def test_limit_preserves_existing_footage(self):
        recording = replay.Recording(('192.168.1.2', 80, '/'))
        try:
            with patch.object(replay, 'MAX_BYTES', 5):
                self.assertTrue(recording.append(b'12345', recording.started))
                self.assertFalse(recording.append(b'6', recording.started))
                self.assertEqual(recording.frame(0), b'12345')
                self.assertIn('limit', recording.error)
        finally:
            recording.close()

    def test_camera_target_rejects_unsafe_targets(self):
        for ip in ['127.0.0.1', '8.8.8.8', '169.254.169.254', '0.0.0.0']:
            with patch('replay.socket.gethostbyname', return_value=ip):
                with self.assertRaises(ValueError):
                    replay.camera_target('http://camera/video')
        with patch('replay.socket.gethostbyname', return_value='192.168.1.2'):
            self.assertEqual(replay.camera_target('http://camera:3031/video?a=1'), ('192.168.1.2', 3031, '/video?a=1'))

    @patch('replay.Recording.capture')
    @patch('replay.camera_target', return_value=('192.168.1.2', 80, '/video'))
    def test_reconnect_retains_footage_and_end_deletes_it(self, target, capture):
        replay.update('tab', 'http://printer/video', True, 'part')
        original = replay.sessions['tab']
        original.append(b'previous footage', original.started + 1)
        result = replay.update('tab', 'http://printer/video', True, 'part')
        self.assertIs(replay.sessions['tab'], original)
        self.assertEqual(result['frames'], 1)
        self.assertEqual(original.frame(0), b'previous footage')
        replay.update('tab', '', False)
        self.assertTrue(original.file.closed)
        self.assertNotIn('tab', replay.sessions)
