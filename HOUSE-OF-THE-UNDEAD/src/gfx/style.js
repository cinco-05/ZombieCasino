// style.js — the art style switch. '1930s' (the default) makes the whole house
// look like a Golden Age cartoon, rubber hose and all: flat cel-shaded light
// bands, lamp light in painted rings, ink outlines (postfx.js), animation on
// twos with squash & stretch (character.js), white cartoon gloves
// (weapons.js), and a scratchy Technicolor film print over everything.
// 'modern' is the old physically-lit look.
//
// The lighting patch rewrites three.js shader chunks, so it has to run before
// the first material compiles: main.js imports this module first, and
// changing the style reloads the page.

import '../persist.js';          // (exe) saves restored from the file before anything reads them
import * as THREE from 'three';

function savedStyle() {
  try { return JSON.parse(localStorage.getItem('hotu_settings') || '{}').artStyle || '1930s'; } catch { return '1930s'; }
}

export const STYLE = {
  name: savedStyle(),
  get cartoon() { return this.name === '1930s' || this.name === '1930bw'; },
  get mono() { return this.name === '1930bw'; },        // black & white print, Betty Boop era
};

if (STYLE.cartoon) celShade();

/**
 * cartoon rim light: a thin warm band where a surface turns away from the
 * camera, so shapes separate from each other and from a busy background
 * (the polish pass every stylised shooter does). Patches mat in place.
 */
export function toonRim(mat, strength = 0.3, color = '1.0, 0.88, 0.66') {
  if (!STYLE.cartoon) return mat;
  const prev = mat.onBeforeCompile;
  const baseKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (sh, r) {
    prev.call(this, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
	totalEmissiveRadiance += vec3( ${color} ) * smoothstep( 0.62, 0.78, 1.0 - abs( dot( normalize( vViewPosition ), normal ) ) ) * ${strength.toFixed(3)};`);
  };
  mat.customProgramCacheKey = function () { return baseKey.call({ onBeforeCompile: prev }) + '|rim' + strength; };
  return mat;
}

/**
 * a copy of mat that the ink pass leaves alone — no outline on or around it
 * (for delicate, glowing things like the chandeliers, which inked to a black
 * tangle). Opaque surfaces flag themselves with alpha 0 in the scene buffer;
 * see inkMask() in postfx.js. Transparent ones just stop writing depth.
 */
const _noInk = new Map();
export function noInk(mat) {
  if (!STYLE.cartoon) return mat;
  let m = _noInk.get(mat);
  if (m) return m;
  m = mat.clone();
  if (m.transparent) m.depthWrite = false;
  else {
    m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace(/\}\s*$/, '\tgl_FragColor.a = 0.0;\n}'); };
    m.customProgramCacheKey = () => 'noink';
  }
  _noInk.set(mat, m);
  return m;
}

function celShade() {
  const C = THREE.ShaderChunk;
  // surface facing: three flat bands (shadow / half-tone / lit), with a hair of
  // softness on each step so the band edges don't crawl
  const band = `float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	dotNL = smoothstep( 0.0, 0.1, dotNL ) * 0.38 + smoothstep( 0.24, 0.42, dotNL ) * 0.62;`;
  const plain = 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );';
  for (const key of ['lights_physical_pars_fragment', 'lights_lambert_pars_fragment']) {
    if (!C[key].includes(plain)) { console.warn('[style] chunk changed:', key); continue; }
    C[key] = C[key].replace(plain, band);
  }
  // lamp fall-off in stepped rings (a stop per ring), like painted light pools
  const def = 'float getDistanceAttenuation(';
  const B = C.lights_pars_begin;
  if (B.includes(def) && B.includes('float getSpotAttenuation(')) {
    C.lights_pars_begin = B.replace(def, 'float getDistanceAttenuationRaw(').replace('float getSpotAttenuation(', `float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float a = getDistanceAttenuationRaw( lightDistance, cutoffDistance, decayExponent );
	if ( a <= 0.0 ) return 0.0;
	float l = log2( a ) * 1.5;
	float f = floor( l );
	return exp2( ( f + smoothstep( 0.1, 0.9, l - f ) ) / 1.5 );
}
float getSpotAttenuation(`);
  } else console.warn('[style] lights_pars_begin changed');
  // painted, not photographed: lit surfaces keep their full texture detail but
  // lean a little toward flat paint tones (unlit signs stay untouched)
  const mapLine = 'vec4 sampledDiffuseColor = texture2D( map, vMapUv );';
  if (C.map_fragment.includes(mapLine)) {
    C.map_fragment = C.map_fragment.replace(mapLine, `#ifdef STANDARD
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	{
		// full-detail texture with just a touch of painted flattening
		vec3 q = pow( max( sampledDiffuseColor.rgb, vec3( 0.0 ) ), vec3( 0.4545 ) ) * 8.0;
		q = floor( q ) + smoothstep( 0.2, 0.8, fract( q ) );
		sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, pow( q / 8.0, vec3( 2.2 ) ), 0.3 );
	}
	#else
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#endif`);
  }
  // no bump maps: cartoon surfaces are flat paint, and bumpy normals flip pixels
  // across the cel bands as the camera moves (the floor would shimmer)
  const bump = 'normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );';
  if (C.normal_fragment_maps.includes(bump)) C.normal_fragment_maps = C.normal_fragment_maps.replace(bump, '/* 1930s: flat paint */');
  // metals are painted, not mirrored: gold keeps a warm yellow base coat
  const metal = 'material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );';
  if (C.lights_physical_fragment.includes(metal)) {
    C.lights_physical_fragment = C.lights_physical_fragment.replace(metal, 'material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor * 0.45 );');
  }
  // shiny CG reflections flatten out: speculars stay, but as hard little glints
  const spec = 'reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );';
  const P = C.lights_physical_pars_fragment;
  if (P.includes(spec)) {
    C.lights_physical_pars_fragment = P.replace(spec, `{
		vec3 s = irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
		float sl = dot( s, vec3( 0.333 ) );
		reflectedLight.directSpecular += s / max( sl, 1e-4 ) * smoothstep( 0.55, 0.7, sl ) * 0.9;
	}`);
  }
}
