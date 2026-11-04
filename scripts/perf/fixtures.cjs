// Plausible backend answers for scripts/perf/profile-startup.cjs (no real backend in the loop).
const day = 86400e3, now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const img = (i) => `https://media.robertsspaceindustries.com/fixture${i}/source.jpg`;
const channels = ['comm-link', 'youtube', 'spectrum', 'patch'];
const src = { 'comm-link': 'comm-link', youtube: 'youtube', spectrum: 'spectrum', patch: 'patch-notes' };
const news = [];
for (let i = 0; i < 80; i++) {
  const ch = channels[i % 4];
  const title = ch === 'patch' ? `Star Citizen Alpha 4.${3 + (i % 3)}.${i % 5} PTU Patch Notes` : `Fixture story ${i}: Into the verse with a longer headline that wraps`;
  news.push({ id: `n${i}`, title, url: `https://robertsspaceindustries.com/comm-link/${i}`, publishedAt: iso(now - i * 0.4 * day), channel: ch,
    summary: 'A plausible summary sentence for the fixture item so the cards have their usual height and text wrap.',
    thumbnail: img(i), images: [img(i), img(i + 100)], category: 'Transmission', source: src[ch] });
}
const feed = { status: { overall: 'operational', label: 'All Systems Operational', components: [
  { name: 'Platform', status: 'operational' }, { name: 'Persistent Universe', status: 'operational' }, { name: 'Arena Commander', status: 'operational' }],
  updatedAt: iso(now) }, news, fetchedAt: iso(now) };
const digest = { generated_at: iso(now), suggested: 5,
  items: [0, 1, 2, 3, 4].map((i) => ({ key: `news:n${i}`, kind: i === 1 ? 'patch' : 'news', title: news[i].title, url: `/verse/news/n${i}`, summary: news[i].summary, image: img(i), at: news[i].publishedAt, pinned: i === 0, score: 10 - i, rank: i + 1 })),
  patch: { line: '4.4', live_at: iso(now - 9 * day), channels: { live: '4.4.0', ptu: '4.5.0' }, channel_info: {}, status: 'live' },
  counts: { news: { recent: 12, total: 80 }, patches: { recent: 2, total: 20 }, gallery: { recent: 4, total: 60 } } };
const wallpapers = Array.from({ length: 24 }, (_, i) => ({ id: `w${i}`, title: `Wallpaper ${i}`, image_url: img(200 + i), thumb_url: img(300 + i), width: 3840, height: 2160, created_at: iso(now - i * day) }));
const build = { id: 'b1', channel: 'LIVE', patch_version: '4.4.0', build_number: 10001, schema_version: 3, quality_score: 0.97, tool_version: '1.0', entity_counts: { ships: 220, components: 3100 }, is_current: true, extracted_at: iso(now - 5 * day) };
module.exports = { feed, digest, wallpapers, build };
