import { test } from 'node:test'
import assert from 'node:assert/strict'
import { meta, minified, size, features, build, explainLog, clean, HOST_LINE } from '../dist/scene.js'
import { SEEDS } from '../dist/scenes.js'

test('meta reads title, spawn and speed from comments', () => {
  const m = meta('// @title  Glass city \n// @spawn 1 2.5 -3 90\n// @speed 7\nfloat map(vec3 p){return p.y;}')
  assert.equal(m.title, 'Glass city')
  assert.deepEqual([m.spawn.x, m.spawn.y, m.spawn.z], [1, 2.5, -3])
  assert.ok(Math.abs(m.spawn.yaw - Math.PI / 2) < 1e-9)
  assert.equal(m.speed, 7)
})

test('meta has defaults and clamps speed', () => {
  const m = meta('float map(vec3 p){return p.y;}\n// @speed 9999')
  assert.equal(m.title, 'Untitled')
  assert.deepEqual([m.spawn.x, m.spawn.y, m.spawn.z], [0, 2, 0])
  assert.equal(m.speed, 50)
})

test('minified drops comments and spaces but keeps preprocessor lines', () => {
  const src = '// hi\n#define FOG 0.02\nfloat map( vec3 p ) {\n  /* x */ return p.y - 1.0 ;\n}\n'
  assert.equal(minified(src), '#define FOG 0.02\nfloat map(vec3 p){return p.y-1.0;}')
  assert.equal(size(src), minified(src).length)
})

test('features finds optional functions', () => {
  assert.deepEqual(features('vec3 sky (vec3 rd){} vec3 glow(vec3 p, vec3 n){}'), { sky: true, material: false, glow: true, render: false })
})

test('build puts the scene at line 1 and defines what it has', () => {
  const out = build('#version 300 es\nprecision mediump float;\nfloat map(vec3 p){return p.y;}\nvec3 sky(vec3 r){return r;}')
  assert.match(out, /#define HAS_SKY/)
  assert.doesNotMatch(out, /#define HAS_MATERIAL/)
  assert.equal(out.match(/#version/g).length, 1)
  assert.match(out, new RegExp(`#line 1\\n[\\s\\S]*float map[\\s\\S]*#line ${HOST_LINE}`))
  assert.equal(clean('precision highp float;\nx').trim(), 'x')
})

test('explainLog maps lines and flags renderer errors', () => {
  const log = "ERROR: 0:3: 'foo' : undeclared identifier\nERROR: 0:10012: 'map' : no matching overloaded function found\n"
  const out = explainLog(log)
  assert.match(out, /line 3:/)
  assert.match(out, /\(renderer\)/)
  assert.match(out, /missing `float map\(vec3 p\)`/)
})

test('every seed has a title, a map and fits the budget', () => {
  for (const s of SEEDS) {
    assert.match(s.src, /float map\(vec3 p\)/)
    assert.notEqual(meta(s.src).title, 'Untitled')
    assert.ok(size(s.src) < 4096, `${s.id} is ${size(s.src)} bytes`)
  }
})
