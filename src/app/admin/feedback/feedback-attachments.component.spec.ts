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

  async function setup(images: FeedbackImage[] = IMAGES) {
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
      },
    });
    translate.use('en');

    fixture = TestBed.createComponent(FeedbackAttachmentsComponent);
    fixture.componentRef.setInput('images', images);
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
});
