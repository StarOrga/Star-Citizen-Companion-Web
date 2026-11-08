**Wichtiger Hinweis:** In dieser Sitzung hatte ich nur Datei-Tools (list_files, read_file, grep). Es gab keine Websuche und keinen Web-Abruf. Die Quellen in Abschnitt 1 stammen aus meinem Wissen, ich habe keinen Link aufgerufen. Bitte vor der Übernahme kurz prüfen. Die Aussagen zum Datenmodell habe ich dagegen im Repo geprüft.

## Ergebnis in Kürze
- Das Modell ist ein regelbasiertes Wissensgraph-Scoring mit Item-zu-Item-Logik. Kein ML und keine Nutzerstatistik, damit alles deterministisch bleibt.
- Die Priorität des Owners (Komplement > gleiche Materialien > Ort > Handlung) wird durch Gewichte erzwungen. Jedes echte Komplement schlägt jeden Nicht-Komplement-Kandidaten.
- Ein Set-Schlüssel für Rüstungen und eine Magazin-Referenz an Waffen sind in den Codex-Tabellen nicht als Spalte vorhanden. Sie müssen aus dem Payload oder aus Klassennamen abgeleitet werden (Abschnitt 6).

## 1) Veröffentlichte Mechanismen
- **Amazon Item-to-Item CF:** Ähnlichkeiten werden offline pro Item berechnet und online nur nachgeschlagen. Das ist deterministisch und schnell. Linden/Smith/York 2003, https://www.cs.umd.edu/~samir/498/Amazon-Recommendations.pdf (IEEE Internet Computing 7(1)). Rückblick: Smith/Linden 2017, https://ieeexplore.ieee.org/document/7927889
- **Komplement vs. Substitut:** McAuley/Pandey/Leskovec, KDD 2015, https://arxiv.org/abs/1506.08839. Substitute werden gemeinsam angesehen, Komplemente gemeinsam gekauft. Für uns heißt das: Substitute (gleicher Slot, gleiche Größe) nie als „Passt dazu" zeigen, nur Komplemente. Ergänzend McAuley et al., SIGIR 2015, https://arxiv.org/abs/1506.04757
- **Frequently Bought Together / Warenkorbanalyse:** Assoziationsregeln mit Support, Confidence und Lift, Agrawal/Srikant, VLDB 1994. Wir haben keine Kaufhistorie. Unsere „Regeln" sind deshalb Katalogbeziehungen: gleiches Set, passende Größe, Rezeptzutat.
- **Wissensbasiert und Knowledge-Graph:** Burke 2000 (Knowledge-based Recommender Systems). KGAT, https://arxiv.org/abs/1905.07854. PGPR (Pfade als Erklärung), https://arxiv.org/abs/1906.05237. Wir nutzen nur die Idee: Kanten wie `fits_port`, `uses_ammo`, `ingredient_of`, `same_set`, und der Pfad liefert das „weil …".
- **Diversität:** MMR, Carbonell/Goldstein, SIGIR 1998, https://www.cs.cmu.edu/~jgc/publication/The_Use_MMR_Diversity_Based_LTMIR_1998.pdf. Topic Diversification, Ziegler et al., WWW 2005, https://dl.acm.org/doi/10.1145/1060745.1060754
- **Aktualität und Session:** Koren, KDD 2009 (Temporal Dynamics). Ding/Li, CIKM 2005 (Time Weight CF). Session-kNN und GRU4Rec, https://arxiv.org/abs/1511.06939. Wir nehmen einen exponentiellen oder rangbasierten Zeitabfall über die zuletzt hinzugefügten Items.
- **Erklärungen:** Herlocker et al., CSCW 2000, https://dl.acm.org/doi/10.1145/358916.358995. Tintarev/Masthoff, Recommender Systems Handbook (Explaining Recommendations). Kurze, konkrete „weil …"-Labels erhöhen Vertrauen und Transparenz.
- **Cold Start:** Schein et al., SIGIR 2002 (Methods and metrics for cold-start recommendations). Inhaltsbasierte Fallbacks greifen, wenn Interaktionen fehlen.

## 2) Deterministische Bewertung
**Anker:** die letzten 3 Warenkorb- oder Wunschlisten-Einträge, sortiert nach `added_at` absteigend. Gewichte `w = [1.0, 0.6, 0.35]`.

**Score eines Kandidaten c, summiert über die Anker a:**
`S(c) = Σ_a w_a · ( 100·C + 30·M + 10·L + 4·A )`

**Komponenten, jeweils in [0, 1]:**
- **C (Komplement)** in Stufen:
  - 1.0: harte Beziehung (gleiches Set, Munition/Magazin der Waffe, Zutat des Blueprints).
  - 0.7: passt in einen freien Port (Größe und Typ).
  - 0.5: weiche Beziehung (gleicher Hersteller und gleiche Linie, z. B. Lackierung für das Schiff).
  - 0: kein Komplement.
- **M (gleiche Materialien):** gewichtetes Jaccard über `ingredient_class_name` der beiden Blueprints, `Σ min(q) / Σ max(q)`. Wenn c selbst ein Rohstoff des Anker-Rezepts ist, gilt M = 1.
- **L (Ort):** gleicher Shop = 1.0, gleiche Station oder Stadt = 0.8, gleicher Körper oder Lagrange-Punkt (über `codex_locations.parent_id`) = 0.4, gleiches System = 0.2.
- **A (Handlung):** gleiche Aktivität (Mining, Hauling, FPS-Kampf, Schiffskampf, Crafting) = 1, sonst 0.

**Dominanz:** Der Maximalwert von M+L+A ist 44. Ein Komplement mit C ≥ 0.5 liefert mindestens 50. Ein Nicht-Komplement kann also nie ein Komplement überholen, und innerhalb derselben C-Stufe entscheidet M vor L vor A.

**Strafen und Ausschlüsse:**
- Ausschluss (hart):
  - schon im Besitz (Hangar oder Inventar),
  - schon auf der Wunschliste oder im Warenkorb,
  - nicht im aktuellen Build (`class_name` fehlt),
  - `is_variant` (die Basisversion wird bevorzugt),
  - Platzhalter oder Testitems.
- Dublette im selben Slot (Substitut):
  - Wenn der Anker-Slot schon belegt ist und c dieselbe Art und Größe hätte, gilt Faktor ×0.3.
  - Wenn ein bereits gewählter Vorschlag denselben Slot füllt, ist c ausgeschlossen.
- Craft oder Kauf bei demselben Item: nur eine Variante zeigen.
  - Deckung = Anteil der Zutaten, die im HQ-Inventar oder in den Vorräten (`hq_supplies`) schon vorhanden sind.
  - Deckung ≥ 0.6 → „craften".
  - Sonst → „kaufen", wenn ein Shop bekannt ist.
  - Sonst → „craften".

**Auswahl (MMR-artig, greedy, 3 Plätze):**
`pick = argmax( S(c) − 30·maxSim(c, bereits gewählt) )`
- `maxSim` = 1.0 bei gleichem Kind-Bucket, 0.5 bei gleichem Slot-Typ, sonst 0.
- Kind-Buckets: Rüstungsteil, Waffe, Magazin, Aufsatz, Schiffskomponente, Rakete, Lackierung, Material, Mining.
- Höchstens ein Vorschlag je Bucket, solange noch andere Buckets Kandidaten mit S > 0 haben. Sonst werden Plätze aufgefüllt.

**Tie-Break:** höherer Anker-Rang, dann `grade` absteigend, dann `name_localized` aufsteigend, dann `class_name` aufsteigend. Keine Zufallswerte, keine Zeit außer `added_at`.

**Schwellwert:** unter S < 20 nichts zeigen. Lieber 1–2 gute Vorschläge als 3 beliebige.

## 3) Komplement-Regeln je Art
Vor der Umsetzung gegen echte Payloads prüfen, welche Felder tatsächlich befüllt sind.

| Anker | Komplemente (C) |
|---|---|
| Rüstungsteil (Helm, Torso, Arme, Beine, Rucksack, Unteranzug) | Die übrigen Teile desselben Sets, C = 1.0. Pembroke-Helm → Pembroke-Torso, -Arme, -Beine. Teile, die schon vorhanden sind, entfallen. Beine und Torso vor dem Rucksack (Reihenfolge fest per Tabelle). |
| FPS-Waffe | 1. passendes Magazin (Munitionsreferenz) = 1.0. 2. Aufsätze über Ports: Optik, Lauf, Unterlauf. Nur wenn der Port-Typ passt, C = 0.7. 3. Waffen-Rüstung desselben Herstellers, C = 0.5. |
| Magazin | Die zugehörige Waffe (umgekehrt). Zusätzliche Magazine nur 1× vorschlagen. |
| Schiff | Schiffswaffen, Komponenten (Kraftwerk, Schild, Kühler, QD) passend zu den Ports des Schiffs (`codex_item_ports` min/max-Größe, Typen). Fabrikausstattung wird nicht vorgeschlagen (Dublette). Raketen nur, wenn das Schiff Raketenträger hat, und dann nach Racks. Lackierungen der Hülle (`ship_skins`). |
| Schiffswaffe oder Komponente | Das Schiff, in das sie passt (nur wenn nicht im Hangar). Dazu weitere Komponenten derselben Größe. |
| Raketenträger | Raketen der Rack-Größe (Kapazität in `itemPorts`). |
| Blueprint | 1. Zutaten (`codex_blueprint_ingredients`) als Rohstoff-Vorschlag. 2. das Magazin des Ausgabe-Items (`output_class_name`). 3. Blueprints mit überlappenden Zutaten (nur M). |
| Mining (Kopf, Modul, Gadget) | Mining-Köpfe passend zur Laser-Größe, dazu Module und Gadgets. Das Mining-Schiff, wenn es noch fehlt. |
| Rohstoff | Blueprints, die ihn verwenden (Rückwärts-Index `codex_blueprints_output_idx` und Ingredient-Reverse-Index), bevorzugt mit hoher Zutaten-Deckung. |

## 4) Erklärungs-Labels („weil …")
Das Label folgt der stärksten beitragenden Kante. Es hängt nur von den Daten ab, nicht vom Zufall.

- „gleiches Set: Pembroke"
- „Magazin für …" und „passt in S3"
- „Aufsatz: Optik, S1"
- „Zutat für …"
- „gleiches Material: Aluminium"
- „gleicher Shop: Area18" und „gleicher Ort: Lorville"
- „gleiche Aktivität: Mining"
- „craftbar: 4 von 5 Zutaten da" und „kaufbar bei …"
- „Lackierung für …"

Zusatzregel: Immer die Komponente mit dem höchsten Beitrag nennen (C vor M vor L vor A). Bei Gleichstand gilt wieder die feste Reihenfolge. Zusätzlich ein kleines Badge „Craften" oder „Kaufen". Ein Tooltip kann bis zu 2 weitere Gründe zeigen.

## 5) Cold Start
- **Warenkorb leer:** Anker aus Hangar-Schiffen (`hangar_ships`), dann aus den letzten HQ-Vorräten (`hq_supplies`), dann aus dem zuletzt angesehenen Codex-Item. Anker aus dem Hangar bekommen w = 0.5.
- **Kein Anker:** feste, kuratierte Startliste pro Patch (z. B. Starter-Rüstung, Medpens, Standard-Magazine) mit dem Label „Einsteiger". Alternativ eine globale Zählung der Wunschlisten-Einträge, die bei gleichem Datenstand ebenfalls deterministisch ist.
- **Anker nicht im Katalog:** `upcoming`-Schiffe (angekündigte Schiffe, `search_wishlist`, `entity_kind='upcoming'`) haben keine Ports. Nur L und A (Hersteller und Aktivität) nutzen und höchstens Schiffs-Lackierungen oder gar nichts zeigen. Das ist laut `20261106140000_one_wishlist.sql:7-16` ein bekannter Sonderfall.
- **Zu wenige Kandidaten:** nicht mit Rauschen auffüllen. Weniger als 3 anzeigen, Zeile ausblenden bei 0.

## 6) Benötigte Daten und Randfälle
**Im Repo vorhanden (geprüft):**
- Items, Waffen, Komponenten mit `attach_type`, `sub_type`, `size`, `grade`, `manufacturer_code`, `is_variant` und Payload (`00008_codex_catalog.sql:138-209`).
- Munition (`codex_ammunition`, `00008…:214`).
- Ports mit `min_size`, `max_size`, `types` (`00008…:238-253`).
- Blueprints und Zutaten mit Vorwärts- und Rückwärts-Index (`00010_codex_blueprints.sql:37-110`), plus der Index auf `output_class_name` (`20260726120000_codex_fps_equipment.sql:17-18`). Die FPS-Rüstung liegt in `codex_items` (`attach_type` `Char_Armor_*`), FPS-Waffen in `codex_weapons` (`weapon_class='FPS'`).
- Orte (`codex_locations`, mit `parent_id`, `type`, `system_code`; `20261008123750…:23-44`).
- Slot-Kompatibilität serverseitig: `codex_swap_candidates()` löst Port-Typ und Größe selbst auf und liefert die Munition des Kandidaten gleich mit (`20261016125100…:58-76`). Der Client kann so die Passungs-Prüfung wiederverwenden, statt sie nachzubauen.
- Wunschliste (`search_wishlist`, ein Speicher für alles, `20261106140000…`). Besitz über Hangar und Inventar, Vorräte über `hq_supplies`.

**Fehlt oder ist unklar (ableiten oder ergänzen):**
- **Set-ID für Rüstungen:** in den Codex-Tabellen gibt es keine. `hq_supplies.set_id` meint ein Hangar-Config-Set (`20261101000000_hq_supplies.sql:122-143`), also etwas anderes. Ableitung: `manufacturer_code` + Familien-Token aus dem `class_name` (Slot-Suffix und Farbvariante entfernen). Das ist heuristisch und braucht einen Test gegen echte Daten. Besser wäre ein Katalog-Feld `set_key` aus dem Extraktor.
- **Magazin- oder Munitionsreferenz an der Waffe:** nur im Payload (`weaponParams`, `itemPorts`), nicht als Spalte. Ein `magazine_class_name` wäre besser.
- **Shop-Standorte:** `codex_locations` kennt Orte, aber keine Shop-zu-Item-Zuordnung. Quellen wären Community-Beobachtungen aus `shop.purchase` (`20261101040000_hq_community.sql`) oder UEX (`uex-proxy`). Ohne diese Daten ist L für Shops deaktiviert und es bleibt nur der Ort.
- **Aktivitäts-Tag je Item:** muss ergänzt werden, z. B. aus Kategorie und `attach_type`.
- **Lackierung-zu-Schiff:** `ship_skins` (`20260603_ship_skins.sql`) und `rsi-paints-sync` prüfen.

**Randfälle:**
- Varianten, Farbvarianten und Platzhalter filtern (`_placeholders.ts`).
- Items, die in einem neuen Patch wegfallen oder umbenannt werden: mit `build_id` des aktuellen Builds abgleichen.
- Mehrere Magazine oder Aufsätze: nur das Standard-Magazin nehmen (Basisversion, kleinste Größe).
- Dangling-Zutaten (`ingredient_class_name` null): ignorieren.
- Mengen und `min_quality`: nicht in M aufnehmen, nur in der Craft-Deckung.
- Sprache: Labels aus i18n-Schlüsseln, nicht als Freitext.
- Testbarkeit: reine Funktion `(Anker, Katalog, Besitz) → Top-3`, mit Snapshot-Tests und festen Fixtures.
