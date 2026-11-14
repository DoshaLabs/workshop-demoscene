import { Renderer } from './renderer.js'
import { meta, size, formatSize, BUDGET, MAX_SOURCE } from './scene.js'
import { SEEDS } from './scenes.js'

const W = window.workshop
const canvas = document.getElementById('screen')
const hud = document.getElementById('hud')
const help = document.getElementById('help')

const MAX_SCENES = 60
const STEPS = { tile: 90, float: 90, pane: 150, overlay: 200 }
const MAX_SCALE = { tile: 0.5, float: 0.5, pane: 0.75, overlay: 1 }
const FPS_CAP = { tile: 30, float: 30, pane: 60, overlay: 60 }

// Sharp: pixels before frames. In the pane and full window it renders up to the screen's own
// pixels (2x on a Retina display) and settles for 30 frames a second to afford them.
let sharp = false
try { sharp = localStorage.getItem('sharp') === '1' } catch {}
const big = () => view === 'pane' || view === 'overlay'
const maxScale = () => (sharp && big() ? Math.min(window.devicePixelRatio || 1, 2) : MAX_SCALE[view] ?? 0.5)
const fpsCap = () => (sharp && big() ? 30 : FPS_CAP[view] ?? 60)
function setSharp(on) {
  sharp = on
  try { localStorage.setItem('sharp', on ? '1' : '0') } catch {}
  scale = sharp && big() ? maxScale() * 0.75 : Math.min(scale, maxScale())
  flash(sharp ? 'Sharp: full resolution, 30 fps' : 'Smooth: 60 fps, lower resolution')
  drawHud()
}

let view = W.view
let saved = [] // the user's own scenes: { id, src, at }
let scene = null // the one running: an entry plus { meta, bytes }
let previous = null // the id to fall back to if the GPU drops this one
let loadedAt = performance.now()
let error = ''
const cam = { x: 0, y: 2, z: 0, yaw: 0, pitch: 0, yawVel: 0, pitchVel: 0, vel: [0, 0, 0] }
let autopilot = true
let speedMul = 1
const keys = new Set()
let reading = null // what the last probe said about the space around the camera
let unstick = 0 // probes left to climb out of rock after a respawn
let scale = Math.min(maxScale(), 1) * 0.8
let fps = 0

const clamp = (x, a, b) => Math.min(b, Math.max(a, x))
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (v) => {
  const l = Math.hypot(...v)
  return l > 1e-6 ? v.map((c) => c / l) : [0, 1, 0]
}

const all = () => [...SEEDS.map((s) => ({ ...s, builtIn: true })), ...saved]
const titleOf = (entry) => meta(entry.src).title

// ---- the camera --------------------------------------------------------------------------------

function basis(c = cam) {
  const cp = Math.cos(c.pitch)
  const f = [Math.sin(c.yaw) * cp, Math.sin(c.pitch), Math.cos(c.yaw) * cp]
  const r = norm(cross([0, 1, 0], f))
  return { f, r, u: cross(f, r) }
}

function camUniform(c = cam) {
  const { f, r, u } = basis(c)
  return { pos: [c.x, c.y, c.z], basis: [...r, ...u, ...f] }
}

const speed = () => (scene?.meta.speed ?? 3) * speedMul
const lookahead = () => clamp(speed() * 1.2, 1.5, 10)

function respawn() {
  const s = scene.meta.spawn
  Object.assign(cam, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: 0, yawVel: 0, pitchVel: 0, vel: [0, 0, 0] })
  reading = null
  unstick = 60
}

/** Where map() is read each frame: the camera and six points around it (the gradient), then five
 * points a look-ahead away (straight on, right, left, up, down), then one nearer straight on. */
function probePoints() {
  const { f, r } = basis()
  const p = [cam.x, cam.y, cam.z]
  const L = lookahead()
  const e = 0.15
  const dir = (a, b, wb) => norm(add(a, b, wb))
  return [
    p,
    add(p, [e, 0, 0]), add(p, [-e, 0, 0]), add(p, [0, e, 0]), add(p, [0, -e, 0]), add(p, [0, 0, e]), add(p, [0, 0, -e]),
    add(p, f, L),
    add(p, dir(f, r, 1), L), add(p, dir(f, r, -1), L),
    add(p, dir(f, [0, 1, 0], 1), L), add(p, dir(f, [0, 1, 0], -1), L),
    add(p, f, L * 0.4)
  ]
}

function applyReading({ d }) {
  const grad = norm([d[1] - d[2], d[3] - d[4], d[5] - d[6]])
  const now = { d0: d[0], grad, ahead: d[7], right: d[8], left: d[9], up: d[10], down: d[11], near: d[12] }
  // Steering reads a smoothed copy: raw readings jitter frame to frame, and steering on jitter
  // shakes the camera. Collision (d0, grad) stays raw, so it is never late.
  if (!reading) reading = now
  else for (const k of ['ahead', 'right', 'left', 'up', 'down', 'near']) reading[k] += (now[k] - reading[k]) * 0.3
  reading.d0 = now.d0
  reading.grad = grad
  if (unstick > 0) {
    // A spawn (or a respawn) inside rock climbs until it is in the open.
    if (d[0] < 0.4) {
      cam.y += Math.max(0.5, 0.4 - d[0])
      unstick--
      return
    }
    unstick = 0
  }
  if (d[0] <= -0.95) return void (unstick = 60) // deep inside something: climb out
  const R = 0.25
  if (d[0] < R) {
    const k = R - d[0]
    cam.x += grad[0] * k
    cam.y += grad[1] * k
    cam.z += grad[2] * k
  }
}

/** The autopilot: wander, turn toward the more open side when something is ahead, keep off floors. */
function steer(dt, t) {
  let yawT = 0.22 * Math.sin(t * 0.13) + 0.12 * Math.sin(t * 0.37 + 1)
  let pitchT = -cam.pitch * 0.8
  if (reading) {
    const L = lookahead()
    const danger = clamp(1 - reading.ahead / (L * 0.7), 0, 1)
    if (danger > 0) {
      // In proportion to how much more open one side is: equal sides mean no turn, not a coin flip.
      const side = (reading.right - reading.left) / (Math.abs(reading.right) + Math.abs(reading.left) + 0.5)
      yawT = side * 2.5 * danger + yawT * (1 - danger)
      // Turn first; climb or dive only when both sides are shut, so it stays down in a canyon.
      const boxedIn = Math.max(reading.left, reading.right) < L * 0.5
      if (boxedIn) pitchT += ((reading.up - reading.down) / (Math.abs(reading.up) + Math.abs(reading.down) + 0.5)) * 1.5 * danger
    }
    // Hover in a band over the ground: sink above it, lift below it. (A scene may scale map() down,
    // so these are small numbers in map()'s own units, not true distances.)
    if (reading.down > 2) pitchT -= Math.min(0.3, (reading.down - 2) * 0.1)
    if (reading.down < 1.2) pitchT += (1.2 - reading.down) * 0.8
    if (reading.up < 1.2) pitchT -= (1.2 - reading.up) * 0.8
  }
  cam.yawVel += (yawT - cam.yawVel) * Math.min(1, dt * 2)
  cam.pitchVel += (pitchT - cam.pitchVel) * Math.min(1, dt * 2)
  cam.yaw += cam.yawVel * dt
  cam.pitch = clamp(cam.pitch + cam.pitchVel * dt, -0.9, 0.9)
}

function update(dt, t) {
  const { f, r } = basis()
  let v = [0, 0, 0]
  if (autopilot) {
    steer(dt, t)
    const room = reading ? clamp(Math.min(reading.ahead, reading.near * 2.5) / lookahead(), 0.25, 1) : 0.5
    v = basis().f.map((c) => c * speed() * room)
    cam.vel = v
  } else {
    const on = (...codes) => codes.some((c) => keys.has(c))
    // Turning: keys and the right stick set a target rate; the camera eases toward it, so a look
    // starts and stops softly instead of snapping.
    let yawT = pad.look[0] * 2.2, pitchT = pad.look[1] * 1.6
    if (on('ArrowLeft')) yawT -= 1.6
    if (on('ArrowRight')) yawT += 1.6
    if (on('ArrowUp')) pitchT += 1.2
    if (on('ArrowDown')) pitchT -= 1.2
    const ease = (k) => 1 - Math.exp(-dt * k)
    cam.yawVel += (yawT - cam.yawVel) * ease(10)
    cam.pitchVel += (pitchT - cam.pitchVel) * ease(10)
    cam.yaw += cam.yawVel * dt
    cam.pitch = clamp(cam.pitch + cam.pitchVel * dt, -1.5, 1.5)
    let m = [0, 0, 0]
    if (on('KeyW')) m = add(m, f)
    if (on('KeyS')) m = add(m, f, -1)
    if (on('KeyD')) m = add(m, r)
    if (on('KeyA')) m = add(m, r, -1)
    if (on('Space', 'KeyE')) m = add(m, [0, 1, 0])
    if (on('ShiftLeft', 'ShiftRight', 'KeyQ')) m = add(m, [0, -1, 0])
    if (Math.hypot(...m) > 0) m = norm(m)
    // The left stick is analog: half a push is half the speed. Triggers lift and sink.
    m = add(add(add(m, f, pad.move[1]), r, pad.move[0]), [0, 1, 0], pad.lift)
    const l = Math.hypot(...m)
    if (l > 1) m = m.map((c) => c / l)
    const target = m.map((c) => c * speed() * 2 * (pad.boost ? 3 : 1))
    // Velocity eases toward the target: a glide in, a glide out.
    const k = ease(l > 0.01 ? 3.5 : 2.5)
    cam.vel = cam.vel.map((c, i) => c + (target[i] - c) * k)
    v = cam.vel
  }
  let step = dt
  const move = Math.hypot(...v) * dt
  if (reading && move > 0) {
    // Never step further than the nearest surface: a ray march, one step a frame.
    const most = Math.max(reading.d0 * 0.8, 0.02)
    if (move > most) step = (dt * most) / move
  }
  cam.x += v[0] * step
  cam.y += v[1] * step
  cam.z += v[2] * step
}

// ---- scenes ------------------------------------------------------------------------------------

function activate(entry, compiled) {
  const r = compiled ?? renderer.compile(entry.src)
  if (!r.ok) return r
  renderer.use(r.program)
  if (scene && scene.id !== entry.id) previous = scene.id
  scene = { ...entry, meta: meta(entry.src), bytes: size(entry.src) }
  respawn()
  loadedAt = performance.now()
  error = ''
  pending = null
  W.head.set({ title: scene.meta.title, badge: formatSize(scene.bytes) }).catch(() => {})
  W.storage.set('current', entry.id).catch(() => {})
  drawHud()
  return r
}

function step(k) {
  const list = all()
  const i = list.findIndex((s) => s.id === scene?.id)
  const next = list[(i + k + list.length) % list.length]
  const r = activate(next)
  if (!r.ok) {
    error = `${titleOf(next)} did not compile`
    drawHud()
  }
}

function find(arg) {
  const list = all()
  const n = Number(arg)
  if (Number.isInteger(n) && n >= 1 && n <= list.length) return list[n - 1]
  const q = String(arg ?? '').trim().toLowerCase()
  return list.find((s) => titleOf(s).toLowerCase() === q) ?? list.find((s) => titleOf(s).toLowerCase().startsWith(q))
}

async function remove(id) {
  saved = saved.filter((s) => s.id !== id)
  await W.storage.set('scenes', saved)
  if (scene?.id === id) activate(all().find((s) => s.id === previous) ?? all()[0])
}

// ---- the frame loop ----------------------------------------------------------------------------

let last = performance.now()
let lastDraw = 0
let slow = 0
let quick = 0

function adapt(dt) {
  const target = 1 / fpsCap()
  fps = fps ? fps * 0.95 + (1 / dt) * 0.05 : 1 / dt
  if (dt > target * 1.35) {
    quick = 0
    if (++slow > 5) {
      scale = Math.max(0.15, scale * 0.85)
      slow = 0
    }
  } else if (dt < target * 1.12) {
    slow = 0
    if (++quick > 60) {
      scale = Math.min(maxScale(), scale * 1.08)
      quick = 0
    }
  }
}

function resize() {
  const w = Math.max(32, Math.round(canvas.clientWidth * scale))
  const h = Math.max(18, Math.round(canvas.clientHeight * scale))
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
}

function tick(now) {
  requestAnimationFrame(tick)
  if (document.hidden || !scene || renderer.lost) {
    last = now
    return
  }
  if (now - lastDraw < 1000 / fpsCap() - 2) return
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  lastDraw = now
  const res = renderer.poll()
  if (res) applyReading(res)
  const t = (now - loadedAt) / 1000
  readPad(dt)
  update(dt, t)
  renderer.probe(probePoints(), camUniform(), t)
  resize()
  renderer.draw(canvas.width, canvas.height, camUniform(), t, STEPS[view] ?? 120)
  adapt(dt)
}

// ---- a game controller (standard mapping: Xbox, PlayStation, Switch Pro) ------------------------
// Left stick flies, right stick looks, the triggers rise and sink, bumpers change speed, a stick
// click boosts, A respawns, Y toggles the autopilot, the d-pad's left and right change worlds.
const pad = { move: [0, 0], look: [0, 0], lift: 0, boost: false, held: [], name: null }
const curve = (x, dz = 0.14) => {
  const a = Math.abs(x)
  return a < dz ? 0 : Math.sign(x) * ((a - dz) / (1 - dz)) ** 1.8
}
function readPad(dt) {
  let gp = null
  try {
    for (const g of navigator.getGamepads?.() ?? []) if (g?.connected) { gp = g; break }
  } catch { gp = null }
  pad.name = gp?.id ?? null
  if (!gp) {
    pad.move = [0, 0]; pad.look = [0, 0]; pad.lift = 0; pad.boost = false
    return
  }
  const val = (i) => gp.buttons[i]?.value ?? 0
  const down = (i) => !!gp.buttons[i]?.pressed
  const ax = (i) => curve(gp.axes[i] ?? 0)
  pad.move = [ax(0), -ax(1)]
  pad.look = [ax(2), -ax(3)]
  pad.lift = val(7) - val(6)
  pad.boost = down(10) || down(11)
  if (down(4)) speedMul = clamp(speedMul * Math.exp(-dt * 1.2), 0.2, 8)
  if (down(5)) speedMul = clamp(speedMul * Math.exp(dt * 1.2), 0.2, 8)
  const pressed = (i) => down(i) && !pad.held[i]
  const active = Math.hypot(...pad.move, ...pad.look, pad.lift) > 0 || gp.buttons.some((b) => b.pressed)
  if (pressed(3)) {
    autopilot = !autopilot
    drawHud()
  } else if (active && autopilot) {
    autopilot = false
    drawHud()
  }
  if (pressed(0)) respawn()
  if (pressed(8) || pressed(9)) setSharp(!sharp)
  if (pressed(14)) step(-1)
  if (pressed(15)) step(1)
  if (active) wake()
  pad.held = gp.buttons.map((b) => b.pressed)
}
addEventListener('gamepadconnected', (e) => flash(`Controller: ${e.gamepad.id.replace(/\s*\(.*$/, '')}`))

// ---- the HUD -----------------------------------------------------------------------------------

function el(tag, cls, text) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

function button(text, title, onClick, cls = '') {
  const b = el('button', cls, text)
  b.title = title
  b.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick(b)
  })
  b.addEventListener('pointerdown', (e) => e.stopPropagation())
  return b
}

let armed = null

function drawHud() {
  hud.replaceChildren()
  document.body.dataset.view = view
  if (!scene) return
  const asked = pending && el('div', 'pending', `${pending.name} is making it…`)
  if (view === 'tile' || view === 'float') {
    if (error) hud.append(el('div', 'error', error))
    if (asked) hud.append(asked)
    return
  }
  const bar = el('div', 'bar')
  bar.append(button('‹', 'Previous world (,)', () => step(-1)), el('span', 'title', scene.meta.title), button('›', 'Next world (.)', () => step(1)))
  const chip = el('span', `chip${scene.bytes > BUDGET ? ' over' : ''}`, `${formatSize(scene.bytes)} / 4 KB`)
  chip.title = 'The scene minified, as a 4K intro counts it'
  bar.append(chip)
  bar.append(
    button(autopilot ? 'Autopilot on' : 'Autopilot off', 'Fly by itself (P)', () => {
      autopilot = !autopilot
      drawHud()
    }, autopilot ? 'on' : '')
  )
  bar.append(button('Sharp', 'Full resolution at 30 fps, or lower resolution at 60 (H)', () => setSharp(!sharp), sharp ? 'on' : ''))
  if (view === 'pane') bar.append(button('Full window', 'Fly over the whole window (F)', () => W.openOverlay().catch((e) => flash(e.message))))
  if (!scene.builtIn) {
    bar.append(
      button(armed === scene.id ? 'Delete?' : '×', 'Delete this world', (b) => {
        if (armed === scene.id) {
          armed = null
          remove(scene.id)
          return
        }
        armed = scene.id
        drawHud()
        setTimeout(() => {
          if (armed) {
            armed = null
            drawHud()
          }
        }, 3000)
      }, armed === scene.id ? 'danger' : '')
    )
  }
  hud.append(bar)
  if (error) hud.append(el('div', 'error', error))
  if (asked) hud.append(asked)
  help.textContent = 'drag to look · WASD fly · Space / Q up and down · arrows turn · wheel speed · P autopilot · H sharp · R respawn · , . worlds · controller: sticks fly and look, triggers up and down, bumpers speed, Y autopilot'
  wake()
}

function flash(text) {
  error = text
  drawHud()
}

let idle
function wake() {
  document.body.classList.remove('quiet')
  clearTimeout(idle)
  idle = setTimeout(() => document.body.classList.add('quiet'), 5000)
}

// ---- input -------------------------------------------------------------------------------------

let drag = null
canvas.addEventListener('pointerdown', (e) => {
  if (view === 'tile') return void W.openPane().catch(() => {})
  if (view === 'float') return
  canvas.focus()
  drag = { x: e.clientX, y: e.clientY, moved: false }
  canvas.setPointerCapture(e.pointerId)
})
canvas.addEventListener('pointermove', (e) => {
  wake()
  if (!drag) return
  const dx = e.clientX - drag.x
  const dy = e.clientY - drag.y
  if (!drag.moved && Math.hypot(dx, dy) < 3) return
  if (!drag.moved && autopilot) {
    autopilot = false
    drawHud()
  }
  drag.moved = true
  cam.yaw += dx * 0.004
  cam.pitch = clamp(cam.pitch - dy * 0.004, -1.5, 1.5)
  cam.yawVel = cam.pitchVel = 0
  drag.x = e.clientX
  drag.y = e.clientY
})
const endDrag = () => (drag = null)
canvas.addEventListener('pointerup', endDrag)
canvas.addEventListener('pointercancel', endDrag)

const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyE', 'KeyQ', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
addEventListener('keydown', (e) => {
  if (view === 'tile' || view === 'float' || e.metaKey || e.ctrlKey || e.altKey) return
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return // typing a prompt
  wake()
  if (MOVE.has(e.code)) {
    keys.add(e.code)
    if (autopilot) {
      autopilot = false
      drawHud()
    }
  } else if (e.code === 'KeyP') {
    autopilot = !autopilot
    drawHud()
  } else if (e.code === 'KeyR') respawn()
  else if (e.code === 'KeyH') setSharp(!sharp)
  else if (e.code === 'KeyF' && view === 'pane') W.openOverlay().catch((err) => flash(err.message))
  else if (e.code === 'Comma') step(-1)
  else if (e.code === 'Period') step(1)
  else return
  e.preventDefault()
})
addEventListener('keyup', (e) => keys.delete(e.code))
addEventListener('blur', () => keys.clear())
addEventListener(
  'wheel',
  (e) => {
    if (view === 'tile' || view === 'float') return // the column's
    e.preventDefault()
    speedMul = clamp(speedMul * Math.exp(-e.deltaY * 0.002), 0.2, 8)
  },
  { passive: false }
)

W.onViewChange((v) => {
  view = v
  scale = Math.min(scale, maxScale())
  if (v === 'tile') {
    autopilot = true
    keys.clear()
  }
  drawHud()
})

// ---- the prompt box: the user asks a session for a world ---------------------------------------
// The tile has no model of its own. What the user types goes to one of their sessions as a line
// it reads as the user asking; the session writes the world and loads it here through the door.

const ask = document.getElementById('ask')
const askInput = ask.querySelector('input')
const picker = ask.querySelector('select')
let open = [] // the sessions a request can go to
let pick = null // the one chosen
let pending = null // { name } while a session is making a world
let pendingTimer

function drawPicker() {
  picker.replaceChildren(
    ...open.map((s) => {
      const o = el('option', null, s.name || 'session')
      o.value = s.id
      o.selected = s.id === pick
      return o
    })
  )
  const none = open.length === 0
  picker.hidden = none
  askInput.disabled = none
  ask.querySelector('button').disabled = none
  askInput.placeholder = none ? 'Open a session to make worlds' : 'Describe a world…'
}

function setSessions(list) {
  open = list.filter((s) => s.open !== false && s.status !== 'dead')
  if (!open.some((s) => s.id === pick)) pick = (open.find((s) => s.focused) ?? open[0])?.id ?? null
  drawPicker()
}

/** One line, as if the user had typed it to the session. Their words are quoted and kept to one line. */
function request(text) {
  const showing = scene ? ` The tile is showing "${scene.meta.title}": if they want that one changed, start from \`node "$WORKSHOP_TILE" demoscene get\`; otherwise make a new world with its own @title.` : ''
  return `[Demoscene] The user asked the Demoscene tile for a world: "${text}".${showing} If you have not read it in this conversation, run \`node "$WORKSHOP_TILE" demoscene guide\` first and follow it: load the world, look at a snap, fix what you see, then answer in a line.`
}

picker.addEventListener('change', () => {
  pick = picker.value
  W.storage.set('pick', pick).catch(() => {})
})
ask.addEventListener('pointerdown', (e) => e.stopPropagation())
ask.addEventListener('submit', async (e) => {
  e.preventDefault()
  const text = askInput.value.replace(/\s+/g, ' ').replace(/"/g, "'").trim().slice(0, 1000)
  if (!text) return
  const who = open.find((s) => s.id === pick)
  if (!who) return flash('Open a session first: it is what makes the world.')
  if (who.status === 'blocked') return flash(`${who.name} is waiting for you. Answer it first, or pick another session.`)
  try {
    await W.sessions.paste(who.id, request(text))
  } catch (err) {
    return flash(err.message)
  }
  askInput.value = ''
  askInput.blur()
  error = ''
  pending = { name: who.name }
  clearTimeout(pendingTimer)
  pendingTimer = setTimeout(() => {
    pending = null
    drawHud()
  }, 10 * 60_000)
  W.head.set({ title: scene?.meta.title ?? 'Demoscene', badge: 'making…' }).catch(() => {})
  drawHud()
})

// ---- the door: how a Claude session makes and shows worlds -------------------------------------

W.door.handle('guide', async () => (await fetch('guide.md')).text())

W.door.handle('load', async (args) => {
  const src = (args.length === 1 ? args[0] : args.join(' ')).trim()
  if (!src) throw new Error('usage: load "$(cat scene.glsl)", the whole scene as one argument')
  if (src.length > MAX_SOURCE) throw new Error(`the scene is ${src.length} characters; the most is ${MAX_SOURCE}`)
  if (!/\bfloat\s+map\s*\(\s*vec3\b/.test(src)) throw new Error('a scene must define float map(vec3 p): the distance from p to the nearest surface')
  const r = renderer.compile(src)
  if (!r.ok) throw new Error(`it did not compile:\n${r.log}`)
  const title = meta(src).title
  const same = scene && !scene.builtIn && titleOf(scene) === title ? saved.find((s) => s.id === scene.id) : null
  let entry
  if (same) {
    same.src = src
    same.at = Date.now()
    entry = same
  } else {
    entry = { id: `s${Date.now().toString(36)}`, src, at: Date.now() }
    saved.push(entry)
    while (saved.length > MAX_SCENES) saved.shift()
  }
  await W.storage.set('scenes', saved)
  activate(entry, r)
  const bytes = size(src)
  return {
    title,
    bytes,
    budget: BUDGET,
    ...(bytes > BUDGET ? { note: `over the ${BUDGET}-byte budget` } : {}),
    replaced: Boolean(same),
    world: all().findIndex((s) => s.id === entry.id) + 1
  }
})

W.door.handle('get', async (args) => {
  const entry = args[0] ? find(args[0]) : scene
  if (!entry) throw new Error(`no world called "${args[0]}"; see list`)
  return entry.src
})

W.door.handle('list', async () =>
  all().map((s, i) => ({ n: i + 1, title: titleOf(s), bytes: size(s.src), builtIn: Boolean(s.builtIn), current: s.id === scene?.id }))
)

W.door.handle('show', async (args) => {
  const entry = find(args.join(' '))
  if (!entry) throw new Error(`no world "${args.join(' ')}"; see list`)
  const r = activate(entry)
  if (!r.ok) throw new Error(`it did not compile:\n${r.log}`)
  return { title: titleOf(entry) }
})

W.door.handle('status', async () => ({
  title: scene?.meta.title ?? null,
  bytes: scene?.bytes ?? 0,
  budget: BUDGET,
  view,
  autopilot,
  fps: Math.round(fps),
  resolution: [canvas.width, canvas.height],
  sharp,
  scale: +scale.toFixed(2),
  camera: { x: +cam.x.toFixed(2), y: +cam.y.toFixed(2), z: +cam.z.toFixed(2), yaw: Math.round((cam.yaw * 180) / Math.PI), pitch: Math.round((cam.pitch * 180) / Math.PI) },
  clearance: reading ? +reading.d0.toFixed(2) : null,
  gamepad: pad.name,
  error: error || null
}))

W.door.handle('snap', async (args) => {
  if (!scene) throw new Error('nothing is running')
  let c = cam
  if (args[0] === 'spawn') {
    const s = scene.meta.spawn
    c = { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: 0 }
  } else if (args.length >= 3) {
    const [x, y, z, yaw = 0, pitch = 0] = args.map(Number)
    if (![x, y, z, yaw, pitch].every(Number.isFinite)) throw new Error('usage: snap [spawn | x y z [yaw pitch]] (degrees)')
    c = { x, y, z, yaw: (yaw * Math.PI) / 180, pitch: (pitch * Math.PI) / 180 }
  }
  return renderer.snap(640, 360, camUniform(c), (performance.now() - loadedAt) / 1000, 220)
})

// ---- start -------------------------------------------------------------------------------------

let renderer
try {
  renderer = new Renderer(canvas, {
    onLost: () => {
      error = 'The GPU dropped this world: a frame took too long to draw. Going back to the one before.'
      drawHud()
    },
    onRestored: () => {
      const msg = error
      const back = all().find((s) => s.id === previous) ?? all()[0]
      scene = null
      activate(back)
      error = msg
      drawHud()
    }
  })
} catch (e) {
  hud.append(el('div', 'error', e.message))
  throw e
}

const [stored, current, picked] = await Promise.all(['scenes', 'current', 'pick'].map((k) => W.storage.get(k).catch(() => null)))
pick = typeof picked === 'string' ? picked : null
W.sessions.list().then(setSessions, () => {})
W.sessions.watch(setSessions)
saved = Array.isArray(stored) ? stored.filter((s) => s && typeof s.id === 'string' && typeof s.src === 'string') : []
const first = all().find((s) => s.id === current) ?? all()[0]
if (!activate(first).ok) activate(all()[0])
requestAnimationFrame(tick)
