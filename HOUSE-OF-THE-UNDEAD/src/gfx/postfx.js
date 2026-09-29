// postfx.js — HDR pipeline: the scene renders into a half-float MSAA target,
// bright areas bloom through a mip chain (13-tap down / tent up), then a
// composite pass tone-maps (ACES), grades, vignettes, adds grain, and writes
// sRGB to the screen. Self-contained (no three.js addons needed).

import * as THREE from 'three';
import { STYLE } from './style.js';

const FULL_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const PREFILTER = /* glsl */`
  uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee;
  varying vec2 vUv;
  vec3 samp(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
  void main() {
    vec3 c = (samp(vec2(-1.0,-1.0)) + samp(vec2(1.0,-1.0)) + samp(vec2(-1.0,1.0)) + samp(vec2(1.0,1.0))) * 0.25;
    // one bad pixel (NaN/Inf) must never smear across the whole bloom chain
    if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
    float br = max(c.r, max(c.g, c.b));
    float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-4);
    float w = max(soft, br - uThreshold) / max(br, 1e-4);
    c = min(c * w, vec3(8.0));    // cap fireflies from tiny specular hot spots
    gl_FragColor = vec4(c, 1.0);
  }`;

const DOWN = /* glsl */`
  uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
  vec3 s(float x, float y) { return texture2D(tSrc, vUv + vec2(x, y) * uTexel).rgb; }
  void main() {
    vec3 a = s(-2.0, 2.0), b = s(0.0, 2.0), c = s(2.0, 2.0);
    vec3 d = s(-2.0, 0.0), e = s(0.0, 0.0), f = s(2.0, 0.0);
    vec3 g = s(-2.0, -2.0), h = s(0.0, -2.0), i = s(2.0, -2.0);
    vec3 j = s(-1.0, 1.0), k = s(1.0, 1.0), l = s(-1.0, -1.0), m = s(1.0, -1.0);
    vec3 o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
    gl_FragColor = vec4(o, 1.0);
  }`;

const UP = /* glsl */`
  uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uRadius; varying vec2 vUv;
  vec3 s(float x, float y) { return texture2D(tSrc, vUv + vec2(x, y) * uTexel * uRadius).rgb; }
  void main() {
    vec3 o = s(0.0, 0.0) * 4.0 + (s(-1.0, 0.0) + s(1.0, 0.0) + s(0.0, -1.0) + s(0.0, 1.0)) * 2.0
           + s(-1.0, -1.0) + s(1.0, -1.0) + s(-1.0, 1.0) + s(1.0, 1.0);
    gl_FragColor = vec4(o / 16.0, 1.0);
  }`;

const COMPOSITE = /* glsl */`
  uniform sampler2D tScene; uniform sampler2D tBloom;
  uniform float uBloom; uniform float uExposure; uniform float uVignette; uniform float uGrain; uniform float uTime;
  uniform vec3 uTint; uniform float uSaturation; uniform float uAberr; uniform float uHurt;
  varying vec2 vUv;
  vec3 aces(vec3 x) {
    // Narkowicz ACES approximation, a touch of shoulder for neon highlights
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec2 d = vUv - 0.5;
    vec3 col;
    if (uAberr > 0.0005) {
      // hit shock: the image splits at the edges for a moment
      vec2 o = d * uAberr;
      col = vec3(texture2D(tScene, vUv + o).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - o).b);
    } else col = texture2D(tScene, vUv).rgb;
    if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
    col += texture2D(tBloom, vUv).rgb * uBloom;
    col *= uExposure * uTint;
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(l), col, uSaturation);
    col = aces(col);
    float edge = smoothstep(0.25, 0.85, dot(d, d) * 2.2);
    col *= 1.0 - uVignette * edge;
    col = mix(col, vec3(0.35, 0.0, 0.02), uHurt * edge);
    col = toSRGB(col);
    col += (hash(vUv * 1000.0 + uTime) - 0.5) * uGrain;
    gl_FragColor = vec4(col, 1.0);
  }`;


// 1930s cartoon print: ink outlines from the depth buffers (world + the gun
// layer, with a hand-drawn wobble that re-draws 12x a second), a two-strip
// Technicolor grade with cream highlights and sepia blacks, paper tooth,
// film grain, dust, scratches, projector flicker and gate weave.
const TOON = /* glsl */`
  uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tDepth;
  uniform sampler2D tOver; uniform sampler2D tOverDepth;
  uniform float uBloom; uniform float uExposure; uniform float uVignette; uniform float uTime;
  uniform vec3 uTint; uniform float uSaturation; uniform float uShake; uniform float uHurt;
  uniform vec2 uRes; uniform vec2 uNF; uniform vec2 uNFvm; uniform float uStep; uniform float uFrame; uniform float uInk; uniform float uMono; uniform float uOverOn; uniform float uInkAA;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // reciprocal view depth: flat on any plane, so floors never grow false lines
  float invZ(sampler2D t, vec2 uv, vec2 nf) { float d = texture2D(t, uv).x; return (nf.y - d * (nf.y - nf.x)) / (nf.x * nf.y); }
  float ink(sampler2D t, vec2 uv, vec2 nf, float w, float far) {
    float c = invZ(t, uv, nf);
    if (c <= 1.0 / far + 1e-5) return 0.0;             // empty sky / a cleared layer
    vec2 px = w / uRes;
    float l = invZ(t, uv - vec2(px.x, 0.0), nf), r = invZ(t, uv + vec2(px.x, 0.0), nf);
    float d = invZ(t, uv - vec2(0.0, px.y), nf), u = invZ(t, uv + vec2(0.0, px.y), nf);
    float lap = (abs(l + r - 2.0 * c) + abs(u + d - 2.0 * c)) / c;
    float sil = max(max(abs(l - c), abs(r - c)), max(abs(u - c), abs(d - c))) / c;
    // a jump in depth only inks when the surface actually bends (a grazing floor is flat)
    return max(smoothstep(0.009, 0.026, lap), smoothstep(0.18, 0.3, sil) * smoothstep(0.003, 0.008, lap));
  }
  // objects drawn with noInk() (the chandeliers) leave alpha 0 in the scene: no outline on or around them
  float inkMask(vec2 uv, float w) {
    vec2 px = (w + 1.0) / uRes;
    float m = min(texture2D(tScene, uv).a, texture2D(tScene, uv + vec2(px.x, 0.0)).a);
    m = min(m, texture2D(tScene, uv - vec2(px.x, 0.0)).a);
    m = min(m, texture2D(tScene, uv + vec2(0.0, px.y)).a);
    m = min(m, texture2D(tScene, uv - vec2(0.0, px.y)).a);
    return smoothstep(0.2, 0.8, m);
  }
  void main() {
    // gate weave: the whole print jiggles in the projector
    vec2 weave = (vec2(hash(vec2(uFrame, 2.2)), hash(vec2(uFrame, 5.9))) - 0.5) * uShake;   // (only when hit)
    vec2 uv = vUv + weave;
    vec3 col = texture2D(tScene, uv).rgb;
    if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
    col += texture2D(tBloom, uv).rgb * uBloom;
    float flick = 1.0 + (hash(vec2(uFrame, 3.1)) - 0.5) * 0.012;
    col *= uExposure * uTint * flick;
    // soft film shoulder: neon rolls off to cream instead of clipping to white
    col = 1.0 - exp(-col * 1.55);

    // ink: world outlines, thicker up close, wobbling on twos
    // (a hair of boil keeps it hand-drawn; the old wobble and pen skips read as noise)
    vec2 boil = (vec2(noise(vUv * uRes / 38.0 + uStep * 17.0), noise(vUv * uRes / 38.0 + 31.0 + uStep * 13.0)) - 0.5) * 0.3 / uRes;
    float zc = 1.0 / max(invZ(tDepth, uv, uNF), 1e-5);
    float w = (0.9 + 1.0 * uRes.y / 1080.0) * mix(1.45, 1.0, smoothstep(2.0, 14.0, zc)) * (0.9 + 0.2 * noise(vUv * uRes / 90.0));
    float inkW = ink(tDepth, uv + boil, uNF, w, uNF.y);
    if (uInkAA > 0.5) {
      // rotated-grid supersample of the line itself, so it has soft edges instead of stair-steps
      vec2 q = 1.0 / uRes;
      inkW = (inkW * 2.0 + ink(tDepth, uv + boil + vec2(0.6, 0.2) * q, uNF, w, uNF.y)
        + ink(tDepth, uv + boil + vec2(-0.2, 0.6) * q, uNF, w, uNF.y)
        + ink(tDepth, uv + boil + vec2(-0.6, -0.2) * q, uNF, w, uNF.y)
        + ink(tDepth, uv + boil + vec2(0.2, -0.6) * q, uNF, w, uNF.y)) / 6.0;
      inkW = smoothstep(0.0, 0.85, inkW);
    }
    inkW *= (1.0 - 0.75 * smoothstep(16.0, 50.0, zc)) * uInk * inkMask(uv, w);

    // the gun + hands layer (premultiplied), with its own bolder outline
    vec4 o = texture2D(tOver, uv) * uOverOn;       // no gun layer on the menus
    float oa = o.a;
    vec2 opx = 2.2 * (uRes.y / 1080.0 + 0.4) / uRes;
    float edgeA = abs(texture2D(tOver, uv + vec2(opx.x, 0.0)).a * uOverOn - oa);
    edgeA = max(edgeA, abs(texture2D(tOver, uv - vec2(opx.x, 0.0)).a * uOverOn - oa));
    edgeA = max(edgeA, abs(texture2D(tOver, uv + vec2(0.0, opx.y)).a * uOverOn - oa));
    edgeA = max(edgeA, abs(texture2D(tOver, uv - vec2(0.0, opx.y)).a * uOverOn - oa));
    float inkO = smoothstep(0.35, 0.8, edgeA);
    if (oa > 0.5) inkO = max(inkO, ink(tOverDepth, uv + boil * 0.6, uNFvm, 1.6, uNFvm.y) * 0.9);
    vec3 oc = 1.0 - exp(-o.rgb * uExposure * uTint * 1.55);
    col = col * (1.0 - oa) + oc;
    inkW *= 1.0 - oa;                                   // no world ink over the gun

    // Technicolor grade: a touch less saturated, warm, cream highlights, sepia blacks
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(lum), col, uSaturation * 1.12);
    col *= vec3(1.04, 1.0, 0.9);
    // early two-strip Technicolor: the green record carries blue — oranges, teals, no true blue
    vec3 two = vec3(col.r, col.g * 0.74 + col.b * 0.26, col.g * 0.34 + col.b * 0.66);
    col = mix(col, two, 0.4 * (1.0 - uMono));
    col = mix(vec3(0.075, 0.05, 0.04), vec3(1.0, 0.95, 0.83), clamp(col, 0.0, 1.0));
    // black & white print: silver nitrate greys, crushed a little for contrast
    float ml = dot(col, vec3(0.3, 0.59, 0.11));
    ml = smoothstep(0.0, 1.0, pow(ml, 0.72));
    col = mix(col, vec3(ml) * vec3(1.0, 0.985, 0.95), uMono);
    vec3 INK = mix(vec3(0.07, 0.045, 0.035), vec3(0.05), uMono);
    col = mix(col, INK, clamp(max(inkW, inkO), 0.0, 1.0));

    // paper tooth (fixed to the print) and grain (new every frame)
    float paper = noise(vUv * uRes / 2.5) * 0.5 + noise(vUv * uRes / 9.0) * 0.3 + noise(vUv * uRes / 45.0) * 0.2;
    float fiber = noise(vUv * uRes / vec2(80.0, 5.0)) * 0.5 + noise(vUv * uRes / vec2(6.0, 60.0)) * 0.5;
    col *= 0.955 + 0.045 * paper + 0.015 * fiber;
    col += (hash(vUv * uRes + uFrame * 7.13) - 0.5) * 0.022;
    // dust specks and hairline scratches, different every frame
    vec2 cell = floor(vUv * vec2(26.0, 15.0));
    float hc = hash(cell + uFrame * 1.7);
    if (hc > 0.9965) {
      vec2 cp = (cell + vec2(hash(cell + 1.1 + uFrame), hash(cell + 2.2 + uFrame))) / vec2(26.0, 15.0);
      float rad = (1.2 + hash(cell + 3.3) * 3.5) / uRes.y;
      float dd = length((vUv - cp) * vec2(uRes.x / uRes.y, 1.0));
      col = mix(col, hc > 0.999 ? vec3(0.98, 0.94, 0.85) : INK, smoothstep(rad, rad * 0.4, dd) * 0.5);
    }
    // (no hairline scratches: on a modern screen they read as a rendering glitch)
    // projector vignette: a warm dark oval
    vec2 dv = vUv - 0.5;
    float vig = smoothstep(0.3, 0.95, length(dv * vec2(1.0, 1.2)) * 1.4);
    col = mix(col, col * vec3(0.42, 0.3, 0.22), vig * uVignette);
    col = mix(col, vec3(0.45, 0.05, 0.03), uHurt * smoothstep(0.25, 0.85, dot(dv, dv) * 2.2));
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }`;

export class PostFX {
  constructor(renderer, { msaa = 4, bloom = true } = {}) {
    this.renderer = renderer;
    this.enabled = true;
    this.bloomOn = bloom;
    this.msaa = msaa;
    this.params = { bloom: 1.05, threshold: 0.95, knee: 0.5, exposure: 1.2, vignette: 0.68, grain: 0.04, saturation: 1.15 };
    this.tint = new THREE.Color(1, 1, 1);

    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(tri);
    this.quad.frustumCulled = false;
    this.qscene = new THREE.Scene();
    this.qscene.add(this.quad);

    const mk = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: FULL_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.mPre = mk(PREFILTER, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 }, uKnee: { value: 0.5 } });
    this.mDown = mk(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.mUp = mk(UP, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } });
    this.mUp.blending = THREE.AdditiveBlending;
    this.mComp = mk(COMPOSITE, {
      tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 1 }, uExposure: { value: 1 },
      uVignette: { value: 0.5 }, uGrain: { value: 0.03 }, uTime: { value: 0 }, uTint: { value: this.tint }, uSaturation: { value: 1 },
      uAberr: { value: 0 }, uHurt: { value: 0 },
    });
    this.toon = STYLE.cartoon;
    this.mToon = mk(TOON, {
      tScene: { value: null }, tBloom: { value: null }, tDepth: { value: null }, tOver: { value: null }, tOverDepth: { value: null },
      uBloom: { value: 0.3 }, uExposure: { value: 1 }, uVignette: { value: 0.8 }, uTime: { value: 0 }, uTint: { value: this.tint },
      uSaturation: { value: 1 }, uShake: { value: 0 }, uHurt: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
      uNF: { value: new THREE.Vector2(0.1, 200) }, uNFvm: { value: new THREE.Vector2(0.01, 6) }, uStep: { value: 0 }, uFrame: { value: 0 }, uInk: { value: 1 }, uMono: { value: STYLE.mono ? 1 : 0 }, uOverOn: { value: 0 }, uInkAA: { value: 0 },
    });
    this.hitAmt = 0;       // decaying hit shock
    this.lowHealth = 0;    // 0..1, drains color + reddens the edges
    this.targets = [];
    this.size = new THREE.Vector2();
    this._black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this._black.needsUpdate = true;
  }

  _mkTarget(w, h, samples = 0, depthTex = false) {
    const t = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, samples,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true,
    });
    if (depthTex) {
      t.depthTexture = new THREE.DepthTexture(w, h);
      t.depthTexture.type = THREE.UnsignedIntType;
      t.depthTexture.minFilter = t.depthTexture.magFilter = THREE.NearestFilter;
    }
    return t;
  }

  setSize(w, h) {
    this.size.set(w, h);
    for (const t of this.targets) t.dispose();
    if (this.scene) { this.scene.depthTexture?.dispose(); this.scene.dispose(); }
    if (this.over) { this.over.depthTexture?.dispose(); this.over.dispose(); this.over = null; }
    this.scene = this._mkTarget(w, h, this.msaa, this.toon);
    if (this.toon) this.over = this._mkTarget(w, h, this.msaa, true);   // the gun layer, drawn apart
    this.targets = [];
    let bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    for (let i = 0; i < 6 && bw > 8 && bh > 8; i++) {
      const t = new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
      this.targets.push(t);
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
    }
  }

  _pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.qscene, this.cam);
  }

  render(scene, camera, time = 0, overlay = null) {
    const r = this.renderer;
    const buf = r.getDrawingBufferSize(new THREE.Vector2());
    if (!this.scene || buf.x !== this.size.x || buf.y !== this.size.y) this.setSize(buf.x, buf.y);

    r.setRenderTarget(this.scene);
    r.render(scene, camera);
    if (this.toon) {
      // the gun renders on its own clear layer so both get their own ink
      const cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();
      r.setRenderTarget(this.over);
      r.setClearColor(0x000000, 0);
      r.clear(true, true, false);
      if (overlay) r.render(overlay.scene, overlay.camera);
      r.setClearColor(cc, ca);
    } else if (overlay) {
      // first-person layer: fresh depth so it always draws over the world
      const auto = r.autoClear;
      r.autoClear = false;
      r.clearDepth();
      r.render(overlay.scene, overlay.camera);
      r.autoClear = auto;
    }

    let bloomTex = this._black;
    if (this.bloomOn && this.targets.length) {
      const P = this.params;
      this.mPre.uniforms.tSrc.value = this.scene.texture;
      this.mPre.uniforms.uTexel.value.set(1 / this.size.x, 1 / this.size.y);
      // (the cartoon only blooms real light sources — neon, bulbs, flashes — never a white shirt)
      this.mPre.uniforms.uThreshold.value = this.toon ? Math.max(P.threshold, 1.7) : P.threshold;
      this.mPre.uniforms.uKnee.value = P.knee;
      this._pass(this.mPre, this.targets[0]);
      for (let i = 1; i < this.targets.length; i++) {
        const src = this.targets[i - 1];
        this.mDown.uniforms.tSrc.value = src.texture;
        this.mDown.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        this._pass(this.mDown, this.targets[i]);
      }
      // upsample adds onto the finer mip — must not clear it first
      const auto = r.autoClear;
      r.autoClear = false;
      for (let i = this.targets.length - 1; i > 0; i--) {
        const src = this.targets[i];
        this.mUp.uniforms.tSrc.value = src.texture;
        this.mUp.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        this._pass(this.mUp, this.targets[i - 1]);
      }
      r.autoClear = auto;
      bloomTex = this.targets[0].texture;
    }

    const P = this.params, u = this.mComp.uniforms;
    const dt = Math.min(0.1, Math.max(0, time - (this._lastT ?? time)));
    this._lastT = time;
    this.hitAmt *= Math.exp(-dt * 6);
    const pulse = this.lowHealth > 0 ? 0.75 + 0.25 * Math.sin(time * 7) : 0;
    u.tScene.value = this.scene.texture;
    u.tBloom.value = bloomTex;
    u.uBloom.value = this.bloomOn ? P.bloom : 0;
    u.uExposure.value = P.exposure;
    u.uVignette.value = P.vignette + this.lowHealth * 0.2;
    u.uGrain.value = P.grain + this.lowHealth * 0.03;
    u.uSaturation.value = P.saturation * (1 - this.lowHealth * 0.7);
    u.uAberr.value = this.hitAmt * 0.018;
    u.uHurt.value = Math.min(0.85, this.lowHealth * 0.55 * pulse + this.hitAmt * 0.35);
    u.uTime.value = time % 100;
    if (this.toon) {
      const T = this.mToon.uniforms;
      T.tScene.value = this.scene.texture;
      T.tBloom.value = bloomTex;
      T.tDepth.value = this.scene.depthTexture;
      T.tOver.value = this.over.texture;
      T.tOverDepth.value = this.over.depthTexture;
      T.uBloom.value = this.bloomOn ? P.bloom * 0.35 : 0;
      T.uExposure.value = P.exposure * 1.08;
      T.uVignette.value = 0.7 + this.lowHealth * 0.25;
      T.uSaturation.value = P.saturation * (1 - this.lowHealth * 0.7);
      T.uShake.value = this.hitAmt * 0.006;
      T.uHurt.value = u.uHurt.value;
      T.uRes.value.set(this.size.x, this.size.y);
      T.uNF.value.set(camera.near, camera.far);
      if (overlay) T.uNFvm.value.set(overlay.camera.near, overlay.camera.far);
      // a cleared multisampled layer isn't resolved, so the last gun would linger: switch it off instead
      T.uOverOn.value = overlay ? 1 : 0;
      T.uInkAA.value = this.inkAA ? 1 : 0;
      T.uStep.value = Math.floor(time * 12) % 1000;        // lines re-drawn on twos
      T.uFrame.value = Math.floor(time * 24) % 1000;       // the film runs at 24
      this._pass(this.mToon, null);
      return;
    }
    this._pass(this.mComp, null);
  }

  /** a hit lands: brief colour split + red edge */
  hit(amount = 0.5) { this.hitAmt = Math.min(1.5, this.hitAmt + 0.5 + amount); }

  dispose() {
    for (const t of this.targets) t.dispose();
    if (this.scene) this.scene.dispose();
  }
}
