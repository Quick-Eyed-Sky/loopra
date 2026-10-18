"""Real loopback integration tests for copy-safe Loopra launchers.

Run from the project folder with ``python3 -m unittest discover -s tests -p 'test_*.py'``.
Every test uses temporary project copies and an unused high port range; none uses
the listener's normal port or opens a browser.
"""

import functools
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request


PROJECT = Path(__file__).resolve().parents[1]
SERVER = PROJECT / "scripts" / "serve.py"
URL_PATTERN = re.compile(r"http://127\.0\.0\.1:(\d+)/\?[^\s\x1b]+")
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def unused_port_range(width=32):
    """Find a currently free range without touching Loopra's usual local port."""
    for _ in range(100):
        with socket.socket() as candidate:
            candidate.bind(("127.0.0.1", 0))
            base = candidate.getsockname()[1]
        if base + width > 65535 or base <= 4184 < base + width:
            continue
        reservations = []
        try:
            for port in range(base, base + width):
                reservation = socket.socket()
                reservations.append(reservation)
                reservation.bind(("127.0.0.1", port))
            return base
        except OSError:
            pass
        finally:
            for reservation in reservations:
                reservation.close()
    raise RuntimeError("Could not find a free loopback port range for the tests")


def fetch(url):
    with HTTP.open(url, timeout=1.5) as response:
        return response.status, response.headers, response.read()


class QuietStaticHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class ServerIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SERVER.is_file(), "scripts/serve.py must exist before running server integration tests")
        temporary = tempfile.TemporaryDirectory(prefix="loopra-server-tests-")
        self.addCleanup(temporary.cleanup)
        self.workspace = Path(temporary.name)
        self.base = unused_port_range()
        self.launches = 0

    def project_copy(self, name="Loopra 2", marker="current-copy"):
        root = self.workspace / name
        (root / "dist").mkdir(parents=True)
        (root / "scripts").mkdir()
        (root / "dist" / "index.html").write_text(
            f"<!doctype html><title>Loopra</title><main>{marker}</main><script src='app.js'></script>",
            encoding="utf-8",
        )
        (root / "dist" / "app.js").write_text(f"globalThis.loopraCopy = {json.dumps(marker)};\n", encoding="utf-8")
        (root / "dist" / "style.css").write_text("body { color: #dfdfd2; }\n", encoding="utf-8")
        (root / "package.json").write_text(json.dumps({"name": "loopra", "version": "0.1.0"}), encoding="utf-8")
        shutil.copyfile(SERVER, root / "scripts" / "serve.py")
        return root

    def launch(self, root):
        self.launches += 1
        log = self.workspace / f"launch-{self.launches}.log"
        environment = os.environ.copy()
        environment["PYTHONUNBUFFERED"] = "1"
        with log.open("wb") as output:
            process = subprocess.Popen(
                [sys.executable, str(SERVER), "--root", str(root), "--port", str(self.base), "--no-open"],
                cwd=self.workspace,
                stdout=output,
                stderr=subprocess.STDOUT,
                env=environment,
            )

        def terminate():
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)

        self.addCleanup(terminate)
        return process, log

    def ready(self, process, log):
        deadline = time.monotonic() + 8
        last_error = None
        while time.monotonic() < deadline:
            text = log.read_text(encoding="utf-8", errors="replace")
            matches = list(URL_PATTERN.finditer(text))
            if matches:
                url = matches[-1].group(0)
                try:
                    status, headers, body = fetch(urllib.parse.urljoin(url, "/__loopra__/identity"))
                    identity = json.loads(body)
                    self.assertEqual(status, 200)
                    self.assertEqual(identity["app"], "loopra")
                    self.assertEqual(identity["server_version"], 1)
                    self.assertTrue(identity["instance"])
                    self.assertTrue(identity["build"])
                    self.assertEqual(identity["version"], "0.1.0")
                    self.assertIn("application/json", headers["Content-Type"])
                    parsed = urllib.parse.urlsplit(url)
                    self.assertEqual(parsed.hostname, "127.0.0.1")
                    self.assertGreaterEqual(parsed.port, self.base)
                    self.assertLess(parsed.port, self.base + 32)
                    query = urllib.parse.parse_qs(parsed.query)
                    self.assertTrue(query.get("build"), "Every launch URL needs a build cache buster")
                    self.assertTrue(query.get("launch"), "Every launch URL needs a fresh navigation nonce")
                    return url, identity
                except (OSError, ValueError, urllib.error.URLError) as error:
                    last_error = error
            if process.poll() not in (None, 0):
                self.fail(f"Server exited {process.returncode}:\n{text}")
            time.sleep(0.04)
        self.fail(f"Server did not become ready: {last_error}\n{log.read_text(errors='replace')}")

    def stale_title_server(self, root):
        handler = functools.partial(QuietStaticHandler, directory=str(root / "dist"))
        server = http.server.ThreadingHTTPServer(("127.0.0.1", self.base), handler)
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        closed = False

        def close():
            nonlocal closed
            if closed:
                return
            closed = True
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

        self.addCleanup(close)
        return close

    def test_stale_server_with_loopra_title_cannot_capture_a_new_copy(self):
        stale = self.project_copy("old Loopra", "old-interface")
        current = self.project_copy("Loopra 2 – extracted", "new-solo-interface")
        self.stale_title_server(stale)
        process, log = self.launch(current)
        url, _identity = self.ready(process, log)
        self.assertNotEqual(urllib.parse.urlsplit(url).port, self.base)
        self.assertIn(b"new-solo-interface", fetch(url)[2])
        self.assertIn(b"old-interface", fetch(f"http://127.0.0.1:{self.base}/")[2])
        self.assertIsNone(process.poll(), "The new copy needs its own live server")

    def test_same_folder_and_build_reuses_server_but_prints_a_fresh_launch_url(self):
        root = self.project_copy()
        first_process, first_log = self.launch(root)
        first_url, first_identity = self.ready(first_process, first_log)
        # A different spelling of the same folder must canonicalize identically.
        alias = root / "dist" / ".."
        second_process, second_log = self.launch(alias)
        second_url, second_identity = self.ready(second_process, second_log)
        self.assertEqual(second_process.wait(timeout=5), 0, second_log.read_text())
        self.assertIsNone(first_process.poll())
        self.assertEqual(second_identity, first_identity)
        self.assertEqual(urllib.parse.urlsplit(first_url).port, urllib.parse.urlsplit(second_url).port)
        first_query = urllib.parse.parse_qs(urllib.parse.urlsplit(first_url).query)
        second_query = urllib.parse.parse_qs(urllib.parse.urlsplit(second_url).query)
        self.assertEqual(first_query["build"], second_query["build"])
        self.assertNotEqual(first_query["launch"], second_query["launch"], "Reopening must request fresh navigation, even when reusing a server")

    def test_same_copy_reuses_higher_port_after_earlier_port_becomes_free(self):
        stale = self.project_copy("old Loopra", "old-interface")
        root = self.project_copy("current Loopra", "current-interface")
        close_stale = self.stale_title_server(stale)
        first_process, first_log = self.launch(root)
        first_url, first_identity = self.ready(first_process, first_log)
        self.assertEqual(urllib.parse.urlsplit(first_url).port, self.base + 1)

        close_stale()
        second_process, second_log = self.launch(root)
        second_url, second_identity = self.ready(second_process, second_log)

        self.assertEqual(second_process.wait(timeout=5), 0, second_log.read_text())
        self.assertEqual(urllib.parse.urlsplit(second_url).port, self.base + 1)
        self.assertEqual(second_identity, first_identity)
        self.assertIsNone(first_process.poll(), "The original matching server must remain alive")
        self.assertIn(b"current-interface", fetch(second_url)[2])
        identity_url = urllib.parse.urljoin(first_url, "/__loopra__/identity")
        self.assertEqual(json.loads(fetch(identity_url)[2]), first_identity)

    def test_identical_build_in_a_different_folder_gets_its_own_server(self):
        first_root = self.project_copy("Loopra", "same-interface")
        second_root = self.workspace / "Loopra 2"
        shutil.copytree(first_root, second_root)
        first_process, first_log = self.launch(first_root)
        first_url, first_identity = self.ready(first_process, first_log)
        second_process, second_log = self.launch(second_root)
        second_url, second_identity = self.ready(second_process, second_log)
        self.assertNotEqual(first_identity["instance"], second_identity["instance"])
        self.assertEqual(first_identity["build"], second_identity["build"])
        self.assertNotEqual(urllib.parse.urlsplit(first_url).port, urllib.parse.urlsplit(second_url).port)
        self.assertIsNone(first_process.poll())
        self.assertIsNone(second_process.poll())

    def test_modified_build_does_not_reuse_an_old_startup_identity(self):
        root = self.project_copy(marker="before-update")
        first_process, first_log = self.launch(root)
        first_url, first_identity = self.ready(first_process, first_log)
        (root / "dist" / "app.js").write_text("globalThis.loopraCopy = 'after-update';\n", encoding="utf-8")
        second_process, second_log = self.launch(root)
        second_url, second_identity = self.ready(second_process, second_log)
        self.assertEqual(first_identity["instance"], second_identity["instance"])
        self.assertNotEqual(first_identity["build"], second_identity["build"])
        self.assertNotEqual(urllib.parse.urlsplit(first_url).port, urllib.parse.urlsplit(second_url).port)
        old_identity_url = urllib.parse.urljoin(first_url, "/__loopra__/identity")
        self.assertEqual(json.loads(fetch(old_identity_url)[2]), first_identity, "A running server must retain its startup identity")
        self.assertIn(b"after-update", fetch(urllib.parse.urljoin(second_url, "app.js"))[2])

    def test_identity_and_cache_busted_static_files_are_never_cached(self):
        root = self.project_copy(marker="fresh-content")
        process, log = self.launch(root)
        url, _identity = self.ready(process, log)
        for suffix, expected in [
            ("/__loopra__/identity", b'"loopra"'),
            ("/?build=fresh&launch=new", b"fresh-content"),
            ("/app.js?build=fresh&launch=new", b"fresh-content"),
            ("/style.css?build=fresh", b"color"),
        ]:
            with self.subTest(path=suffix):
                status, headers, body = fetch(urllib.parse.urljoin(url, suffix))
                self.assertEqual(status, 200)
                self.assertIn("no-store", headers.get("Cache-Control", "").lower())
                self.assertIn(expected, body)


if __name__ == "__main__":
    unittest.main(verbosity=2)
