/**
 * Compact "⚡ Standard ▾" tempo chip shown under the Extract/Upload card.
 * Click opens a small popover with the profile picker (same `applyProfile`
 * write path main.ts already owns) — the applied/armed/unsupported outcome is
 * reported to the caller so it can be routed to the bottom-strip snackbar.
 */

export type LiveProfile = 'minimal' | 'standard' | 'maximum' | 'auto';

interface ProfileDefLike {
  id: string;
  label: { en: string };
  description: { en: string };
}

export interface ThrottleChipCtx {
  getProfile: () => LiveProfile;
  getLocale: () => string;
  applyProfile: (next: LiveProfile) => Promise<{ message: string } | null>;
  onMessage: (msg: string) => void;
}

export function throttleChipHtml(profile: LiveProfile): string {
  const label = profile.charAt(0).toUpperCase() + profile.slice(1);
  return `<button type="button" id="throttle-chip" class="throttle-chip">⚡ ${label} ▾</button>`;
}

export function wireThrottleChip(ctx: ThrottleChipCtx): void {
  const chip = document.getElementById('throttle-chip');
  chip?.addEventListener('click', (e) => {
    e.stopPropagation();
    void openPopover(chip as HTMLElement, ctx);
  });
}

let openPanel: HTMLElement | null = null;

function closePopover(): void {
  openPanel?.remove();
  openPanel = null;
}

async function openPopover(anchor: HTMLElement, ctx: ThrottleChipCtx): Promise<void> {
  if (openPanel) {
    closePopover();
    return;
  }
  const { profiles } = await window.sc.profiles();
  const lang = ctx.getLocale();
  const panel = document.createElement('div');
  panel.className = 'sc-popover throttle-popover';
  panel.innerHTML = (Object.values(profiles) as ProfileDefLike[])
    .map((p) => {
      const label = (p.label as Record<string, string>)[lang] ?? p.label.en;
      const active = p.id === ctx.getProfile() ? 'active' : '';
      return `<button type="button" class="profile-pill compact ${active}" data-profile="${p.id}">${label}</button>`;
    })
    .join('');
  document.body.appendChild(panel);
  const rect = anchor.getBoundingClientRect();
  panel.style.top = `${rect.bottom + 6}px`;
  panel.style.left = `${rect.left}px`;
  openPanel = panel;

  panel.querySelectorAll<HTMLButtonElement>('.profile-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset['profile'] as LiveProfile | undefined;
      closePopover();
      if (!id) return;
      void ctx.applyProfile(id).then((r) => {
        if (r) ctx.onMessage(r.message);
      });
    });
  });

  const onDocClick = (e: MouseEvent): void => {
    if (panel.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
    closePopover();
    document.removeEventListener('mousedown', onDocClick, true);
  };
  document.addEventListener('mousedown', onDocClick, true);
}
