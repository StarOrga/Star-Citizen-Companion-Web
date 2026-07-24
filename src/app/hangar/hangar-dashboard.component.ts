import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { isValidRsiPledgeShipUrl } from '../core/rsi-pledge-link.util';
import { CodexListRow, CodexService, pickLocalized } from '../codex/codex.service';
import { cleanLocaleValue, humanizeClassName } from '../codex/codex-format';
import { HangarImportComponent } from './hangar-import.component';
import { HangarService } from './hangar.service';
import {
  HangarShip,
  ROLE_LOADOUT_ROLES,
  RoleLoadoutRole,
} from './hangar.types';

const SEARCH_DEBOUNCE_MS = 250;

/**
 * "My Hangar" dashboard: pinned top-3 flagship strip, the ship collection
 * (owned + wishlist), inline add-ship search over the codex catalog, and the
 * role-loadout (FPS/mining/salvage/…) section.
 */
@Component({
  selector: 'sc-hangar-dashboard',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, HangarImportComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      @if (!auth.user()) {
        <!-- Signed-out benefits teaser (#131): the hangar is the members-only
             surface — pitch what it does and route to sign-in. -->
        <div class="teaser">
          <h1>{{ 'hangar.teaser.title' | translate }}</h1>
          <p class="hint">{{ 'hangar.teaser.subtitle' | translate }}</p>
          <ul class="benefits">
            @for (b of ['save', 'overview', 'loadouts', 'compare']; track b) {
              <li class="sc-card benefit">
                <strong>{{ 'hangar.teaser.' + b + '.title' | translate }}</strong>
                <span>{{ 'hangar.teaser.' + b + '.text' | translate }}</span>
              </li>
            }
          </ul>
          <a class="sc-btn cta" routerLink="/login" [queryParams]="{ redirect: '/hangar' }">
            {{ 'hangar.teaser.cta' | translate }}
          </a>
        </div>
      } @else {
      <header class="head">
        <div class="title-block">
          <h1>{{ 'hangar.title' | translate }}</h1>
          <p class="hint">{{ 'hangar.subtitle' | translate }}</p>
        </div>
        <div class="counts">
          <div class="count-chip">
            <strong>{{ hangar.ownedCount() }}</strong>
            <span>{{ 'hangar.counts.owned' | translate }}</span>
          </div>
          <div class="count-chip">
            <strong>{{ hangar.wishlistCount() }}</strong>
            <span>{{ 'hangar.counts.wishlist' | translate }}</span>
          </div>
          <button type="button" class="sc-btn import-btn" (click)="importOpen.set(!importOpen())">
            {{ 'hangar.import.open' | translate }}
          </button>
        </div>
      </header>

      @if (hangar.error(); as err) {
        <div class="sc-card err">{{ err }}</div>
      }

      <!-- Import from export file (#136) -->
      @if (importOpen()) {
        <sc-hangar-import (closed)="importOpen.set(false)" />
      }

      <!-- Top 3 pinned -->
      @if (hangar.pinnedShips().length > 0) {
        <div class="pinned-strip">
          @for (s of hangar.pinnedShips(); track s.id) {
            <a class="hero sc-card" [routerLink]="['/hangar/ship', s.id]">
              <span class="rank">#{{ s.pinnedRank }}</span>
              @if (thumb(s); as src) {
                <div class="hero-thumb"><img [src]="src" [alt]="displayName(s)" loading="lazy" /></div>
              }
              <h3>{{ s.customName || displayName(s) }}</h3>
              @if (s.customName) { <span class="hero-sub">{{ displayName(s) }}</span> }
              <div class="badges">
                @if (cardFor(s)?.manufacturerCode; as mfr) { <span class="badge mfr">{{ mfr }}</span> }
                @if (cardFor(s)?.crewSize != null) {
                  <span class="badge">{{ 'codex.card.crew' | translate: { count: cardFor(s)?.crewSize } }}</span>
                }
              </div>
            </a>
          }
        </div>
      }

      <!-- Add ship -->
      <div class="sc-card add-ship">
        <h2>{{ 'hangar.add.title' | translate }}</h2>
        <div class="search-row">
          <input class="search" type="search" [ngModel]="searchInput()"
                 (ngModelChange)="onSearchInput($event)"
                 [attr.placeholder]="'hangar.add.placeholder' | translate"
                 [attr.aria-label]="'hangar.add.placeholder' | translate" />
        </div>
        @if (searching()) {
          <p class="state">{{ 'hangar.picker.loading' | translate }}</p>
        } @else if (searchInput() && searchResults().length === 0) {
          <p class="state">{{ 'hangar.add.noResults' | translate }}</p>
        } @else if (searchResults().length > 0) {
          <ul class="results">
            @for (r of searchResults(); track r.classNameSlug) {
              <li class="result-row">
                <span class="r-name">{{ shipName(r) }}</span>
                <span class="r-meta">
                  @if (r.manufacturerCode) { <span class="badge mfr">{{ r.manufacturerCode }}</span> }
                  @if (r.crewSize != null) { <span class="badge">{{ 'codex.card.crew' | translate: { count: r.crewSize } }}</span> }
                </span>
                @if (inHangar(r.classNameSlug)) {
                  <span class="already">{{ 'hangar.add.already' | translate }}</span>
                } @else {
                  <button class="sc-btn tiny" type="button" (click)="add(r, 'owned')">{{ 'hangar.add.owned' | translate }}</button>
                  <button class="sc-btn tiny ghost" type="button" (click)="add(r, 'wishlist')">{{ 'hangar.add.wishlist' | translate }}</button>
                }
              </li>
            }
          </ul>
        }
      </div>

      <!-- Fleet grid -->
      <div class="fleet">
        <h2>{{ 'hangar.fleet.title' | translate }}</h2>
        @if (hangar.loading() && hangar.ships().length === 0) {
          <div class="grid">
            @for (s of skeletons; track s) { <div class="card skel"></div> }
          </div>
        } @else if (hangar.ships().length === 0) {
          <div class="sc-card empty">
            <strong>{{ 'hangar.fleet.emptyTitle' | translate }}</strong>
            <p>{{ 'hangar.fleet.emptyHint' | translate }}</p>
          </div>
        } @else {
          <div class="grid">
            @for (s of hangar.ships(); track s.id) {
              <a class="card" [routerLink]="['/hangar/ship', s.id]">
                @if (thumb(s); as src) {
                  <div class="thumb"><img [src]="src" [alt]="displayName(s)" loading="lazy" /></div>
                }
                <div class="card-top">
                  <h3 class="name">{{ s.customName || displayName(s) }}</h3>
                  <div class="card-top-right">
                    @if (isFlagship(s)) { <span class="flag-badge" [attr.title]="'hangar.flagship.badge' | translate">★</span> }
                    @if (s.pinnedRank) { <span class="rank-sm">#{{ s.pinnedRank }}</span> }
                  </div>
                </div>
                @if (s.customName) { <code class="cls">{{ displayName(s) }}</code> }
                <div class="badges">
                  <span class="badge" [class.wishlist]="s.status === 'wishlist'">
                    {{ ('hangar.status.' + s.status) | translate }}
                  </span>
                  @if (cardFor(s)?.manufacturerCode; as mfr) { <span class="badge mfr">{{ mfr }}</span> }
                  @if (cardFor(s)?.crewSize != null) {
                    <span class="badge">{{ 'codex.card.crew' | translate: { count: cardFor(s)?.crewSize } }}</span>
                  }
                </div>
                <button type="button" class="flag-toggle" [class.is-flagship]="isFlagship(s)"
                        (click)="toggleFlagship($event, s)"
                        [attr.aria-pressed]="isFlagship(s)">
                  {{ (isFlagship(s) ? 'hangar.flagship.pinned' : 'hangar.flagship.set') | translate }}
                </button>
              </a>
            }
          </div>
        }
      </div>

      <!-- Concept-ship wishlist (#135) — unreleased ships, no catalog entry -->
      <div class="concepts">
        <h2>{{ 'hangar.concept.title' | translate }}</h2>
        <p class="hint">{{ 'hangar.concept.hint' | translate }}</p>

        <form class="concept-form" (submit)="addConcept($event)">
          <input type="text" class="text-input" name="name" required maxlength="80"
                 [(ngModel)]="conceptName"
                 [attr.placeholder]="'hangar.concept.namePlaceholder' | translate"
                 [attr.aria-label]="'hangar.concept.namePlaceholder' | translate" />
          <input type="text" class="text-input" name="manufacturer" maxlength="60"
                 [(ngModel)]="conceptManufacturer"
                 [attr.placeholder]="'hangar.concept.manufacturerPlaceholder' | translate"
                 [attr.aria-label]="'hangar.concept.manufacturerPlaceholder' | translate" />
          <input type="url" class="text-input wide" name="rsiUrl"
                 [(ngModel)]="conceptRsiUrl"
                 (ngModelChange)="onConceptUrlInput()"
                 [class.invalid]="conceptUrlError()"
                 [attr.aria-invalid]="conceptUrlError() ? 'true' : null"
                 [attr.placeholder]="'hangar.concept.urlPlaceholder' | translate"
                 [attr.aria-label]="'hangar.concept.urlPlaceholder' | translate" />
          <button type="submit" class="sc-btn" [disabled]="!conceptName.trim() || conceptSaving()">
            {{ 'hangar.concept.add' | translate }}
          </button>
        </form>
        @if (conceptUrlError()) {
          <p class="concept-url-error" role="alert">{{ 'hangar.concept.urlError' | translate }}</p>
        }

        @if (hangar.conceptShips().length === 0) {
          <p class="hint">{{ 'hangar.concept.empty' | translate }}</p>
        } @else {
          <ul class="concept-list">
            @for (c of hangar.conceptShips(); track c.id) {
              <li class="sc-card concept-row">
                <div class="concept-main">
                  <strong>{{ c.name }}</strong>
                  @if (c.manufacturer) { <span class="concept-mfr">{{ c.manufacturer }}</span> }
                  <span class="badge preliminary">{{ 'hangar.concept.preliminary' | translate }}</span>
                </div>
                <div class="concept-actions">
                  @if (c.rsiUrl) {
                    <!-- User-supplied URL: bound as a plain href, never innerHTML. -->
                    <a class="concept-link" [href]="c.rsiUrl" target="_blank" rel="noopener noreferrer nofollow">
                      {{ 'hangar.concept.pledgeLink' | translate }}
                    </a>
                  }
                  <button type="button" class="concept-remove" (click)="removeConcept(c.id)"
                          [attr.aria-label]="'hangar.concept.remove' | translate">✕</button>
                </div>
              </li>
            }
          </ul>
        }
      </div>

      <!-- Role loadouts -->
      <div class="loadouts">
        <div class="loadouts-head">
          <h2>{{ 'hangar.roleLoadouts.title' | translate }}</h2>
          <div class="new-loadout">
            <select class="sc-select" [ngModel]="newLoadoutRole()" (ngModelChange)="newLoadoutRole.set($event)">
              @for (r of loadoutRoles; track r) {
                <option [value]="r">{{ ('hangar.roles.' + r) | translate }}</option>
              }
            </select>
            <input class="ld-name" type="text" [ngModel]="newLoadoutName()" (ngModelChange)="newLoadoutName.set($event)"
                   [attr.placeholder]="'hangar.roleLoadouts.namePlaceholder' | translate"
                   [attr.aria-label]="'hangar.roleLoadouts.namePlaceholder' | translate" />
            <button class="sc-btn small" type="button" [disabled]="!newLoadoutName().trim()" (click)="createLoadout()">
              {{ 'hangar.roleLoadouts.create' | translate }}
            </button>
          </div>
        </div>
        @if (hangar.roleLoadouts().length === 0) {
          <p class="hint">{{ 'hangar.roleLoadouts.empty' | translate }}</p>
        } @else {
          <div class="grid">
            @for (l of hangar.roleLoadouts(); track l.id) {
              <a class="card loadout-card" [routerLink]="['/hangar/loadout', l.id]">
                <div class="card-top">
                  <h3 class="name">{{ l.name }}</h3>
                  <span class="badge role-{{ l.role }}">{{ ('hangar.roles.' + l.role) | translate }}</span>
                </div>
                <p class="ld-summary">
                  {{ 'hangar.roleLoadouts.itemCount' | translate: { count: filledCount(l.items) } }}
                </p>
              </a>
            }
          </div>
        }
      </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .page { display: flex; flex-direction: column; gap: 20px; }

    /* Signed-out teaser (#131) */
    .teaser { display: flex; flex-direction: column; gap: 16px; max-width: 860px; }
    .teaser h1 { margin: 0; }
    .teaser .hint { color: var(--sc-fg-2); margin: -8px 0 0; max-width: 60ch; }
    .benefits { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .benefit { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; }
    .benefit strong { font-family: var(--sc-font-display); font-size: 0.9rem;
      letter-spacing: 0.04em; color: var(--sc-accent); }
    .benefit span { color: var(--sc-fg-2); font-size: 0.85rem; line-height: 1.5; }
    .teaser .cta { align-self: flex-start; text-decoration: none;
      color: var(--sc-bg-0); background: var(--sc-accent); border-color: var(--sc-accent); }
    .teaser .cta:hover { background: transparent; color: var(--sc-accent); }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
    .title-block h1 { margin: 0; }
    .title-block .hint { color: var(--sc-fg-2); margin: 4px 0 0; max-width: 60ch; }
    .counts { display: flex; gap: 8px; }
    .count-chip { display: flex; flex-direction: column; align-items: center; padding: 8px 16px; border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); }
    .count-chip strong { font-family: var(--sc-font-display); font-size: 1.2rem; color: var(--sc-accent); }
    .count-chip span { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2); }
    .import-btn { align-self: center; }

    .pinned-strip { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .hero { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 16px; text-decoration: none; color: inherit; border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, transparent); transition: transform 0.16s, box-shadow 0.16s; }
    .hero:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.4), 0 0 18px color-mix(in srgb, var(--sc-accent) 30%, transparent); }
    .hero .rank { position: absolute; top: 10px; right: 12px; font-family: var(--sc-font-display); color: var(--sc-accent); font-size: 1rem; }
    .hero-thumb { height: 110px; display: flex; align-items: center; justify-content: center; border-radius: 6px; background: radial-gradient(circle at 50% 45%, var(--sc-bg-2), var(--sc-bg-0)); }
    .hero-thumb img { max-height: 100px; max-width: 100%; object-fit: contain; filter: drop-shadow(0 2px 8px rgba(0,0,0,0.5)); }
    .hero h3 { margin: 0; font-size: 1.05rem; }
    .hero-sub { font-size: 0.74rem; color: var(--sc-fg-2); }

    .sc-card h2, .fleet h2, .loadouts h2, .concepts h2 { margin: 0 0 10px; font-size: 1rem; }

    /* Concept-ship wishlist (#135) */
    .concepts .hint { color: var(--sc-fg-2); font-size: 0.85rem; margin: 0 0 10px; }
    .concept-form { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    .concept-form .text-input {
      flex: 1 1 160px; min-width: 140px; padding: 8px 12px;
      background: var(--sc-bg-1); color: var(--sc-fg-0);
      border: 1px solid var(--sc-border); border-radius: 4px; font: inherit; font-size: 0.9rem;
    }
    .concept-form .text-input.wide { flex: 2 1 240px; }
    .concept-form .text-input:focus { outline: none; border-color: var(--sc-accent); }
    .concept-form .text-input.invalid { border-color: var(--sc-danger); }
    .concept-url-error { margin: -4px 0 12px; color: var(--sc-danger); font-size: 0.8rem; }
    .concept-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .concept-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 14px; flex-wrap: wrap; }
    .concept-main { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
    .concept-mfr { color: var(--sc-fg-2); font-size: 0.8rem; }
    .badge.preliminary {
      font-size: 0.6rem; padding: 2px 8px; border-radius: 999px; text-transform: uppercase;
      letter-spacing: 0.06em; background: rgba(255, 170, 60, 0.14); color: #f0b35c;
      border: 1px solid color-mix(in srgb, #f0b35c 45%, transparent);
    }
    .concept-actions { display: flex; align-items: center; gap: 12px; }
    .concept-link { color: var(--sc-accent); font-size: 0.8rem; }
    .concept-remove {
      background: transparent; border: 0; color: var(--sc-fg-2); cursor: pointer; font-size: 0.85rem;
    }
    .concept-remove:hover { color: var(--sc-danger); }
    .add-ship { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; }
    .search-row { display: flex; }
    .search { flex: 1; padding: 9px 14px; border-radius: 8px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-0); font-family: inherit; font-size: 0.9rem; }
    .search:focus { outline: none; border-color: var(--sc-accent); box-shadow: 0 0 0 2px rgba(0,212,255,0.22); }
    .state { margin: 0; color: var(--sc-fg-2); font-size: 0.82rem; }
    .results { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 300px; overflow-y: auto; }
    .result-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); }
    .r-name { flex: 1; font-size: 0.86rem; min-width: 0; overflow-wrap: anywhere; }
    .r-meta { display: flex; gap: 4px; }
    .already { font-size: 0.7rem; color: var(--sc-fg-2); font-style: italic; }

    .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
    .card { display: flex; flex-direction: column; gap: 8px; padding: 14px; border-radius: 8px; border: 1px solid var(--sc-border); background: var(--sc-bg-1); color: inherit; text-decoration: none; transition: transform 0.16s, border-color 0.16s, box-shadow 0.16s; }
    .card:hover { transform: translateY(-2px); border-color: var(--sc-accent); box-shadow: 0 6px 20px rgba(0,0,0,0.4), 0 0 14px color-mix(in srgb, var(--sc-accent) 28%, transparent); }
    .card .thumb { height: 90px; display: flex; align-items: center; justify-content: center; border-radius: 6px; background: radial-gradient(circle at 50% 45%, var(--sc-bg-2), var(--sc-bg-0)); }
    .card .thumb img { max-height: 82px; max-width: 100%; object-fit: contain; filter: drop-shadow(0 2px 8px rgba(0,0,0,0.5)); }
    .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .card .name { margin: 0; font-size: 0.98rem; font-weight: 600; line-height: 1.25; }
    .rank-sm { font-family: var(--sc-font-display); color: var(--sc-accent); font-size: 0.82rem; }
    .card-top-right { display: flex; align-items: center; gap: 6px; }
    .flag-badge { color: var(--sc-warning, #ffc14d); font-size: 0.92rem; line-height: 1; }
    .flag-toggle { margin-top: 4px; padding: 5px 10px; border-radius: 6px; background: transparent;
      border: 1px solid var(--sc-border); color: var(--sc-fg-2); font-family: var(--sc-font-display);
      font-size: 0.62rem; letter-spacing: 0.05em; text-transform: uppercase; cursor: pointer; align-self: flex-start;
      transition: color 0.16s, border-color 0.16s, background 0.16s; }
    .flag-toggle:hover { color: var(--sc-warning, #ffc14d); border-color: var(--sc-warning, #ffc14d); }
    .flag-toggle.is-flagship { color: var(--sc-warning, #ffc14d); border-color: var(--sc-warning, #ffc14d);
      background: color-mix(in srgb, var(--sc-warning, #ffc14d) 16%, transparent); }
    .cls { font-size: 0.7rem; color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); overflow-wrap: anywhere; }
    .badges { display: flex; flex-wrap: wrap; gap: 5px; margin-top: auto; }
    .badge { font-size: 0.64rem; padding: 2px 7px; border-radius: 999px; background: color-mix(in srgb, var(--sc-accent) 14%, transparent); border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); }
    .badge.mfr { background: color-mix(in srgb, var(--sc-accent-hot) 14%, transparent); border-color: color-mix(in srgb, var(--sc-accent-hot) 35%, transparent); }
    .badge.wishlist { background: color-mix(in srgb, var(--sc-warning) 16%, transparent); border-color: color-mix(in srgb, var(--sc-warning) 40%, transparent); }
    .badge[class*='role-'] { text-transform: uppercase; letter-spacing: 0.05em; }

    .card.skel { min-height: 140px; background: linear-gradient(110deg, var(--sc-bg-1) 30%, var(--sc-bg-2) 50%, var(--sc-bg-1) 70%); background-size: 200% 100%; animation: skel 1.4s ease-in-out infinite; }
    @keyframes skel { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    .loadouts-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
    .loadouts-head h2 { margin: 0; }
    .new-loadout { display: flex; gap: 8px; flex-wrap: wrap; }
    .ld-name { padding: 7px 10px; border-radius: 6px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-0); font-family: inherit; font-size: 0.84rem; }
    .ld-name:focus { outline: none; border-color: var(--sc-accent); }
    .sc-select { background: var(--sc-bg-1); color: var(--sc-fg-0); border: 1px solid var(--sc-border); border-radius: 6px; padding: 7px 10px; font-family: inherit; font-size: 0.82rem; cursor: pointer; }
    .loadout-card .ld-summary { margin: 0; font-size: 0.78rem; color: var(--sc-fg-2); }

    .sc-btn { padding: 8px 14px; border-radius: 6px; background: var(--sc-bg-1); border: 1px solid var(--sc-accent); color: var(--sc-accent); font-family: var(--sc-font-display); font-size: 0.72rem; letter-spacing: 0.05em; text-transform: uppercase; cursor: pointer; }
    .sc-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
    .sc-btn:disabled { opacity: 0.5; cursor: default; }
    .sc-btn.small { padding: 7px 12px; font-size: 0.7rem; }
    .sc-btn.tiny { padding: 4px 9px; font-size: 0.64rem; }
    .sc-btn.ghost { border-color: var(--sc-border); color: var(--sc-fg-1); }
    .sc-btn.ghost:hover { border-color: var(--sc-accent); color: var(--sc-accent); }

    .empty { text-align: center; padding: 36px 20px; color: var(--sc-fg-1); }
    .empty p { color: var(--sc-fg-2); margin: 6px 0 0; }
    .err { color: var(--sc-danger); padding: 14px 16px; }
    .hint { color: var(--sc-fg-2); font-size: 0.84rem; margin: 0; }

    @media (max-width: 720px) {
      .head { flex-direction: column; align-items: stretch; }
      .counts { flex-wrap: wrap; }
    }
    @media (max-width: 560px) {
      .grid, .pinned-strip { grid-template-columns: 1fr 1fr; }
      .new-loadout { width: 100%; }
      .new-loadout .ld-name { flex: 1 1 100%; }
    }
    @media (max-width: 400px) {
      .grid, .pinned-strip { grid-template-columns: 1fr; }
      .count-chip strong { font-size: 1.05rem; }
    }
  `],
})
export class HangarDashboardComponent implements OnInit {
  readonly hangar = inject(HangarService);
  readonly auth = inject(AuthService);
  private readonly codex = inject(CodexService);

  readonly loadoutRoles = ROLE_LOADOUT_ROLES;
  readonly skeletons = Array.from({ length: 4 }, (_, i) => i);

  readonly searchInput = signal('');
  readonly searching = signal(false);
  readonly searchResults = signal<CodexListRow[]>([]);
  readonly newLoadoutName = signal('');
  readonly newLoadoutRole = signal<RoleLoadoutRole>('fps');

  /** codex card data per ship class name (preview/manufacturer/crew). */
  private readonly cards = signal<Map<string, CodexListRow>>(new Map());

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchSeq = 0;

  readonly hangarClassNames = computed(
    () => new Set(this.hangar.ships().map((s) => s.shipClassName)),
  );

  async ngOnInit(): Promise<void> {
    // Signed-out (#131): the teaser needs no data — and hangar RLS would
    // reject the queries anyway.
    if (!this.auth.user()) return;
    await Promise.all([this.hangar.loadAll(), this.codex.loadCurrentBuild()]);
    await this.refreshCards();
  }

  cardFor(s: HangarShip): CodexListRow | null {
    return this.cards().get(s.shipClassName) ?? null;
  }

  displayName(s: HangarShip): string {
    const card = this.cardFor(s);
    if (card) return this.shipName(card);
    return humanizeClassName(s.shipClassName);
  }

  shipName(r: CodexListRow): string {
    const p = r.payload as { name?: { de: string; en: string; key: string } } | undefined;
    const en = p?.name ? pickLocalized(p.name, 'en') : '';
    return en || cleanLocaleValue(r.nameLocalized) || humanizeClassName(r.classNameSlug);
  }

  thumb(s: HangarShip): string | null {
    const card = this.cardFor(s);
    const p = card?.payload as { previewImage?: string | null } | undefined;
    return this.codex.previewUrl(p?.previewImage);
  }

  inHangar(classNameSlug: string): boolean {
    return this.hangarClassNames().has(classNameSlug);
  }

  onSearchInput(value: string): void {
    this.searchInput.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (!value.trim()) {
      this.searchResults.set([]);
      return;
    }
    this.searchTimer = setTimeout(() => void this.runSearch(value.trim()), SEARCH_DEBOUNCE_MS);
  }

  async add(r: CodexListRow, status: 'owned' | 'wishlist'): Promise<void> {
    const ship = await this.hangar.addShip(r.classNameSlug, status);
    if (ship) {
      const cards = new Map(this.cards());
      cards.set(r.classNameSlug, r);
      this.cards.set(cards);
    }
  }

  // Import panel visibility (#136).
  readonly importOpen = signal(false);

  // ── concept-ship wishlist (#135) ────────────────────────────────────────────
  conceptName = '';
  conceptManufacturer = '';
  conceptRsiUrl = '';
  readonly conceptSaving = signal(false);

  /** Inline validation error for the optional RSI link (feedback f7d3bd9a). */
  readonly conceptUrlError = signal(false);

  /** Clear the RSI-link error as soon as the user edits the field again. */
  onConceptUrlInput(): void {
    if (this.conceptUrlError()) this.conceptUrlError.set(false);
  }

  async addConcept(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.conceptName.trim() || this.conceptSaving()) return;
    // The link is optional, but if one is given it must be an official RSI
    // pledge-ship URL. Fail loudly here instead of silently dropping it — the
    // service normalizes and the DB CHECK gates, but the user deserves to know.
    if (this.conceptRsiUrl.trim() && !isValidRsiPledgeShipUrl(this.conceptRsiUrl)) {
      this.conceptUrlError.set(true);
      return;
    }
    this.conceptUrlError.set(false);
    this.conceptSaving.set(true);
    const created = await this.hangar.addConceptShip({
      name: this.conceptName,
      manufacturer: this.conceptManufacturer,
      rsiUrl: this.conceptRsiUrl,
    });
    if (created) {
      this.conceptName = '';
      this.conceptManufacturer = '';
      this.conceptRsiUrl = '';
    }
    this.conceptSaving.set(false);
  }

  async removeConcept(id: string): Promise<void> {
    await this.hangar.removeConceptShip(id);
  }

  async createLoadout(): Promise<void> {
    const name = this.newLoadoutName().trim();
    if (!name) return;
    const created = await this.hangar.createRoleLoadout(name, this.newLoadoutRole());
    if (created) this.newLoadoutName.set('');
  }

  filledCount(items: { className: string | null }[]): number {
    return items.filter((i) => i.className).length;
  }

  isFlagship(s: HangarShip): boolean {
    return this.hangar.isFlagship(s.shipClassName);
  }

  /** Toggle the flagship from a fleet card (swallow the anchor navigation). */
  toggleFlagship(ev: Event, s: HangarShip): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.hangar.toggleFlagship(s.shipClassName);
  }

  private async runSearch(term: string): Promise<void> {
    const seq = ++this.searchSeq;
    this.searching.set(true);
    try {
      const res = await this.codex.listByKind('ship', { search: term, limit: 8 });
      if (seq !== this.searchSeq) return;
      this.searchResults.set(res.rows);
    } catch {
      if (seq === this.searchSeq) this.searchResults.set([]);
    } finally {
      if (seq === this.searchSeq) this.searching.set(false);
    }
  }

  private async refreshCards(): Promise<void> {
    const names = this.hangar.ships().map((s) => s.shipClassName);
    if (names.length === 0) return;
    this.cards.set(await this.codex.getShipsByClassNames(names));
  }
}
