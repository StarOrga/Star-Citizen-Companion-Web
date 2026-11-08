import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { throwError } from 'rxjs';
import { ConsentService } from '../../core/consent.service';
import { NewsService } from '../../news/news.service';
import { VerseNewsItemComponent } from './verse-news-item.component';

describe('VerseNewsItemComponent', () => {
  it('a direct load whose feed fails shows an error state with retry, not a blank page', async () => {
    const get = vi.fn().mockName('get').mockReturnValue(throwError(() => new Error('offline')));
    TestBed.configureTestingModule({
      imports: [VerseNewsItemComponent],
      providers: [
        provideTranslateService(),
        provideRouter([]),
        NewsService,
        { provide: HttpClient, useValue: { get } },
        { provide: ConsentService, useValue: { preferencesAllowed: () => false, statisticsAllowed: () => false } },
      ],
    });
    const fixture = TestBed.createComponent(VerseNewsItemComponent);
    fixture.componentRef.setInput('id', 'missing');
    fixture.detectChanges();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role=alert]'), 'error state').not.toBeNull();
    expect(el.querySelector('.miss'), 'not the "item missing" note').toBeNull();
    const calls = vi.mocked(get).mock.calls.length;
    el.querySelector<HTMLButtonElement>('.retry')!.click();
    expect(vi.mocked(get).mock.calls.length).toBe(calls + 1);
    fixture.destroy();
  });
});
