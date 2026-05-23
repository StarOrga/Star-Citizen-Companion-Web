import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { AuthService } from './auth.service';

export type Role = 'admin' | 'collaborator' | 'viewer';

@Injectable({ providedIn: 'root' })
export class RoleService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);

  private readonly _role = signal<Role | null>(null);
  private readonly _loaded = signal(false);

  readonly role = this._role.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  readonly isAdmin = computed(() => this._role() === 'admin');
  readonly isCollaborator = computed(() =>
    this._role() === 'admin' || this._role() === 'collaborator',
  );

  constructor() {
    effect(() => {
      const user = this.auth.user();
      if (!user) {
        this._role.set(null);
        this._loaded.set(false);
        return;
      }
      this.refresh().catch(() => null);
    });
  }

  async refresh(): Promise<void> {
    const user = this.auth.user();
    if (!user) {
      this._role.set(null);
      this._loaded.set(false);
      return;
    }
    const { data, error } = await this.sb.client
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (error) {
      this._role.set('viewer');
    } else {
      this._role.set(((data?.['role'] as Role) ?? 'viewer'));
    }
    this._loaded.set(true);
  }

  waitReady(): Promise<void> {
    if (this._loaded()) return Promise.resolve();
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (this._loaded()) {
          clearInterval(interval);
          resolve();
        }
      }, 30);
    });
  }
}
