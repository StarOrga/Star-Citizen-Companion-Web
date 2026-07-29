import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

/**
 * /tools/3d-print — no-hosting 3D-printing guidance page (issue #79, Option 0).
 *
 * Deliberately hosts and serves ZERO CIG-derived geometry: RSI's EULA and the
 * Fankit/Fandom FAQ prohibit redistributing extracted Game Material, so this
 * page only explains the community workflow (user's own local extraction →
 * conversion → Blender print-prep) and links the vetted external tools.
 */
interface ExternalTool {
  name: string;
  url: string;
  descKey: string;
}

@Component({
  selector: 'sc-print-guide',
  standalone: true,
  imports: [TranslateModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <h1>{{ 'printGuide.title' | translate }}</h1>
      <p class="subtitle">{{ 'printGuide.subtitle' | translate }}</p>

      <!-- Legal stance: we host nothing, and why -->
      <div class="sc-card legal">
        <h2>{{ 'printGuide.legal.title' | translate }}</h2>
        <p>{{ 'printGuide.legal.p1' | translate }}</p>
        <p>{{ 'printGuide.legal.p2' | translate }}</p>
        <ul class="link-list">
          <li>
            <a href="https://robertsspaceindustries.com/en/eula" target="_blank" rel="noopener noreferrer">
              {{ 'printGuide.legal.eulaLink' | translate }}
            </a>
          </li>
          <li>
            <a href="https://support.robertsspaceindustries.com/hc/en-us/articles/360006895793-Star-Citizen-Fankit-and-Fandom-FAQ"
               target="_blank" rel="noopener noreferrer">
              {{ 'printGuide.legal.faqLink' | translate }}
            </a>
          </li>
        </ul>
        <p class="disclaimer">{{ 'printGuide.legal.affiliation' | translate }}</p>
      </div>

      <!-- The community workflow, step by step -->
      <div class="sc-card">
        <h2>{{ 'printGuide.workflow.title' | translate }}</h2>
        <ol class="steps">
          @for (step of ['extract', 'convert', 'prep', 'slice']; track step) {
            <li>
              <span class="step-title">{{ 'printGuide.workflow.' + step + '.title' | translate }}</span>
              <span class="step-text">{{ 'printGuide.workflow.' + step + '.text' | translate }}</span>
            </li>
          }
        </ol>
      </div>

      <!-- Vetted external community tools -->
      <div class="sc-card">
        <h2>{{ 'printGuide.tools.title' | translate }}</h2>
        <p class="hint">{{ 'printGuide.tools.hint' | translate }}</p>
        <ul class="tools">
          @for (tool of tools; track tool.name) {
            <li>
              <a [href]="tool.url" target="_blank" rel="noopener noreferrer" class="tool-name">
                {{ tool.name }}
              </a>
              <span class="tool-desc">{{ tool.descKey | translate }}</span>
            </li>
          }
        </ul>
      </div>

      <!-- Print-prep tips (watertight meshes, scale) -->
      <div class="sc-card">
        <h2>{{ 'printGuide.tips.title' | translate }}</h2>
        <ul class="tips">
          @for (tip of ['watertight', 'solidify', 'remesh', 'scale', 'lod']; track tip) {
            <li>{{ 'printGuide.tips.' + tip | translate }}</li>
          }
        </ul>
        <p class="hint">
          <a href="https://robertsspaceindustries.com/community-hub/post/easy-preparation-of-stl-files-for-3-d-printing-yAA4Iw8v9kv9h"
             target="_blank" rel="noopener noreferrer">
            {{ 'printGuide.tips.cigGuide' | translate }}
          </a>
        </p>
      </div>

      <!-- What this app DOES offer: real dimensions from the codex -->
      <div class="sc-card codex-hint">
        <h2>{{ 'printGuide.codex.title' | translate }}</h2>
        <p>{{ 'printGuide.codex.text' | translate }}</p>
        <a routerLink="/codex" class="sc-btn">{{ 'printGuide.codex.cta' | translate }}</a>
      </div>
    </section>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 20px; max-width: 860px; }
    h1 { margin: 0; }
    .subtitle { color: var(--sc-fg-2); margin: -8px 0 0; }
    h2 {
      margin: 0 0 10px;
      font-size: 1rem;
      font-family: var(--sc-font-display);
      letter-spacing: 0.04em;
    }
    p { line-height: 1.55; margin: 0 0 10px; }
    p:last-child { margin-bottom: 0; }
    .hint { color: var(--sc-fg-2); font-size: 0.85rem; }

    .legal { border-color: var(--sc-accent); }
    .legal .disclaimer {
      color: var(--sc-fg-2);
      font-size: max(0.78rem, var(--sc-fs-floor));
      border-top: 1px solid var(--sc-border);
      padding-top: 10px;
      margin-top: 12px;
    }
    .link-list { margin: 0; padding-left: 20px; }
    .link-list li { margin: 4px 0; }
    /* Standalone links (list entries, the CIG-guide hint) are controls, not
       prose — on touch they get the full hit area. */
    @media (pointer: coarse) {
      .link-list li > a,
      .hint > a:only-child { display: flex; align-items: center; min-height: var(--sc-tap-min); }
    }

    a { color: var(--sc-accent); }
    a:hover { color: var(--sc-fg-0); }

    .steps { margin: 0; padding-left: 22px; display: flex; flex-direction: column; gap: 12px; }
    .step-title {
      display: block;
      font-family: var(--sc-font-display);
      font-size: 0.85rem;
      letter-spacing: 0.05em;
      color: var(--sc-fg-1);
    }
    .step-text { color: var(--sc-fg-2); font-size: 0.9rem; line-height: 1.5; }

    .tools { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
    .tools li {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 10px 12px;
      background: var(--sc-bg-1);
      border: 1px solid var(--sc-border);
      border-radius: 6px;
    }
    .tool-name {
      font-family: var(--sc-font-display);
      font-size: 0.9rem;
      letter-spacing: 0.04em;
      text-decoration: none;
    }
    .tool-desc { color: var(--sc-fg-2); font-size: 0.85rem; line-height: 1.45; }

    .tips { margin: 0 0 12px; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
    .tips li { color: var(--sc-fg-1); font-size: 0.9rem; line-height: 1.5; }

    .codex-hint .sc-btn { display: inline-block; margin-top: 4px; text-decoration: none; }
  `],
})
export class PrintGuideComponent {
  // Vetted community tools (issue #79). URLs are external references, the
  // user runs every one of them locally against their own game install.
  readonly tools: readonly ExternalTool[] = [
    {
      name: 'unp4k',
      url: 'https://github.com/dolkensp/unp4k',
      descKey: 'printGuide.tools.unp4k',
    },
    {
      name: 'StarFab / scdatatools',
      url: 'https://pypi.org/project/scdatatools/',
      descKey: 'printGuide.tools.starfab',
    },
    {
      name: 'StarBreaker',
      url: 'https://github.com/diogotr7/StarBreaker',
      descKey: 'printGuide.tools.starbreaker',
    },
    {
      name: 'Cryengine-Converter',
      url: 'https://github.com/Markemp/Cryengine-Converter',
      descKey: 'printGuide.tools.cryengineConverter',
    },
    {
      name: 'SCExporter (Blender)',
      url: 'https://github.com/Kjasi/SCExporter',
      descKey: 'printGuide.tools.scexporter',
    },
  ];
}
