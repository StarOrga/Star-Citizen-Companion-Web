# Implement brief 3: after the round-7 review (concept 20261109-1745)

Branch `claude/batch-fb8929` (head `756397c4`, main merged).

## Decisions (round 7, submitted with „implement“)
- r7-ship = fix-then-ship. Fix the open points, then ship directly with no further review round. The ship includes the db push of both migrations, the deploy of `exemplar-ai`, and the alpha release.
- r7-roomnames: no option picked. User note, verbatim: „Dafür gern wie beim data uploader die translation mechanimus bemühen! kostet ja nicht viele tokens“. Translate room names through the existing game-string translation mechanism (`supabase/functions/translate-orchestrator`, `translation-overlay`, docs/translation/ARCHITECTURE.md). Do not use a hand-written table.
- r7-plan = fit. The deck plan fills the stage (zoom to fit); the room chip row scrolls.
- Pin on the Kühler picker (s15), verbatim: „dieses popup darf auch in der klassischen ansicht geändert werden!“ Picker fixes apply to BOTH views.

## Checklist
- E1 Picker (shared, both views): no English left. Covers slot names („Cooler Left“, „Power Plant“), column heads („Power Seg“, „Grade“, „Mindest-Power“, „Archetyp / Power“) and type lines („Ballistic Gatling“, „Cooler“). Use i18n keys or the existing localized type keys. The dev jargon in the spread note („P4K“, „Extractor-Lücke“) is replaced by user language. The picker closes only via its own X / Abbrechen / Escape, not on a scrim click (project dialog rule); remove the „Klick neben das Fenster …“ hint.
- E2 Date: German style „13. Oktober 2026, 18:14“ (check `formatScDate` / the region setting; the slashes come from somewhere).
- E3 Numbers: decimal comma everywhere in the Holotisch (schema dimensions „19.7 × 17.4 × 5.1 m“), „+28 %“ with a space.
- E4 3D: the model fills the stage sensibly (fixed distance from C13 stays, just a tighter fit radius).
- E5 Deck plan zoom-to-fit (r7-plan). The room chip row scrolls without clipping a chip mid-word; no duplicate chips („Turret Rear Foyer“ twice).
- E6 Carrack outer labels truncated („FERNGESTEUERTE TÜRM…“). Use a short type label or allow two lines.
- E7 Skala tooltip must not cover the schema labels; the „%.“ orphan is gone.
- E8 Exemplar save created a second exemplar „Codex-Loadout“ once. Find the double-create (name dialog fallback plus save) and guard it.
- E9 EM value differs between two shots of the same draft (11,9 vs 13,4 km). Find the stale stat.
- E10 Inspector: empty placeholder area before „Vorschau der Detailseite“, and the preview is clipped at the card edge.
- E11 Schema box: the third line is clipped at the card end.
- E12 Generator callout covers the „Lebenserhaltung S1“ label (16).
- E13 Akte: large empty gap between the text and the facts; livery name „Frostbite Ca…“ truncated.
- E14 Room names translated via the translation mechanism (see the decision above). Also check that the uploader emits the room's localization key where the game has one.
