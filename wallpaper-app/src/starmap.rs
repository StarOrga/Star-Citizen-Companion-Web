//! Native constellation wallpaper renderer — a software rasteriser that mirrors
//! the web's reference renderer `src/app/verse/starmap/constellation-render.ts`
//! step for step (same units, same PRNG, same random-number consumption order,
//! same symmetric light order), so the desktop and the website draw the same
//! sky for the same seed.
//!
//!   u   = min(w, h) / 1000
//!   rnd = mulberry32(fnv1a32(seed))   — seed hashed over UTF-16 code units,
//!                                       exactly like `charCodeAt`
//!
//! Pixels are `0x00RRGGBB` (= BGRX bytes, the layout a 32-bpp top-down DIB
//! expects), so a frame can be copied into a DIB section unchanged.
//!
//! Known, deliberate differences to the canvas version: text is drawn with a
//! built-in stroke font (no Rajdhani on the desktop), and gradients blend in
//! 8-bit integer channels (a dither on the background hides the banding).

use std::f64::consts::PI;

// ---------------- Seeded randomness (mirror of starmap.model.ts) ----------------

/// FNV-1a 32-bit over UTF-16 code units — `hashSeed()` in starmap.model.ts.
pub fn hash_seed(text: &str) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for cu in text.encode_utf16() {
        h ^= cu as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

/// mulberry32 → floats in [0, 1). Bit-identical to the TS closure.
#[derive(Clone)]
pub struct Rng(u32);

impl Rng {
    pub fn new(seed: u32) -> Rng {
        Rng(seed)
    }
    pub fn from_text(seed: &str) -> Rng {
        Rng::new(hash_seed(seed))
    }
    pub fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

pub type Point = (f64, f64);

/// The order in which the 7 stars light up — symmetric about the vertical axis
/// through the centroid, never along the outline (`symmetricLightOrder`).
pub fn symmetric_light_order(points: &[Point]) -> Vec<usize> {
    if points.is_empty() {
        return Vec::new();
    }
    let cx = points.iter().map(|p| p.0).sum::<f64>() / points.len() as f64;
    let eps = 1e-6;
    let mut v: Vec<(usize, f64, f64, f64)> =
        points.iter().enumerate().map(|(i, p)| (i, (p.0 - cx).abs(), p.1, p.0)).collect();
    v.sort_by(|a, b| {
        // JS Math.round on a non-negative number == f64::round.
        let ring = (a.1 * 50.0).round() - (b.1 * 50.0).round();
        if ring != 0.0 {
            return ring.partial_cmp(&0.0).unwrap();
        }
        if (a.2 - b.2).abs() > eps {
            return a.2.partial_cmp(&b.2).unwrap();
        }
        a.3.partial_cmp(&b.3).unwrap_or(std::cmp::Ordering::Equal)
    });
    v.into_iter().map(|e| e.0).collect()
}

pub fn lit_indices(points: &[Point], star_count: u32) -> Vec<usize> {
    let n = (star_count as usize).min(points.len());
    symmetric_light_order(points).into_iter().take(n).collect()
}

/// Generated supernova constellation (streak 7) — `supernovaPoints(seed)`.
pub fn supernova_points(seed: &str) -> [Point; 7] {
    let mut rnd = Rng::from_text(&format!("supernova:{seed}"));
    let mut pts = [(0.0, 0.0); 7];
    for (i, p) in pts.iter_mut().enumerate() {
        let a = -PI / 2.0 + (i as f64 / 7.0) * PI * 2.0;
        let r = 0.3 + rnd.next() * 0.18;
        *p = (0.5 + a.cos() * r, 0.5 + a.sin() * r);
    }
    pts
}

// ---------------- Canvas ----------------

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rgba(pub f64, pub f64, pub f64, pub f64);

const fn hex(c: u32, a: f64) -> Rgba {
    Rgba(((c >> 16) & 255) as f64, ((c >> 8) & 255) as f64, (c & 255) as f64, a)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Blend {
    Over,
    Lighter,
}

/// A borrowed pixel surface plus a dirty box (used by the animation to know
/// which rectangles a sprite touched).
pub struct Canvas<'a> {
    pub w: i32,
    pub h: i32,
    pub px: &'a mut [u32],
    pub dirty: Option<(i32, i32, i32, i32)>,
}

impl<'a> Canvas<'a> {
    pub fn new(w: i32, h: i32, px: &'a mut [u32]) -> Canvas<'a> {
        debug_assert_eq!(px.len(), (w * h) as usize);
        Canvas { w, h, px, dirty: None }
    }

    fn mark(&mut self, x0: i32, y0: i32, x1: i32, y1: i32) {
        self.dirty = Some(match self.dirty {
            None => (x0, y0, x1, y1),
            Some((a, b, c, d)) => (a.min(x0), b.min(y0), c.max(x1), d.max(y1)),
        });
    }

    /// Clamp a float box to pixel bounds; `None` when it is off-canvas.
    fn bounds(&mut self, x0: f64, y0: f64, x1: f64, y1: f64) -> Option<(i32, i32, i32, i32)> {
        let bx0 = (x0.floor() as i32).max(0);
        let by0 = (y0.floor() as i32).max(0);
        let bx1 = (x1.ceil() as i32).min(self.w);
        let by1 = (y1.ceil() as i32).min(self.h);
        if bx0 >= bx1 || by0 >= by1 {
            return None;
        }
        self.mark(bx0, by0, bx1, by1);
        Some((bx0, by0, bx1, by1))
    }

    #[inline]
    fn put(&mut self, x: i32, y: i32, c: Rgba, a: f64, mode: Blend) {
        if a <= 0.0 {
            return;
        }
        let i = (y * self.w + x) as usize;
        let d = self.px[i];
        let (dr, dg, db) = (((d >> 16) & 255) as f64, ((d >> 8) & 255) as f64, (d & 255) as f64);
        let a = a.min(1.0);
        let (r, g, b) = match mode {
            Blend::Over => (dr + (c.0 - dr) * a, dg + (c.1 - dg) * a, db + (c.2 - db) * a),
            Blend::Lighter => (dr + c.0 * a, dg + c.1 * a, db + c.2 * a),
        };
        let q = |v: f64| (v.round().clamp(0.0, 255.0)) as u32;
        self.px[i] = (q(r) << 16) | (q(g) << 8) | q(b);
    }

    /// Anti-aliased filled disc.
    pub fn disc(&mut self, cx: f64, cy: f64, r: f64, c: Rgba, alpha: f64, mode: Blend) {
        let r = r.max(0.3);
        let Some((x0, y0, x1, y1)) = self.bounds(cx - r - 1.0, cy - r - 1.0, cx + r + 1.0, cy + r + 1.0) else {
            return;
        };
        for y in y0..y1 {
            for x in x0..x1 {
                let d = ((x as f64 + 0.5 - cx).powi(2) + (y as f64 + 0.5 - cy).powi(2)).sqrt();
                let cov = (r + 0.5 - d).clamp(0.0, 1.0) * r.min(1.0).max(0.3);
                self.put(x, y, c, cov * c.3 * alpha, mode);
            }
        }
    }

    /// Radial gradient inner → outer over radius `r`, filled as a disc
    /// (canvas `createRadialGradient(x,y,0,x,y,r)` + `arc` + `fill`).
    pub fn glow(&mut self, cx: f64, cy: f64, r: f64, inner: Rgba, outer: Rgba, alpha: f64, mode: Blend) {
        if r <= 0.0 {
            return;
        }
        let Some((x0, y0, x1, y1)) = self.bounds(cx - r, cy - r, cx + r, cy + r) else { return };
        for y in y0..y1 {
            let dy = y as f64 + 0.5 - cy;
            for x in x0..x1 {
                let dx = x as f64 + 0.5 - cx;
                let d2 = dx * dx + dy * dy;
                if d2 >= r * r {
                    continue;
                }
                let t = d2.sqrt() / r;
                // Premultiplied interpolation, like the browsers do.
                let a = lerp(inner.3, outer.3, t);
                if a <= 0.0 {
                    continue;
                }
                let mix = |i: f64, o: f64| lerp(i * inner.3, o * outer.3, t) / a;
                let c = Rgba(mix(inner.0, outer.0), mix(inner.1, outer.1), mix(inner.2, outer.2), a);
                self.put(x, y, c, a * alpha, mode);
            }
        }
    }

    /// Anti-aliased line segment of width `lw`. `fade` > 0 fades alpha from
    /// the start (full) to the end (`1 - fade`), used for meteor tails.
    #[allow(clippy::too_many_arguments)]
    pub fn line(&mut self, x0: f64, y0: f64, x1: f64, y1: f64, lw: f64, c: Rgba, alpha: f64, fade: f64, mode: Blend) {
        let hw = (lw / 2.0).max(0.35);
        let pad = hw + 1.0;
        let Some((bx0, by0, bx1, by1)) =
            self.bounds(x0.min(x1) - pad, y0.min(y1) - pad, x0.max(x1) + pad, y0.max(y1) + pad)
        else {
            return;
        };
        let (vx, vy) = (x1 - x0, y1 - y0);
        let len2 = (vx * vx + vy * vy).max(1e-9);
        let thin = (lw).min(1.0).max(0.35); // sub-pixel lines → less coverage
        for y in by0..by1 {
            for x in bx0..bx1 {
                let (px, py) = (x as f64 + 0.5 - x0, y as f64 + 0.5 - y0);
                let t = ((px * vx + py * vy) / len2).clamp(0.0, 1.0);
                let (ex, ey) = (px - vx * t, py - vy * t);
                let d = (ex * ex + ey * ey).sqrt();
                let cov = (hw + 0.5 - d).clamp(0.0, 1.0) * if lw < 1.0 { thin } else { 1.0 };
                if cov > 0.0 {
                    self.put(x, y, c, cov * c.3 * alpha * (1.0 - fade * t), mode);
                }
            }
        }
    }

    /// Dashed polyline; the dash phase carries across vertices like canvas.
    fn dashed(&mut self, pts: &[Point], lw: f64, dash: f64, gap: f64, c: Rgba) {
        let period = dash + gap;
        let mut phase = 0.0;
        for seg in pts.windows(2) {
            let (a, b) = (seg[0], seg[1]);
            let len = ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt();
            let mut s = 0.0;
            while s < len {
                let in_period = (phase + s) % period;
                if in_period < dash {
                    let e = (s + (dash - in_period).max(1e-3)).min(len);
                    let p = |k: f64| (a.0 + (b.0 - a.0) * k / len, a.1 + (b.1 - a.1) * k / len);
                    let (p0, p1) = (p(s), p(e));
                    self.line(p0.0, p0.1, p1.0, p1.1, lw, c, 1.0, 0.0, Blend::Over);
                    s = e;
                } else {
                    s += (period - in_period).max(1e-3);
                }
            }
            phase = (phase + len) % period;
        }
    }

    /// Stroke-font text, left-aligned, baseline at `y` (fillText semantics).
    pub fn text(&mut self, s: &str, x: f64, y: f64, size: f64, c: Rgba, alpha: f64) {
        let cap = size * 0.68;
        let lw = (size * 0.1).max(0.6);
        let mut pen = x;
        for ch in s.chars() {
            let (adv, strokes) = glyph(ch);
            let gw = size * 0.38;
            let top = y - cap;
            for stroke in strokes {
                if stroke.len() == 1 {
                    let (gx, gy) = stroke[0];
                    self.disc(pen + gx * gw, top + gy * cap, lw * 0.7, c, alpha, Blend::Over);
                }
                for w in stroke.windows(2) {
                    let (a, b) = (w[0], w[1]);
                    self.line(pen + a.0 * gw, top + a.1 * cap, pen + b.0 * gw, top + b.1 * cap, lw, c, alpha, 0.0, Blend::Over);
                }
            }
            pen += size * adv;
        }
    }
}

/// Angular stroke glyphs (x, y in 0..1 of the glyph box, y down). Only what
/// the wallpaper writes: patch numbers and the "SCC" hint.
fn glyph(ch: char) -> (f64, &'static [&'static [(f64, f64)]]) {
    const ZERO: &[&[(f64, f64)]] = &[&[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0), (0.0, 0.0)]];
    const ONE: &[&[(f64, f64)]] = &[&[(0.25, 0.2), (0.6, 0.0), (0.6, 1.0)]];
    const TWO: &[&[(f64, f64)]] = &[&[(0.0, 0.0), (1.0, 0.0), (1.0, 0.5), (0.0, 0.5), (0.0, 1.0), (1.0, 1.0)]];
    const THREE: &[&[(f64, f64)]] = &[&[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)], &[(0.2, 0.5), (1.0, 0.5)]];
    const FOUR: &[&[(f64, f64)]] = &[&[(0.0, 0.0), (0.0, 0.55), (1.0, 0.55)], &[(0.8, 0.0), (0.8, 1.0)]];
    const FIVE: &[&[(f64, f64)]] = &[&[(1.0, 0.0), (0.0, 0.0), (0.0, 0.5), (1.0, 0.5), (1.0, 1.0), (0.0, 1.0)]];
    const SIX: &[&[(f64, f64)]] = &[&[(1.0, 0.0), (0.0, 0.0), (0.0, 1.0), (1.0, 1.0), (1.0, 0.5), (0.0, 0.5)]];
    const SEVEN: &[&[(f64, f64)]] = &[&[(0.0, 0.0), (1.0, 0.0), (0.4, 1.0)]];
    const EIGHT: &[&[(f64, f64)]] = &[&[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0), (0.0, 0.0)], &[(0.0, 0.5), (1.0, 0.5)]];
    const NINE: &[&[(f64, f64)]] = &[&[(1.0, 0.5), (0.0, 0.5), (0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]];
    const DOT: &[&[(f64, f64)]] = &[&[(0.3, 1.0)]];
    const C: &[&[(f64, f64)]] = &[&[(1.0, 0.0), (0.0, 0.0), (0.0, 1.0), (1.0, 1.0)]];
    match ch {
        '0' => (0.52, ZERO),
        '1' => (0.52, ONE),
        '2' => (0.52, TWO),
        '3' => (0.52, THREE),
        '4' => (0.52, FOUR),
        '5' | 'S' => (0.52, FIVE),
        '6' => (0.52, SIX),
        '7' => (0.52, SEVEN),
        '8' => (0.52, EIGHT),
        '9' => (0.52, NINE),
        '.' => (0.26, DOT),
        'C' => (0.52, C),
        _ => (0.3, &[]),
    }
}

// ---------------- The wallpaper ----------------

#[derive(Clone, Debug, PartialEq)]
pub struct RenderConstellation {
    pub patch_line: String,
    pub points: Vec<Point>,
    pub star_count: u32,
    pub sun: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RenderOptions {
    pub width: i32,
    pub height: i32,
    pub seed: String,
    /// Newest first; `[0]` is drawn large. At most 7 are drawn.
    pub constellations: Vec<RenderConstellation>,
    pub nebula: bool,
    pub road: bool,
    pub supernova: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BoxF {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

fn place_box(cx: f64, cy: f64, size: f64) -> BoxF {
    BoxF { x: cx - size / 2.0, y: cy - size / 2.0, w: size, h: size }
}

fn map_point(p: Point, b: &BoxF) -> Point {
    (b.x + p.0 * b.w, b.y + p.1 * b.h)
}

/// `constellationBoxes()`.
pub fn constellation_boxes(w: f64, h: f64, count: usize) -> Vec<BoxF> {
    let short = w.min(h);
    let mut boxes = Vec::new();
    if count > 0 {
        boxes.push(place_box(w * 0.4, h * 0.52, short * 0.62));
    }
    for k in 0..count.saturating_sub(1).min(6) {
        let k = k as f64;
        boxes.push(place_box(w * 0.8 + (k * 0.9).sin() * w * 0.06, h * 0.18 + k * h * 0.13, short * 0.17));
    }
    boxes
}

pub fn centroid(points: &[Point], b: &BoxF) -> Point {
    if points.is_empty() {
        return (b.x + b.w / 2.0, b.y + b.h / 2.0);
    }
    let n = points.len() as f64;
    let sx = points.iter().map(|p| p.0).sum::<f64>() / n;
    let sy = points.iter().map(|p| p.1).sum::<f64>() / n;
    map_point((sx, sy), b)
}

/// Where the animation layer may play: the large constellation's stars, its
/// centre (meteor radiant) and the twinkle field.
#[derive(Clone, Debug, PartialEq)]
pub struct Layout {
    pub u: f64,
    pub stars: Vec<Point>,
    pub radiant: Point,
    pub sun: Option<Point>,
}

fn hsl(h: f64, s: f64, l: f64) -> (f64, f64, f64) {
    let h = h.rem_euclid(360.0) / 360.0;
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    let f = |mut t: f64| {
        t = t.rem_euclid(1.0);
        let v = if t < 1.0 / 6.0 {
            p + (q - p) * 6.0 * t
        } else if t < 0.5 {
            q
        } else if t < 2.0 / 3.0 {
            p + (q - p) * (2.0 / 3.0 - t) * 6.0
        } else {
            p
        };
        v * 255.0
    };
    (f(h + 1.0 / 3.0), f(h), f(h - 1.0 / 3.0))
}

fn star_color(t: f64) -> Rgba {
    if t < 0.15 {
        hex(0xffe2b8, 1.0)
    } else if t < 0.3 {
        hex(0xbcd4ff, 1.0)
    } else {
        hex(0xffffff, 1.0)
    }
}

fn background(c: &mut Canvas, rnd_dither: &mut u32) {
    let (w, h) = (c.w as f64, c.h as f64);
    let stops = [(0.0, hex(0x03050c, 1.0)), (0.55, hex(0x070b1a, 1.0)), (1.0, hex(0x02030a, 1.0))];
    let r = (w * w + h * h).sqrt() / 2.0;
    let (r0, r1) = (r * 0.35, r);
    for y in 0..c.h {
        let t = (y as f64 + 0.5) / h;
        let (a, b, k) = if t < 0.55 { (stops[0].1, stops[1].1, t / 0.55) } else { (stops[1].1, stops[2].1, (t - 0.55) / 0.45) };
        let base = (lerp(a.0, b.0, k), lerp(a.1, b.1, k), lerp(a.2, b.2, k));
        let dy = y as f64 + 0.5 - h / 2.0;
        for x in 0..c.w {
            let dx = x as f64 + 0.5 - w / 2.0;
            let d = (dx * dx + dy * dy).sqrt();
            let v = ((d - r0) / (r1 - r0)).clamp(0.0, 1.0) * 0.55;
            // Tiny xorshift dither: ±0.5 LSB, hides 8-bit banding in the dark ramp.
            *rnd_dither ^= *rnd_dither << 13;
            *rnd_dither ^= *rnd_dither >> 17;
            *rnd_dither ^= *rnd_dither << 5;
            let n = (*rnd_dither as f64 / u32::MAX as f64) - 0.5;
            let q = |ch: f64| ((ch * (1.0 - v)) + n).round().clamp(0.0, 255.0) as u32;
            c.px[(y * c.w + x) as usize] = (q(base.0) << 16) | (q(base.1) << 8) | q(base.2);
        }
    }
    c.mark(0, 0, c.w, c.h);
}

fn draw_constellation(c: &mut Canvas, k: &RenderConstellation, b: &BoxF, u: f64, large: bool) {
    let pts: Vec<Point> = k.points.iter().map(|p| map_point(*p, b)).collect();
    let lit = lit_indices(&k.points, k.star_count);
    let any_lit = !lit.is_empty();
    if pts.len() > 1 {
        let col = Rgba(150.0, 190.0, 255.0, if any_lit { 0.42 } else { 0.14 });
        let lw = if large { 1.6 } else { 0.8 } * u;
        for i in 0..pts.len() {
            let (a, z) = (pts[i], pts[(i + 1) % pts.len()]);
            c.line(a.0, a.1, z.0, z.1, lw, col, 1.0, 0.0, Blend::Over);
        }
    }
    let s = if large { 1.0 } else { 0.45 };
    for (i, &(x, y)) in pts.iter().enumerate() {
        if lit.contains(&i) {
            c.glow(x, y, 3.2 * 9.0 * s * u, Rgba(255.0, 255.0, 255.0, 0.9), Rgba(120.0, 170.0, 255.0, 0.0), 1.0, Blend::Over);
            c.disc(x, y, 3.2 * s * u, hex(0xffffff, 1.0), 1.0, Blend::Over);
        } else {
            c.disc(x, y, 2.2 * s * u, Rgba(200.0, 215.0, 255.0, 0.28), 1.0, Blend::Over);
        }
    }
    if k.sun {
        let (sx, sy) = sun_pos(b);
        let core = if large { 16.0 } else { 4.0 } * u;
        let corona = core * if large { 9.0 } else { 5.0 };
        c.glow(sx, sy, corona, Rgba(255.0, 214.0, 140.0, 0.55), Rgba(255.0, 170.0, 80.0, 0.0), 1.0, Blend::Over);
        c.glow(sx, sy, core * 1.6, hex(0xfff6e0, 1.0), Rgba(255.0, 220.0, 150.0, 0.2), 1.0, Blend::Over);
        c.disc(sx, sy, core, hex(0xfff3d6, 1.0), 1.0, Blend::Over);
    }
}

fn sun_pos(b: &BoxF) -> Point {
    (b.x + b.w * 1.02, b.y - b.h * 0.02)
}

/// Draw the static wallpaper into `px` (len = w·h). Deterministic for equal
/// options. Returns the layout the animation layer builds on.
pub fn render_into(px: &mut [u32], o: &RenderOptions) -> Layout {
    let (w, h) = (o.width as f64, o.height as f64);
    let u = w.min(h) / 1000.0;
    let mut rnd = Rng::from_text(&o.seed);
    let mut c = Canvas::new(o.width, o.height, px);
    let mut dither = hash_seed(&o.seed) | 1;

    // 1 — background + vignette.
    background(&mut c, &mut dither);

    // 2 — nebula ('lighter').
    let (blobs, na) = if o.nebula { (7, 0.16) } else { (4, 0.1) };
    for _ in 0..blobs {
        let x = rnd.next() * w;
        let y = rnd.next() * h;
        let r = lerp(180.0, 480.0, rnd.next()) * u;
        let base = if rnd.next() < 0.5 { 205.0 } else { 265.0 };
        let hue = (base + (rnd.next() - 0.5) * 50.0).round();
        let (cr, cg, cb) = hsl(hue, 0.7, 0.45);
        c.glow(x, y, r, Rgba(cr, cg, cb, na), Rgba(cr, cg, cb, 0.0), 1.0, Blend::Lighter);
    }

    // 3 — starfield, three layers.
    let area = (w / u) * (h / u) / 1e6;
    let layers: [(f64, (f64, f64), (f64, f64), bool); 3] = [
        (1400.0, (0.35, 0.9), (0.25, 0.6), false),
        (420.0, (0.8, 1.6), (0.45, 0.85), false),
        (60.0, (1.4, 2.6), (0.8, 1.0), true),
    ];
    for (n, rr, aa, near) in layers {
        let count = (n * area).round() as usize;
        for _ in 0..count {
            let x = rnd.next() * w;
            let y = rnd.next() * h;
            let r = lerp(rr.0, rr.1, rnd.next()) * u;
            let alpha = lerp(aa.0, aa.1, rnd.next());
            let col = star_color(rnd.next());
            if near {
                c.glow(x, y, r * 6.0, Rgba(190.0, 210.0, 255.0, 0.35), Rgba(190.0, 210.0, 255.0, 0.0), alpha, Blend::Over);
                let lw = (u * 0.4).max(0.5);
                c.line(x - r * 10.0, y, x + r * 10.0, y, lw, col, alpha * 0.35, 0.0, Blend::Over);
                c.line(x, y - r * 10.0, x, y + r * 10.0, lw, col, alpha * 0.35, 0.0, Blend::Over);
            }
            c.disc(x, y, r, col, alpha, Blend::Over);
        }
    }

    // 4 — road through the centroids, oldest → newest.
    let list: Vec<&RenderConstellation> = o.constellations.iter().take(7).collect();
    let boxes = constellation_boxes(w, h, list.len());
    if o.road && list.len() > 1 {
        let mut cs: Vec<Point> = list.iter().zip(&boxes).map(|(k, b)| centroid(&k.points, b)).collect();
        cs.reverse();
        c.dashed(&cs, 1.2 * u, 6.0 * u, 10.0 * u, Rgba(180.0, 200.0, 255.0, 0.16));
    }

    // 5 — constellations.
    for (i, (k, b)) in list.iter().zip(&boxes).enumerate() {
        draw_constellation(&mut c, k, b, u, i == 0);
    }

    // 6 — supernova burst + the subtle SCC hint.
    if o.supernova && !list.is_empty() {
        let (cx, cy) = centroid(&list[0].points, &boxes[0]);
        c.glow(cx, cy, 340.0 * u, Rgba(255.0, 90.0, 200.0, 0.18), Rgba(255.0, 90.0, 200.0, 0.0), 1.0, Blend::Lighter);
        c.glow(cx, cy, 160.0 * u, Rgba(255.0, 170.0, 230.0, 0.35), Rgba(255.0, 170.0, 230.0, 0.0), 1.0, Blend::Lighter);
        c.glow(cx, cy, 46.0 * u, Rgba(255.0, 250.0, 240.0, 0.95), Rgba(255.0, 230.0, 200.0, 0.0), 1.0, Blend::Lighter);
        for i in 0..28 {
            let a = (i as f64 / 28.0) * PI * 2.0;
            let len = lerp(90.0, 260.0, rnd.next()) * u;
            c.line(cx + a.cos() * 30.0 * u, cy + a.sin() * 30.0 * u, cx + a.cos() * len, cy + a.sin() * len, 0.9 * u, Rgba(255.0, 220.0, 240.0, 0.22), 1.0, 0.0, Blend::Lighter);
        }
        c.text("SCC", cx + 120.0 * u, cy + 150.0 * u, 18.0 * u, hex(0xffffff, 1.0), 0.06);
    }

    // 7 — watermark: the patch number beside the first lit star.
    let mut layout = Layout { u, stars: Vec::new(), radiant: (w * 0.4, h * 0.52), sun: None };
    if let (Some(k), Some(b)) = (list.first(), boxes.first()) {
        if !k.points.is_empty() {
            let lit = lit_indices(&k.points, k.star_count);
            let anchor = map_point(k.points[lit.iter().copied().min().unwrap_or(0)], b);
            if !k.patch_line.is_empty() {
                c.text(&k.patch_line, anchor.0 + 14.0 * u, anchor.1 + 10.0 * u, 14.0 * u, hex(0xdfe8ff, 1.0), 0.07);
            }
            layout.stars = lit.iter().map(|&i| map_point(k.points[i], b)).collect();
            layout.radiant = centroid(&k.points, b);
            layout.sun = k.sun.then(|| sun_pos(b));
        }
    }
    layout
}

pub fn render(o: &RenderOptions) -> (Vec<u32>, Layout) {
    let mut px = vec![0u32; (o.width.max(1) * o.height.max(1)) as usize];
    let layout = render_into(&mut px, o);
    (px, layout)
}

/// Largest render the app produces: 4K. Bigger monitors scale down
/// proportionally (Windows stretches the file to fill), smaller ones render
/// natively.
pub fn clamp_to_4k(w: u32, h: u32) -> (i32, i32) {
    let (w, h) = (w.max(320), h.max(200));
    let max = 3840.0 * 2160.0;
    let px = w as f64 * h as f64;
    if px <= max {
        return (w as i32, h as i32);
    }
    let k = (max / px).sqrt();
    ((w as f64 * k).floor() as i32, (h as f64 * k).floor() as i32)
}

/// 24-bit bottom-up BMP — what `SPI_SETDESKWALLPAPER` accepts on every build.
pub fn encode_bmp(px: &[u32], w: i32, h: i32) -> Vec<u8> {
    let row = ((w as usize * 3) + 3) & !3;
    let size = 54 + row * h as usize;
    let mut out = Vec::with_capacity(size);
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&(size as u32).to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&54u32.to_le_bytes());
    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&w.to_le_bytes());
    out.extend_from_slice(&h.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&24u16.to_le_bytes());
    out.extend_from_slice(&[0u8; 24]);
    let pad = row - w as usize * 3;
    for y in (0..h).rev() {
        for x in 0..w {
            let p = px[(y * w + x) as usize];
            out.extend_from_slice(&[(p & 255) as u8, ((p >> 8) & 255) as u8, ((p >> 16) & 255) as u8]);
        }
        out.extend(std::iter::repeat(0u8).take(pad));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(seed: &str, w: i32, h: i32) -> RenderOptions {
        RenderOptions {
            width: w,
            height: h,
            seed: seed.into(),
            constellations: vec![
                RenderConstellation {
                    patch_line: "4.4".into(),
                    points: vec![(0.5, 0.08), (0.36, 0.38), (0.64, 0.38), (0.14, 0.62), (0.86, 0.62), (0.4, 0.9), (0.6, 0.9)],
                    star_count: 7,
                    sun: true,
                },
                RenderConstellation {
                    patch_line: "4.3".into(),
                    points: supernova_points("4.3").to_vec(),
                    star_count: 3,
                    sun: true,
                },
            ],
            nebula: true,
            road: true,
            supernova: false,
        }
    }

    #[test]
    fn hash_and_prng_match_the_typescript_reference() {
        // FNV-1a("") is the offset basis; "a" is the published test vector.
        assert_eq!(hash_seed(""), 0x811c9dc5);
        assert_eq!(hash_seed("a"), 0xe40c292c);
        // mulberry32(0) first output, as computed by the TS closure.
        let mut r = Rng::new(0);
        let first = r.next();
        assert!((first - 0.26642920868471265).abs() < 1e-15, "{first}");
        let mut r = Rng::from_text("4.4");
        assert!((r.next() - 0.9477335806004703).abs() < 1e-15);
    }

    #[test]
    fn light_order_is_symmetric_axis_first() {
        let pts = [(0.5, 0.08), (0.36, 0.38), (0.64, 0.38), (0.14, 0.62), (0.86, 0.62), (0.4, 0.9), (0.6, 0.9)];
        // Nose first, then mirrored pairs inside → out.
        assert_eq!(symmetric_light_order(&pts), vec![0, 5, 6, 1, 2, 3, 4]);
        assert_eq!(lit_indices(&pts, 3), vec![0, 5, 6]);
        assert_eq!(lit_indices(&pts, 99).len(), 7);
    }

    #[test]
    fn render_is_deterministic_per_seed() {
        let (a, la) = render(&opts("4.4", 160, 90));
        let (b, lb) = render(&opts("4.4", 160, 90));
        assert_eq!(a, b);
        assert_eq!(la, lb);
        let (c, _) = render(&opts("4.3", 160, 90));
        assert_ne!(a, c, "another seed draws another sky");
        assert_eq!(la.stars.len(), 7);
        assert!(la.sun.is_some());
    }

    #[test]
    fn supernova_changes_the_image_and_is_seeded() {
        let mut o = opts("4.4", 120, 80);
        let (plain, _) = render(&o);
        o.supernova = true;
        let (nova, _) = render(&o);
        assert_ne!(plain, nova);
        assert_eq!(supernova_points("4.4"), supernova_points("4.4"));
        assert_ne!(supernova_points("4.4"), supernova_points("4.5"));
    }

    #[test]
    fn boxes_follow_the_reference_layout() {
        let b = constellation_boxes(1920.0, 1080.0, 9);
        assert_eq!(b.len(), 7, "current + max 6 older");
        assert!((b[0].w - 1080.0 * 0.62).abs() < 1e-9);
        assert!((b[0].x + b[0].w / 2.0 - 768.0).abs() < 1e-9);
    }

    #[test]
    fn clamp_keeps_4k_and_scales_bigger() {
        assert_eq!(clamp_to_4k(1920, 1080), (1920, 1080));
        assert_eq!(clamp_to_4k(3840, 2160), (3840, 2160));
        let (w, h) = clamp_to_4k(7680, 4320);
        assert_eq!((w, h), (3840, 2160));
    }

    #[test]
    fn bmp_header_and_size() {
        let px = vec![0x00112233u32; 3 * 2];
        let bmp = encode_bmp(&px, 3, 2);
        assert_eq!(&bmp[0..2], b"BM");
        assert_eq!(bmp.len(), 54 + 12 * 2);
        assert_eq!(&bmp[54..57], &[0x33, 0x22, 0x11]);
    }
}

#[cfg(test)]
mod preview {
    use super::*;

    /// Manual visual check: `STARMAP_PREVIEW=<dir> cargo test --release -- --ignored preview`.
    #[test]
    #[ignore]
    fn preview_4k() {
        let Ok(dir) = std::env::var("STARMAP_PREVIEW") else { return };
        let ship = vec![(0.5, 0.05), (0.38, 0.35), (0.62, 0.35), (0.12, 0.66), (0.88, 0.66), (0.42, 0.95), (0.58, 0.95)];
        let older = |l: &str, n: u32, sun: bool| RenderConstellation { patch_line: l.into(), points: supernova_points(l).to_vec(), star_count: n, sun };
        for (name, nova) in [("patch", false), ("supernova", true)] {
            let mut list = vec![RenderConstellation { patch_line: "4.4".into(), points: ship.clone(), star_count: 7, sun: true }];
            if nova {
                list[0].points = supernova_points("4.4").to_vec();
                list[0].sun = false;
            }
            list.extend([older("4.3", 7, true), older("4.2", 4, false), older("4.1", 2, true)]);
            let o = RenderOptions { width: 3840, height: 2160, seed: "4.4".into(), constellations: list, nebula: true, road: true, supernova: nova };
            let t0 = std::time::Instant::now();
            let (px, _) = render(&o);
            eprintln!("{name}: 3840x2160 in {} ms", t0.elapsed().as_millis());
            std::fs::write(format!("{dir}/{name}.bmp"), encode_bmp(&px, 3840, 2160)).unwrap();
        }
    }
}
