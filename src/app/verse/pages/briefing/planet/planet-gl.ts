import { ROLL, SUN, TILT } from './planet-world';

/**
 * WebGL 1 renderer of the hub planet: one full-screen quad, the sphere is
 * ray-cast per pixel (orthographic). Day side lit from the sun (fixed in view
 * space), night side carries the city lights, clouds drift slowly, the limb
 * scatters in the app's accent colour, and an aurora shimmers above the
 * northern horizon when `aurora` > 0.
 */

const VS = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';

/**
 * Fragment shader. With OES_standard_derivatives (`DERIV`) the longitude seam
 * is sampled the Tarini way — two u candidates, the one without the jump wins
 * per 2×2 quad — so the textures can carry mipmaps without a seam line.
 */
const FS = (deriv: boolean) => `
${deriv ? '#extension GL_OES_standard_derivatives : enable\n#define DERIV 1' : ''}
precision highp float;
uniform vec2 uRes; uniform vec2 uC; uniform float uR; uniform float uRot; uniform float uTilt; uniform float uRoll; uniform vec3 uSun;
uniform float uTime; uniform float uAur; uniform vec3 uAccent;
uniform sampler2D tDay, tNight, tCloud;
const float PI = 3.14159265;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
// Thin atmosphere halo + the aurora above the northern limb (straight colour, alpha).
vec4 halo(vec2 d, float r, vec3 aurC){
  float t = max(r - 1.0, 0.0);
  vec2 dir = d / max(r, 1e-4);
  float sunSide = clamp(dot(normalize(dir), normalize(uSun.xy)) * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = uAccent * exp(-t * 90.0) * (0.10 + 0.55 * pow(sunSide, 3.0));
  float ang = atan(dir.x, dir.y);
  float patch = smoothstep(0.5, 0.78, n2(vec2(ang * 7.0 + uTime * 0.004, 3.0))) * (1.0 - smoothstep(0.3, 0.55, abs(dir.x)));
  float curt = 0.55 + 0.45 * n2(vec2(ang * 55.0, uTime * 0.03));
  float hgt = 0.010 + 0.008 * n2(vec2(ang * 18.0, uTime * 0.02));
  col += aurC * exp(-pow((t - hgt) / (0.6 * hgt), 2.0)) * curt * patch * uAur * 0.38;
  float a = clamp(max(max(col.r, col.g), col.b) * 1.6, 0.0, 1.0);
  return vec4(col / max(a, 1e-4), a);
}
vec3 surface(vec2 d, vec3 aurC){
  vec3 n = vec3(d, sqrt(max(0.0, 1.0 - dot(d, d))));
  // View → planet: undo the roll (about z), the tilt (about x), then the spin.
  float co = cos(uRoll), so = sin(uRoll);
  vec3 m = vec3(n.x * co + n.y * so, -n.x * so + n.y * co, n.z);
  float ct = cos(uTilt), st = sin(uTilt);
  vec3 q = vec3(m.x, m.y * ct - m.z * st, m.y * st + m.z * ct);
  float cr = cos(uRot), sr = sin(uRot);
  vec3 p = vec3(q.x * cr - q.z * sr, q.y, q.x * sr + q.z * cr);
  float lon = atan(p.z, p.x) / (2.0 * PI);
  float u = lon + 0.5;
#ifdef DERIV
  float u2 = fract(lon + 1.0) - 0.5; // same texel as u (REPEAT), jump moved to lon 0
  u = fwidth(u) < fwidth(u2) - 0.001 ? u : u2;
#endif
  vec2 uv = vec2(u, 0.5 - asin(clamp(p.y, -1.0, 1.0)) / PI);
  vec3 day = texture2D(tDay, uv).rgb;
  float cl = texture2D(tCloud, uv + vec2(uTime * 0.0000035, 0.0)).r;
  vec3 lights = texture2D(tNight, uv).rgb;
  float ndl = dot(n, uSun);
  float dayK = smoothstep(-0.06, 0.18, ndl);
  float nightK = 1.0 - smoothstep(-0.10, 0.03, ndl);
  vec3 surf = mix(day, vec3(0.92, 0.95, 1.0), cl * 0.85) * (0.18 + 0.82 * clamp(ndl, 0.0, 1.0)) * dayK;
  surf += vec3(1.0, 0.6, 0.35) * exp(-pow(ndl / 0.07, 2.0)) * 0.05;
  vec3 moon = (day * 0.05 + vec3(cl) * 0.05) * vec3(0.55, 0.75, 1.0);
  surf += (moon + lights * (1.0 - 0.65 * cl) * 0.85) * nightK;
  float rim = pow(1.0 - n.z, 4.0);
  surf = mix(surf, uAccent * (0.15 + 0.85 * clamp(ndl + 0.35, 0.0, 1.0)), rim * 0.55);
  surf += uAccent * pow(1.0 - n.z, 10.0) * 0.12;
  surf += aurC * uAur * 0.10 * pow(max(n.y, 0.0), 30.0) * nightK;
  return surf * 0.92;
}
void main(){
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 d = (fc - uC) / uR; d.y = -d.y;
  float r = length(d);
  if (r > 1.08) { gl_FragColor = vec4(0.0); return; }
  vec3 aurC = mix(vec3(0.37, 0.88, 0.69), uAccent, 0.45);
  // Anti-aliased limb: the disc covers the pixel by its distance to the edge (1 px ramp).
  float cover = clamp((1.0 - r) * uR + 0.5, 0.0, 1.0);
  vec4 o = halo(d, r, aurC);
  vec3 s = cover > 0.0 ? surface(d * min(1.0, 0.9995 / r), aurC) : vec3(0.0);
  vec3 pm = o.rgb * o.a * (1.0 - cover) + s * cover;
  float a = o.a * (1.0 - cover) + cover;
  gl_FragColor = vec4(pm / max(a, 1e-4), a);
}`;

export interface PlanetFrame {
  /** Planet centre and radius in CSS pixels of the canvas. */
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly rot: number;
  /** Seconds, drives cloud drift and the aurora's motion. */
  readonly time: number;
  readonly aurora: number;
}

export class PlanetRenderer {
  private readonly gl: WebGLRenderingContext;
  private readonly prog: WebGLProgram;
  private readonly u: Record<string, WebGLUniformLocation | null> = {};
  private readonly textures: WebGLTexture[] = [];
  private readonly aniso: EXT_texture_filter_anisotropic | null;
  private readonly mipmaps: boolean;

  /** Throws when WebGL is missing — the caller then keeps the CSS planet. */
  constructor(private readonly canvas: HTMLCanvasElement, accent: readonly [number, number, number]) {
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, antialias: false, alpha: true });
    if (!gl) throw new Error('webgl unavailable');
    this.gl = gl;
    const prog = gl.createProgram()!;
    const deriv = !!gl.getExtension('OES_standard_derivatives');
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    gl.attachShader(prog, this.shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, this.shader(gl.FRAGMENT_SHADER, FS(deriv)));
    this.mipmaps = deriv;
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link failed');
    gl.useProgram(prog);
    this.prog = prog;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uRes', 'uC', 'uR', 'uRot', 'uTilt', 'uRoll', 'uSun', 'uTime', 'uAur', 'uAccent']) this.u[n] = gl.getUniformLocation(prog, n);
    gl.uniform1f(this.u['uTilt'], TILT);
    gl.uniform1f(this.u['uRoll'], ROLL);
    gl.uniform3f(this.u['uSun'], SUN[0], SUN[1], SUN[2]);
    gl.uniform3f(this.u['uAccent'], accent[0], accent[1], accent[2]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Uploads the equirect sources; they may be released afterwards. */
  setTextures(day: TexImageSource, night: TexImageSource, cloud: TexImageSource): void {
    const gl = this.gl;
    [day, night, cloud].forEach((img, unit) => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      // Mipmaps keep the far, foreshortened limb from shimmering; without the
      // seam fix (no derivatives) they would draw a line at the date line.
      if (this.mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(this.prog, ['tDay', 'tNight', 'tCloud'][unit]), unit);
      this.textures.push(t);
    });
  }

  draw(f: PlanetFrame, dpr: number): void {
    const gl = this.gl, c = this.canvas;
    gl.viewport(0, 0, c.width, c.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.u['uRes'], c.width, c.height);
    gl.uniform2f(this.u['uC'], f.cx * dpr, f.cy * dpr);
    gl.uniform1f(this.u['uR'], f.r * dpr);
    gl.uniform1f(this.u['uRot'], f.rot);
    gl.uniform1f(this.u['uTime'], f.time);
    gl.uniform1f(this.u['uAur'], f.aurora);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose(): void {
    for (const t of this.textures) this.gl.deleteTexture(t);
    this.gl.deleteProgram(this.prog);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private shader(type: number, src: string): WebGLShader {
    const gl = this.gl, s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'compile failed');
    return s;
  }
}
