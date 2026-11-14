// A scene is a few lines of GLSL that define `float map(vec3 p)`: the distance from p to the
// nearest surface. Everything else (the camera, the ray march, light, shadow, fog) is the host's,
// wrapped around it here. Pure functions only, so test/scene.test.mjs can check them in node.

export const BUDGET = 4096
export const MAX_SOURCE = 32 * 1024
/** The line the host's own code after the scene starts at, so errors there can be told apart. */
export const HOST_LINE = 10000

/** `// @title …`, `// @spawn x y z [yaw]`, `// @speed n` from the scene's comments. */
export function meta(src) {
  const tag = (name) => new RegExp(`^\\s*//\\s*@${name}\\s+(.+)$`, 'm').exec(src)?.[1].trim()
  const nums = (s) => (s ?? '').split(/[\s,]+/).map(Number).filter(Number.isFinite)
  const title = (tag('title') ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 60) || 'Untitled'
  const sp = nums(tag('spawn'))
  const spawn = { x: sp[0] ?? 0, y: sp[1] ?? 2, z: sp[2] ?? 0, yaw: ((sp[3] ?? 0) * Math.PI) / 180 }
  const speed = Math.min(50, Math.max(0.2, nums(tag('speed'))[0] ?? 3))
  return { title, spawn, speed }
}

/** The source as a sizecoder would ship it: comments gone, whitespace only where it is needed. */
export function minified(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith('#') ? `\n${line}\n` : line.replace(/\s+/g, ' ').replace(/\s*([{}()[\];,=+\-*/<>!?:&|.])\s*/g, '$1')))
    .join('')
    .replace(/\n+/g, '\n')
    .trim()
}

export const size = (src) => new TextEncoder().encode(minified(src)).length

export function formatSize(bytes) {
  return bytes < 1000 ? `${bytes} B` : `${(bytes / 1024).toFixed(2)} KB`
}

/** Which optional functions the scene defines. */
export function features(src) {
  const has = (name) => new RegExp(`\\bvec3\\s+${name}\\s*\\(`).test(src)
  return { sky: has('sky'), material: has('material'), glow: has('glow'), render: has('render') }
}

/** What a scene may not carry: the host owns the version line, precision and main(). */
export function clean(src) {
  return src.replace(/^\s*#version[^\n]*$/gm, '').replace(/^\s*precision\s[^\n]*$/gm, '')
}

const HELPERS = `
#define PI 3.14159265
float hash(float n){ return fract(sin(n)*43758.5453123); }
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x*p.y); }
float hash(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x + p.y + p.z)); }
float noise(vec2 x){ vec2 i = floor(x), f = fract(x); f = f*f*(3.0 - 2.0*f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y); }
float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0 - 2.0*f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 5; i++){ s += a*noise(p); p = m*p; a *= 0.5; } return s; }
float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a*noise(p); p = p*2.02 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5*(b - a)/k, 0.0, 1.0); return mix(b, a, h) - k*h*(1.0 - h); }
float smax(float a, float b, float k){ return -smin(-a, -b, k); }
float sdSphere(vec3 p, float r){ return length(p) - r; }
float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdTorus(vec3 p, vec2 t){ return length(vec2(length(p.xz) - t.x, p.y)) - t.y; }
float sdCapsule(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba)/dot(ba, ba), 0.0, 1.0); return length(pa - ba*h) - r; }
float sdCylinder(vec3 p, float r, float h){ vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d){ return a + b*cos(6.28318*(c*t + d)); }
`

const RENDERER = `
#ifndef FOG
#define FOG 0.015
#endif
#ifndef SUN
#define SUN normalize(vec3(0.6, 0.5, -0.4))
#endif
#ifndef SUNCOL
#define SUNCOL vec3(1.0, 0.92, 0.8)
#endif
#ifndef FAR
#define FAR 150.0
#endif
#ifndef LAMPCOL
#define LAMPCOL vec3(1.0, 0.85, 0.65)
#endif
#ifndef HAS_SKY
vec3 sky(vec3 rd){ float s = max(dot(rd, SUN), 0.0);
  vec3 c = mix(vec3(0.55, 0.65, 0.8), vec3(0.12, 0.28, 0.65), clamp(rd.y*1.5, 0.0, 1.0));
  return c + SUNCOL*(pow(s, 64.0)*1.5 + pow(s, 6.0)*0.2); }
#endif
#ifndef HAS_MATERIAL
vec3 material(vec3 p, vec3 n){ return vec3(0.5); }
#endif
float march(vec3 ro, vec3 rd){
  float t = 0.02;
  for (int i = 0; i < 300; i++){
    if (i >= uSteps) break;
    float d = map(ro + rd*t);
    if (abs(d) < 0.0005*t) return t;
    t += d*0.9;
    if (t > FAR) return -1.0;
  }
  return t < FAR ? t : -1.0;
}
vec3 calcNormal(vec3 p, float t){
  float e = 0.0005*max(t, 1.0); vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy*map(p + k.xyy*e) + k.yyx*map(p + k.yyx*e) + k.yxy*map(p + k.yxy*e) + k.xxx*map(p + k.xxx*e));
}
float softShadow(vec3 ro, vec3 rd){
  float r = 1.0, t = 0.03;
  for (int i = 0; i < 40; i++){
    float h = map(ro + rd*t);
    r = min(r, 10.0*h/t); t += clamp(h, 0.03, 0.8);
    if (r < 0.005 || t > 30.0) break;
  }
  return clamp(r, 0.0, 1.0);
}
float occlusion(vec3 p, vec3 n){
  float o = 0.0, s = 1.0;
  for (int i = 0; i < 5; i++){ float h = 0.02 + 0.15*float(i); o += (h - map(p + n*h))*s; s *= 0.75; }
  return clamp(1.0 - 1.5*o, 0.0, 1.0);
}
vec3 shade(vec3 ro, vec3 rd){
  vec3 bg = sky(rd);
  float t = march(ro, rd);
  if (t < 0.0) return bg;
  vec3 p = ro + rd*t, n = calcNormal(p, t), alb = material(p, n);
  float occ = occlusion(p, n);
  vec3 col = alb*sky(normalize(vec3(n.x, abs(n.y) + 0.3, n.z)))*0.45*occ;
#ifndef NOSUN
  float dif = clamp(dot(n, SUN), 0.0, 1.0);
  if (dif > 0.0) dif *= softShadow(p + n*0.01, SUN);
  col += alb*SUNCOL*dif*1.6;
  col += SUNCOL*pow(clamp(dot(reflect(rd, n), SUN), 0.0, 1.0), 32.0)*dif*0.2;
#endif
#ifdef LAMP
  col += alb*LAMPCOL*LAMP*clamp(dot(n, -rd), 0.0, 1.0)/(1.0 + 0.04*t*t);
#endif
#ifdef HAS_GLOW
  col += glow(p, n);
#endif
  return mix(col, bg, 1.0 - exp(-FOG*t));
}
void main(){
  if (uMode == 1){
    float d = map(uProbe[int(gl_FragCoord.x)]);
    float x = clamp((d + 1.0)/33.0, 0.0, 1.0)*255.0;
    fragColor = vec4(floor(x)/255.0, fract(x), 0.0, 1.0);
    return;
  }
  vec2 uv = (2.0*gl_FragCoord.xy - iResolution)/iResolution.y;
  vec3 rd = normalize(uCam*vec3(uv, 1.6));
#ifdef HAS_RENDER
  vec3 col = render(uPos, rd);
#else
  vec3 col = shade(uPos, rd);
#endif
  col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));
  vec2 q = gl_FragCoord.xy/iResolution;
  col *= 0.5 + 0.5*pow(16.0*q.x*q.y*(1.0 - q.x)*(1.0 - q.y), 0.15);
  fragColor = vec4(col, 1.0);
}
`

/** The whole fragment shader: uniforms, helpers, the scene at line 1, then the renderer. */
export function build(src) {
  const f = features(src)
  const defs = [f.sky && 'HAS_SKY', f.material && 'HAS_MATERIAL', f.glow && 'HAS_GLOW', f.render && 'HAS_RENDER']
    .filter(Boolean)
    .map((d) => `#define ${d}`)
    .join('\n')
  return `#version 300 es
precision highp float;
precision highp int;
uniform vec2 iResolution;
uniform float iTime;
uniform vec3 uPos;
uniform mat3 uCam;
uniform int uMode;
uniform int uSteps;
uniform vec3 uProbe[16];
out vec4 fragColor;
${defs}
${HELPERS}
#line 1
${clean(src)}
#line ${HOST_LINE}
${RENDERER}`
}

/**
 * The compiler's log with the scene's own line numbers, and a hint when an error is in the host's
 * code after the scene (that almost always means map() is missing or has another signature).
 */
export function explainLog(log, lineOffset = 0) {
  const lines = String(log)
    .split('\n')
    .map((l) => l.replace(/\u0000/g, '').trim())
    .filter(Boolean)
  let host = false
  const out = lines.map((l) =>
    l.replace(/^(ERROR|WARNING): (\d+):(\d+):/, (_, kind, file, n) => {
      const line = Number(n) + lineOffset
      if (line >= HOST_LINE) {
        host = true
        return `${kind}: (renderer):`
      }
      return `${kind}: line ${line}:`
    })
  )
  // The renderer calls map() in a dozen places, so one bad signature is a dozen identical errors.
  const unique = [...new Set(out)].slice(0, 30)
  out.length = 0
  out.push(...unique)
  if (host) out.push('An error in the renderer means the scene is missing `float map(vec3 p)`, or an optional function (sky, material, glow, render) has the wrong signature.')
  return out.join('\n')
}
