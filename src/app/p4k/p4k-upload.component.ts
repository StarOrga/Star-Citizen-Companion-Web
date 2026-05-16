import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { P4kService, detectChannel, detectVersion } from './p4k.service';
import { environment } from '../../environments/environment';

@Component({
  selector: 'sc-p4k-upload',
  standalone: true,
  imports: [DatePipe, DecimalPipe, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <header class="head">
        <div>
          <h1>{{ 'p4k.title' | translate }}</h1>
          <p class="hint">{{ 'p4k.subtitle' | translate }}</p>
        </div>
      </header>

      <div
        class="drop sc-card"
        [class.dragover]="dragOver()"
        (dragenter)="onDragEnter($event)"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave($event)"
        (drop)="onDrop($event)"
      >
        <input
          #fileInput
          type="file"
          accept=".p4k,.zip,.json,application/octet-stream"
          (change)="onFileSelected($event)"
          hidden
        />
        <div class="drop-inner">
          <h2>{{ 'p4k.dropTitle' | translate }}</h2>
          <p>{{ 'p4k.dropHint' | translate:({ max: maxMb }) }}</p>
          @if (preview(); as p) {
            <div class="preview">
              <span class="sc-pill" [class]="p.channel">{{ p.channel }}</span>
              @if (p.version) { <span class="sc-pill tech">v{{ p.version }}</span> }
              <span class="filename">{{ p.name }}</span>
              <span class="size">{{ p.size / 1024 / 1024 | number:'1.0-1' }} MB</span>
            </div>
          }
          @if (errorMsg()) {
            <div class="err">{{ errorMsg() }}</div>
          }
          <button class="sc-btn sc-btn-primary" (click)="fileInput.click()" [disabled]="svc.busy()">
            {{ svc.busy() ? ('p4k.uploading' | translate) : ('p4k.choose' | translate) }}
          </button>
        </div>
      </div>

      <div class="history">
        <h2>{{ 'p4k.historyTitle' | translate }}</h2>
        @if (svc.uploads().length === 0) {
          <div class="sc-card empty">{{ 'p4k.empty' | translate }}</div>
        } @else {
          <table class="sc-card table">
            <thead>
              <tr>
                <th>{{ 'p4k.col.file' | translate }}</th>
                <th>{{ 'p4k.col.channel' | translate }}</th>
                <th>{{ 'p4k.col.version' | translate }}</th>
                <th>{{ 'p4k.col.size' | translate }}</th>
                <th>{{ 'p4k.col.uploaded' | translate }}</th>
                <th>{{ 'p4k.col.status' | translate }}</th>
              </tr>
            </thead>
            <tbody>
              @for (u of svc.uploads(); track u.id) {
                <tr>
                  <td>{{ u.original_name }}</td>
                  <td><span class="sc-pill" [class]="u.detected_channel">{{ u.detected_channel }}</span></td>
                  <td>{{ u.detected_version ?? '—' }}</td>
                  <td>{{ u.size_bytes / 1024 / 1024 | number:'1.0-1' }} MB</td>
                  <td>{{ u.uploaded_at | date:'short' }}</td>
                  <td>
                    <span class="status" [class]="u.status">{{ u.status }}</span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    </section>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 24px; }
    .head { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; }
    .hint { color: var(--sc-fg-2); margin: 4px 0 0; }
    .drop {
      border: 2px dashed var(--sc-border);
      padding: 48px 24px;
      text-align: center;
      transition: all 0.18s ease;
      cursor: pointer;
    }
    .drop.dragover {
      border-color: var(--sc-accent);
      background: linear-gradient(180deg, rgba(0, 212, 255, 0.06), var(--sc-bg-1));
      transform: scale(1.005);
    }
    .drop-inner { display: flex; flex-direction: column; gap: 14px; align-items: center; }
    .preview { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .preview .filename { font-family: monospace; font-size: 0.9rem; }
    .preview .size { color: var(--sc-fg-2); font-size: 0.85rem; }
    .err {
      padding: 10px 14px;
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid var(--sc-danger);
      color: var(--sc-danger);
      border-radius: 4px;
    }
    .history h2 { margin-bottom: 12px; }
    .empty { text-align: center; color: var(--sc-fg-2); padding: 40px; }
    .table {
      width: 100%;
      padding: 0;
      border-collapse: collapse;
      overflow: hidden;
    }
    .table th, .table td {
      padding: 12px 18px;
      text-align: left;
      border-bottom: 1px solid var(--sc-border);
      font-size: 0.88rem;
    }
    .table thead th {
      background: var(--sc-bg-2);
      font-family: var(--sc-font-display);
      font-size: 0.75rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
    }
    .table tbody tr:hover { background: rgba(0, 212, 255, 0.04); }
    .status {
      font-size: 0.78rem;
      padding: 2px 8px;
      border-radius: 999px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      &.pending { color: var(--sc-fg-2); border: 1px solid var(--sc-fg-2); }
      &.processing { color: var(--sc-warning); border: 1px solid var(--sc-warning); }
      &.done { color: var(--sc-success); border: 1px solid var(--sc-success); }
      &.failed { color: var(--sc-danger); border: 1px solid var(--sc-danger); }
    }
  `],
})
export class P4kUploadComponent implements OnInit {
  readonly svc = inject(P4kService);
  readonly maxMb = environment.storage.maxP4kSizeMb;
  readonly dragOver = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly preview = signal<{ name: string; size: number; channel: string; version: string | null } | null>(null);

  ngOnInit() { this.svc.listMine().catch(() => null); }

  onDragEnter(e: DragEvent) { e.preventDefault(); this.dragOver.set(true); }
  onDragOver(e: DragEvent) { e.preventDefault(); this.dragOver.set(true); }
  onDragLeave(e: DragEvent) {
    e.preventDefault();
    if (e.target === e.currentTarget) this.dragOver.set(false);
  }

  onDrop(e: DragEvent) {
    e.preventDefault();
    this.dragOver.set(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) this.startUpload(file);
  }

  onFileSelected(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.startUpload(file);
    input.value = '';
  }

  private async startUpload(file: File) {
    this.errorMsg.set(null);
    const channel = detectChannel(file.name);
    const version = detectVersion(file.name);
    this.preview.set({ name: file.name, size: file.size, channel, version });

    if (file.size > this.maxMb * 1024 * 1024) {
      this.errorMsg.set(`File too large. Max ${this.maxMb} MB.`);
      return;
    }

    try {
      await this.svc.upload(file);
    } catch (err) {
      this.errorMsg.set((err as Error).message);
    }
  }
}
