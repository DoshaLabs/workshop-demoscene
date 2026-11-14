---
name: demoscene
description: Make a tiny procedural 3D world (a signed-distance-field scene in GLSL, demoscene style) for workshop's Demoscene tile, where the user flies around it. Use when the user asks for a world, a scene, a landscape, a demo, "something to fly around", "make me a canyon / ocean / city / cave…", or wants to change the one that is showing ("more fog", "make it night", "add towers"). Also to look at what the tile shows, or switch between saved worlds.
---

# Demoscene

The Demoscene tile in workshop's column runs a **scene**: a few lines of GLSL that define one
function, `float map(vec3 p)`, the distance from `p` to the nearest surface (negative inside).
The tile does the rest the way a 4K intro does: one fragment shader ray-marches `map` for every
pixel, lights it (sun, soft shadow, occlusion, fog), and the user flies the camera (WASD, drag
to look; an autopilot when it sits in the column). You write the scene; you never write
`main`, uniforms, `#version` or `precision`.

## The loop

```bash
mkdir -p "${TMPDIR:-/tmp}/demoscene"
F="${TMPDIR:-/tmp}/demoscene/ocean.glsl"          # write the scene here (never in the user's project)
node "$WORKSHOP_TILE" demoscene load "$(cat "$F")"  # compile and show it; prints title and bytes
node "$WORKSHOP_TILE" demoscene snap spawn | base64 -d > "${F%.glsl}.jpg"   # then Read the .jpg to see it
node "$WORKSHOP_TILE" demoscene status              # fps, camera, error (the GPU dropped it?)
```

1. Write the scene to a file, `load` it. If it does not compile, the call fails with the
   compiler's log, with line numbers in YOUR file: fix and load again.
2. **Always look at it**: `snap spawn` (or `snap x y z yaw pitch`, degrees, or `snap` for what the
   user sees now) gives a 640 × 360 JPEG as base64. Decode it and Read the picture. Judge it as
   the user would: is the spawn in the open, is anything visible, is it too dark or blown out?
3. Then `status`: if `error` says the GPU dropped the world, `map` is too slow (see Cost). The tile
   has already gone back to the previous one.
4. Loading again with the same `@title` while that world shows replaces it in place, so iterate
   under one title. A new title is a new world in the gallery.

Other ops: `list` (every world, numbered, built-ins first), `show <n|title>`, `get [n|title]`
(a scene's source: `get > file.glsl` to remix the one showing, built-ins included).

## A scene

```glsl
// @title Alien ocean                  shown on the tile's head (60 characters at most)
// @spawn 0 3 0 90                     x y z [yaw in degrees]: where the flight starts; must be in the open
// @speed 4                            units a second for the autopilot (manual is twice that)
#define FOG 0.02                       optional settings, below

float map(vec3 p){ return p.y - 0.5*fbm(p.xz*0.3); }     // required

vec3 material(vec3 p, vec3 n){ return vec3(0.1, 0.3, 0.4); }   // optional: albedo, LINEAR colour
vec3 sky(vec3 rd){ return mix(vec3(0.6,0.7,0.8), vec3(0.1,0.2,0.5), rd.y); }  // optional: background and fog colour
vec3 glow(vec3 p, vec3 n){ return vec3(0.0); }    // optional: emitted light, added unlit (neon, lava, bioluminescence)
vec3 render(vec3 ro, vec3 rd){ … }                // optional, expert: replaces the whole renderer; map still drives flight
```

- Settings (`#define` before use): `FOG` (density, 0.015), `SUN` (a normalized vec3), `SUNCOL`,
  `FAR` (150), `NOSUN` (no sun light or shadow: caves, night), `LAMP 2.0` (a light on the camera,
  intensity; `LAMPCOL`). Colours are linear: the renderer applies gamma, so a mid grey is 0.2.
- Uniforms you may read: `iTime` (seconds since load), `iResolution`.
- Helpers already defined: `hash(float|vec2|vec3)`, `noise(vec2|vec3)` (0..1), `fbm(vec2|vec3)`
  (5 octaves, about 0..1), `rot(a)` (mat2, `p.xz = rot(a)*p.xz`), `smin(a,b,k)` / `smax` (blend),
  `sdSphere(p,r)`, `sdBox(p,halfSize)`, `sdTorus(p,vec2(R,r))`, `sdCapsule(p,a,b,r)`,
  `sdCylinder(p,r,halfHeight)`, `pal(t,a,b,c,d)` (cosine palette), `PI`. Do not redefine them.
- GLSL ES 3.00: write floats with a point (`1.0`, not `1`), no implicit int → float.

## Making it good

- **The tricks.** Height fields (`p.y - h(p.xz)`) for land and sea; `mod(p, c) - c/2` repeats space,
  so one object becomes an endless field (seed each cell with `hash(floor(p/c))`); `smin` melts
  shapes together; `abs(p.x)` mirrors; twisting `p.xz = rot(p.y*k)*p.xz` bends; a gyroid
  `dot(sin(p), cos(p.yzx))` gives endless caves; `max(a, -b)` carves b out of a.
- **Keep it a distance.** If `map` overstates the distance (steep terrain, twists, big noise), rays
  pass through surfaces: multiply it down (`*0.5`, `*0.35`) until the holes go.
- **Spawn in the open, looking at something.** `map(spawn)` should be well above 1. The tile climbs
  out of rock if you get it wrong, but look at the `snap spawn` picture. Leave room to fly: the
  user should be able to go anywhere without the world ending.
- **Cost.** `map` runs about 200 times per pixel per frame. Keep loops in it short (fbm's 5
  octaves is the most); avoid fbm of fbm; repeat space instead of looping over objects. A `map`
  far over budget makes the GPU drop the world: simplify.
- **The 4 KB budget** is the demoscene's: `load` reports the bytes once minified. It is a target
  for the fun of it, not a rule: say the size when you show the world off.
- Describe what you made in a line or two and how to fly (click the tile to open it; Full window
  for the whole screen). Don't paste the shader into the conversation unless asked.

If a call says the tile is off, ask the user to turn the Demoscene tile on in workshop's column.
