/**
 * GLSL (WebGL 1) for the stage's living bodies. Both shaders draw one square
 * viewport: the body is centred, `uRes` is its size in device pixels.
 *
 * Light is fixed in view space (top right, towards the viewer — where the sun
 * beacon stands); only the surface turns under it, so terminator, glint and
 * rim stay put while the world rotates.
 */

export const VS = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';

/** Hash / value noise / fbm in 3D, shared by both fragment shaders. */
const NOISE = `
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
`;

/**
 * Planet: equirect day / night / cloud maps on a ray-cast sphere. With
 * OES_standard_derivatives (`DERIV`) the date line is sampled the Tarini way so
 * the maps can carry mipmaps without a seam.
 */
export const PLANET_FS = (deriv: boolean) => `
${deriv ? '#extension GL_OES_standard_derivatives : enable\n#define DERIV 1' : ''}
precision highp float;
uniform vec2 uRes; uniform vec3 uSun; uniform vec3 uAtm; uniform vec3 uCloudC;
uniform float uRot, uCloudRot, uRoll, uSpec, uNight, uCloudK, uTraffic, uTime;
uniform sampler2D tDay, tNight, tCloud;
const float PI = 3.14159265;
${NOISE}
float wrapU(float lon){
  float u = fract(lon + 0.5);
#ifdef DERIV
  float u2 = fract(lon + 1.0) - 0.5;
  u = fwidth(u) < fwidth(u2) - 0.001 ? u : u2;
#endif
  return u;
}
void main(){
  vec2 d = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  float r = length(d);
  float cover = clamp((1.0 - r) * uRes.x * 0.5 + 0.5, 0.0, 1.0);
  if (cover <= 0.0) { gl_FragColor = vec4(0.0); return; }
  d *= min(1.0, 0.9995 / max(r, 1e-4));
  vec3 n = vec3(d, sqrt(max(0.0, 1.0 - dot(d, d))));
  // View → body: undo the roll (axis tilt in the picture), lean the north pole
  // a little towards the viewer, then the spin.
  float co = cos(uRoll), so = sin(uRoll);
  vec3 m = vec3(n.x * co + n.y * so, -n.x * so + n.y * co, n.z);
  const float LEAN = 0.2;
  vec3 q = vec3(m.x, m.y * cos(LEAN) - m.z * sin(LEAN), m.y * sin(LEAN) + m.z * cos(LEAN));
  float lat = asin(clamp(q.y, -1.0, 1.0));
  float lon = atan(q.x, q.z) / (2.0 * PI);
  vec2 uv = vec2(wrapU(lon + uRot), 0.5 - lat / PI);
  // Towards the poles the equirect maps pinch; sample them blurrier there
  // (mip bias) so no fans or streaks show.
  float pole = smoothstep(0.8, 0.98, abs(q.y));
  float bias = pole * 5.0;
  vec3 day = texture2D(tDay, uv, bias).rgb;
  vec3 lights = texture2D(tNight, uv, bias).rgb * (1.0 - 0.7 * pole);
  float cl = uCloudK > 0.0 ? texture2D(tCloud, vec2(wrapU(lon + uCloudRot), uv.y), bias).r * uCloudK : 0.0;

  float ndl = dot(n, uSun);
  float dayK = smoothstep(-0.16, 0.34, ndl);
  float nightK = 1.0 - smoothstep(-0.14, 0.06, ndl);
  float lit = dayK * (0.5 + 0.5 * clamp(ndl, 0.0, 1.0)) + 0.16 * pow(max(ndl, 0.0), 6.0);
  float limb = mix(0.6, 1.0, pow(n.z, 0.45));
  vec3 col = mix(day, uCloudC, cl) * lit * limb;
  // Fixed glint (ice, sea): stays where the sun puts it while the world turns.
  vec3 hv = normalize(uSun + vec3(0.0, 0.0, 1.0));
  col += vec3(1.0) * pow(max(dot(n, hv), 0.0), 38.0) * uSpec * (1.0 - 0.6 * cl) * dayK;

  // Night: city lights twinkle a little; on ArcCorp traffic runs the avenues.
  float tw = 0.82 + 0.36 * noise(vec3(uv * vec2(1400.0, 700.0), uTime * 1.5));
  vec3 night = lights * tw * uNight * (1.0 - 0.7 * cl);
  if (uTraffic > 0.0) {
    float mu = uv.x * 22.5, pv = uv.y * 12.0;
    float onM = 1.0 - smoothstep(0.0, 0.045, abs(fract(mu + 0.5) - 0.5));
    float onP = 1.0 - smoothstep(0.0, 0.07, abs(fract(pv + 0.5) - 0.5));
    float laneM = floor(mu + 0.5), laneP = floor(pv + 0.5);
    float pulseM = smoothstep(0.8, 1.0, fract(uv.y * 26.0 + uTime * (0.05 + 0.04 * hash(vec3(laneM, 1.0, 2.0))) * (mod(laneM, 2.0) * 2.0 - 1.0)));
    float pulseP = smoothstep(0.8, 1.0, fract(uv.x * 70.0 + uTime * (0.03 + 0.03 * hash(vec3(laneP, 3.0, 4.0))) * (mod(laneP, 2.0) * 2.0 - 1.0)));
    // No traffic near the poles, where the lanes would bunch into rings.
    float tr = max(onM * pulseM, onP * pulseP) * uTraffic * (1.0 - smoothstep(0.55, 0.8, abs(q.y)));
    night += vec3(1.0, 0.86, 0.62) * tr * 1.4;
    col += vec3(1.0, 0.9, 0.75) * tr * 0.18 * dayK;
  }
  col += (night + day * 0.025) * nightK;

  // Atmosphere: scattering towards the limb, brightest on the sun side.
  vec2 nd = normalize(n.xy + 1e-5);
  float sunSide = smoothstep(-0.35, 0.65, dot(nd, normalize(uSun.xy)));
  float fr = pow(1.0 - n.z, 3.0);
  col = mix(col, uAtm, fr * 0.6 * sunSide);
  col += uAtm * pow(1.0 - n.z, 9.0) * 0.55 * sunSide;
  gl_FragColor = vec4(col * cover, cover);
}`;

/** Prominence table: limb angle, cycle seconds, phase offset, max height (disc radii), eruptive. */
export const PROMINENCES: readonly (readonly [number, number, number, number, number])[] = [
  [0.55, 11.0, 0.10, 0.34, 0],
  [1.70, 15.5, 0.55, 0.26, 0],
  [2.65, 9.5, 0.30, 0.22, 0],
  [3.55, 19.0, 0.80, 0.70, 1],
  [4.40, 13.0, 0.45, 0.30, 0],
  [5.45, 23.0, 0.05, 0.85, 1],
  [6.05, 8.5, 0.70, 0.18, 0],
];

/**
 * Sun: a boiling, limb-darkened photosphere with a slowly turning spot group,
 * flames streaming out of the chromosphere, a corona, prominences that rise as
 * plasma loops (material flows along them), hang and fade — some erupt and
 * tear off outwards — and now and then a flare flash on the limb.
 */
export const SUN_FS = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uR;
const float PI = 3.14159265;
${NOISE}
vec3 promColor(float a, float h, float t){
  vec3 c = vec3(0.0);
${PROMINENCES.map(([ang, per, off, hmax, erupt], k) => `  {
    float ph = fract(t / ${per.toFixed(2)} + ${off.toFixed(2)});
    float life = smoothstep(0.0, 0.12, ph) * (1.0 - smoothstep(${erupt ? '0.55, 0.95' : '0.7, 1.0'}, ph));
    float da = a - ${ang.toFixed(2)} - 0.04 * sin(t * 0.05 + ${k}.0);
    da = mod(da + PI, 2.0 * PI) - PI;
    float w = ${(0.1 + 0.035 * ((k * 7) % 3)).toFixed(3)};
    float H = mix(0.04, ${hmax.toFixed(2)}, smoothstep(0.0, ${erupt ? '0.8' : '0.45'}, ph));
    float lift = ${erupt ? 'max(0.0, ph - 0.45) * 0.9' : '0.0'};
    float x = da + 0.035 * (noise(vec3(h * 9.0, ${k}.0, t * 0.35)) - 0.5);
    float y = h - lift + 0.025 * (noise(vec3(da * 12.0, ${k}.0 + 5.0, t * 0.3)) - 0.5);
    vec2 e = vec2(x / w, y / H);
    float rr = length(e);
    float dist = abs(rr - 1.0) * min(w, H);
    float s = atan(e.y, e.x);
    float flow = 0.45 + 0.55 * noise(vec3(s * 6.0 - t * 1.4, ${k}.0 * 3.1, t * 0.2));
    float th = 0.010 + 0.012 * noise(vec3(s * 4.0, t * 0.5, ${k}.0));
    float on = step(-0.02, y) * ${erupt ? '(1.0 - smoothstep(0.0, 0.3, lift) * (1.0 - smoothstep(0.25, 0.9, e.y / max(rr, 1e-3))))' : '1.0'};
    float core = exp(-pow(dist / th, 2.0)) * flow;
    float halo = exp(-dist / 0.045) * 0.22;
    float inner = exp(-pow(abs(rr - 0.72) * min(w, H) / (th * 0.7), 2.0)) * 0.5 * flow;
    c += (vec3(1.0, 0.36, 0.13) * (core + inner) * 1.7 + vec3(1.0, 0.55, 0.25) * halo) * life * on * step(-0.01, h);
  }`).join('\n')}
  return c;
}
void main(){
  vec2 p = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  float pl = length(p);
  float r = pl / uR;
  float a = atan(p.y, p.x);
  vec2 dir = p / max(pl, 1e-4);
  float t = uTime;
  float px = 2.0 / (uRes.x * uR);

  // Photosphere.
  vec3 disc = vec3(0.0);
  float cover = clamp((1.0 - r) / px + 0.5, 0.0, 1.0);
  if (cover > 0.0) {
    vec2 q = p / uR * min(1.0, 0.9995 / max(r, 1e-4));
    float mu = sqrt(max(0.0, 1.0 - dot(q, q)));
    float rt = t * 0.012;
    vec3 sp = vec3(q.x * cos(rt) - mu * sin(rt), q.y, q.x * sin(rt) + mu * cos(rt));
    float gran = fbm(sp * 16.0 + vec3(0.0, 0.0, t * 0.09));
    float lanes = 1.0 - abs(noise(sp * 34.0 + t * 0.12) * 2.0 - 1.0);
    float fac = smoothstep(0.5, 0.78, fbm(sp * 5.0 + t * 0.015)) * pow(1.0 - mu, 1.5);
    float spot = smoothstep(0.045, 0.02, length(sp - normalize(vec3(-0.38, -0.22, 0.9))))
               + 0.8 * smoothstep(0.03, 0.012, length(sp - normalize(vec3(-0.31, -0.27, 0.91))))
               + 0.6 * smoothstep(0.022, 0.008, length(sp - normalize(vec3(0.3, 0.18, 0.94))));
    float pen = smoothstep(0.1, 0.045, length(sp - normalize(vec3(-0.35, -0.24, 0.9))))
              + 0.6 * smoothstep(0.05, 0.022, length(sp - normalize(vec3(0.3, 0.18, 0.94))));
    vec3 base = mix(vec3(1.0, 0.36, 0.04), vec3(1.0, 0.94, 0.76), pow(mu, 0.7));
    float I = (0.36 + 0.64 * pow(mu, 0.5)) * (0.88 + 0.2 * gran - 0.1 * lanes) + 0.3 * fac;
    I *= 1.0 - 0.3 * min(pen, 1.0) - 0.6 * min(spot, 1.0);
    disc = base * I * 1.08;
  }

  // Above the limb: chromosphere, flames, corona, prominences, flares.
  float h = r - 1.0;
  vec3 out3 = vec3(0.0);
  if (h > -0.03) {
    float hh = max(h, 0.0);
    float f1 = fbm(vec3(dir * 3.2, hh * 2.6 - t * 0.28));
    float f2 = fbm(vec3(dir * 8.5, hh * 5.5 - t * 0.5) + 7.0);
    float flames = pow(clamp(f1 * 0.7 + f2 * 0.55 - 0.2, 0.0, 1.0), 2.0) * exp(-hh * 5.0);
    float corona = exp(-hh * 3.0) * 0.38 + exp(-hh * 11.0) * 0.55;
    float chrom = exp(-pow(hh / 0.03, 2.0));
    float streak = pow(fbm(vec3(dir * 6.0, t * 0.03)), 3.0) * exp(-hh * 1.6) * 0.9;
    out3 = vec3(1.0, 0.84, 0.58) * corona * (0.7 + 0.5 * f1)
         + vec3(1.0, 0.85, 0.65) * streak
         + vec3(1.0, 0.52, 0.2) * flames * 1.6
         + vec3(1.0, 0.42, 0.16) * chrom * 0.9;
    out3 += promColor(a, h, t);
    // Flare: a short white flash at a random spot on the limb every ~17 s.
    float cyc = floor(t / 17.0);
    float fa = hash(vec3(cyc, 1.7, 3.3)) * 2.0 * PI;
    float fp = fract(t / 17.0);
    float fl = exp(-pow((fp - 0.2) / 0.025, 2.0));
    vec2 fpnt = vec2(cos(fa), sin(fa)) * uR;
    out3 += vec3(1.0, 0.95, 0.85) * fl * exp(-length(p - fpnt) / (0.06 * uR)) * 1.6;
  }
  vec3 col = disc * cover + out3 * (1.0 - cover);
  float alpha = clamp(max(cover, max(max(out3.r, out3.g), out3.b)), 0.0, 1.0);
  gl_FragColor = vec4(min(col, vec3(1.0)), alpha);
}`;
