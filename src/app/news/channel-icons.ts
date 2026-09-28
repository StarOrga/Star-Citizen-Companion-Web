import type { NewsChannel } from './news.service';

/**
 * Inline channel glyphs — no icon font, no sprite request.
 *
 * Foreign brand marks (YouTube, Spectrum) are embedded unaltered in their own
 * colours — the CLAUDE.md brand exception. App glyphs use currentColor, so the
 * surface that shows them decides their tint.
 *
 * YouTube brand terms (YouTube Brand Resources + API branding guidelines):
 * red #FF0000 with a white #FFFFFF triangle, never recoloured, filtered,
 * faded, animated or clipped, never below 20px, clear space around it at
 * least the triangle's size. Every surface that shows it sizes it to 20px
 * (news-thumb .ch-pill.ch-youtube, news-list .ch-icon.brand-mark).
 */
export function channelIconSvg(channel: NewsChannel): string {
  switch (channel) {
    case 'youtube':
      // YouTube brand red and white — brand colours, not tokens.
      return '<svg viewBox="0 0 24 24" aria-hidden="true">'
        + '<path fill="#FF0000" d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8z"/>'
        + '<path fill="#FFFFFF" d="M10 15V9l5.2 3z"/>'
        + '</svg>';
    case 'spectrum':
      // Placeholder: the official Spectrum mark goes here, in its original
      // colours, once the owner supplies a licence-clean SVG (the RSI fankit
      // needs a login). Until then a generic headset glyph in currentColor.
      return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3a9 9 0 0 0-9 9v5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H5a7 7 0 0 1 14 0h-2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-5a9 9 0 0 0-9-9z"/></svg>';
    default:
      return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 4h11a2 2 0 0 1 2 2v11a3 3 0 0 0 3 3H6a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2zm2 4v2h7V8H7zm0 4v2h7v-2H7zm0 4v2h5v-2H7z"/></svg>';
  }
}
