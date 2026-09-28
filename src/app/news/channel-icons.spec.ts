import { channelIconSvg } from './channel-icons';
import type { NewsChannel } from './news.service';

describe('channelIconSvg', () => {
  it('embeds the YouTube mark in its own colours, not currentColor', () => {
    const svg = channelIconSvg('youtube');
    expect(svg).toContain('fill="#FF0000"');
    expect(svg).toContain('fill="#FFFFFF"');
    expect(svg).not.toContain('currentColor');
  });

  it('keeps app glyphs on currentColor', () => {
    expect(channelIconSvg('comm-link')).toContain('currentColor');
    expect(channelIconSvg('patch')).toContain('currentColor');
  });

  it('returns a decorative svg for every channel', () => {
    const channels: NewsChannel[] = ['comm-link', 'spectrum', 'status', 'patch', 'youtube'];
    for (const channel of channels) {
      const svg = channelIconSvg(channel);
      expect(svg).withContext(channel).toContain('<svg');
      expect(svg).withContext(channel).toContain('aria-hidden="true"');
    }
  });
});
