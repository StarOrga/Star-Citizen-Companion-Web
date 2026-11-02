# Handover from the backlog run (#832, shell beta follow-ups)

Handed over by the backlog session on 2026-11-02. The owner decided that these two parts belong to the search concept. Both go into the implement brief of this concept and are delivered as part of it, one after the other, with `Refs #832`.

## 1. Find gallery images in the search

- **Today:** the `gallery` context in `src/app/shell/fusion-bar/search-context.ts` has `placesFirst: true`. It lists app places only, never real gallery hits.
- **Data:** `verse_wallpapers` (`image_id`, `title`, `series`, `published_at`, `preview_url`), read through `src/app/starscape/starscape.service.ts`.
- **Needs:** a search RPC or a query with an `ilike`/trigram index. Mind the anon statement timeout of 3 s. Check RLS and the anon grant first.
- **Hits:** real anchors to `/verse/gallery/:imageId`.
- **Concept rule (round 2):** gallery rows get no main CTA and no standard icons.
- **Acceptance:** in the gallery context, a gallery title lists matching images first, as real links.

## 2. Search your own hangar

- **Where:** client side only, over the data of `HangarService` (`src/app/hangar/hangar.service.ts`), only in the HQ context and only when signed in.
- **Never:** none of it goes into the shared codex index, into other users' data or into a request payload.
- **Concept link:** this is the "Aus deinem Bestand" section. Ship custom names, config names and FPS-set names count as sources (rounds 1–2).
- **Acceptance:** in the HQ context, a ship name lists your own hangar entries.

## Order

Both parts change the search engine's group model, so ship one before starting the other. Out of scope: the Fankit check and the e-mail handover from #832.
