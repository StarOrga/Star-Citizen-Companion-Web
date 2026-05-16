import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Session, User } from '@supabase/supabase-js';
import { SupabaseClientProvider } from '../core/supabase.client';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly router = inject(Router);

  private readonly _session = signal<Session | null>(null);
  private readonly _ready = signal(false);

  readonly session = this._session.asReadonly();
  readonly user = computed<User | null>(() => this._session()?.user ?? null);
  readonly ready = this._ready.asReadonly();
  readonly isAuthenticated = computed(() => this._session() !== null);
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    this.sb.client.auth.getSession().then(({ data }) => {
      this._session.set(data.session);
      this._ready.set(true);
    });

    this.sb.client.auth.onAuthStateChange((_event, session) => {
      this._session.set(session);
      this._ready.set(true);
    });
  }

  async signInWithPassword(email: string, password: string) {
    return this.sb.client.auth.signInWithPassword({ email, password });
  }

  async signUp(email: string, password: string) {
    return this.sb.client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: typeof window !== 'undefined' ? `${window.location.origin}/news` : undefined,
      },
    });
  }

  async signInWithGoogle() {
    return this.sb.client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/news` : undefined,
      },
    });
  }

  async signOut() {
    await this.sb.client.auth.signOut();
    await this.router.navigate(['/login']);
  }
}
