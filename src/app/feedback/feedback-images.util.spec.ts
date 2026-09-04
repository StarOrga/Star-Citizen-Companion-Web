import type { PendingImage } from '../admin/feedback/feedback-composer.component';
import {
  ATTACHMENT_TYPE_BLOCKED,
  assertAttachmentsAllowed,
  buildFeedbackBody,
  feedbackImagePath,
} from './feedback-images.util';

const IMG: PendingImage = { id: '1', name: 'shot.jpg', dataUrl: 'data:image/jpeg;base64,AA' };
const LEGACY: PendingImage = { id: '2', name: 'old.jpg', dataUrl: 'data:image/jpeg;base64,AA' };
const LOG: PendingImage = {
  id: '3',
  name: 'crash.log',
  dataUrl: '',
  mime: 'text/plain',
};

/**
 * The attachment role gate (admin feedback 312a4acc). Viewers and collaborators
 * may attach IMAGES ONLY; admins may attach anything.
 *
 * These tests guard the copy of the rule that sits in the shared send path,
 * which is the one every surface goes through — the composer's `accept`
 * attribute is a hint a drag-and-drop walks straight past, and the storage
 * policy (migration 20260904040000) cannot be exercised from a unit test.
 */
describe('feedback attachment rules', () => {
  describe('assertAttachmentsAllowed', () => {
    it('lets images through for everyone', () => {
      expect(() => assertAttachmentsAllowed([IMG, LEGACY], false)).not.toThrow();
    });

    it('treats an attachment without a MIME as the image it used to be', () => {
      // Every draft written before non-image attachments existed looks like
      // this; refusing those would break restoring an old draft.
      expect(() => assertAttachmentsAllowed([LEGACY], false)).not.toThrow();
    });

    it('refuses a non-image when files are not allowed', () => {
      expect(() => assertAttachmentsAllowed([IMG, LOG], false)).toThrowError(
        ATTACHMENT_TYPE_BLOCKED,
      );
    });

    it('allows a non-image for an admin composer', () => {
      expect(() => assertAttachmentsAllowed([IMG, LOG], true)).not.toThrow();
    });

    it('accepts an empty attachment list either way', () => {
      expect(() => assertAttachmentsAllowed([], false)).not.toThrow();
    });
  });

  describe('buildFeedbackBody', () => {
    it('appends an image as markdown image syntax, so it is lifted into the chip row', () => {
      const body = buildFeedbackBody('Look here', [IMG], ['https://db.test/a.jpg']);
      expect(body).toBe('Look here\n\n![shot.jpg](https://db.test/a.jpg)');
    });

    it('appends a non-image as a plain link, because there is no thumbnail behind it', () => {
      const body = buildFeedbackBody('Log attached', [LOG], ['https://db.test/c.log']);
      expect(body).toBe('Log attached\n\n[crash.log](https://db.test/c.log)');
    });

    it('keeps images and files apart within one message', () => {
      const body = buildFeedbackBody('', [IMG, LOG], ['https://db.test/a.jpg', 'https://db.test/c.log']);
      expect(body).toContain('![shot.jpg](https://db.test/a.jpg)');
      expect(body).toContain('[crash.log](https://db.test/c.log)');
      expect(body).not.toContain('![crash.log]');
    });

    it('drops the empty half when there is text but nothing attached', () => {
      expect(buildFeedbackBody('just text', [], [])).toBe('just text');
    });
  });

  describe('feedbackImagePath', () => {
    it('reads the object path back out of one of our public URLs', () => {
      expect(
        feedbackImagePath('https://db.test/storage/v1/object/public/feedback-images/uid/a.jpg'),
      ).toBe('uid/a.jpg');
    });

    it('returns null for a URL that is not ours to delete', () => {
      expect(feedbackImagePath('https://example.test/somewhere/else.jpg')).toBeNull();
    });
  });
});
