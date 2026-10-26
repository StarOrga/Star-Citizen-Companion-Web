import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { toErrorKey } from '../describe-error';
import { HandoffService } from './handoff.service';

/**
 * Phone landing page of "Continue on your phone": trades the one-time code in
 * `?c=` for a session and navigates on. Plain layout (route data), no shell.
 * The code leaves the address bar immediately (replaceUrl on success; on
 * failure the page keeps only an error, the code is dead either way).
 */
@Component({
  selector: 'sc-handoff',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="wrap">
      <div class="sc-card card">
        <h1>{{ 'handoff.title' | translate }}</h1>
        @if (errorKey(); as key) {
          <p class="lead" role="alert">{{ 'handoff.invalid' | translate }}</p>
          <p class="detail">{{ key | translate }}</p>
          <a routerLink="/login" class="sc-btn sc-btn-primary">{{ 'handoff.toLogin' | translate }}</a>
        } @else {
          <p class="lead" role="status">{{ 'handoff.working' | translate }}</p>
        }
      </div>
    </section>
  `,
  styles: [
    `
      .wrap {
        display: grid;
        place-items: center;
        min-height: 60dvh;
      }
      .card {
        max-width: 28rem;
        display: grid;
        gap: 0.75rem;
      }
      .detail {
        color: var(--sc-text-muted);
        font-size: 0.875rem;
      }
    `,
  ],
})
export class HandoffComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly handoff = inject(HandoffService);

  readonly errorKey = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    const code = this.route.snapshot.queryParamMap.get('c') ?? '';
    try {
      const target = await this.handoff.redeem(code);
      await this.router.navigateByUrl(target, { replaceUrl: true });
    } catch (err) {
      this.errorKey.set(toErrorKey('handoff', 'redeem', err));
    }
  }
}
