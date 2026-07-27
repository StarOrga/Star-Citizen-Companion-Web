import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { FeedbackAttachmentsComponent } from './feedback-attachments.component';
import { FeedbackImage } from './markdown.util';

const IMAGES: FeedbackImage[] = [
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

  async function setup(images: FeedbackImage[] = IMAGES, removable = false) {
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
      },
    });
    translate.use('en');

    fixture = TestBed.createComponent(FeedbackAttachmentsComponent);
    fixture.componentRef.setInput('images', images);
    fixture.componentRef.setInput('removable', removable);
    fixture.detectChanges();
    cmp = fixture.componentInstance;
    return cmp;
  }

  function thumbs(): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.att-thumb'));
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
});
