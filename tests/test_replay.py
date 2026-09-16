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
        replay.update('test', '', False, delete=True)
        self.assertTrue(recording.file.closed)
        self.assertEqual(recording.frames, [])
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
    def test_reconnect_and_completion_retain_footage(self, target, capture):
        replay.update('tab', 'http://printer/video', True, 'part')
        original = replay.sessions['tab']
        original.append(b'previous footage', original.started + 1)
        result = replay.update('tab', 'http://printer/video', True, 'part')
        self.assertIs(replay.sessions['tab'], original)
        self.assertEqual(result['frames'], 1)
        self.assertEqual(original.frame(0), b'previous footage')
        replay.update('tab', '', False)
        self.assertFalse(original.file.closed)
        self.assertTrue(original.capture_stop.is_set())
        self.assertEqual(original.frame(0), b'previous footage')
        original.updated = 0
        replay.expire_captures()
        self.assertFalse(original.file.closed)
        restored = replay.update('tab', '', False)
        self.assertEqual(restored['frames'], 1)
        self.assertFalse(restored['recording'])

    @patch('replay.Recording.capture')
    @patch('replay.camera_target', return_value=('192.168.1.2', 80, '/video'))
    def test_same_filename_next_print_replaces_completed_replay(self, target, capture):
        replay.update('tab', 'http://printer/video', True, 'part')
        previous = replay.sessions['tab']
        previous.append(b'old', previous.started)
        replay.update('tab', '', False)
        result = replay.update('tab', 'http://printer/video', True, 'part')
        self.assertTrue(previous.file.closed)
        self.assertEqual(result['frames'], 0)
        self.assertIsNot(previous, replay.sessions['tab'])

    @patch('replay.Recording.capture')
    @patch('replay.camera_target', return_value=('192.168.1.2', 80, '/video'))
    def test_delete_during_print_does_not_restart_on_status_poll(self, target, capture):
        replay.update('tab', 'http://printer/video', True, 'part')
        previous = replay.sessions['tab']
        replay.update('tab', '', True, delete=True)
        result = replay.update('tab', 'http://printer/video', True, 'part')
        self.assertTrue(previous.file.closed)
        self.assertFalse(result['recording'])
        replay.update('tab', '', False)
        self.assertTrue(replay.update('tab', 'http://printer/video', True, 'part')['recording'])

    @patch('replay.Recording.capture')
    @patch('replay.camera_target', return_value=('192.168.1.2', 80, '/video'))
    def test_disconnect_stops_capture_without_deleting_and_can_resume(self, target, capture):
        replay.update('tab', 'http://printer/video', True, 'part')
        recording = replay.sessions['tab']
        recording.append(b'kept', recording.started)
        recording.updated = 0
        replay.expire_captures()
        self.assertTrue(recording.capture_stop.is_set())
        result = replay.update('tab', 'http://printer/video', True, 'part')
        self.assertEqual(result['frames'], 1)
        self.assertFalse(recording.capture_stop.is_set())

    @patch('replay.Recording.capture')
    @patch('replay.camera_target', return_value=('192.168.1.2', 80, '/video'))
    def test_different_browser_ids_share_printer_recording_and_deletion(self, target, capture):
        first = replay.update('localhost-browser', 'http://printer/video', True, 'part', printer='cc1:192.168.1.2')
        recording = replay.sessions[first['id']]
        recording.append(b'shared footage', recording.started + 3)
        remote = replay.update('lan-browser', 'http://printer/video', True, 'part', printer='cc1:192.168.1.2')
        self.assertEqual(remote['id'], first['id'])
        self.assertEqual(remote['frames'], 1)
        self.assertEqual(len(replay.sessions), 1)
        replay.update('localhost-browser', '', False, printer='cc1:192.168.1.2')
        retained = replay.update('lan-browser', '', False, printer='cc1:192.168.1.2')
        self.assertEqual(retained['frames'], 1)
        replay.update('lan-browser', '', False, delete=True, printer='cc1:192.168.1.2')
        self.assertTrue(recording.file.closed)
        self.assertEqual(replay.update('localhost-browser', '', False, printer='cc1:192.168.1.2')['frames'], 0)

    @patch('replay.Recording.capture')
    @patch('replay.camera_target', return_value=('192.168.1.2', 80, '/video'))
    def test_shared_identity_keeps_printers_separate(self, target, capture):
        one = replay.update('browser', 'http://printer/video', True, 'part', printer='cc1:192.168.1.2')
        two = replay.update('browser', 'http://printer/video', True, 'part', printer='cc2:192.168.1.3')
        self.assertNotEqual(one['id'], two['id'])
        self.assertEqual(len(replay.sessions), 2)
