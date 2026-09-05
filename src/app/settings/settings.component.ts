import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { PasswordFormComponent } from '../auth/password-form.component';
import { ProfileService } from '../auth/profile.service';
import { RoleService } from '../auth/role.service';
import { ComposerPrefsService } from '../core/composer-prefs.service';
import { FeedbackFabPrefsService } from '../core/feedback-fab-prefs.service';
import { ConsentService } from '../core/consent.service';
import { isPlainLeftClick } from '../core/modified-click.util';
import { AnalyticsService } from '../core/analytics.service';
import { LocaleService } from '../core/locale/locale.service';
import type { AppLanguage, RegionCode } from '../core/locale/locale.types';
import { PICKER_REGIONS } from '../core/locale/region.data';
import { ScDatePipe } from '../core/locale/sc-date.pipe';
import { SupabaseClientProvider } from '../core/supabase.client';
import { memberSince } from './member-since';

// Only languages with a real translation file are offered (issue #23) — the
// other locale files are machine-stub placeholders; offering them silently
// fell back to English, which read as "translation exists but is broken".
type LangId = AppLanguage;

/**
 * Thematic order of the page (feedback af058ca4, follow-up to PR #435).
 *
 * The cards used to sit in one flat grid, which read as an unsorted pile. They
 * are now grouped by what the user is actually doing — who am I (account),
 * how does the app talk to me (language + input), what does it keep (privacy),
 * and the irreversible bit last. The same list drives the table-of-contents
 * rail, so a new section can never appear in one place and not the other.
 */
type GroupId = 'account' | 'preferences' | 'privacy' | 'danger';

interface SettingsGroup {
  readonly id: GroupId;
  /** DOM id = link fragment. Prefixed so it cannot clash with another page. */
  readonly anchor: string;
  readonly labelKey: string;
  /**
   * One-word label for the compact (phone) rail. A pinned bar has to fit on a
   * 375px screen without becoming a scroll puzzle of its own; the full section
   * title still travels with the entry as its accessible name.
   */
  readonly shortKey: string;
}

/**
 * Breathing room between whatever is parked at the top of the viewport and the
 * heading of the section that counts as "the one being read". The parked height
 * itself is measured, never assumed — see {@link SettingsComponent.readingLine}.
 */
const SPY_CLEARANCE_PX = 24;

/**
 * Viewport width at which the rail stops being a vertical column beside the
 * cards and becomes the pinned horizontal bar above them. Mirrors the 1080px
 * breakpoint in this component's stylesheet — the two must move together.
 */
const RAIL_STACK_QUERY = '(max-width: 1079px)';

@Component({
  selector: 'sc-settings',
  standalone: true,
  imports: [PasswordFormComponent, RouterLink, ScDatePipe, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <h1>{{ 'settings.title' | translate }}</h1>

      <div class="layout">
        <!-- Table of contents (feedback af058ca4 follow-up). Real anchors on
             purpose: middle click, Ctrl/Cmd+click and "copy link address" work
             for free and the fragment is shareable. The href carries the PAGE
             PATH — a bare "#settings-account" resolves against <base href="/">
             instead of the current URL, which is why the rail used to dump the
             user on the start page (feedback af058ca4, round 3). The plain
             left click is intercepted so the page glides to the section
             instead of jumping; every other kind of click falls through. -->
        <nav class="toc" [attr.aria-label]="'settings.toc.label' | translate">
          <ul class="toc-list">
            @for (g of groups; track g.id) {
              <li>
                <a
                  class="toc-link"
                  [class.active]="activeGroup() === g.id"
                  [href]="tocHref(g.anchor)"
                  (click)="onTocClick($event, g)"
                  [attr.aria-label]="g.labelKey | translate"
                  [attr.aria-current]="activeGroup() === g.id ? 'true' : null">
                  <span class="toc-marker" aria-hidden="true"></span>
                  <!-- Pinned to the top of a phone screen the bar has one row
                       to work with, so it carries the short label there. The
                       aria-label above keeps the full section title as the
                       entry's accessible name either way. -->
                  <span class="toc-text">{{ (compactRail() ? g.shortKey : g.labelKey) | translate }}</span>
                </a>
              </li>
            }
          </ul>
        </nav>

        <div class="sections">
          <!-- 1. Account & identity — who the account is, plus the one field
               the user owns about themselves. -->
          <section class="group" id="settings-account" tabindex="-1">
            <h2 class="group-title">{{ 'settings.groups.account.title' | translate }}</h2>
            <div class="grid">
              @if (auth.user(); as user) {
                <div class="sc-card section account">
                  <h3>{{ 'settings.account.title' | translate }}</h3>
                  <div class="row">
                    <span class="label">{{ 'profile.username' | translate }}</span>
                    <span class="value">
                      @if (profile.username(); as name) {
                        {{ name }}
                      } @else {
                        <span class="muted">{{ 'profile.usernameUnset' | translate }}</span>
                      }
                    </span>
                  </div>
                  <div class="row">
                    <span class="label">{{ 'profile.email' | translate }}</span>
                    <span class="value">{{ user.email }}</span>
                  </div>
                  <div class="row">
                    <span class="label">{{ 'profile.role' | translate }}</span>
                    <span class="value">
                      <span class="role-pill" [class]="roles.role() ?? 'viewer'">
                        {{ ('profile.roles.' + (roles.role() ?? 'viewer')) | translate }}
                      </span>
                    </span>
                  </div>
                  <!-- An account can hold several linked identities at once
                       (signed up with Google, then added a password, or the
                       other way round), so this lists every identity instead
                       of one derived provider. -->
                  <div class="row">
                    <span class="label">{{ 'profile.provider' | translate }}</span>
                    <span class="value pills">
                      @for (p of providers(); track p) {
                        <span class="provider-pill">{{ providerLabel(p) }}</span>
                      }
                    </span>
                  </div>
                  <div class="row">
                    <span class="label">{{ 'profile.created' | translate }}</span>
                    <span
                      class="value"
                      [title]="
                        'profile.memberSince.exact'
                          | translate: { date: (user.created_at | scDate: 'datetime') }
                      ">
                      @if (memberSinceLabel(); as since) {
                        {{ since.key | translate: { count: since.count } }}
                      } @else {
                        <span class="muted">{{ 'profile.memberSince.unknown' | translate }}</span>
                      }
                    </span>
                  </div>
                  <!-- The user id is support/debug metadata, not account
                       identity — it stays copyable but must not read as a peer
                       of e-mail or role. -->
                  <p class="id-line">
                    <span class="id-label">{{ 'profile.id' | translate }}</span>
                    <code class="id-value">{{ user.id }}</code>
                    <button type="button" class="id-copy" (click)="copyUserId(user.id)">
                      {{ (idCopied() ? 'profile.idCopied' : 'profile.idCopy') | translate }}
                    </button>
                  </p>
                </div>
              }

              <div class="sc-card section">
                <h3>{{ 'settings.username.title' | translate }}</h3>
                <p class="hint">{{ 'settings.username.hint' | translate }}</p>
                <form class="field-row" (submit)="saveUsername($event)">
                  <input
                    type="text"
                    class="text-input"
                    [value]="usernameInput()"
                    (input)="usernameInput.set(asInput($event))"
                    [placeholder]="'settings.username.placeholder' | translate"
                    [disabled]="usernameSaving()"
                    maxlength="20"
                    autocomplete="off"
                    spellcheck="false" />
                  <button
                    type="submit"
                    class="sc-btn sc-btn-primary"
                    [disabled]="usernameSaving() || !usernameDirty()">
                    {{ (usernameSaving() ? 'settings.username.saving' : 'settings.username.save') | translate }}
                  </button>
                </form>
                @if (usernameOk()) {
                  <div class="flash success">{{ 'settings.username.saved' | translate }}</div>
                }
                @if (usernameError(); as e) {
                  <div class="flash error">{{ e | translate }}</div>
                }
              </div>

              <!-- Friends — the entry point into the social graph. It belongs
                   with the account: it is about who you are and who you are
                   connected to. A real anchor, not a button: it takes you
                   somewhere, so middle-click and "open in new tab" have to
                   work. -->
              <div class="sc-card section">
                <h3>{{ 'settings.friends.title' | translate }}</h3>
                <p class="hint">{{ 'settings.friends.hint' | translate }}</p>
                <a class="sc-btn sc-btn-primary link-btn" routerLink="/friends">
                  {{ 'settings.friends.open' | translate }}
                </a>
              </div>

              <!-- Password lives with identity, not in the danger zone: for an
                   INVITED account this is not a change, it is the first one
                   its owner ever picks (feedback d93ddb05). -->
              <div class="sc-card section">
                <h3>{{ 'settings.password.title' | translate }}</h3>
                <p class="hint">{{ 'settings.password.hint' | translate }}</p>
                <sc-password-form />
              </div>
            </div>
          </section>

          <!-- 2. Language & controls — how the app speaks, and how it reacts to
               the keyboard. Both answer "how does the app behave for me". -->
          <section class="group" id="settings-preferences" tabindex="-1">
            <h2 class="group-title">{{ 'settings.groups.preferences.title' | translate }}</h2>
            <div class="grid">
              <div class="sc-card section">
                <h3>{{ 'settings.locale.title' | translate }}</h3>
                <p class="hint">{{ 'settings.locale.hint' | translate }}</p>

                <!-- One grid track per control: the two selects sit in separate
                     cells, so they can never share a line partially and
                     collide, at any viewport (feedback af058ca4). -->
                <div class="locale-grid">
                  <label class="locale-field">
                    <span class="inline-label">{{ 'settings.locale.language.label' | translate }}</span>
                    <select
                      class="sc-select"
                      [value]="locale.languageSetting()"
                      (change)="onLanguageChange($event)"
                      [attr.aria-label]="'settings.locale.language.label' | translate">
                      <option value="auto">{{ 'settings.locale.auto' | translate }}</option>
                      @for (l of languages; track l) {
                        <option [value]="l">{{ 'settings.locale.languages.' + l | translate }}</option>
                      }
                    </select>
                    @if (locale.languageIsAuto()) {
                      <span class="field-note">
                        {{ 'settings.locale.detected' | translate: { value: languageLabel(locale.language()) } }}
                      </span>
                    }
                  </label>

                  <label class="locale-field">
                    <span class="inline-label">{{ 'settings.locale.region.label' | translate }}</span>
                    <select
                      class="sc-select"
                      [value]="locale.regionSetting()"
                      (change)="onRegionChange($event)"
                      [attr.aria-label]="'settings.locale.region.label' | translate">
                      <option value="auto">{{ 'settings.locale.auto' | translate }}</option>
                      @for (r of regions; track r) {
                        <option [value]="r">{{ 'settings.locale.regions.' + r | translate }}</option>
                      }
                    </select>
                    @if (locale.regionIsAuto()) {
                      <span class="field-note">
                        {{ 'settings.locale.detected' | translate: { value: regionLabel(locale.region()) } }}
                      </span>
                    }
                  </label>
                </div>

                <div class="row">
                  <span class="label">{{ 'settings.locale.preview' | translate }}</span>
                  <span class="value">{{ sampleDate | scDate: 'datetime' }}</span>
                </div>
              </div>

              <div class="sc-card section">
                <h3>{{ 'settings.composer.title' | translate }}</h3>
                <p class="hint">{{ 'settings.composer.hint' | translate }}</p>
                <div class="row">
                  <span class="label">{{ 'settings.composer.sendOnEnter.label' | translate }}</span>
                  <span class="value">
                    <label class="consent-toggle">
                      <input
                        type="checkbox"
                        [checked]="composerPrefs.sendOnEnter()"
                        (change)="onSendOnEnterToggle($event)" />
                      {{ (composerPrefs.sendOnEnter() ? 'consent.settings.on' : 'consent.settings.off') | translate }}
                    </label>
                  </span>
                </div>
                <p class="consent-desc">
                  {{
                    (composerPrefs.sendOnEnter()
                      ? 'settings.composer.sendOnEnter.descOn'
                      : 'settings.composer.sendOnEnter.descOff') | translate
                  }}
                </p>
              </div>

              <!-- The feedback launcher is a corner button on EVERY page, so
                   whether it is there at all is a preference, not a fixed part
                   of the chrome. Opt-out only: the default is on, and this card
                   is the way back — it is the one control that reports the app
                   is broken, so it must never be switchable off from a place
                   the user cannot find again. -->
              <div class="sc-card section">
                <h3>{{ 'settings.feedbackFab.title' | translate }}</h3>
                <p class="hint">{{ 'settings.feedbackFab.hint' | translate }}</p>
                <div class="row">
                  <span class="label">{{ 'settings.feedbackFab.show.label' | translate }}</span>
                  <span class="value">
                    <label class="consent-toggle">
                      <input
                        type="checkbox"
                        [checked]="feedbackFabPrefs.show()"
                        (change)="onFeedbackFabToggle($event)" />
                      {{ (feedbackFabPrefs.show() ? 'consent.settings.on' : 'consent.settings.off') | translate }}
                    </label>
                  </span>
                </div>
                <p class="consent-desc">
                  {{
                    (feedbackFabPrefs.show()
                      ? 'settings.feedbackFab.show.descOn'
                      : 'settings.feedbackFab.show.descOff') | translate
                  }}
                </p>
              </div>
            </div>
          </section>

          <!-- 3. Data & privacy — what the browser is allowed to keep (#130). -->
          <section class="group" id="settings-privacy" tabindex="-1">
            <h2 class="group-title">{{ 'settings.groups.privacy.title' | translate }}</h2>
            <div class="grid">
              <div class="sc-card section wide">
                <h3>{{ 'consent.settings.title' | translate }}</h3>
                <p class="hint">{{ 'consent.settings.hint' | translate }}</p>
                <div class="row">
                  <span class="label">{{ 'consent.settings.essential.label' | translate }}</span>
                  <span class="value">
                    <span class="consent-pill locked">{{ 'consent.settings.alwaysOn' | translate }}</span>
                  </span>
                </div>
                <p class="consent-desc">{{ 'consent.settings.essential.desc' | translate }}</p>
                <div class="row">
                  <span class="label">{{ 'consent.settings.preferences.label' | translate }}</span>
                  <span class="value">
                    <label class="consent-toggle">
                      <input
                        type="checkbox"
                        [checked]="consent.preferencesAllowed()"
                        (change)="onConsentToggle($event)" />
                      {{ (consent.preferencesAllowed() ? 'consent.settings.on' : 'consent.settings.off') | translate }}
                    </label>
                  </span>
                </div>
                <p class="consent-desc">{{ 'consent.settings.preferences.desc' | translate }}</p>
                <div class="row">
                  <span class="label">{{ 'consent.settings.statistics.label' | translate }}</span>
                  <span class="value">
                    <label class="consent-toggle">
                      <input
                        type="checkbox"
                        [checked]="consent.statisticsAllowed()"
                        (change)="onStatisticsToggle($event)" />
                      {{ (consent.statisticsAllowed() ? 'consent.settings.on' : 'consent.settings.off') | translate }}
                    </label>
                  </span>
                </div>
                <p class="consent-desc">{{ 'consent.settings.statistics.desc' | translate }}</p>
              </div>
            </div>
          </section>

          <!-- 4. Danger zone — irreversible, therefore last. -->
          <section class="group" id="settings-danger" tabindex="-1">
            <h2 class="group-title danger-title">{{ 'settings.groups.danger.title' | translate }}</h2>
            <div class="grid">
              <div class="sc-card danger-zone wide">
                <h3>{{ 'settings.danger.title' | translate }}</h3>
                <p class="hint">{{ 'settings.danger.warning' | translate }}</p>
                @if (deleteError(); as e) {
                  <div class="flash error">{{ e }}</div>
                }
                <button
                  type="button"
                  class="sc-btn danger-btn"
                  [disabled]="deleting()"
                  (click)="deleteAccount()">
                  {{ (deleting() ? 'settings.danger.deleting' : 'settings.danger.deleteBtn') | translate }}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  `,
  styles: [`
    /* Settings used to cap itself at 720px while every other subpage runs the
       full shell width — it read as a broken, half-finished column (feedback
       af058ca4). It now fills the same width and spends it on a two-column
       card grid instead of stretching label/value rows across 1280px. */
    .page { display: flex; flex-direction: column; gap: 20px; }
    h1 { margin: 0; }

    /* Rail + content. Below 1080px the rail collapses into a horizontal bar
       above the content, and the layout is a plain BLOCK there on purpose: a
       grid item's sticky travel is bounded by its own grid area, so as a
       single-column grid item the bar could not have moved a pixel. As a block
       child of .layout it sticks across the whole page (feedback af058ca4
       round 4). Two columns above 1080px, where the rail's grid area is the
       full-height row and sticky works out of the box. */
    .layout { display: block; }
    @media (min-width: 1080px) {
      .layout {
        display: grid;
        grid-template-columns: 176px minmax(0, 1fr);
        gap: 32px;
        align-items: start;
      }
    }

    .sections { display: flex; flex-direction: column; gap: 32px; min-width: 0; }
    .group {
      display: flex;
      flex-direction: column;
      gap: 12px;
      /* Clears whatever is parked at the top of the viewport when the page
         scrolls to a #fragment. --sc-topbar-h is measured and published by the
         shell (0px whenever the header is not sticky), so this stays right
         even when the header wraps onto a second row. */
      scroll-margin-top: calc(
        var(--sc-imp-banner-h, 0px) + var(--sc-topbar-h, 0px) + 24px
      );
      /* The rail hands focus to the section it scrolled to (see onTocClick),
         so a keyboard user continues INSIDE the section instead of at the top
         of the rail. Only the keyboard gets a ring — a mouse click must not
         paint a box around a third of the page. */
      outline: none;
    }
    .group:focus-visible {
      outline: 2px solid var(--sc-accent);
      outline-offset: 6px;
      border-radius: 4px;
    }
    .group-title {
      margin: 0;
      display: flex;
      align-items: center;
      gap: 12px;
      font-family: var(--sc-font-display);
      font-size: max(0.8rem, var(--sc-fs-floor));
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
    }
    /* Hairline that runs out to the card edge — enough to read as a section
       break without adding another boxed container around the cards. */
    .group-title::after {
      content: '';
      flex: 1 1 auto;
      height: 1px;
      background: var(--sc-border);
    }
    .group-title.danger-title { color: var(--sc-danger); }
    .group-title.danger-title::after { background: rgba(248, 113, 113, 0.3); }

    /* Quiet table of contents: text links on the page background, one accent
       marker for the section being read. Deliberately not a boxed sidebar —
       the ask was "dezent". */
    .toc { min-width: 0; }
    .toc-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .toc-link {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 4px;
      min-height: 36px;
      color: var(--sc-fg-2);
      text-decoration: none;
      font-family: var(--sc-font-display);
      font-size: max(0.74rem, var(--sc-fs-floor));
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border-radius: 4px;
      transition: color 0.16s ease;
    }
    .toc-marker {
      flex: 0 0 auto;
      width: 2px;
      align-self: stretch;
      border-radius: 999px;
      background: var(--sc-border);
      transition: background 0.16s ease;
    }
    .toc-text { min-width: 0; overflow-wrap: anywhere; }
    .toc-link:hover { color: var(--sc-fg-0); }
    .toc-link:hover .toc-marker { background: var(--sc-fg-2); }
    .toc-link.active { color: var(--sc-accent); }
    .toc-link.active .toc-marker { background: var(--sc-accent); }

    @media (min-width: 1080px) {
      /* Follows the reader down the page, parked below the sticky topbar. */
      .toc {
        position: sticky;
        top: calc(var(--sc-imp-banner-h, 0px) + var(--sc-topbar-h, 0px) + 24px);
      }
    }

    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 20px;
      align-items: start;
    }
    @media (min-width: 900px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      /* Cards that own their group alone: stretching one card across both
         tracks beats leaving a ragged empty cell next to it. */
      .wide { grid-column: 1 / -1; }
    }
    .section h3, .danger-zone h3 {
      margin: 0 0 6px;
      font-size: 1rem;
      font-family: var(--sc-font-display);
      letter-spacing: 0.04em;
    }
    .account h3 { margin-bottom: 2px; }
    /* The friends entry point is an <a>, so it needs the bits .sc-btn assumes
       a <button> already brings. */
    .link-btn { margin-top: 12px; align-self: flex-start; text-decoration: none; width: fit-content; }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--sc-border);
      &:last-child { border-bottom: 0; }
    }
    .label {
      color: var(--sc-fg-2);
      font-family: var(--sc-font-display);
      font-size: max(0.78rem, var(--sc-fs-floor));
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .value { color: var(--sc-fg-0); min-width: 0; text-align: right; overflow-wrap: anywhere; }
    .label { flex: 0 0 auto; }
    .value.pills {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      justify-content: flex-end;
    }
    .muted { color: var(--sc-fg-2); font-style: italic; }
    .role-pill {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: max(0.74rem, var(--sc-fs-floor));
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: var(--sc-bg-2);
      color: var(--sc-fg-2);
      &.admin { background: rgba(0, 212, 255, 0.18); color: var(--sc-accent); }
      &.collaborator { background: rgba(74, 222, 128, 0.18); color: var(--sc-success); }
      &.viewer { background: rgba(122, 134, 156, 0.18); color: var(--sc-fg-2); }
    }
    .provider-pill {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: max(0.74rem, var(--sc-fs-floor));
      font-weight: 600;
      letter-spacing: 0.04em;
      background: var(--sc-bg-2);
      color: var(--sc-fg-1);
      border: 1px solid var(--sc-border);
    }

    /* De-emphasised metadata footer — deliberately not a .row, so the user id
       cannot be mistaken for a first-class account field. */
    .id-line {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 12px 0 0;
      padding-top: 10px;
      border-top: 1px dashed var(--sc-border);
      color: var(--sc-fg-2);
      font-size: max(0.72rem, var(--sc-fs-floor));
      min-width: 0;
    }
    .id-label { letter-spacing: 0.06em; text-transform: uppercase; flex: 0 0 auto; }
    .id-value {
      font-family: monospace;
      font-size: max(0.7rem, var(--sc-fs-floor));
      color: var(--sc-fg-2);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
      flex: 1 1 auto;
    }
    .id-copy {
      flex: 0 0 auto;
      background: none;
      border: 1px solid var(--sc-border);
      border-radius: 999px;
      color: var(--sc-fg-2);
      cursor: pointer;
      font: inherit;
      letter-spacing: 0.04em;
      /* 44px+ touch target without inflating the visual pill (mobile gate). */
      padding: 4px 12px;
      min-height: 32px;
    }
    .id-copy:hover { color: var(--sc-accent); border-color: var(--sc-accent); }

    .hint { color: var(--sc-fg-2); margin: 0 0 12px; font-size: 0.85rem; }

    .consent-desc { color: var(--sc-fg-2); font-size: max(0.78rem, var(--sc-fs-floor)); margin: 4px 0 10px; line-height: 1.45; }
    .consent-pill {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: max(0.74rem, var(--sc-fs-floor));
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: rgba(122, 134, 156, 0.18);
      color: var(--sc-fg-2);
    }
    .consent-toggle {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-size: 0.85rem;
      color: var(--sc-fg-0);
    }

    .field-row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .inline-label {
      color: var(--sc-fg-2);
      font-family: var(--sc-font-display);
      font-size: max(0.78rem, var(--sc-fs-floor));
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .text-input {
      flex: 1;
      min-width: 200px;
      padding: 8px 12px;
      background: var(--sc-bg-1);
      color: var(--sc-fg-0);
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      font: inherit;
      font-size: 0.9rem;
    }
    .text-input:focus {
      outline: none;
      border-color: var(--sc-accent);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.25);
    }

    .locale-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
      gap: 14px 16px;
      align-items: start;
      margin-bottom: 4px;
    }
    .locale-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .field-note {
      color: var(--sc-fg-2);
      font-size: max(0.75rem, var(--sc-fs-floor));
      line-height: 1.4;
    }
    .sc-select {
      background: var(--sc-bg-1);
      color: var(--sc-fg-0);
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      padding: 8px 12px;
      font-family: var(--sc-font-display);
      font-size: 0.85rem;
      letter-spacing: 0.06em;
      cursor: pointer;
      /* Full cell width: a select that sizes itself to its widest option is
         exactly what used to push it over its neighbour. */
      width: 100%;
      min-width: 0;
      max-width: 100%;
      min-height: 40px;
    }
    .sc-select:focus {
      outline: none;
      border-color: var(--sc-accent);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.25);
    }
    .sc-btn-primary {
      background: var(--sc-accent);
      color: var(--sc-bg-0);
      border-color: var(--sc-accent);
    }
    .sc-btn-primary:hover:not(:disabled) {
      background: transparent;
      color: var(--sc-accent);
    }

    .flash {
      margin-top: 12px;
      padding: 9px 14px;
      border-radius: 4px;
      font-size: 0.85rem;
    }
    .flash.success {
      background: rgba(74, 222, 128, 0.1);
      border: 1px solid var(--sc-success);
      color: var(--sc-success);
    }
    .flash.error {
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid var(--sc-danger);
      color: var(--sc-danger);
    }

    .danger-zone {
      border-color: var(--sc-danger);
      box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.15);
    }
    .danger-zone h3 { color: var(--sc-danger); }
    .danger-btn {
      color: var(--sc-danger);
      border-color: var(--sc-danger);
    }
    .danger-btn:hover:not(:disabled) {
      background: var(--sc-danger);
      color: var(--sc-bg-0);
    }

    /* Below the two-column breakpoint the rail cannot sit beside anything, so
       it becomes a bar of chips above the first section — and that bar is what
       stays PINNED down here, in the slot the shell header gave up (admin
       feedback af058ca4 round 4: "mach eher die sub menu leiste sticky").
       Before, the bar scrolled away with the page, so the very first tap on a
       section took it off screen and left no way back to the other sections
       short of scrolling to the top again. */
    @media (max-width: 1079px) {
      .toc {
        position: sticky;
        top: calc(var(--sc-imp-banner-h, 0px) + var(--sc-topbar-h, 0px));
        z-index: 5;
        /* Runs edge to edge: a pinned bar that content slides past has to
           cover the full width, or the cards travel visibly up its flanks.
           --sc-content-pad-x is the shell's page gutter (shell.component.ts). */
        margin: 0 calc(-1 * var(--sc-content-pad-x, 16px)) 20px;
        padding: 8px var(--sc-content-pad-x, 16px);
        background: color-mix(in srgb, var(--sc-bg-0) 86%, transparent);
        -webkit-backdrop-filter: blur(12px);
        backdrop-filter: blur(12px);
        border-bottom: 1px solid var(--sc-border);
      }
      .toc-list {
        flex-direction: row;
        flex-wrap: nowrap;
        /* Never centre a row that can overflow: what spills past the START
           edge is unreachable, because a scroll port cannot travel behind its
           own origin. Same trap the shell nav fell into. */
        justify-content: flex-start;
        gap: 6px;
        overflow-x: auto;
        overscroll-behavior-x: contain;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        margin: 0;
        padding: 0;
      }
      .toc-list::-webkit-scrollbar { display: none; }
      /* Segmented-control look rather than four outlined pills: unselected
         entries are quiet fills with no border of their own, so the bar reads
         as one object and the current section is the only thing that carries
         colour. */
      .toc-link {
        flex: 0 0 auto;
        gap: 0;
        padding: 9px 12px;
        min-height: 40px;
        white-space: nowrap;
        border-radius: 999px;
        background: color-mix(in srgb, var(--sc-fg-2) 12%, transparent);
        color: var(--sc-fg-1);
        transition: color 0.16s ease, background 0.16s ease;
      }
      .toc-text { overflow-wrap: normal; }
      /* The dot was a second, weaker "you are here" signal next to the label
         colour; the filled chip says it on its own. */
      .toc-marker { display: none; }
      .toc-link:hover { color: var(--sc-fg-0); background: color-mix(in srgb, var(--sc-fg-2) 20%, transparent); }
      .toc-link.active,
      .toc-link.active:hover {
        background: var(--sc-accent);
        color: var(--sc-bg-0);
        font-weight: 600;
      }
      /* A fragment jump has to clear the pinned bar too, or it parks the
         heading underneath the very control that sent you there. 88px covers
         the bar at its tallest (48px touch chip + padding + rule). */
      .group {
        scroll-margin-top: calc(
          var(--sc-imp-banner-h, 0px) + var(--sc-topbar-h, 0px) + 88px
        );
      }
    }

    /* Touch baseline: 44px is the project threshold, but the shell's loading
       scale animations shave a pixel off a measured target — so ask for 48. */
    @media (pointer: coarse) {
      .sc-select { min-height: 48px; }
      .id-copy { min-height: 48px; padding: 8px 16px; }
      .toc-link { min-height: 48px; }
    }

    @media (max-width: 560px) {
      .row { flex-direction: column; gap: 4px; align-items: flex-start; }
      .value { text-align: left; }
      .value.pills { justify-content: flex-start; }
      .text-input { min-width: 0; flex: 1 1 100%; }
      .field-row .sc-btn { flex: 1 1 100%; justify-content: center; }
      .danger-btn { width: 100%; justify-content: center; }
      /* The id would otherwise squeeze the copy button off the card edge. */
      .id-line { flex-wrap: wrap; }
      .id-value { flex: 1 1 100%; order: 3; }
      .id-copy { margin-left: auto; }
    }
  `],
})
export class SettingsComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly auth = inject(AuthService);
  readonly roles = inject(RoleService);
  readonly profile = inject(ProfileService);
  readonly consent = inject(ConsentService);
  readonly composerPrefs = inject(ComposerPrefsService);
  readonly feedbackFabPrefs = inject(FeedbackFabPrefsService);
  readonly locale = inject(LocaleService);
  private readonly sb = inject(SupabaseClientProvider);
  private readonly translate = inject(TranslateService);
  private readonly analytics = inject(AnalyticsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private readonly location = inject(Location);
  private readonly route = inject(ActivatedRoute);

  /** Single source of truth for both the rail and the section order. */
  readonly groups: readonly SettingsGroup[] = [
    {
      id: 'account',
      anchor: 'settings-account',
      labelKey: 'settings.groups.account.title',
      shortKey: 'settings.groups.account.short',
    },
    {
      id: 'preferences',
      anchor: 'settings-preferences',
      labelKey: 'settings.groups.preferences.title',
      shortKey: 'settings.groups.preferences.short',
    },
    {
      id: 'privacy',
      anchor: 'settings-privacy',
      labelKey: 'settings.groups.privacy.title',
      shortKey: 'settings.groups.privacy.short',
    },
    {
      id: 'danger',
      anchor: 'settings-danger',
      labelKey: 'settings.groups.danger.title',
      shortKey: 'settings.groups.danger.short',
    },
  ];

  /** Section the rail highlights — driven by the scroll position, not by clicks. */
  readonly activeGroup = signal<GroupId>('account');

  /**
   * True while the rail is the pinned horizontal bar rather than the vertical
   * column — i.e. below {@link RAIL_STACK_QUERY}. Only the chip LABEL depends
   * on it; everything else about the two shapes is CSS.
   */
  readonly compactRail = signal(false);
  private railQuery?: MediaQueryList;
  private railQueryListener?: (e: MediaQueryListEvent) => void;

  /**
   * Scroll-spy plumbing. The listener runs OUTSIDE Angular and only re-enters
   * the zone when the highlighted section actually changes, so scrolling the
   * settings page costs one rAF-throttled measurement and no change detection.
   */
  private scrollListener?: () => void;
  private spyFrame = 0;

  readonly languages: readonly LangId[] = ['de', 'en'];
  readonly regions: readonly RegionCode[] = PICKER_REGIONS;
  /** Stable reference so the live format preview does not re-render per tick. */
  readonly sampleDate = new Date();
  // Normalize legacy stored values (fr/es/pt/ru/zh from the old 7-language
  // dropdown) onto the supported pair so the select always has a valid option.
  readonly currentLang = computed<LangId>(() => this.locale.language());

  // Username — the saved value is the shared ProfileService signal, so editing
  // here immediately updates the avatar/account-menu across the shell.
  private readonly savedUsername = computed(() => this.profile.username() ?? '');
  readonly usernameInput = signal<string>('');
  readonly usernameSaving = signal(false);
  readonly usernameOk = signal(false);
  readonly usernameError = signal<string | null>(null);
  readonly usernameDirty = computed(
    () => this.usernameInput().trim() !== this.savedUsername().trim(),
  );

  readonly idCopied = signal(false);

  // Danger zone
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);

  /**
   * Every sign-in method actually linked to the account.
   *
   * `app_metadata.provider` only ever names the identity the current session
   * was opened with, so an account that started on Google and later gained a
   * password looked single-provider. `user.identities` is the real link table;
   * `app_metadata.providers` is the fallback for a session minted before the
   * identities list was populated.
   */
  readonly providers = computed<readonly string[]>(() => {
    const user = this.auth.user();
    if (!user) return [];
    const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
    const listed = (user.identities ?? []).map((i) => i.provider);
    const fallback = [
      ...(Array.isArray(meta['providers']) ? (meta['providers'] as unknown[]) : []),
      meta['provider'],
    ];
    const raw = listed.length ? listed : fallback;
    const seen = new Set<string>();
    for (const entry of raw) {
      if (typeof entry !== 'string' || !entry.trim()) continue;
      seen.add(entry.trim().toLowerCase());
    }
    // `email` first (it is the account's own credential), the rest alphabetical
    // so the pill order does not shuffle between renders.
    return [...seen].sort((a, b) =>
      a === 'email' ? -1 : b === 'email' ? 1 : a.localeCompare(b),
    );
  });

  /**
   * Membership age as ONE coarse unit plus its plural key (feedback af058ca4).
   * The exact timestamp is the row's tooltip, so nothing is lost by rounding.
   */
  readonly memberSinceLabel = computed<{ key: string; count: number } | null>(() => {
    const raw = this.auth.user()?.created_at;
    if (!raw) return null;
    const created = new Date(raw);
    if (Number.isNaN(created.getTime())) return null;
    const { unit, count } = memberSince(created);
    if (unit === 'today') return { key: 'profile.memberSince.today', count: 0 };
    return {
      key: `profile.memberSince.${unit}.${count === 1 ? 'one' : 'other'}`,
      count,
    };
  });

  async ngOnInit() {
    this.watchRailShape();
    // Seed the edit field from the shared handle (loaded once by ProfileService).
    if (!this.profile.loaded()) await this.profile.refresh();
    this.usernameInput.set(this.profile.username() ?? '');
  }

  /** Keeps {@link compactRail} in step with the stylesheet's rail breakpoint. */
  private watchRailShape() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    this.railQuery = window.matchMedia(RAIL_STACK_QUERY);
    this.compactRail.set(this.railQuery.matches);
    this.railQueryListener = (e) => this.compactRail.set(e.matches);
    this.railQuery.addEventListener('change', this.railQueryListener);
  }

  ngAfterViewInit() {
    if (typeof window === 'undefined') return;
    this.zone.runOutsideAngular(() => {
      this.scrollListener = () => {
        if (this.spyFrame) return;
        this.spyFrame = requestAnimationFrame(() => {
          this.spyFrame = 0;
          this.syncActiveGroup();
        });
      };
      window.addEventListener('scroll', this.scrollListener, { passive: true });
      window.addEventListener('resize', this.scrollListener, { passive: true });
      this.syncActiveGroup();
    });
    this.jumpToInitialFragment();
  }

  /**
   * Honours a deep link (/settings#settings-privacy) once the sections exist.
   *
   * The router's own anchorScrolling runs on NavigationEnd, i.e. before this
   * view has laid out, so it can land short. Re-running the jump here is a
   * no-op when the router already got it right. No smooth scroll: arriving on
   * a page mid-glide reads as a rendering glitch, not as guidance.
   */
  private jumpToInitialFragment() {
    const anchor = this.route.snapshot.fragment;
    if (!anchor || !this.groups.some((g) => g.anchor === anchor)) return;
    requestAnimationFrame(() => {
      this.host.nativeElement
        .querySelector<HTMLElement>(`#${anchor}`)
        ?.scrollIntoView({ behavior: 'auto', block: 'start' });
      this.syncActiveGroup();
    });
  }

  /**
   * Href of a rail entry — the current page path PLUS the fragment.
   *
   * A bare `#settings-account` is resolved against `<base href="/">` rather
   * than against the current URL, so the browser left /settings and loaded the
   * start page instead (feedback af058ca4, round 3). The path has to be in
   * there for the anchor to mean what it looks like — including for middle
   * click, "open in new tab" and "copy link address".
   */
  tocHref(anchor: string): string {
    const internal = this.location.path(false);
    const page = internal
      ? this.location.prepareExternalUrl(internal)
      : typeof window === 'undefined'
        ? ''
        : `${window.location.pathname}${window.location.search}`;
    return `${page}#${anchor}`;
  }

  /**
   * Plain left click on a rail entry: glide down to the section instead of
   * letting the browser teleport there. Ctrl/⌘/middle/shift clicks are left
   * alone so the href keeps opening a new tab or window.
   */
  onTocClick(ev: MouseEvent, group: SettingsGroup) {
    if (!isPlainLeftClick(ev)) return;
    const target = this.host.nativeElement.querySelector<HTMLElement>(`#${group.anchor}`);
    // No target rendered → let the real href do its job rather than swallowing
    // the click.
    if (!target) return;
    ev.preventDefault();

    // Immediate feedback; the scroll-spy takes the highlight over again as the
    // page travels and ends on this very section.
    this.activeGroup.set(group.id);
    this.revealRailEntry(this.groups.indexOf(group));
    target.scrollIntoView({ behavior: this.scrollBehavior(), block: 'start' });
    // Intercepting the click also swallows the browser's own "move focus to
    // the target" step, which would strand a keyboard user in the rail.
    target.focus({ preventScroll: true });

    // Keep the address bar on the section without a router navigation: that
    // would re-run anchorScrolling and teleport past the glide.
    const internal = this.location.path(false);
    if (internal) this.location.replaceState(`${internal.split('#')[0]}#${group.anchor}`);
  }

  /** Users who asked the OS for less motion get the instant jump. */
  private scrollBehavior(): ScrollBehavior {
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return reduced ? 'auto' : 'smooth';
  }

  ngOnDestroy() {
    if (this.spyFrame) cancelAnimationFrame(this.spyFrame);
    if (this.railQuery && this.railQueryListener) {
      this.railQuery.removeEventListener('change', this.railQueryListener);
    }
    this.railQuery = undefined;
    this.railQueryListener = undefined;
    if (!this.scrollListener) return;
    window.removeEventListener('scroll', this.scrollListener);
    window.removeEventListener('resize', this.scrollListener);
    this.scrollListener = undefined;
  }

  /**
   * Last section whose heading has passed the reading line wins — that is the
   * one filling the screen. The bottom of the document is special-cased: the
   * final section is often too short to ever reach the line, and a rail that
   * highlights nothing at the end of the page reads as broken.
   */
  private syncActiveGroup() {
    const root = this.host.nativeElement;
    const line = this.readingLine();
    let nextIndex = 0;
    this.groups.forEach((group, i) => {
      const el = root.querySelector<HTMLElement>(`#${group.anchor}`);
      if (el && el.getBoundingClientRect().top <= line) nextIndex = i;
    });
    const doc = document.documentElement;
    const scrollable = doc.scrollHeight - window.innerHeight > 4;
    if (scrollable && window.innerHeight + window.scrollY >= doc.scrollHeight - 4) {
      nextIndex = this.groups.length - 1;
    }
    const next = this.groups[nextIndex].id;
    if (next === this.activeGroup()) return;
    this.zone.run(() => this.activeGroup.set(next));
    this.revealRailEntry(nextIndex);
  }

  /**
   * Where the "currently being read" line sits, measured rather than assumed.
   *
   * It has to fall just below everything parked at the top of the viewport:
   * the impersonation banner, the shell header WHEN it is sticky (it is not on
   * phones — it publishes `--sc-topbar-h: 0px` then), and the rail itself once
   * the rail is the pinned horizontal bar.
   */
  private readingLine(): number {
    const style = getComputedStyle(document.documentElement);
    const px = (name: string) => parseFloat(style.getPropertyValue(name)) || 0;
    let line = px('--sc-imp-banner-h') + px('--sc-topbar-h') + SPY_CLEARANCE_PX;
    const toc = this.host.nativeElement.querySelector<HTMLElement>('.toc');
    // Pinned AND wider than it is tall = the horizontal bar, which covers the
    // top of the page; the vertical rail sits beside the text and covers none.
    if (toc && getComputedStyle(toc).position === 'sticky' && toc.offsetWidth > toc.offsetHeight) {
      line += toc.offsetHeight;
    }
    return line;
  }

  /**
   * Keeps the highlighted chip inside the pinned bar's scroll port. Without
   * this the bar can highlight an entry that is off its own right edge, which
   * looks like nothing is selected at all. No-op for the vertical rail and
   * whenever the bar is short enough not to scroll.
   */
  private revealRailEntry(index: number) {
    const list = this.host.nativeElement.querySelector<HTMLElement>('.toc-list');
    if (!list || list.scrollWidth <= list.clientWidth + 1) return;
    const entry = list.querySelectorAll<HTMLElement>('.toc-link')[index];
    if (!entry) return;
    const left = entry.offsetLeft - (list.clientWidth - entry.offsetWidth) / 2;
    list.scrollTo({ left: Math.max(0, left), behavior: this.scrollBehavior() });
  }

  asInput(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  /** Translated provider name, falling back to the raw id for a new provider. */
  providerLabel(provider: string): string {
    return this.translated(
      `profile.providers.${provider}`,
      provider.charAt(0).toUpperCase() + provider.slice(1),
    );
  }

  async copyUserId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      this.idCopied.set(true);
      setTimeout(() => this.idCopied.set(false), 2000);
    } catch {
      // Clipboard denied (insecure context / permission) — select the text so
      // the user can still copy it by hand.
      const sel = window.getSelection();
      const el = document.querySelector('.id-value');
      if (sel && el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }

  async saveUsername(e: Event) {
    e.preventDefault();
    if (this.usernameSaving() || !this.usernameDirty()) return;
    this.usernameSaving.set(true);
    this.usernameOk.set(false);
    this.usernameError.set(null);
    const next = this.usernameInput().trim();
    const { error } = await this.profile.setUsername(next);
    if (error) {
      const msg = error.message ?? '';
      if (msg.includes('username_invalid')) {
        this.usernameError.set('settings.username.errInvalid');
      } else if (msg.includes('username_taken')) {
        this.usernameError.set('settings.username.errTaken');
      } else {
        this.usernameError.set('settings.username.errGeneric');
      }
      this.usernameSaving.set(false);
      return;
    }
    // savedUsername now derives from ProfileService (updated by setUsername),
    // so usernameDirty resets automatically.
    this.usernameInput.set(next);
    this.usernameOk.set(true);
    this.usernameSaving.set(false);
    this.analytics.capture('settings_username_saved');
  }

  onSendOnEnterToggle(e: Event) {
    const on = (e.target as HTMLInputElement).checked;
    this.composerPrefs.setSendOnEnter(on);
    this.analytics.capture('settings_send_on_enter_changed', { on });
  }

  onFeedbackFabToggle(e: Event) {
    const on = (e.target as HTMLInputElement).checked;
    this.feedbackFabPrefs.setShow(on);
    this.analytics.capture('settings_feedback_fab_changed', { on });
  }

  onConsentToggle(e: Event) {
    this.consent.setPreferences((e.target as HTMLInputElement).checked);
  }

  onStatisticsToggle(e: Event) {
    this.consent.setStatistics((e.target as HTMLInputElement).checked);
  }

  /**
   * Language choice. `LocaleService` owns persistence + the ngx-translate
   * activation (the shell mirrors its resolved language), so this handler only
   * records the choice and syncs it to the account.
   */
  onLanguageChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    const setting = value === 'auto' ? 'auto' : (value as LangId);
    this.locale.setLanguage(setting);
    this.analytics.capture('settings_language_changed', { lang: setting });
    // Persist to the profile as the logged-in preference. Fire-and-forget:
    // a failure here (e.g. migration not yet applied) must not block the UI.
    // `null` clears the column, i.e. hands the decision back to detection.
    this.sb.client
      .rpc('set_preferred_lang', { lang: setting === 'auto' ? null : setting })
      .then(({ error }) => {
        if (error) console.warn('[settings] set_preferred_lang failed:', error.message);
      });
  }

  /** Region choice — decides date field order and the clock convention. */
  onRegionChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    const setting = value === 'auto' ? 'auto' : value.toUpperCase();
    this.locale.setRegion(setting);
    this.analytics.capture('settings_region_changed', { region: setting });
    this.sb.client
      .rpc('set_preferred_region', { region: setting === 'auto' ? null : setting })
      .then(({ error }) => {
        if (error) console.warn('[settings] set_preferred_region failed:', error.message);
      });
  }

  /** Translated language name, for the "detected automatically" line. */
  languageLabel(lang: string): string {
    return this.translated(`settings.locale.languages.${lang}`, lang.toUpperCase());
  }

  /**
   * Translated region name. A region resolved from the browser can legitimately
   * sit outside the curated picker list (e.g. `HR`) — show the raw ISO code
   * rather than leaking a translation key.
   */
  regionLabel(region: string): string {
    return this.translated(`settings.locale.regions.${region}`, region);
  }

  private translated(key: string, fallback: string): string {
    const value = this.translate.instant(key);
    return !value || value === key ? fallback : value;
  }

  async deleteAccount() {
    if (this.deleting()) return;
    const user = this.auth.user();
    if (!user) return;
    const msg = this.translate.instant('settings.danger.confirm', { email: user.email });
    if (!window.confirm(msg)) return;
    this.deleting.set(true);
    this.deleteError.set(null);
    const { data, error } = await this.sb.client.functions.invoke('delete-user', {
      body: { userId: user.id },
    });
    const payload = (data ?? {}) as {
      ok?: boolean;
      error?: string;
      message?: string;
      deletedSelf?: boolean;
    };
    if (error || payload.error) {
      this.deleteError.set(
        payload.message ??
          payload.error ??
          error?.message ??
          this.translate.instant('settings.danger.failed'),
      );
      this.deleting.set(false);
      return;
    }
    if (payload.deletedSelf) {
      await this.auth.signOut();
      return;
    }
    this.deleting.set(false);
  }
}
