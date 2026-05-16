import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SupabaseClientProvider } from '../core/supabase.client';
import { environment } from '../../environments/environment';

export type ChannelTag = 'live' | 'ptu' | 'eptu' | 'tech-preview' | 'unknown';

export interface P4kUpload {
  id: string;
  user_id: string;
  storage_path: string;
  original_name: string;
  size_bytes: number;
  detected_channel: ChannelTag;
  detected_version: string | null;
  uploaded_at: string;
  processed_at: string | null;
  status: 'pending' | 'processing' | 'done' | 'failed';
  result: unknown | null;
  error: string | null;
}

export interface UploadProgress {
  total: number;
  loaded: number;
  pct: number;
}

@Injectable({ providedIn: 'root' })
export class P4kService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly http = inject(HttpClient);

  readonly uploads = signal<P4kUpload[]>([]);
  readonly busy = signal(false);

  async listMine(): Promise<void> {
    const { data, error } = await this.sb.client
      .from('p4k_uploads')
      .select('*')
      .order('uploaded_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    this.uploads.set((data ?? []) as P4kUpload[]);
  }

  async upload(file: File, onProgress?: (p: UploadProgress) => void): Promise<P4kUpload> {
    this.busy.set(true);
    try {
      const { data: userData } = await this.sb.client.auth.getUser();
      const user = userData.user;
      if (!user) throw new Error('Not authenticated');

      const channel = detectChannel(file.name);
      const version = detectVersion(file.name);
      const storagePath = `${user.id}/${Date.now()}-${sanitize(file.name)}`;

      const { error: uploadError } = await this.sb.client.storage
        .from(environment.storage.p4kBucket)
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: 'application/octet-stream',
        });

      if (uploadError) throw uploadError;
      if (onProgress) onProgress({ total: file.size, loaded: file.size, pct: 100 });

      const { data: row, error: insertError } = await this.sb.client
        .from('p4k_uploads')
        .insert({
          user_id: user.id,
          storage_path: storagePath,
          original_name: file.name,
          size_bytes: file.size,
          detected_channel: channel,
          detected_version: version,
          status: 'pending',
        })
        .select()
        .single();

      if (insertError) throw insertError;

      try {
        await firstValueFrom(
          this.http.post(`${environment.supabase.url}/functions/v1/process-p4k`, { upload_id: row.id })
        );
      } catch {
        /* processing fail surfaces via status polling */
      }

      await this.listMine();
      return row as P4kUpload;
    } finally {
      this.busy.set(false);
    }
  }

  async remove(id: string, storagePath: string): Promise<void> {
    await this.sb.client.storage.from(environment.storage.p4kBucket).remove([storagePath]);
    await this.sb.client.from('p4k_uploads').delete().eq('id', id);
    await this.listMine();
  }
}

const CHANNEL_RX = /(?:^|[\\/_\-\.\s])(live|ptu|eptu|tech-?preview)(?:[\\/_\-\.\s]|$)/i;
const VERSION_RX = /(\d+\.\d+(?:\.\d+)?(?:[-_]?[a-z]+\d*)?)/i;

export function detectChannel(name: string): ChannelTag {
  const match = name.match(CHANNEL_RX);
  if (!match) return 'unknown';
  const tag = match[1].toLowerCase().replace(/^techpreview$/, 'tech-preview');
  if (tag === 'live' || tag === 'ptu' || tag === 'eptu' || tag === 'tech-preview') return tag;
  return 'unknown';
}

export function detectVersion(name: string): string | null {
  const match = name.match(VERSION_RX);
  return match ? match[1] : null;
}

function sanitize(name: string): string {
  return name.replace(/[^a-z0-9._-]/gi, '_').slice(0, 120);
}
