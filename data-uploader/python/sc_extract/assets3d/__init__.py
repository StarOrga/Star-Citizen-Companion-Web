"""Generic 3D asset packages: a root geometry (ship hull, FPS weapon body),
shared content-addressed part GLBs and a manifest that places every part at
its port. Public API and contract: data-uploader/docs/asset-package.md.

Stages (each typed, each unit-testable on its own):
  1. EXTRACT  datacore.DataCoreSource   DataCore + P4K -> EntityDef / LoadoutEntry
  2. RESOLVE  entity.resolve_entity     -> ResolvedPort (CryEngine space)
  3. EXPORT   parts.PartStore.export    geometry path -> PartRef (sha256 GLB)
  4. ENRICH   enrich.enrich             -> manifest Placement rows (glTF space)
  5. PACKAGE  package.build_package     -> validated Manifest (+ locator check)
"""
from .entity import EntityDef, LoadoutEntry, PortDef, ResolvedPort, resolve_entity
from .manifest import SCHEMA_VERSION, Manifest, Placement, validate_manifest, write_manifest
from .package import PackageResult, build_manifest, build_package, check_locators, export_parts
from .parts import PartRef, PartStore

__all__ = [
    "EntityDef", "LoadoutEntry", "PortDef", "ResolvedPort", "resolve_entity",
    "SCHEMA_VERSION", "Manifest", "Placement", "validate_manifest", "write_manifest",
    "PackageResult", "build_manifest", "build_package", "check_locators", "export_parts",
    "PartRef", "PartStore",
]
