# Demoscene

Tiny procedural worlds for [workshop](https://github.com/DoshaLabs/workshop)'s tile column, in the
spirit of the demoscene's 4K intros: a whole landscape from a few hundred bytes of maths, drawn
live, that you fly around.

Ask any Claude session for one ("make me an alien ocean with glowing jellyfish") and it writes the
scene, loads it into the tile, looks at a snapshot and fixes what it sees. The tile shows the
size of each world, minified, against the classic 4 KB budget.

## How a world works

A scene is GLSL that defines one function, `float map(vec3 p)`: the distance from `p` to the
nearest surface. The tile ray-marches it for every pixel (one fullscreen shader, as a 4K intro
does), lights it with sun, soft shadows, occlusion and fog, and reads the same function at the
camera to keep you out of walls and to steer the autopilot. Optional `material`, `sky`, `glow`
and `render` functions, and a few `#define`s, change the look. The full contract is the skill in
`plugin/skills/demoscene/SKILL.md`.

Three worlds ship with it: **Red canyon** (a height field), **Monolith field** (domain
repetition) and **Gyroid caves** (an implicit surface, lit by your own lamp).

## What it asks for

- `storage`: your worlds (up to 60) and which one is showing.
- `overlay`: Full window, to fly over the whole workshop window.
- `door` (`load`, `get`, `list`, `show`, `snap`, `status`): Claude sessions make, read and switch
  worlds, and `snap` hands back a picture so a session can see what it made.

No network: nothing is fetched and nothing leaves your Mac.

## Fly

In the column it flies itself. Click it to open it large: drag to look, WASD to fly, Space / Q up
and down, arrows to turn, the wheel for speed, P for the autopilot, R to respawn, `,` `.` for the
other worlds, F or Full window for the whole window (Esc to come back).

## Develop

```bash
node --test test/*.test.mjs     # the scene rules in dist/scene.js, as shipped
```

No build step: `dist/` is the tile.
