import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ChannelPickerComponent } from './channel-picker.component';
import { RoleService } from '../auth/role.service';

describe('ChannelPickerComponent', () => {
  function setup(role: 'admin' | 'collaborator' | 'viewer') {
    const roleSig = signal(role);
    TestBed.configureTestingModule({
      imports: [ChannelPickerComponent, TranslateModule.forRoot()],
      providers: [{ provide: RoleService, useValue: { role: roleSig.asReadonly() } }],
    });
    const fixture = TestBed.createComponent(ChannelPickerComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('offers alpha/beta/stable and defaults alpha for admin', () => {
    const f = setup('admin');
    expect(f.componentInstance.options()).toEqual(['alpha', 'beta', 'stable']);
    expect(f.componentInstance.channel()).toBe('alpha');
    expect(f.nativeElement.querySelector('select')).not.toBeNull();
  });

  it('offers beta/stable and defaults beta for collaborator', () => {
    const f = setup('collaborator');
    expect(f.componentInstance.options()).toEqual(['beta', 'stable']);
    expect(f.componentInstance.channel()).toBe('beta');
  });

  it('renders no picker for viewer (stable only)', () => {
    const f = setup('viewer');
    expect(f.componentInstance.options()).toEqual(['stable']);
    expect(f.nativeElement.querySelector('select')).toBeNull();
  });
});
