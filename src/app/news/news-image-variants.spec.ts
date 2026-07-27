import {
  MAX_VARIANT_WIDTH, RUNG_WIDTHS, newsDefaultSrc, newsSrcset, parseVariantUrl, rsiVariant, variantRungs,
} from './news-image-variants';

const BUCKET = 'https://x.supabase.co/storage/v1/object/public/news-images';
const MEDIA = 'https://media.robertsspaceindustries.com/abc123';

describe('news image variants', () => {
  describe('variantRungs', () => {
    it('derives the full ladder from the top width', () => {
      expect(variantRungs(1600)).toEqual([400, 800, 1600]);
    });

    it('drops rungs that would upscale and keeps the source width as top', () => {
      expect(variantRungs(1140)).toEqual([400, 800, 1140]);
      expect(variantRungs(480)).toEqual([400, 480]);
      expect(variantRungs(350)).toEqual([350]);
    });

    it('never emits a duplicate when the source width IS a rung', () => {
      expect(variantRungs(800)).toEqual([400, 800]);
      expect(variantRungs(400)).toEqual([400]);
    });

    it('treats the reserved 0 width as "no ladder"', () => {
      expect(variantRungs(0)).toEqual([]);
    });
  });

  describe('parseVariantUrl', () => {
    it('splits our own variant urls', () => {
      expect(parseVariantUrl(`${BUCKET}/deadbeef/w800.jpg`))
        .toEqual({ base: `${BUCKET}/deadbeef/`, top: 800, ext: '.jpg' });
    });

    it('rejects legacy and upstream urls', () => {
      expect(parseVariantUrl(`${BUCKET}/deadbeef/cover.png`)).toBeNull();
      expect(parseVariantUrl(`${MEDIA}/source.jpg`)).toBeNull();
    });
  });

  describe('newsSrcset', () => {
    it('advertises every ladder entry with its REAL width', () => {
      expect(newsSrcset(`${BUCKET}/deadbeef/w1140.jpg`)).toBe(
        `${BUCKET}/deadbeef/w400.jpg 400w, ${BUCKET}/deadbeef/w800.jpg 800w, ${BUCKET}/deadbeef/w1140.jpg 1140w`,
      );
    });

    it('only advertises candidates that exist for a small source', () => {
      expect(newsSrcset(`${BUCKET}/deadbeef/w480.png`)).toBe(
        `${BUCKET}/deadbeef/w400.png 400w, ${BUCKET}/deadbeef/w480.png 480w`,
      );
    });

    it('emits nothing for the opaque single-object case, so src wins', () => {
      expect(newsSrcset(`${BUCKET}/deadbeef/w0.gif`)).toBe('');
    });

    it('keeps the legacy post/cover pair for not-yet-compacted cache urls', () => {
      expect(newsSrcset(`${BUCKET}/deadbeef/cover.jpg`)).toBe(
        `${BUCKET}/deadbeef/post.jpg 500w, ${BUCKET}/deadbeef/cover.jpg 1140w`,
      );
    });

    it('keeps the legacy pair for upstream RSI media urls', () => {
      expect(newsSrcset(`${MEDIA}/source.jpg`)).toBe(
        `${MEDIA}/post.jpg 500w, ${MEDIA}/cover.jpg 1140w`,
      );
    });
  });

  describe('newsDefaultSrc', () => {
    it('gives a regular tile the smallest rung and the hero the largest', () => {
      expect(newsDefaultSrc(`${BUCKET}/deadbeef/w1600.jpg`, false)).toBe(`${BUCKET}/deadbeef/w400.jpg`);
      expect(newsDefaultSrc(`${BUCKET}/deadbeef/w1600.jpg`, true)).toBe(`${BUCKET}/deadbeef/w1600.jpg`);
    });

    it('returns the object itself when there is only one', () => {
      expect(newsDefaultSrc(`${BUCKET}/deadbeef/w0.gif`, false)).toBe(`${BUCKET}/deadbeef/w0.gif`);
      expect(newsDefaultSrc(`${BUCKET}/deadbeef/w350.jpg`, false)).toBe(`${BUCKET}/deadbeef/w350.jpg`);
    });

    it('falls back to post/cover for upstream urls', () => {
      expect(newsDefaultSrc(`${MEDIA}/source.jpg`, false)).toBe(`${MEDIA}/post.jpg`);
      expect(newsDefaultSrc(`${MEDIA}/source.jpg`, true)).toBe(`${MEDIA}/cover.jpg`);
    });
  });

  describe('rsiVariant', () => {
    it('leaves urls without a variant segment alone', () => {
      const signed = 'https://robertsspaceindustries.com/i/abcdef/foo.jpg';
      expect(rsiVariant(signed, 'post')).toBe(signed);
    });

    it('does not rewrite the new width-variant scheme', () => {
      // `w800` is not `post`/`cover`, so the legacy rewriter must ignore it —
      // otherwise a compacted url would be mangled into a 404.
      const url = `${BUCKET}/deadbeef/w800.jpg`;
      expect(rsiVariant(url, 'cover')).toBe(url);
    });
  });

  it('pins the ladder contract shared with the edge function', () => {
    // supabase/functions/fetch-verse-news/image-variants.ts must agree.
    expect(RUNG_WIDTHS).toEqual([400, 800]);
    expect(MAX_VARIANT_WIDTH).toBe(1600);
  });
});
