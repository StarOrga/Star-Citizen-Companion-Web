import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { CodexKind, CodexService } from './codex.service';

interface PinnedRef {
  key: string;
  kind: CodexKind;
  className: string;
}

/**
 * Floating compare tray. Shows the pinned entities (max 4) as removable chips
 * with a deep-link, plus a "clear" action. Rendered globally by the list view;
 * stays in sync via the CodexService compare signal so pins survive navigation
 * to the detail view and back.
 */
@Component({
  selector: 'sc-codex-compare-tray',
  standalone: true,
  imports: [RouterLink, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (refs().length > 0) {
      <aside class="tray" aria-live="polite">
        <span class="tray-label">{{ 'codex.compare.tray' | translate: { count: refs().length } }}</span>
        <ul class="chips">
          @for (r of refs(); track r.key) {
            <li class="chip">
              <a [routerLink]="['/codex', r.kind, r.className]" class="chip-link">{{ r.className }}</a>
              <button type="button" class="chip-x" (click)="remove(r.key)"
                      [attr.aria-label]="'codex.compare.remove' | translate">×</button>
            </li>
          }
        </ul>
        <button type="button" class="clear" (click)="clear()">{{ 'codex.compare.clear' | translate }}</button>
      </aside>
    }
  `,
  styles: [`
    .tray {
      position: fixed; left: 50%; transform: translateX(-50%);
      bottom: 18px; z-index: 40;
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      max-width: min(960px, calc(100vw - 32px));
      padding: 10px 14px; border-radius: 12px;
      background: color-mix(in srgb, var(--sc-bg-2) 92%, transparent);
      border: 1px solid var(--sc-accent);
      box-shadow: 0 8px 30px rgba(0,0,0,0.5), 0 0 22px color-mix(in srgb, var(--sc-accent) 30%, transparent);
      backdrop-filter: blur(10px);
    }
    .tray-label {
      font-family: var(--sc-font-display); font-size: 0.74rem; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--sc-accent); white-space: nowrap;
    }
    .chips { list-style: none; display: flex; gap: 6px; flex-wrap: wrap; margin: 0; padding: 0; }
    .chip {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 4px 3px 10px; border-radius: 999px;
      background: var(--sc-bg-1); border: 1px solid var(--sc-border);
      font-size: 0.76rem;
    }
    .chip-link { color: var(--sc-fg-0); text-decoration: none; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chip-link:hover { color: var(--sc-accent); }
    .chip-x {
      border: none; background: transparent; color: var(--sc-fg-2); cursor: pointer;
      font-size: 1.1rem; line-height: 1; padding: 0 4px; border-radius: 50%;
    }
    .chip-x:hover { color: var(--sc-danger); }
    .clear {
      margin-left: auto; padding: 5px 12px; border-radius: 6px;
      background: transparent; border: 1px solid var(--sc-border); color: var(--sc-fg-2);
      font-family: inherit; font-size: 0.74rem; cursor: pointer;
    }
    .clear:hover { color: var(--sc-accent); border-color: var(--sc-accent); }
  `],
})
export class CodexCompareTrayComponent {
  private readonly svc = inject(CodexService);

  readonly refs = computed<PinnedRef[]>(() =>
    this.svc.compareKeys().map((key) => {
      const idx = key.indexOf(':');
      return {
        key,
        kind: key.slice(0, idx) as CodexKind,
        className: key.slice(idx + 1),
      };
    }),
  );

  remove(key: string): void {
    this.svc.unpin(key);
  }

  clear(): void {
    this.svc.clearCompare();
  }
}
