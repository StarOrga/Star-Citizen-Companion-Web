import { Injectable, signal } from '@angular/core';

/**
 * What a cinematic hub's stage tells the shell chrome (beta "shell").
 * `stageSearchVisible`: the hub's own search line is on screen — the bar
 * keeps its search folded until it scrolls away, then morphs it into the
 * capsule. False on every page without a stage search line.
 *
 * Minimal stand-in until the bar's chrome state lands; the bar may absorb it.
 */
@Injectable({ providedIn: 'root' })
export class StageChromeService {
  private readonly _stageSearchVisible = signal(false);
  readonly stageSearchVisible = this._stageSearchVisible.asReadonly();

  setStageSearchVisible(visible: boolean): void {
    this._stageSearchVisible.set(visible);
  }
}
