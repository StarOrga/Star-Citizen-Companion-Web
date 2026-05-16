# P4K Format Notes

Star Citizen's `Data.p4k` is a modified CryEngine PAK — internally a ZIP container with custom encryption on some entries.

## What the upload pipeline does today (MVP)

`process-p4k` (Supabase edge function) downloads the **first 64 KB** of the uploaded blob and runs:

1. **Magic check** — `PK\x03\x04` for ZIP local-file-header, or `CrCh` / `CrPk` for older CryEngine variants.
2. **Header version** — read at offset 4 (little-endian uint16).
3. **Entry count estimate** — counts the `PK\x03\x04` signature occurrences in the first 64 KB. This is a lower bound (a real Data.p4k has tens of thousands of entries; the central directory is at the end of the file).
4. **Channel + version hint** — comes from the filename (regex in `src/app/p4k/p4k.service.ts`):
   - `(live|ptu|eptu|tech-preview)` token before/after a separator → channel
   - `\d+\.\d+(\.\d+)?` → version (e.g. `3.24.1`, `4.0_eptu`)

The result row in `p4k_uploads.result` looks like:

```json
{
  "magicOk": true,
  "magic": "PK",
  "headerVersion": 20,
  "estimatedEntries": 412,
  "fileSizeBytes": 80523776,
  "channelHint": "live",
  "versionHint": "3.24.1",
  "notes": ["ZIP local-file-header version = 20"],
  "parsedAt": "2026-05-17T..."
}
```

## What we explicitly do NOT do (yet)

- **Full ZIP central-directory parsing.** Would need the last 64KB + size of central directory. Add when phase flips to beta.
- **Decryption** of CryEngine-encrypted entries. The encryption key has been reverse-engineered by the SC community for read-only inspection but is not redistributed here.
- **Manifest.xml extraction.** Phase 2 goal — once we have central-directory parsing.
- **Ship/weapon catalog ingestion.** Phase 3 goal — feeds the loadout planner (erkul-style).

## File size limits

- Frontend cap: `environment.storage.maxP4kSizeMb = 200`. Production Data.p4k is ~150 GB — out of scope. We currently only accept slices/extracts.
- Storage bucket cap: 300 MB (`file_size_limit = 314572800` in migration `00002`). Upload above this hits a Supabase 413.

## References

- CryEngine PAK overview: <https://wiki.starcitizenbase.com/wiki/Data.p4k>
- Star Citizen Tools — file format reverse-engineering: <https://wiki.starcitizen.tools>
- erkul.games does parsing client-side (uploads stay local). We chose server-side for now to simplify the first MVP — re-evaluate when file size becomes a constraint.
