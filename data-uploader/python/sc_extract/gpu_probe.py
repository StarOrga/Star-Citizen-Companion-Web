"""GPU capability probe for the host.

    python -m sc_extract.gpu_probe
    -> {"available": true, "name": "NVIDIA GeForce RTX 2080 SUPER/PCIe/SSE2", "reason": null}
    -> {"available": false, "name": null, "reason": "no OpenGL 3.3 context: ..."}

One JSON line on stdout, exit code 0 either way (a missing GPU is an answer,
not an error). ``available`` means: the silhouette raster would really run on
the GPU in this environment (headless OpenGL 3.3 context, hardware renderer).
It does not read ``SC_USE_GPU`` — the host asks whether it CAN, then decides.
"""
from __future__ import annotations

import json
import sys


def main() -> int:
    try:
        from .silhouette_gpu import status
        result = status()
    except Exception as exc:  # noqa: BLE001 — the probe must always answer
        result = {"available": False, "name": None, "reason": f"{type(exc).__name__}: {exc}"}
    sys.stdout.write(json.dumps(result) + "\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
