// @title Drift isles
// @spawn 0 4 0 45
// @speed 4
#define FOG 0.009
#define FAR 240.0
#define SUN normalize(vec3(-0.5, 0.35, 0.8))
#define SUNCOL vec3(1.25, 1.0, 0.75)

// Floating islands: one rock per 36-unit cell, a domed mossy top over a craggy root that
// tapers into the mist. A second, offset layer of smaller isles fills the gaps.
float isle(vec3 p, float cell, float yRange, float rMin, float rVar, float seed){
  vec2 id = floor(p.xz/cell);
  vec3 q = p;
  q.xz = mod(q.xz, cell) - cell*0.5;
  vec2 h = vec2(hash(id + seed), hash(id + seed + 4.7));
  q.xz -= (h - 0.5)*cell*0.3;
  q.y -= (hash(id + seed + 9.1) - 0.5)*yRange;
  float R = rMin + rVar*h.x*h.y;
  float r = length(q.xz);
  float L = R*1.7;
  float w = R*pow(clamp((q.y + L)/L, 0.0, 1.0), 0.6);
  float dome = q.y - 1.2*(1.0 - r*r/(R*R));
  float d = max(max(r - w, dome), -(q.y + L));
  float amp = smoothstep(0.0, R*0.6, w);                    // calmer near the thin root: no loose bits
  d += ((noise(p*0.22) - 0.5)*3.2 + (noise(p*0.8) - 0.5)*0.9)*amp;
  return d*0.45;
}

float islands(vec3 p){
  float a = isle(p, 36.0, 14.0, 5.0, 6.0, 0.0);
  float b = isle(p + vec3(18.0, 9.0, 18.0), 36.0, 10.0, 2.0, 2.5, 13.0);
  return min(a, b);
}

// Waterfalls: most big isles spill one ribbon of water off their rim, arcing out as it falls
// all the way to the forest. Same cells as the big isles, so it starts at its own isle's edge.
float falls(vec3 p){
  vec2 id = floor(p.xz/36.0);
  if (hash(id + 21.0) < 0.3) return 1e3;
  vec3 q = p;
  q.xz = mod(q.xz, 36.0) - 18.0;
  vec2 h = vec2(hash(id), hash(id + 4.7));
  q.xz -= (h - 0.5)*36.0*0.3;
  q.y -= (hash(id + 9.1) - 0.5)*14.0;
  float R = 5.0 + 6.0*h.x*h.y;
  q.xz = rot(hash(id + 33.0)*6.28)*q.xz;
  float drop = max(-q.y, 0.0);
  q.x -= R*0.92 + 0.35*sqrt(drop);                              // arcs outward as it falls
  q.z += sin(q.y*0.15 + id.x)*0.4;
  float wide = 0.7 + 0.025*drop;                                 // spreads into spray lower down
  float d = sdBox(q - vec3(0.0, -27.0, 0.0), vec3(0.12 + 0.01*drop, 27.6, wide)) - 0.05;
  return d*0.6;
}

// The forest floor far below: rolling ground under a lumpy canopy of tree crowns.
float forest(vec3 p){
  vec2 x = p.xz;
  float h = -48.0 + 7.0*fbm(x*0.012);
  vec2 cid = floor(x/3.2);
  vec2 g = fract(x/3.2) - 0.5 - (vec2(hash(cid), hash(cid + 1.7)) - 0.5)*0.35;
  float cr = 0.1 + 0.12*hash(cid + 3.3);
  float crown = sqrt(max(cr - dot(g, g), 0.0))*(2.0 + 3.0*hash(cid + 5.1));
  h += 4.0*smoothstep(0.45, 0.8, noise(x*0.04));                 // groves of taller trees
  h += crown + 1.2*noise(x*0.35);
  return (p.y - h)*0.5;
}

// Groves on the big isles: round-crowned trees and fern clumps, standing on the isle's own
// (noisy) top surface, thick in some patches and clear in others.
float kind;                                                      // for material: 0 trunk, 1 crown, 2 fern
float flora(vec3 p){
  vec2 id = floor(p.xz/36.0);
  vec3 q = p;
  q.xz = mod(q.xz, 36.0) - 18.0;
  vec2 h = vec2(hash(id), hash(id + 4.7));
  q.xz -= (h - 0.5)*36.0*0.3;
  q.y -= (hash(id + 9.1) - 0.5)*14.0;
  float R = 5.0 + 6.0*h.x*h.y;
  float r = length(q.xz);
  float b = max(r - R*0.8, abs(q.y - 1.5) - 4.5);
  if (b > 0.5) return b;
  float top = 1.2*(1.0 - r*r/(R*R));
  vec3 ps = vec3(p.x, p.y - q.y + top, p.z);
  float yg = top - ((noise(ps*0.22) - 0.5)*3.2 + (noise(ps*0.8) - 0.5)*0.9) + 0.05;
  vec2 gid = floor(q.xz/2.2);
  vec2 g = mod(q.xz, 2.2) - 1.1 - (vec2(hash(gid + id), hash(gid + id + 2.9)) - 0.5)*0.6;
  vec3 t = vec3(g.x, q.y - yg, g.y);
  float ty = hash(gid + id*7.0 + 0.5);
  float dense = noise(q.xz*0.35 + id*3.0);
  float d = 1.0;
  kind = 2.0;
  if (ty < dense*0.9) {
    float ht = 1.2 + 1.3*hash(gid + id + 6.6);
    float trunk = sdCapsule(t, vec3(0.0, -0.5, 0.0), vec3(0.0, ht, 0.0), 0.07);
    vec3 c = t - vec3(0.0, ht + 0.1, 0.0);
    c.y *= 1.3;
    float crown = (length(c) - 0.55 - 0.15*hash(gid + 4.4))/1.3 + (noise(t*5.0) - 0.5)*0.15;
    d = min(trunk, crown);
    kind = crown < trunk ? 1.0 : 0.0;
  } else if (ty < dense*0.9 + 0.35) {
    float a = atan(t.z, t.x);
    float rr = length(t.xz);
    float sec = 6.2832/7.0;
    a = mod(a + hash(gid)*3.0, sec) - sec*0.5;
    vec3 ft = vec3(rr*cos(a), t.y, rr*sin(a));
    float arch = 0.3 - 0.6*(ft.x - 0.25)*(ft.x - 0.25);          // fronds arch up then droop
    d = sdBox(ft - vec3(0.4, arch, 0.0), vec3(0.4, 0.015, 0.07*(1.0 - ft.x*0.9))) * 0.6;
  }
  return max(d*0.7, b);
}

// Glider reptiles: one per 40-unit cell, circling its own isle at its own height and pace.
// Long neck, a tail with a fin, membrane wings beating slow with long glides between.
float beast(vec3 p){
  vec2 id = floor(p.xz/40.0);
  float s = hash(id + 2.3);
  vec2 c = (id + 0.5)*40.0;
  float sp = 0.25 + 0.15*s;
  float a = iTime*sp + s*6.28;
  float rad = 9.0 + 4.0*hash(id + 5.5);
  vec3 pos = vec3(c.x + cos(a)*rad, 3.0 + 9.0*hash(id + 8.8) + sin(iTime*0.5 + s*9.0)*1.2, c.y + sin(a)*rad);
  vec3 q = p - pos;
  float bound = length(q) - 5.0;
  if (bound > 1.0) return bound;
  // face along the circle (heading = tangent), bank into the turn
  q.xz = rot(a)*q.xz;
  q.xy = rot(-0.35)*q.xy;
  q *= 0.9;
  float t = iTime*2.2 + s*20.0;
  float beat = sin(t)*smoothstep(-0.2, 0.6, sin(t*0.23));     // beats, then glides
  float body = sdCapsule(q, vec3(0.0, 0.0, -0.9), vec3(0.0, 0.05, 0.8), 0.2);
  float neck = sdCapsule(q, vec3(0.0, 0.05, 0.8), vec3(0.0, 0.3, 1.6), 0.09);
  float head = sdCapsule(q, vec3(0.0, 0.3, 1.6), vec3(0.0, 0.18, 2.3), 0.07);
  float tail = sdCapsule(q, vec3(0.0, 0.0, -0.9), vec3(0.0, 0.1 + beat*0.1, -2.8), 0.05);
  vec3 f = q - vec3(0.0, 0.1, -2.75);
  float fin = sdBox(f, vec3(0.02, 0.18, 0.25));
  vec3 w = q;
  w.x = abs(w.x);
  w.xy -= vec2(0.15, 0.05);
  w.xy = rot(-beat*0.55)*w.xy;
  float span = 3.4;
  float wing = sdBox(w - vec3(span*0.5, 0.0, -0.2), vec3(span*0.5, 0.025, 0.65));
  wing = max(wing, (-0.85 + 0.27*w.x - w.z)*0.96);              // swept trailing edge
  wing = max(wing, (w.z - 0.45 + 0.12*w.x)*0.99);               // swept leading edge
  float d = smin(smin(body, neck, 0.15), head, 0.08);
  d = smin(d, tail, 0.1);
  d = min(d, min(fin, wing));
  return d/0.9;
}

float map(vec3 p){ return min(min(min(islands(p), flora(p)), beast(p)), min(falls(p), forest(p))); }

vec3 material(vec3 p, vec3 n){
  float di = islands(p), dw = falls(p), df = forest(p), db = beast(p);
  if (dw < min(di, db) && dw < df) return vec3(0.55, 0.65, 0.7);
  if (df < min(di, db)) {
    float t = noise(p.xz*0.4);
    vec3 leaf = mix(vec3(0.02, 0.09, 0.02), vec3(0.08, 0.22, 0.05), t);
    return mix(leaf, vec3(0.16, 0.24, 0.05), smoothstep(0.7, 0.95, noise(p.xz*0.08))*0.7);
  }
  float dl = flora(p);
  if (dl < min(di, db) && dl < dw) {
    if (kind < 0.5) return vec3(0.09, 0.05, 0.03);
    float v = hash(floor(p.xz/2.2));
    if (kind < 1.5) return mix(vec3(0.03, 0.12, 0.03), vec3(0.1, 0.24, 0.04), v)*(0.8 + 0.4*noise(p*4.0));
    return vec3(0.12, 0.3, 0.05);
  }
  if (db < di) {
    float stripe = smoothstep(0.3, 0.7, sin(p.x*9.0 + p.z*9.0));
    vec3 hide = mix(vec3(0.03, 0.1, 0.09), vec3(0.08, 0.3, 0.22), stripe);
    return mix(hide, vec3(0.32, 0.22, 0.08), 0.35*smoothstep(0.4, 0.9, noise(p*6.0)));
  }
  vec3 rock = mix(vec3(0.16, 0.14, 0.13), vec3(0.3, 0.26, 0.22), noise(p*1.5));
  rock *= 0.7 + 0.3*sin(p.y*3.0 + noise(p.xz*0.5)*4.0);
  vec3 moss = mix(vec3(0.05, 0.16, 0.04), vec3(0.12, 0.28, 0.06), noise(p*2.0));
  float m = smoothstep(0.45, 0.8, n.y + (noise(p*3.0) - 0.5)*0.4);
  return mix(rock, moss, m);
}

// Faint gold veins on the wings, pulsing slow.
vec3 glow(vec3 p, vec3 n){
  if (falls(p) < 0.03) {                                         // white water streaking down
    float streak = noise(vec3(p.x*3.0, p.y*0.6 + iTime*7.0, p.z*3.0));
    return vec3(0.75, 0.82, 0.85)*(0.25 + 0.6*smoothstep(0.45, 0.85, streak));
  }
  if (beast(p) > 0.02) return vec3(0.0);
  float v = smoothstep(0.92, 1.0, sin(p.x*14.0 + sin(p.z*6.0)*2.0));
  return vec3(1.0, 0.6, 0.15)*v*(0.3 + 0.2*sin(iTime*1.5));
}

// Pale haze above, a sea of white mist below the horizon, a warm low sun.
vec3 sky(vec3 rd){
  float s = max(dot(rd, SUN), 0.0);
  vec3 up = mix(vec3(0.66, 0.73, 0.77), vec3(0.16, 0.32, 0.55), clamp(rd.y*1.8, 0.0, 1.0));
  vec3 mist = vec3(0.74, 0.77, 0.78) + 0.05*noise(rd.xz/(0.05 - min(rd.y, 0.0))*0.5);
  vec3 c = mix(mist, up, smoothstep(-0.12, 0.05, rd.y));
  return c + SUNCOL*(pow(s, 300.0)*2.0 + pow(s, 8.0)*0.25);
}
