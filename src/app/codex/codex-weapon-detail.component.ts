import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  alphaDamage,
  damageChannelsOf,
  formatEquippedStat,
  impactDamageChannels,
  penetrationDistance,
  projectileRange,
} from './codex-equipped-stats';
import { toFiniteNumber } from '../hangar/loadout-stats';
import { swapAimStats, swapResourceStats } from './swap-table';

/** Everything the weapon detail window needs about one hardpoint occupant. */
export interface WeaponDetailEntry {
  className: string;
  name: string;
  port: string;
  size: number | null;
  grade: string | null;
  manufacturerCode: string | null;
  payload: unknown;
  /** Matching `<class>_AMMO` projectile payload, when one exists. */
  ammoPayload?: unknown;
}

interface DetailRow {
  labelKey: string;
  /** `null` = the P4K carries no source for this at all (gold-dashed). */
  value: string | null;
}

interface DetailCard {
  titleKey: string;
  srcKey: string;
  rows: DetailRow[];
  /** Every row in this card is a KNOWN absence, not a per-item gap. */
  miss?: boolean;
}

const DAMAGE_ROW_KEY: Record<string, string> = {
  physical: 'codex.weaponDetail.row.physical',
  energy: 'codex.weaponDetail.row.energy',
  distortion: 'codex.weaponDetail.row.distortion',
  thermal: 'codex.weaponDetail.row.thermal',
  biochemical: 'codex.weaponDetail.row.biochemical',
  stun: 'codex.weaponDetail.row.stun',
};

function num(v: number | null, format: 'int' | 'dec' | 'perSec' | 'seconds' | 'mps' | 'metres' | 'metresDec'): string | null {
  return v === null ? null : formatEquippedStat({ labelKey: '', value: v, format });
}

/**
 * The weapon detail window (`ⓘ`, MASTER §10 / iteration 8 `#h3`): every value a
 * ship weapon carries in the P4K, grouped by the struct it comes from, cyan
 * when present and gold-dashed when the extract genuinely has no source. Reads
 * through the SAME helpers the picker's columns use (`swap-table.ts`,
 * `codex-equipped-stats.ts`) so a value never gets a second, diverging
 * definition. Reuses the `sc-codex-component-modal` shell's visual language
 * (backdrop, focus-on-Escape) but is its own component: the modal's payload is
 * "everything about one occupant", this one is "one fixed struct-grouped form".
 */
@Component({
  selector: 'sc-codex-weapon-detail',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (entry(); as e) {
      <div class="wd-backdrop" (click)="closed.emit()">
        <article #dialog class="wd-panel sc-card" role="dialog" aria-modal="true" aria-labelledby="wd-title"
                 tabindex="-1" (click)="$event.stopPropagation()" (keydown)="onKeydown($event)">
          <header class="wd-head">
            <h2 id="wd-title">{{ e.name }}{{ e.size != null ? ' · S' + e.size : '' }}</h2>
            <button type="button" class="wd-close" (click)="closed.emit()"
                    [attr.aria-label]="'codex.weaponDetail.close' | translate">✕</button>
          </header>
          <p class="note info">{{ 'codex.weaponDetail.intro' | translate }}</p>

          <div class="val-grid">
            @for (card of cards(); track card.titleKey) {
              <section class="val-card" [class.miss]="card.miss">
                <h4>{{ card.titleKey | translate }}</h4>
                @for (row of card.rows; track row.labelKey) {
                  <div class="row">
                    <span class="k">{{ row.labelKey | translate }}</span>
                    <span class="v" [class.gapv]="row.value === null">{{ row.value ?? (dashText() | translate) }}</span>
                  </div>
                }
                <p class="src">{{ card.srcKey | translate }}</p>
              </section>
            }
          </div>
        </article>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .wd-backdrop { position: fixed; inset: 0; z-index: 145;
      background: color-mix(in srgb, var(--sc-bg-0) 60%, transparent);
      -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
      display: flex; justify-content: center; align-items: flex-start; padding: 6vh 16px 16px; overflow-y: auto; }
    .wd-panel { position: relative; width: 100%; max-width: 900px; display: flex; flex-direction: column;
      gap: 12px; padding: 18px 20px 20px; border-color: color-mix(in srgb, var(--sc-accent) 45%, transparent); }
    .wd-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .wd-head h2 { margin: 0; font-size: 1.05rem; }
    .wd-close { flex: 0 0 auto; width: 32px; height: 32px; border-radius: 50%; background: var(--sc-bg-0);
      border: 1px solid var(--sc-border); color: var(--sc-fg-1); cursor: pointer; font-size: 0.9rem; }
    .wd-close:hover { border-color: var(--sc-accent); color: var(--sc-accent); }
    .note.info { margin: 0; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    .val-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--sc-gap-2, 10px); }
    .val-card { background: var(--sc-bg-2); border: 1px solid var(--sc-border); border-radius: var(--radius-md, 4px);
      padding: 10px; display: grid; gap: 2px; align-content: start; }
    .val-card h4 { margin: 0 0 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--sc-accent); }
    .val-card.miss { border: 1px dashed color-mix(in srgb, var(--sc-warn) 40%, transparent);
      background: color-mix(in srgb, var(--sc-warn) 4%, transparent); }
    .val-card.miss h4 { color: var(--sc-warn); }
    .row { display: grid; grid-template-columns: 1fr auto; gap: 6px; }
    .row .k { font-size: 12px; color: var(--sc-fg-2); }
    .row .v { font-size: 13px; color: var(--sc-fg-0); font-variant-numeric: tabular-nums; text-align: right; }
    .row .v.gapv { color: var(--sc-fg-2); }
    .val-card.miss .row .v { color: var(--sc-warn); }
    .src { margin: 4px 0 0; font-size: 11px; color: var(--sc-fg-2); }
    .val-card.miss .src { color: var(--sc-warn); opacity: 0.8; }

    @media (max-width: 640px) {
      .wd-backdrop { padding: 0; }
      .wd-panel { max-width: none; min-height: 100%; border-radius: 0; }
    }
  `],
})
export class CodexWeaponDetailComponent {
  readonly entry = input<WeaponDetailEntry | null>(null);
  readonly closed = output<void>();

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private returnFocus: HTMLElement | null = null;

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.entry()) this.closed.emit();
  }

  private readonly i18n = inject(TranslateService);
  /** Re-run the computed on a language switch so the resolved strings below follow (#50). */
  private readonly lang = signal(this.i18n.currentLang);

  constructor() {
    this.i18n.onLangChange.pipe(takeUntilDestroyed()).subscribe((e) => this.lang.set(e.lang));

    // Focus trap + focus-return (§13), same pattern as the swap picker.
    effect(() => {
      if (this.entry()) {
        this.returnFocus = (globalThis.document?.activeElement as HTMLElement | null) ?? null;
        queueMicrotask(() => this.dialog()?.nativeElement.focus());
      } else {
        const el = this.returnFocus;
        this.returnFocus = null;
        if (el?.isConnected) el.focus();
      }
    });
  }

  /** Tab/Shift+Tab wrap inside the dialog; Escape is handled by the host listener above. */
  onKeydown(ev: KeyboardEvent): void {
    if (ev.key !== 'Tab') return;
    const focusable = this.focusable();
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = globalThis.document?.activeElement as HTMLElement | null;
    if (ev.shiftKey && active === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && active === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  private focusable(): HTMLElement[] {
    const root = this.dialog()?.nativeElement;
    if (!root) return [];
    return Array.from(
      root.querySelectorAll<HTMLElement>('button, input, a[href], [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => !el.hasAttribute('disabled'));
  }

  dashText(): string {
    return 'codex.weaponDetail.value.dash';
  }

  readonly cards = computed<DetailCard[]>(() => {
    const e = this.entry();
    this.lang();
    if (!e) return [];
    const payload = e.payload;
    const ammo = e.ammoPayload;
    const weaponParams = (payload as { weaponParams?: Record<string, unknown> } | null | undefined)
      ?.weaponParams;
    const ammoP = ammo as { speed?: number | null; lifetime?: number | null } | undefined;

    // damageChannels — the channels the round (or, failing that, the weapon
    // itself) actually deals, verbatim from AmmoParams.impactDamage.
    const dealt = new Map(impactDamageChannels(ammo ?? null).map((c) => [c.channel, c.value]));
    if (dealt.size === 0) {
      for (const c of impactDamageChannels(payload)) dealt.set(c.channel, c.value);
    }
    const damageChannels: DetailRow[] = Object.entries(DAMAGE_ROW_KEY).map(([channel, labelKey]) => ({
      labelKey,
      value: dealt.has(channel) ? num(dealt.get(channel)!, 'dec') : null,
    }));

    const alpha = alphaDamage(ammo ?? null) ?? alphaDamage(payload);
    const fireRate = toFiniteNumber(weaponParams?.['fireRate'] ?? null);
    const projectilesPerShot = toFiniteNumber(
      (weaponParams?.['projectilesPerShot'] ?? weaponParams?.['pelletCount'] ?? null) as
        | number
        | null,
    );
    const range = projectileRange(ammoP?.speed, ammoP?.lifetime);
    const penetration = penetrationDistance(ammo ?? null);

    const fireBallistics: DetailRow[] = [
      { labelKey: 'codex.weaponDetail.row.fireRate', value: num(fireRate, 'int') },
      { labelKey: 'codex.weaponDetail.row.projectilesPerShot', value: num(projectilesPerShot, 'int') },
      { labelKey: 'codex.weaponDetail.row.projectileSpeed', value: num(toFiniteNumber(ammoP?.speed ?? null), 'mps') },
      { labelKey: 'codex.weaponDetail.row.lifetime', value: num(toFiniteNumber(ammoP?.lifetime ?? null), 'seconds') },
      { labelKey: 'codex.weaponDetail.row.range', value: num(range, 'metres') },
    ];

    // derived — both DPS figures share the same source until magazine data
    // exists (owner decision, MASTER §15): sustained and burst read the same
    // fire rate, and say so via the same value rather than diverging guesses.
    // Alpha/Durchschlag join them here (concept #h3: Abgeleitet = Alpha ·
    // Burst-DPS · Dauer-DPS · Durchschlag), not under Feuer & Ballistik.
    const dps = alpha !== null && fireRate !== null ? (alpha * fireRate) / 60 : null;
    const derived: DetailRow[] = [
      { labelKey: 'codex.weaponDetail.row.alpha', value: num(alpha, 'dec') },
      { labelKey: 'codex.weaponDetail.row.burstDps', value: num(dps, 'dec') },
      { labelKey: 'codex.weaponDetail.row.sustainedDps', value: num(dps, 'dec') },
      { labelKey: 'codex.weaponDetail.row.penetration', value: num(penetration, 'metresDec') },
    ];

    const res = swapResourceStats(payload);
    const irValue = res['codex.picker.col.ir'];
    const powerSignature: DetailRow[] = [
      { labelKey: 'codex.weaponDetail.row.powerDraw', value: fmt(res['codex.picker.col.power']) },
      { labelKey: 'codex.weaponDetail.row.emOnline', value: fmt(res['codex.picker.col.em']) },
      {
        labelKey: 'codex.weaponDetail.row.irOnline',
        value: irValue?.value === 0 ? (this.i18n.instant('codex.weaponDetail.value.none') as string) : fmt(irValue),
      },
    ];

    const durability: DetailRow[] = [
      { labelKey: 'codex.weaponDetail.row.hp', value: fmt(res['codex.equipped.health']) },
      { labelKey: 'codex.weaponDetail.row.distortionPool', value: fmt(res['codex.equipped.distortion']) },
      { labelKey: 'codex.weaponDetail.row.distortionRegen', value: null },
    ];

    const physical: DetailRow[] = [
      { labelKey: 'codex.weaponDetail.row.mass', value: fmt(res['codex.picker.col.mass']) },
      { labelKey: 'codex.weaponDetail.row.size', value: e.size != null ? `S${e.size}` : null },
      { labelKey: 'codex.weaponDetail.row.grade', value: e.grade ?? null },
      // `AttachDef.Class` (e.g. "Civilian") is not a field the extract carries
      // anywhere today — showing the manufacturer code under a "Klasse" label
      // would read as a wrong answer, not a gap, so this stays a gap until the
      // extractor grows a source for it (MASTER §10 / B §3.5).
      { labelKey: 'codex.weaponDetail.row.itemClass', value: null },
    ];

    const attachments: DetailRow[] = [
      { labelKey: 'codex.weaponDetail.row.itemPorts', value: null },
      { labelKey: 'codex.weaponDetail.row.factoryFit', value: null },
    ];

    const aim = swapAimStats(payload);
    const aiming: DetailRow[] = [
      { labelKey: 'codex.weaponDetail.row.aimYaw', value: fmt(aim['codex.picker.col.aimYaw']) },
      { labelKey: 'codex.weaponDetail.row.aimRate', value: fmt(aim['codex.picker.col.aimRate']) },
    ];

    const isEnergy = damageChannelsOf(payload, ammo ?? null).every((d) => /energy|laser/i.test(d));
    const missing: DetailRow[] = [
      { labelKey: 'codex.weaponDetail.row.spread', value: null },
      { labelKey: 'codex.weaponDetail.row.recoil', value: null },
      {
        labelKey: 'codex.weaponDetail.row.magazine',
        value: isEnergy ? (this.i18n.instant('codex.weaponDetail.value.magazineEnergy') as string) : null,
      },
      { labelKey: 'codex.weaponDetail.row.overheat', value: null },
    ];

    return [
      { titleKey: 'codex.weaponDetail.card.damageChannels', srcKey: 'codex.weaponDetail.src.damage', rows: damageChannels },
      { titleKey: 'codex.weaponDetail.card.fireBallistics', srcKey: 'codex.weaponDetail.src.fire', rows: fireBallistics },
      { titleKey: 'codex.weaponDetail.card.derived', srcKey: 'codex.weaponDetail.src.derived', rows: derived },
      { titleKey: 'codex.weaponDetail.card.powerSignature', srcKey: 'codex.weaponDetail.src.power', rows: powerSignature },
      { titleKey: 'codex.weaponDetail.card.durability', srcKey: 'codex.weaponDetail.src.durability', rows: durability },
      { titleKey: 'codex.weaponDetail.card.physical', srcKey: 'codex.weaponDetail.src.physical', rows: physical },
      { titleKey: 'codex.weaponDetail.card.attachments', srcKey: 'codex.weaponDetail.src.attachments', rows: attachments },
      { titleKey: 'codex.weaponDetail.card.aiming', srcKey: 'codex.weaponDetail.src.aiming', rows: aiming },
      { titleKey: 'codex.weaponDetail.card.missing', srcKey: 'codex.weaponDetail.src.missing', rows: missing, miss: true },
    ];
  });
}

function fmt(v: { value: number; format: string } | undefined): string | null {
  if (!v) return null;
  return formatEquippedStat({ labelKey: '', value: v.value, format: v.format as never });
}
