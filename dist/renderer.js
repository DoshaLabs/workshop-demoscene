// WebGL 2: one fullscreen triangle and one fragment shader, as a 4K intro draws. Also a 16 × 1
// "probe" pass that evaluates the scene's map() at points the flight code asks about (collision,
// the autopilot's look-ahead), read back asynchronously so the frame never waits on the GPU.

import { build, explainLog } from './scene.js'

const VERT = `#version 300 es
in vec2 a;
void main(){ gl_Position = vec4(a, 0.0, 1.0); }`

export const PROBES = 16

export class Renderer {
  constructor(canvas, { onLost, onRestored } = {}) {
    this.canvas = canvas
    this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'low-power' })
    if (!this.gl) throw new Error('WebGL 2 is not available')
    this.lost = false
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      this.lost = true
      this.program = null
      this.sync = null
      onLost?.()
    })
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false
      this.init()
      onRestored?.()
    })
    this.init()
  }

  init() {
    const gl = this.gl
    this.vs = gl.createShader(gl.VERTEX_SHADER)
    gl.shaderSource(this.vs, VERT)
    gl.compileShader(this.vs)
    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.probeTarget = this.target(PROBES, 1)
    this.pbo = gl.createBuffer()
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo)
    gl.bufferData(gl.PIXEL_PACK_BUFFER, PROBES * 4, gl.STREAM_READ)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    this.program = null
    this.sync = null
  }

  target(w, h) {
    const gl = this.gl
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    const fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { fbo, tex, w, h }
  }

  /** Compiles a scene. { ok: true, program } or { ok: false, log } with the scene's line numbers. */
  compile(src) {
    const gl = this.gl
    if (this.lost) return { ok: false, log: 'the GPU context is lost; try again in a moment' }
    const fs = gl.createShader(gl.FRAGMENT_SHADER)
    gl.shaderSource(fs, build(src))
    gl.compileShader(fs)
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(fs) || 'the shader did not compile (no log)'
      gl.deleteShader(fs)
      return { ok: false, log: explainLog(log, this.lineOffset ?? 0) }
    }
    const p = gl.createProgram()
    gl.attachShader(p, this.vs)
    gl.attachShader(p, fs)
    gl.bindAttribLocation(p, 0, 'a')
    gl.linkProgram(p)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p) || 'the shader did not link (no log)'
      gl.deleteProgram(p)
      return { ok: false, log: explainLog(log, this.lineOffset ?? 0) }
    }
    const u = (n) => gl.getUniformLocation(p, n)
    const program = {
      p,
      res: u('iResolution'),
      time: u('iTime'),
      pos: u('uPos'),
      cam: u('uCam'),
      mode: u('uMode'),
      steps: u('uSteps'),
      probe: u('uProbe[0]') ?? u('uProbe')
    }
    return { ok: true, program }
  }

  use(program) {
    if (this.program && this.program !== program) this.gl.deleteProgram(this.program.p)
    this.program = program
    this.sync = null
  }

  /** Sets the uniforms every pass shares. cam: { pos: [x,y,z], basis: 9 numbers, columns right, up, forward }. */
  uniforms(w, h, cam, time, steps, mode) {
    const gl = this.gl
    const P = this.program
    gl.useProgram(P.p)
    gl.uniform2f(P.res, w, h)
    gl.uniform1f(P.time, time)
    gl.uniform3fv(P.pos, cam.pos)
    gl.uniformMatrix3fv(P.cam, false, cam.basis)
    gl.uniform1i(P.mode, mode)
    gl.uniform1i(P.steps, steps)
  }

  draw(w, h, cam, time, steps) {
    if (!this.program || this.lost) return
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, w, h)
    this.uniforms(w, h, cam, time, steps, 0)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** Asks for map() at up to 16 points. False if a reading is still on its way. */
  probe(points, cam, time) {
    if (!this.program || this.lost || this.sync) return false
    const gl = this.gl
    const flat = new Float32Array(PROBES * 3)
    points.slice(0, PROBES).forEach((p, i) => flat.set(p, i * 3))
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.probeTarget.fbo)
    gl.viewport(0, 0, PROBES, 1)
    this.uniforms(PROBES, 1, cam, time, 0, 1)
    gl.uniform3fv(this.program.probe, flat)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo)
    gl.readPixels(0, 0, PROBES, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    gl.flush()
    this.asked = points
    return true
  }

  /** The distances from the last probe once the GPU has them, else null. */
  poll() {
    if (!this.sync || this.lost) return null
    const gl = this.gl
    const s = gl.clientWaitSync(this.sync, 0, 0)
    if (s !== gl.ALREADY_SIGNALED && s !== gl.CONDITION_SATISFIED) return null
    gl.deleteSync(this.sync)
    this.sync = null
    const px = new Uint8Array(PROBES * 4)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo)
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, px)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    const d = []
    for (let i = 0; i < PROBES; i++) d.push(((px[i * 4] + px[i * 4 + 1] / 255) / 255) * 33 - 1)
    return { points: this.asked, d }
  }

  /** One frame at w × h off screen, as a JPEG's base64. */
  snap(w, h, cam, time, steps) {
    if (!this.program || this.lost) throw new Error('nothing is running')
    const gl = this.gl
    const t = this.target(w, h)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
    gl.viewport(0, 0, w, h)
    this.uniforms(w, h, cam, time, steps, 0)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    const px = new Uint8Array(w * h * 4)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.deleteFramebuffer(t.fbo)
    gl.deleteTexture(t.tex)
    if (this.lost || gl.isContextLost()) throw new Error('the GPU dropped the scene while drawing it: map() is too slow')
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    const img = ctx.createImageData(w, h)
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4)
    ctx.putImageData(img, 0, 0)
    return c.toDataURL('image/jpeg', 0.88).split(',')[1]
  }
}
