"""Preview WebPs are encoded once per distinct source DDS, across runs."""
from __future__ import annotations

import io
from pathlib import Path

import pytest

PIL = pytest.importorskip("PIL")
from PIL import Image  # noqa: E402

from sc_extract.images import AssetExtractor, preview_cache_dir  # noqa: E402


class _P4K:
    def __init__(self, files):
        self.files = files

    def namelist(self):
        return list(self.files)

    def getinfo(self, name):
        return name

    def open(self, info):
        return io.BytesIO(self.files[info])


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", (8, 8), (255, 0, 0, 255)).save(buf, "PNG")
    return buf.getvalue()


def test_second_run_copies_from_the_cache(tmp_path, monkeypatch):
    p4k = _P4K({"Data/UI/a.dds": _png()})
    cache = tmp_path / "cache"
    first = AssetExtractor(p4k, tmp_path / "run1", cache_dir=cache)
    assert first.resolve("UI/a.tif") == "a.webp"
    assert len(list(cache.glob("*.webp"))) == 1

    encoded = []
    real_open = Image.open

    def spy(*a, **k):
        encoded.append(1)
        return real_open(*a, **k)

    monkeypatch.setattr(Image, "open", spy)
    second = AssetExtractor(p4k, tmp_path / "run2", cache_dir=cache)
    assert second.resolve("UI/a.tif") == "a.webp"
    assert encoded == []  # served from the cache, not decoded again
    assert (tmp_path / "run2" / "a.webp").read_bytes() == (tmp_path / "run1" / "a.webp").read_bytes()


def test_prune_keeps_exactly_the_current_art(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "old.webp").write_bytes(b"x")
    ex = AssetExtractor(_P4K({"Data/UI/a.dds": _png()}), tmp_path / "run", cache_dir=cache)
    ex.resolve("UI/a.tif")
    assert ex.prune_cache() == 1
    assert [f.name for f in cache.glob("*.webp")] != ["old.webp"]


def test_cache_dir_only_next_to_extract_dirs(tmp_path):
    assert preview_cache_dir(tmp_path / ".sc-companion-extracts" / "LIVE-4.3") == \
        (tmp_path / ".sc-companion-extracts" / "preview-cache").resolve()
    assert preview_cache_dir(tmp_path / "x") is None
