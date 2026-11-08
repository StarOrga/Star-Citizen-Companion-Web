import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The HQ station on the Verse stage (concept 2026-11-08 batch-feedback-15,
 * round 3 "Olisar-Kreuz"): a sphere hub with four docking arms in a cross,
 * docking collars, landing pads with lights at the arm ends (one small ship
 * parked on the front pad), a hab ring around the hub and an antenna mast.
 * Lit by the stage's sun from the top right; the night side carries warm
 * windows. The drawing (briefing-station.component.html) is generated from the
 * concept's own generator, so it is the mock's markup 1:1. Motion lives here
 * only for the position lights: red and green alternate every 2 s, a white
 * strobe flashes every 3 s; drift and hover scale belong to the beacon.
 * Purely decorative (aria-hidden) — the beacon anchor carries the name.
 */
@Component({
  selector: 'sc-briefing-station',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './briefing-station.component.html',
  styles: `
    :host { display: block; width: 100%; height: 100%; }
    .st { display: block; width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 0.12cqw 0.22cqw rgba(0, 4, 10, 0.6)); }
    .nl-r { animation: nl-blink 2s ease-in-out infinite; animation-play-state: var(--sc-brief-play, running); }
    .nl-g { animation: nl-blink 2s ease-in-out -1s infinite; animation-play-state: var(--sc-brief-play, running); }
    .nl-w { animation: nl-strobe 3s linear infinite; animation-play-state: var(--sc-brief-play, running); }
    @keyframes nl-blink { 0%, 70%, 100% { opacity: 0.18; } 80% { opacity: 1; } }
    @keyframes nl-strobe { 0%, 92%, 100% { opacity: 0.1; } 94% { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .nl-r, .nl-g, .nl-w { animation: none; opacity: 0.85; }
    }
  `,
})
export class BriefingStationComponent {}
