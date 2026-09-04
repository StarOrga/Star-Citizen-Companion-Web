import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { AttachmentChip, FeedbackAttachmentsComponent } from './feedback-attachments.component';

const IMAGES: AttachmentChip[] = [
  { src: 'https://a.b/one.png', alt: 'first shot' },
  { src: 'https://a.b/two.png', alt: '' },
];

/**
 * Screenshots ride at the end of a message as attachment chips and only get
 * big on demand (feedback a660536a).
 */
describe('FeedbackAttachmentsComponent', () => {
  let fixture: ComponentFixture<FeedbackAttachmentsComponent>;
  let cmp: FeedbackAttachmentsComponent;

  async function setup(
    images: AttachmentChip[] = IMAGES,
    removable = false,
    extra: Record<string, unknown> = {},
  ) {
    await TestBed.configureTestingModule({
      imports: [FeedbackAttachmentsComponent],
      providers: [provideTranslateService({ fallbackLang: 'en' })],
    }).compileComponents();

    // No HTTP loader in the test — mirror the keys the component uses so the
    // labels resolve to real text (and the {{name}} parameter is exercised).
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      feedbackAttachments: {
        label: 'Attachments',
        image: 'Attachment',
        enlarge: 'Enlarge image',
        enlargeNamed: 'Enlarge image: {{name}}',
        close: 'Close image',
        remove: 'Remove image',
        prev: 'Previous image',
        next: 'Next image',
        counter: '{{i}} of {{n}}',
        openFile: 'Open file: {{name}}',
        addImage: 'Attach an image',
        addFile: 'Attach an image or file',
        capture: 'Capture a screenshot of this page',
        annotate: 'Annotate',
        annotateTools: 'Annotation tools',
        annotateSave: 'Apply annotation',
        annotateCancel: 'Cancel',
        annotateFailed: 'The annotation could not be saved.',
        colorPick: 'Pick a colour',
        undo: 'Undo the last mark',
        tool: { rect: 'Rectangle', arrow: 'Arrow', pen: 'Freehand' },
      },
    });
    translate.use('en');

    fixture = TestBed.createComponent(FeedbackAttachmentsComponent);
    fixture.componentRef.setInput('images', images);
    fixture.componentRef.setInput('removable', removable);
    for (const [key, value] of Object.entries(extra)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    cmp = fixture.componentInstance;
    return cmp;
  }

  function thumbs(): HTMLButtonElement[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('.att-thumb:not(.att-add):not(.att-capture)'),
    );
  }

  function lightbox(): HTMLElement | null {
    return document.querySelector('.lb-backdrop');
  }

  afterEach(() => {
    cmp?.close();
    TestBed.resetTestingModule();
  });

  it('renders one focusable, labelled thumbnail per image', async () => {
    await setup();
    const row = thumbs();
    expect(row.length).toBe(2);
    expect(row.every((b) => b.type === 'button')).toBeTrue();
    expect(row[0].getAttribute('aria-label')).toBe('Enlarge image: first shot');
    // A nameless image still gets a label instead of an empty button.
    expect(row[1].getAttribute('aria-label')).toBe('Enlarge image');
    expect(row[1].querySelector('img')?.getAttribute('alt')).toBe('Attachment');
    expect(row[0].querySelector('img')?.getAttribute('src')).toBe('https://a.b/one.png');
  });

  it('renders nothing when the message has no images', async () => {
    await setup([]);
    expect(thumbs().length).toBe(0);
    expect(fixture.nativeElement.querySelector('.att-row')).toBeNull();
  });

  it('opens the clicked image large, and closes again', async () => {
    await setup();
    expect(lightbox()).toBeNull();

    thumbs()[1].click();
    fixture.detectChanges();
    expect(cmp.current()?.src).toBe('https://a.b/two.png');
    expect(lightbox()).not.toBeNull();
    expect(lightbox()?.querySelector('.lb-img')?.getAttribute('src')).toBe('https://a.b/two.png');

    cmp.close();
    fixture.detectChanges();
    expect(cmp.current()).toBeNull();
    expect(lightbox()).toBeNull();
  });

  it('closes on ESC', async () => {
    await setup();
    thumbs()[0].click();
    fixture.detectChanges();
    expect(lightbox()).not.toBeNull();

    // The CDK keyboard dispatcher listens on <body>, which is where a real
    // keypress inside the overlay bubbles to.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(lightbox()).toBeNull();
  });

  /** Several screenshots on one message read as one gallery (feedback 99723afc). */
  describe('paging a multi-image message', () => {
    function press(key: string) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      fixture.detectChanges();
    }

    it('steps to the next/previous image and wraps at both ends', async () => {
      await setup();
      thumbs()[0].click();
      fixture.detectChanges();
      expect(lightbox()?.querySelector('.lb-count')?.textContent?.trim()).toBe('1 of 2');

      press('ArrowRight');
      expect(cmp.current()?.src).toBe('https://a.b/two.png');
      expect(lightbox()?.querySelector('.lb-img')?.getAttribute('src')).toBe('https://a.b/two.png');

      // Wraps rather than dead-ending on the last image.
      press('ArrowRight');
      expect(cmp.current()?.src).toBe('https://a.b/one.png');
      press('ArrowLeft');
      expect(cmp.current()?.src).toBe('https://a.b/two.png');
    });

    it('hides the paging controls for a single image', async () => {
      await setup([IMAGES[0]]);
      thumbs()[0].click();
      fixture.detectChanges();
      expect(lightbox()?.querySelector('.lb-nav')).toBeNull();
    });
  });

  /**
   * The composer renders its pending images through the same row, so an image
   * is one 72px chip from paste to re-read (feedback 99723afc).
   */
  describe('removable (composer strip)', () => {
    it('carries no remove badge by default', async () => {
      await setup();
      expect(fixture.nativeElement.querySelectorAll('.att-remove').length).toBe(0);
    });

    it('reports the position of the chip whose badge was pressed', async () => {
      await setup(IMAGES, true);
      const removed: number[] = [];
      cmp.remove.subscribe((i: number) => removed.push(i));

      const badges: HTMLButtonElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('.att-remove'),
      );
      expect(badges.length).toBe(2);
      expect(badges[1].getAttribute('aria-label')).toBe('Remove image');

      badges[1].click();
      expect(removed).toEqual([1]);
      // Removing must not enlarge the image it sits on.
      expect(lightbox()).toBeNull();
    });
  });
  /**
   * The row is also where you ADD something (admin feedback 312a4acc): the mini
   * image icon button above the field is gone, replaced by a pseudo-thumbnail
   * with a "+" in it — same box, same size, same line as an attachment that is
   * already there.
   */
  describe('add tiles', () => {
    it('shows no tiles on a read-only thread row', async () => {
      await setup();
      expect(fixture.nativeElement.querySelector('.att-add')).toBeNull();
      expect(fixture.nativeElement.querySelector('.att-capture')).toBeNull();
    });

    it('renders the "+" tile in the same row as the thumbnails', async () => {
      await setup(IMAGES, true, { addTile: true });
      const row = fixture.nativeElement.querySelector('.att-row') as HTMLElement;
      const children = Array.from(row.children) as HTMLElement[];
      // Two chips, then the tile — one line, one control.
      expect(children.length).toBe(3);
      expect(children[2].classList.contains('att-add')).toBeTrue();
      expect(children[2].classList.contains('att-thumb'))
        .withContext('the tile is the same box as a thumbnail')
        .toBeTrue();
    });

    it('opens the row even when nothing is attached yet', async () => {
      await setup([], true, { addTile: true, captureTile: true });
      expect(fixture.nativeElement.querySelector('.att-row')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('.att-add')).not.toBeNull();
    });

    it('names what may be attached, per role', async () => {
      await setup([], false, { addTile: true });
      expect(fixture.nativeElement.querySelector('.att-add')?.getAttribute('aria-label')).toBe(
        'Attach an image',
      );

      fixture.componentRef.setInput('addLabelKey', 'feedbackAttachments.addFile');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.att-add')?.getAttribute('aria-label')).toBe(
        'Attach an image or file',
      );
    });

    it('emits add and capture instead of doing the work itself', async () => {
      await setup([], false, { addTile: true, captureTile: true });
      let added = 0;
      let captured = 0;
      cmp.add.subscribe(() => added++);
      cmp.capture.subscribe(() => captured++);

      (fixture.nativeElement.querySelector('.att-add') as HTMLButtonElement).click();
      (fixture.nativeElement.querySelector('.att-capture') as HTMLButtonElement).click();
      expect(added).toBe(1);
      expect(captured).toBe(1);
    });

    it('refuses a second capture while one is still running', async () => {
      await setup([], false, { captureTile: true, capturing: true });
      const tile = fixture.nativeElement.querySelector('.att-capture') as HTMLButtonElement;
      expect(tile.disabled).toBeTrue();
      expect(tile.querySelector('.spin')).not.toBeNull();
    });
  });

  /**
   * Admins may attach any file (admin feedback 312a4acc). A file has no
   * thumbnail to show, so its chip says what it is — and because opening it is
   * a navigation, it is a real anchor, not a button with a click handler.
   */
  describe('file chips', () => {
    const FILE: AttachmentChip = { src: 'https://a.b/crash.log', alt: 'crash.log', kind: 'file' };

    it('renders an uploaded file as an anchor that opens in a new tab', async () => {
      await setup([FILE]);
      const link = fixture.nativeElement.querySelector('a.att-file') as HTMLAnchorElement;
      expect(link).not.toBeNull();
      expect(link.getAttribute('href')).toBe('https://a.b/crash.log');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link.getAttribute('aria-label')).toBe('Open file: crash.log');
      expect(link.querySelector('.af-ext')?.textContent?.trim()).toBe('log');
    });

    it('renders an inert box while the upload is still in flight', async () => {
      await setup([{ src: '', alt: 'crash.log', kind: 'file' }]);
      expect(fixture.nativeElement.querySelector('a.att-file')).toBeNull();
      expect(fixture.nativeElement.querySelector('span.att-file')).not.toBeNull();
    });

    it('falls back to a generic label for a name without an extension', async () => {
      await setup([{ src: 'https://a.b/dump', alt: 'dump', kind: 'file' }]);
      expect(fixture.nativeElement.querySelector('.af-ext')?.textContent?.trim()).toBe('file');
    });

    it('never opens the image lightbox for a file', async () => {
      await setup([FILE]);
      expect(fixture.nativeElement.querySelectorAll('.att-thumb button').length).toBe(0);
      expect(lightbox()).toBeNull();
    });
  });

  /**
   * Mark-up (admin feedback 312a4acc): a composer image can be drawn on before
   * it is sent. Offered only where the image is still editable — a thread
   * message is a record, not a canvas.
   */
  describe('annotation', () => {
    function annotateButton(): HTMLButtonElement | null {
      const buttons = Array.from(lightbox()?.querySelectorAll('button') ?? []);
      return (buttons.find((b) => b.textContent?.includes('Annotate')) as HTMLButtonElement) ?? null;
    }

    it('offers no mark-up on a read-only message', async () => {
      await setup();
      thumbs()[0].click();
      fixture.detectChanges();
      expect(annotateButton()).toBeNull();
    });

    it('opens a drawing surface and a toolbar on an editable image', async () => {
      await setup(IMAGES, true, { editable: true });
      thumbs()[0].click();
      fixture.detectChanges();
      expect(annotateButton()).not.toBeNull();

      cmp.startAnnotate();
      fixture.detectChanges();
      expect(cmp.annotating()).toBeTrue();
      expect(lightbox()?.querySelector('canvas.lb-draw')).not.toBeNull();
      expect(lightbox()?.querySelector('.lb-tools')).not.toBeNull();
      // Paging is suspended: an arrow key while drawing must not swap the image.
      expect(lightbox()?.querySelector('.lb-step')).toBeNull();
    });

    it('cannot be entered on a message that is not editable', async () => {
      await setup();
      thumbs()[0].click();
      fixture.detectChanges();
      cmp.startAnnotate();
      expect(cmp.annotating()).toBeFalse();
    });

    it('backs out of mark-up on ESC before it closes the lightbox', async () => {
      await setup(IMAGES, true, { editable: true });
      thumbs()[0].click();
      fixture.detectChanges();
      cmp.startAnnotate();
      fixture.detectChanges();

      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(cmp.annotating()).withContext('first ESC leaves mark-up').toBeFalse();
      expect(lightbox()).withContext('and keeps the image open').not.toBeNull();

      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(lightbox()).toBeNull();
    });

    it('ignores a backdrop click while drawing, so a stray tap costs nothing', async () => {
      await setup(IMAGES, true, { editable: true });
      thumbs()[0].click();
      fixture.detectChanges();
      cmp.startAnnotate();
      fixture.detectChanges();

      (lightbox() as HTMLElement).click();
      fixture.detectChanges();
      expect(lightbox()).not.toBeNull();
    });

    it('undo drops the last mark and cancel drops all of them', async () => {
      await setup(IMAGES, true, { editable: true });
      thumbs()[0].click();
      fixture.detectChanges();
      cmp.startAnnotate();
      cmp.shapes.set([
        { tool: 'rect', color: '#ff0000', width: 3, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
        { tool: 'arrow', color: '#ff0000', width: 3, points: [{ x: 1, y: 1 }, { x: 9, y: 9 }] },
      ]);
      cmp.undo();
      expect(cmp.shapes().length).toBe(1);
      cmp.cancelAnnotate();
      expect(cmp.shapes().length).toBe(0);
      expect(cmp.annotating()).toBeFalse();
    });

    it('emits the flattened image for the row position it belongs to', async () => {
      // Produced by the browser, not typed out: a hand-written base64 PNG can
      // decode in an <img> and still fail the stricter decoders behind it.
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 4;
      const png = canvas.toDataURL('image/png');
      await setup([{ src: png, alt: 'shot' }], true, { editable: true });
      const results: { index: number; dataUrl: string }[] = [];
      cmp.annotate.subscribe((r) => results.push(r));

      thumbs()[0].click();
      fixture.detectChanges();
      cmp.startAnnotate();
      cmp.shapes.set([
        { tool: 'rect', color: '#ff0000', width: 1, points: [{ x: 0, y: 0 }, { x: 3, y: 3 }] },
      ]);
      await cmp.saveAnnotation();

      expect(results.length).toBe(1);
      expect(results[0].index).toBe(0);
      expect(results[0].dataUrl.startsWith('data:image/jpeg')).toBeTrue();
      // Saving closes the enlarged view — the chip in the row is the result now.
      expect(cmp.annotating()).toBeFalse();
    });

    it('says so instead of silently keeping the original when the export fails', async () => {
      await setup([{ src: 'https://a.b/not-loadable.png', alt: 'x' }], true, { editable: true });
      thumbs()[0].click();
      fixture.detectChanges();
      cmp.startAnnotate();
      cmp.shapes.set([
        { tool: 'rect', color: '#ff0000', width: 1, points: [{ x: 0, y: 0 }, { x: 3, y: 3 }] },
      ]);
      await cmp.saveAnnotation();
      expect(cmp.annotateError()).toBe('feedbackAttachments.annotateFailed');
    });
  });
});
