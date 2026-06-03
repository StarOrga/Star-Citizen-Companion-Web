"""Upload a ship-skin export (hull3d output) to Supabase: glb models + webp icons
to the public `ship-skins` storage bucket, and one row per skin into
`public.ship_skins`. Service-role only (bypasses RLS for ingest).

Run AFTER the migration `20260603_ship_skins.sql` is applied and AFTER an export
(cutlass_pilot / ship_export) has produced  <out>/<ShipId>/{models,icons,skins.json}.

Env:
    SUPABASE_URL                e.g. https://hcnqhvzlavdycidqyaai.supabase.co
    SUPABASE_SERVICE_ROLE_KEY   service-role key (secret — never commit)

CLI:
    python -m sc_extract.upload_skins --export ./out/DRAK_Cutlass_Black
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path
from typing import Optional

CONTENT_TYPES = {".glb": "model/gltf-binary", ".webp": "image/webp"}


def _req(method: str, url: str, key: str, body: Optional[bytes], content_type: str) -> bytes:
    r = urllib.request.Request(url, data=body, method=method)  # noqa: S310
    r.add_header("Authorization", f"Bearer {key}")
    r.add_header("apikey", key)
    if content_type:
        r.add_header("Content-Type", content_type)
    with urllib.request.urlopen(r) as resp:  # noqa: S310
        return resp.read()


def _upload_object(base: str, key: str, bucket: str, obj_path: str, file: Path) -> str:
    ct = CONTENT_TYPES.get(file.suffix.lower(), "application/octet-stream")
    url = f"{base}/storage/v1/object/{bucket}/{obj_path}"
    # upsert via x-upsert header
    r = urllib.request.Request(url, data=file.read_bytes(), method="POST")  # noqa: S310
    r.add_header("Authorization", f"Bearer {key}")
    r.add_header("apikey", key)
    r.add_header("Content-Type", ct)
    r.add_header("x-upsert", "true")
    with urllib.request.urlopen(r):  # noqa: S310
        pass
    return obj_path


def main() -> int:
    ap = argparse.ArgumentParser(description="Upload ship-skin export to Supabase")
    ap.add_argument("--export", required=True, type=Path, help="<out>/<ShipId> dir")
    ap.add_argument("--bucket", default="ship-skins")
    args = ap.parse_args()

    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        print("ERROR: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 2

    from .hull3d import safe_id

    ship_id = safe_id(args.export.name, "ship_id")  # dir name -> storage path
    catalog = json.loads((args.export / "skins.json").read_text(encoding="utf-8"))
    rows = []
    for s in catalog["skins"]:
        skin_id = safe_id(str(s["id"]), "skin_id")  # never let it traverse the bucket
        model_path = icon_path = None
        try:
            if s.get("model"):
                f = args.export / s["model"]
                if f.exists():
                    model_path = _upload_object(base, key, args.bucket,
                                                f"{ship_id}/{skin_id}.glb", f)
            if s.get("icon"):
                f = args.export / s["icon"]
                if f.exists():
                    icon_path = _upload_object(base, key, args.bucket,
                                               f"{ship_id}/{skin_id}.webp", f)
        except Exception as exc:  # noqa: BLE001 — one failed object must not abort the run
            print(f"  ! {skin_id}: upload failed ({type(exc).__name__}: {exc}) — skipping asset",
                  file=sys.stderr)
        rows.append({
            "ship_id": ship_id, "skin_id": skin_id, "name": s["name"],
            "description": s.get("description", ""), "source": s.get("source", "store"),
            "name_verified": bool(s.get("name_verified")),
            "model_path": model_path, "icon_path": icon_path,
            "model_bytes": int((s.get("model_mb") or 0) * 1e6) or None,
            "sort": 10 if skin_id == "standard" else 100,
        })
        print(f"  {skin_id:20} model={'y' if model_path else '-'} icon={'y' if icon_path else '-'}")

    # upsert rows (on_conflict=ship_id,skin_id)
    url = f"{base}/rest/v1/ship_skins?on_conflict=ship_id,skin_id"
    r = urllib.request.Request(url, data=json.dumps(rows).encode(), method="POST")  # noqa: S310
    r.add_header("Authorization", f"Bearer {key}")
    r.add_header("apikey", key)
    r.add_header("Content-Type", "application/json")
    r.add_header("Prefer", "resolution=merge-duplicates")
    with urllib.request.urlopen(r):  # noqa: S310
        pass
    print(f"\nuploaded {len(rows)} skins for {ship_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
