"""Runtime compat shim for opening current (SC 4.x) Data.p4k with scdatatools 1.0.4.

THE PROBLEM
-----------
scdatatools 1.0.4 (released 2022-08-02) fails to open a present-day SC 4.x
``Data.p4k`` with::

    zipfile.BadZipFile: Corrupt extra field 0001 (size=18)

raised from ``scdatatools.p4k.P4KInfo._decodeExtra`` (p4k.py:183).

ROOT CAUSE (verified against the live 147 GB Data.p4k, build LIVE 4.x)
----------------------------------------------------------------------
Every central-directory entry carries a **206-byte** ``extra`` blob laid out as:

    offset 0   tp=0x0001  ln=32   ZIP64 sizes  (file_size, compress_size,
                                                header_offset as 3x u64, plus
                                                8 trailing bytes scdatatools
                                                ignores -- the >=24 branch reads
                                                only the first 24)
    offset 36  ...                SC's *proprietary* signature / encryption
                                   trailer (NOT a sequence of standard
                                   tp/ln extra records). The encryption flag
                                   the loader checks lives at byte 168.

``_decodeExtra`` walks ``extra`` as if the whole blob were a chain of standard
``(tp, ln)`` records (``offset += ln + 4``). After the legit 0x0001/ln=32
record it lands at offset 36, inside SC's signature trailer, and starts
mis-reading random signature bytes as fake extra records. For *most* entries
the bogus length is huge and the loop simply runs off the end harmlessly --
but for some entries (e.g.
``Data/Objects/planets/flora/.../betula_01_sapling_c_dead_bboard_ddna.dds.4a``)
the trailing bytes happen to read as ``tp=0x0001, ln=18``, which hits the
``else: raise BadZipFile`` branch and aborts opening the entire archive.

THE FIX
-------
The only standards-compliant ZIP64 data scdatatools needs is the **first**
0x0001 record. SC's trailer must not be parsed as extra records. We replace
``P4KInfo._decodeExtra`` with a version that:

  * still sets ``is_encrypted`` from byte 168 (unchanged behaviour),
  * decodes the legitimate leading ZIP64 0x0001 record exactly as upstream,
  * **stops** (``break``) instead of ``raise``-ing when it encounters a 0x0001
    record whose length is not one of the known ZIP64 sizes -- i.e. when the
    walk has desynced into SC's signature trailer.

This reads every byte that is actually present and skips the unknown remainder
rather than error-silencing real corruption: a genuinely truncated ZIP64 field
would also have produced unusable size fields, but here the leading record is
complete and valid (proven on live data), so breaking is correct.

USAGE
-----
Import and call :func:`apply_p4k_compat` **before** constructing ``P4KFile``::

    from sc_extract.p4k_compat import apply_p4k_compat
    apply_p4k_compat()
    from scdatatools.p4k import P4KFile
    p4k = P4KFile(r"...\\LIVE\\Data.p4k")

Idempotent. Returns True if the patch was applied (or already present),
False if scdatatools could not be imported.
"""

from __future__ import annotations

import struct

_PATCHED_FLAG = "_sc_companion_compat_patched"


def _decodeExtra_tolerant(self) -> None:
    """Drop-in replacement for ``P4KInfo._decodeExtra`` tolerant of SC's trailer.

    Mirrors scdatatools 1.0.4 logic byte-for-byte for the ZIP64 0x0001 record,
    but ``break``s instead of ``raise``-ing on an unknown 0x0001 length, which
    is the signal that the walk has run past the standard extra records into
    SC's proprietary signature trailer.
    """
    # Encryption flag: byte 168 of the extra blob (unchanged from upstream).
    self.is_encrypted = len(self.extra) >= 168 and self.extra[168] > 0x00

    offset = 0
    total = len(self.extra)
    while (offset + 4) < total:
        tp, ln = struct.unpack("<HH", self.extra[offset : offset + 4])
        if tp == 0x0001:
            if ln >= 24:
                counts = struct.unpack("<QQQ", self.extra[offset + 4 : offset + 28])
            elif ln == 16:
                counts = struct.unpack("<QQ", self.extra[offset + 4 : offset + 20])
            elif ln == 8:
                counts = struct.unpack("<Q", self.extra[offset + 4 : offset + 12])
            elif ln == 0:
                counts = ()
            else:
                # Desynced into SC's signature trailer -- the leading ZIP64
                # record has already been consumed. Stop, don't abort the archive.
                break

            idx = 0
            if self.file_size in (0xFFFFFFFFFFFFFFFF, 0xFFFFFFFF):
                self.file_size = counts[idx]
                idx += 1
            if self.compress_size == 0xFFFFFFFF:
                self.compress_size = counts[idx]
                idx += 1
            if self.header_offset == 0xFFFFFFFF:
                self.header_offset = counts[idx]
                idx += 1
        offset += ln + 4


def apply_p4k_compat() -> bool:
    """Monkeypatch scdatatools so the current SC 4.x Data.p4k opens.

    Idempotent; safe to call multiple times. Returns True if patched (or
    already patched), False if scdatatools is not importable.
    """
    try:
        from scdatatools.p4k import P4KInfo
    except ImportError:
        return False

    if getattr(P4KInfo, _PATCHED_FLAG, False):
        return True

    P4KInfo._decodeExtra = _decodeExtra_tolerant
    setattr(P4KInfo, _PATCHED_FLAG, True)
    return True
