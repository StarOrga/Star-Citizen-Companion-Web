"""The sliced zstd read must match upstream's outcome on every stream shape."""

import pytest

zstd = pytest.importorskip("zstandard")

from sc_extract.p4k_compat import _ZSTD_SLICE, _decompress_sliced  # noqa: E402


class _Upstream:
    """scdatatools.p4k.ZStdDecompressor, verbatim."""

    def __init__(self) -> None:
        self._decomp = zstd.ZstdDecompressor().decompressobj()
        self.eof = False

    def decompress(self, data):
        result = b""
        try:
            result = self._decomp.decompress(data)
        except zstd.ZstdError:
            self.eof = True
        return result


class _Sliced(_Upstream):
    decompress = _decompress_sliced


def _both(*calls):
    """Feed the same calls to both decoders; return (output, eof) for each."""
    out = []
    for cls in (_Upstream, _Sliced):
        d = cls()
        out.append(([d.decompress(c) for c in calls], d.eof))
    return out


def _frame(payload: bytes) -> bytes:
    return zstd.ZstdCompressor().compress(payload)


def _noise(n: int) -> bytes:
    # Deterministic and poorly compressible, so the frame spans many slices.
    x, out = 1, bytearray()
    while len(out) < n:
        x = (x * 1103515245 + 12345) & 0x7FFFFFFF
        out += x.to_bytes(4, "little")
    return bytes(out[:n])


@pytest.mark.parametrize("payload", [b"", b"x", b"x" * 5_000_000, _noise(_ZSTD_SLICE * 5)])
def test_whole_frame_in_one_call(payload):
    frame = _frame(payload)
    upstream, sliced = _both(frame)
    assert sliced == upstream
    assert b"".join(sliced[0]) == payload


def test_frame_spread_over_short_reads():
    payload = _noise(_ZSTD_SLICE * 3)
    frame = _frame(payload)
    calls = [frame[i : i + 4096] for i in range(0, len(frame), 4096)]
    upstream, sliced = _both(*calls)
    assert b"".join(sliced[0]) == b"".join(upstream[0]) == payload
    assert sliced[1] == upstream[1]


def test_input_past_the_frame_end_is_dropped_not_fatal():
    """A later slice hits the finished frame: the output so far must survive."""
    payload = _noise(_ZSTD_SLICE * 2)
    frame = _frame(payload)
    d = _Sliced()
    assert d.decompress(frame + b"\x00" * (_ZSTD_SLICE * 2)) == payload
    assert d.eof is True


def test_call_after_the_frame_end_ends_the_stream():
    frame = _frame(b"payload")
    upstream, sliced = _both(frame, b"more")
    assert sliced == upstream
    assert sliced[1] is True


def test_corrupt_stream_yields_nothing_like_upstream():
    upstream, sliced = _both(b"\x00" * 64)
    assert sliced == upstream == ([b""], True)


def test_corruption_in_a_later_slice_drops_the_partial_output():
    """Upstream sees it in one call and returns b""; slicing must not leak a prefix."""
    # The checksum is what makes the damage an error: without one, zstd decodes a
    # flipped byte in a raw (noise) block as ordinary data.
    payload = _noise(_ZSTD_SLICE * 5)
    frame = bytearray(zstd.ZstdCompressor(write_checksum=True).compress(payload))
    assert len(frame) > _ZSTD_SLICE * 3
    frame[len(frame) // 2] ^= 0xFF
    upstream, sliced = _both(bytes(frame))
    assert sliced == upstream
    assert sliced == ([b""], True)
