import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from './auth/auth.service';

@Component({
  selector: 'sc-root',
  standalone: true,
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<router-outlet />`,
  styles: [`:host { display: block; min-height: 100vh; }`],
})
export class AppComponent implements OnInit {
  private readonly translate = inject(TranslateService);
  private readonly auth = inject(AuthService);

  ngOnInit(): void {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('sc.lang') : null;
    const browser = (this.translate.getBrowserLang() ?? 'en').slice(0, 2);
    const initial = stored ?? (browser === 'de' ? 'de' : 'en');
    this.translate.use(initial);
    this.auth.init();
  }
}
