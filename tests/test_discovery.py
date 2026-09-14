import json
import socket
import unittest
from unittest.mock import patch, MagicMock
from discovery import discover


class DiscoveryTests(unittest.TestCase):
    @patch('discovery.socket.gethostbyname', return_value='192.168.1.2')
    @patch('discovery.socket.socket')
    def test_retries_and_reads_id(self, factory, resolve):
        probe = MagicMock()
        factory.return_value.__enter__.return_value = probe
        probe.recv.side_effect = [socket.timeout(), json.dumps({'Data': {'MainboardID': '000000000001d354'}}).encode()]
        self.assertEqual(discover('printer.local'), '000000000001d354')
        probe.connect.assert_called_once_with(('192.168.1.2', 3000))
        self.assertEqual(probe.send.call_count, 2)
        probe.send.assert_called_with(b'M99999')

    @patch('discovery.socket.gethostbyname', return_value='192.168.1.2')
    @patch('discovery.socket.socket')
    def test_timeout_is_bounded(self, factory, resolve):
        probe = factory.return_value.__enter__.return_value
        probe.recv.side_effect = socket.timeout()
        with self.assertRaises(TimeoutError):
            discover('printer.local')
        self.assertEqual(probe.send.call_count, 3)

    @patch('discovery.socket.gethostbyname', return_value='8.8.8.8')
    def test_public_target_is_rejected(self, resolve):
        with self.assertRaises(ValueError):
            discover('example.com')
