"""Real loopback HTTP requests; artificial payloads, no Player or user assets."""
import http.client
import http.server
import json
import socket
import threading
import unittest

from host import PreviewRequestHandler


class Handler(PreviewRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        try:
            request = self.read_json(1024)
            if request.get('fail'):
                raise ValueError('场景素材不可用')
            self.send_json({'ok': True, 'id': request['id']})
        except Exception as error:
            self.send_json({'ok': False, 'error': str(error)}, 502)


class PreviewHTTPTests(unittest.TestCase):
    def setUp(self):
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.client = http.client.HTTPConnection(*self.server.server_address, timeout=5)

    def tearDown(self):
        self.client.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(5)

    def post(self, body):
        self.client.request('POST', '/state', body, {'Content-Type': 'application/json'})
        reply = self.client.getresponse()
        data = json.loads(reply.read())
        return reply, data

    def test_continuous_states_reuse_one_socket(self):
        self.client.connect()
        connection = self.client.sock
        for index in range(300):
            reply, data = self.post(json.dumps({'id': index, 'text': '字幕'}))
            self.assertEqual(reply.status, 200)
            self.assertEqual(reply.version, 11)
            self.assertEqual(data, {'ok': True, 'id': index})
            self.assertIs(self.client.sock, connection)

    def test_consumed_invalid_json_and_application_errors_allow_next_state(self):
        self.client.connect()
        connection = self.client.sock
        for body in ('{', '{"id":1,"fail":true}'):
            reply, data = self.post(body)
            self.assertEqual(reply.status, 502)
            self.assertFalse(data['ok'])
            self.assertTrue(data['error'])
            self.assertIs(self.client.sock, connection)
            self.assertEqual(self.post('{"id":2}')[1], {'ok': True, 'id': 2})

    def test_rejected_body_closes_connection_before_next_request(self):
        reply, data = self.post('x' * 1025)
        self.assertEqual(reply.status, 502)
        self.assertEqual(reply.getheader('Connection'), 'close')
        self.assertEqual(data['error'], 'invalid length')
        self.assertIsNone(self.client.sock)
        self.assertEqual(self.post('{"id":3}')[1], {'ok': True, 'id': 3})

    def test_ambiguous_framing_is_closed(self):
        for headers in ('Content-Length: 2\r\nContent-Length: 2',
                        'Content-Length: 2\r\nTransfer-Encoding: chunked',
                        'Content-Length: nope', 'Content-Length: -1', ''):
            with self.subTest(headers=headers), socket.create_connection(self.server.server_address, timeout=5) as conn:
                conn.sendall(('POST /state HTTP/1.1\r\nHost: localhost\r\n' + headers + '\r\n\r\n{}').encode())
                response = http.client.HTTPResponse(conn)
                response.begin()
                self.assertEqual(response.status, 502)
                self.assertEqual(response.getheader('Connection'), 'close')
                self.assertEqual(json.loads(response.read())['error'], 'invalid length')
                self.assertEqual(conn.recv(1), b'')


if __name__ == '__main__':
    unittest.main()
