import { renderFeedbackBody } from '../admin/feedback/markdown.util';
import { applySignedUrls, attachmentPathsOf } from './feedback-attachment-urls';

const BASE = 'https://proj.supabase.co/storage/v1/object/public/feedback-images';
const IMG = `${BASE}/u1/shot.jpg`;
const LOG = `${BASE}/u1/crash.log`;

describe('feedback-attachment-urls', () => {
  describe('attachmentPathsOf', () => {
    it('collects paths from image and file links, without duplicates', () => {
      const body = `hi\n\n![shot](${IMG})\n\n[crash.log](${LOG})\n\n![again](${IMG})`;
      expect(attachmentPathsOf(body)).toEqual(['u1/shot.jpg', 'u1/crash.log']);
    });

    it('ignores foreign URLs and data URIs', () => {
      const body = '![a](https://a.b/x.png) [b](https://example.com/y) ![c](data:image/png;base64,AAAA)';
      expect(attachmentPathsOf(body)).toEqual([]);
    });

    it('tolerates an empty body', () => {
      expect(attachmentPathsOf('')).toEqual([]);
    });
  });

  describe('applySignedUrls', () => {
    it('replaces the href of a bucket file link and escapes the signed URL', () => {
      const rendered = renderFeedbackBody(`see [crash.log](${LOG})`);
      const signed = new Map([['u1/crash.log', 'https://proj.supabase.co/sign/x?token=a&b=c']]);
      const out = applySignedUrls(rendered, signed);
      expect(out.html).toContain('href="https://proj.supabase.co/sign/x?token=a&amp;b=c"');
      expect(out.html).not.toContain(LOG);
    });

    it('keeps the images array reference-identical', () => {
      const rendered = renderFeedbackBody(`![shot](${IMG})\n\n[crash.log](${LOG})`);
      const out = applySignedUrls(rendered, new Map([['u1/crash.log', 'https://s/1']]));
      expect(out).not.toBe(rendered);
      expect(out.images).toBe(rendered.images);
    });

    it('returns the same object when nothing is replaced', () => {
      const rendered = renderFeedbackBody('see [x](https://a.b/y) and [crash.log](' + LOG + ')');
      expect(applySignedUrls(rendered, new Map())).toBe(rendered);
      expect(applySignedUrls(rendered, new Map([['u9/other.jpg', 'https://s/2']]))).toBe(rendered);
    });
  });
});
