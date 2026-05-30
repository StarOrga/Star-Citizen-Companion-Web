"""Test bootstrap.

The sc_extract test suite is fully offline (synthetic in-memory DCB fixtures,
no network). Some developer environments globally enable ``pytest-socket`` with
``--disable-socket``, which makes the event-loop fixture from other installed
plugins (e.g. pytest-asyncio) raise ``SocketBlockedError`` during collection —
breaking even the pure-unit tests. Re-enable sockets here when that plugin is
present so the suite runs identically everywhere. No effect if pytest-socket
isn't installed.
"""

from __future__ import annotations

try:  # pragma: no cover - environment dependent
    import pytest_socket

    def pytest_runtest_setup(item) -> None:  # noqa: D401
        pytest_socket.enable_socket()
except ImportError:  # pragma: no cover
    pass
