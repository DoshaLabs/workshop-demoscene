// The worlds the tile ships with. Each shows one classic trick: a height field, domain
// repetition, and an implicit surface (a gyroid). A session can `get` one and remix it.

const canyon = `// @title Red canyon
// @spawn 15 6 -20 0
// @speed 5
#define FOG 0.007
#define SUN normalize(vec3(-0.6, 0.3, 0.7))
#define SUNCOL vec3(1.3, 0.8, 0.5)

// A height field: fbm for the land, cut into mesa terraces, a river carving a canyon through it.
float height(vec2 x){
  float h = fbm(x*0.05)*26.0;
  float k = h/2.0;
  h = (floor(k) + smoothstep(0.55, 1.0, fract(k)))*2.0;
  float river = abs(x.x*0.06 + sin(x.y*0.04)*0.8 + sin(x.y*0.011)*1.5);
  return h*smoothstep(0.2, 1.4, river) + fbm(x*0.7)*0.4;
}

// Not a true distance (cliffs are steep), so it is scaled down: the march takes smaller steps.
float map(vec3 p){ return (p.y - height(p.xz))*0.35; }

vec3 material(vec3 p, vec3 n){
  vec3 c = mix(vec3(0.42, 0.12, 0.05), vec3(0.75, 0.38, 0.17), 0.5 + 0.5*sin(p.y*4.0 + noise(p.xz*0.4)*3.0));
  return mix(c, vec3(0.6, 0.45, 0.3), smoothstep(0.75, 0.95, n.y))*0.7;
}

vec3 sky(vec3 rd){
  float s = max(dot(rd, SUN), 0.0);
  vec3 c = mix(vec3(1.0, 0.5, 0.25), vec3(0.12, 0.16, 0.38), clamp(rd.y*2.2, 0.0, 1.0));
  return c + SUNCOL*(pow(s, 400.0)*3.0 + pow(s, 12.0)*0.15);
}
`

const monoliths = `// @title Monolith field
// @spawn 0 2.5 0 0
// @speed 3
#define FOG 0.035
#define SUN normalize(vec3(0.3, 0.25, 0.9))
#define SUNCOL vec3(0.35, 0.4, 0.6)

// Domain repetition: mod() folds all of space into one 8 x 8 cell, so one box is a whole field.
// Each cell's id seeds its own turn and height.
float map(vec3 p){
  float ground = p.y + 0.25*noise(p.xz*0.6);
  vec2 id = floor(p.xz/8.0);
  vec3 q = p;
  q.xz = mod(q.xz, 8.0) - 4.0;
  q.xz = rot(hash(id)*6.28)*q.xz;
  float h = 0.5 + 6.0*hash(id + 3.1)*hash(id + 7.7);
  float slab = sdBox(q - vec3(0.0, h, 0.0), vec3(0.45, h, 1.4)) - 0.03;
  return min(ground, slab*0.8);
}

vec3 material(vec3 p, vec3 n){ return p.y > 0.2 ? vec3(0.03) : vec3(0.25, 0.22, 0.2); }

// Light that is not lit: bands of cyan climbing every slab.
vec3 glow(vec3 p, vec3 n){
  if (p.y < 0.2) return vec3(0.0);
  float band = smoothstep(0.04, 0.0, abs(fract(p.y*0.5 - iTime*0.2) - 0.5));
  return vec3(0.1, 0.8, 1.0)*band*2.0;
}

vec3 sky(vec3 rd){
  float m = max(dot(rd, SUN), 0.0);
  vec3 c = mix(vec3(0.08, 0.06, 0.14), vec3(0.01, 0.01, 0.04), clamp(rd.y*2.0, 0.0, 1.0));
  c += step(0.997, hash(floor(rd*400.0)))*0.6*clamp(rd.y*3.0, 0.0, 1.0);
  return c + vec3(0.8, 0.85, 1.0)*smoothstep(0.9985, 0.999, m) + vec3(0.2, 0.25, 0.4)*pow(m, 12.0)*0.3;
}
`

const caves = `// @title Gyroid caves
// @spawn 4.49 0 0 0
// @speed 2
#define NOSUN
#define LAMP 2.2
#define FOG 0.06

// A gyroid, sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x), splits space into two endless
// labyrinths. Keep only one side and it is a cave system with no end. Lit by your own lamp.
float map(vec3 p){
  vec3 q = p*0.35;
  float g = dot(sin(q), cos(q.yzx));
  g += (fbm(p*1.3) - 0.5)*0.25;
  return (g - 0.45)*0.8;
}

vec3 material(vec3 p, vec3 n){ return mix(vec3(0.35, 0.3, 0.28), vec3(0.15, 0.2, 0.3), noise(p*0.8)); }

vec3 glow(vec3 p, vec3 n){
  float c = smoothstep(0.86, 0.9, noise(p*3.1))*step(0.6, noise(p*0.4));
  return vec3(0.15, 1.0, 0.7)*c*1.2*(0.7 + 0.3*sin(iTime*1.5 + p.x));
}

vec3 sky(vec3 rd){ return vec3(0.01, 0.02, 0.025); }
`

export const SEEDS = [
  { id: 'seed:canyon', src: canyon },
  { id: 'seed:monoliths', src: monoliths },
  { id: 'seed:caves', src: caves }
]
