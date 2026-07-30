// ============================================================================
// ASHFALL — core/renderer.js
// WebGLRenderer + cinematic post pipeline (three r185):
//   RenderPass → GTAOPass (subtle AO) → UnrealBloomPass → filmic grade
//   (teal-shadow / warm-highlight split tone, log-space S-curve, desaturation,
//   corner vignette, teal-leaning toe lift so blacks never crush to 0,0,0,
//   animated fine grain) → SMAAPass → OutputPass
//   (ACESFilmic tone mapping, exposure 1.22 — set on the renderer, read by
//   OutputPass).
// ============================================================================

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ---------------------------------------------------------------------------
// Filmic grade shader. Runs on LINEAR HDR values (before SMAA + OutputPass /
// tone mapping) so the split-toning and grain get compressed by ACES exactly
// like a physical film response would.
// ---------------------------------------------------------------------------
const GradeShader = {
  name: 'AshfallGradeShader',

  uniforms: {
    tDiffuse:       { value: null },
    uTime:          { value: 0.0 },
    uResolution:    { value: new THREE.Vector2(1920, 1080) },
    uSaturation:    { value: 0.92 },   // slight global desaturation
    uContrast:      { value: 1.055 },  // gentle S-curve slope in log space
    uShadowTint:    { value: new THREE.Color(0.055, 0.115, 0.135) }, // teal
    uShadowLift:    { value: 0.038 },  // lifted blacks amount
    uHighlightTint: { value: new THREE.Color(1.045, 0.985, 0.905) }, // warm gold
    uHighlightAmt:  { value: 0.55 },
    uVignette:      { value: 0.28 },   // corner darkening strength
    uToe:           { value: 0.02 },   // floor lift: no pixel reaches 0,0,0
    uGrain:         { value: 0.024 },  // fine grain, ~1.2% luminance amplitude
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2  uResolution;
    uniform float uSaturation;
    uniform float uContrast;
    uniform vec3  uShadowTint;
    uniform float uShadowLift;
    uniform vec3  uHighlightTint;
    uniform float uHighlightAmt;
    uniform float uVignette;
    uniform float uToe;
    uniform float uGrain;
    varying vec2 vUv;

    const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );
    const float MIDGREY = 0.18;

    // stable per-pixel hash (no sin() precision cliffs)
    float hash12( vec2 p ) {
      vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
      p3 += dot( p3, p3.yzx + 33.33 );
      return fract( ( p3.x + p3.y ) * p3.z );
    }

    void main() {
      vec3 col = max( texture2D( tDiffuse, vUv ).rgb, vec3( 0.0 ) );

      // --- gentle desaturation (military palette discipline) ---------------
      float luma = dot( col, LUMA );
      col = mix( vec3( luma ), col, uSaturation );

      // --- filmic S-curve: contrast in log2 space around mid-grey ----------
      // HDR-safe: highlights steepen smoothly instead of clipping.
      vec3 lg = log2( col + 1e-4 );
      lg = ( lg - log2( MIDGREY ) ) * uContrast + log2( MIDGREY );
      col = max( exp2( lg ) - 1e-4, vec3( 0.0 ) );

      // --- split toning: teal lifted shadows, warm highlights --------------
      float l2 = dot( col, LUMA );
      float shadowMask    = 1.0 - smoothstep( 0.0, 0.30, l2 );
      float highlightMask = smoothstep( 0.38, 1.8, l2 );
      col += uShadowTint * ( shadowMask * uShadowLift );            // lift blacks toward teal
      col *= mix( vec3( 1.0 ), uHighlightTint, highlightMask * uHighlightAmt );

      // --- corner vignette (aspect-aware, smooth radial) --------------------
      vec2 q = vUv - 0.5;
      q.x *= uResolution.x / max( uResolution.y, 1.0 );
      float vig = smoothstep( 1.38, 0.44, length( q ) );
      col *= mix( 1.0, vig, uVignette );

      // --- toe lift (after vignette so corners keep the floor too) ----------
      // Slightly teal-leaning so lifted blacks sit in the grade's shadow
      // palette instead of going milky grey. Guarantees no 0,0,0 output.
      col = col * ( 1.0 - uToe ) + uToe * vec3( 0.90, 1.0, 1.10 );

      // --- very fine animated film grain ------------------------------------
      // Per-physical-pixel, time-jittered, luminance-weighted (shadows/mids
      // carry more grain, highlights protected — pre-tonemap so ACES rolls
      // it off naturally).
      float t = mod( uTime, 61.7 );
      float n = hash12( gl_FragCoord.xy + vec2( t * 127.1, t * 311.7 ) );
      float l3 = dot( col, LUMA );
      float response = mix( 1.0, 0.28, smoothstep( 0.0, 1.1, l3 ) );
      col *= 1.0 + ( n - 0.5 ) * uGrain * response;

      gl_FragColor = vec4( max( col, vec3( 0.0 ) ), 1.0 );
    }
  `,
};

// ---------------------------------------------------------------------------
// createRenderer({ canvas })
// ---------------------------------------------------------------------------
export function createRenderer({ canvas }) {
  const params = new URLSearchParams(location.search);
  const lowfx = params.has('lowfx');

  // --- renderer -------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // SMAA in the composer
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Read by OutputPass at the end of the composer chain:
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  // physicallyCorrectLights: r185 defaults — leave untouched.

  // --- scene / camera ---------------------------------------------------------
  const scene = new THREE.Scene(); // world module fills it, sets fog/background

  const camera = new THREE.PerspectiveCamera(
    74,
    window.innerWidth / window.innerHeight,
    0.05,
    // far plane covers the 380m sky sphere + skyline ring from an off-origin
    // camera (spawn is z=+52); at 400 the sky's far cap clipped into a "hole"
    500
  );
  camera.position.set(0, 1.68, 0);

  // --- composer pipeline ------------------------------------------------------
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;

  const composer = new EffectComposer(renderer); // HalfFloat RT by default in r185

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  let gtaoPass = null;
  if (!lowfx) {
    gtaoPass = new GTAOPass(scene, camera, w * pixelRatio, h * pixelRatio);
    gtaoPass.output = GTAOPass.OUTPUT.Default;
    gtaoPass.blendIntensity = 0.62; // subtle — grounding contact shadow, not soot
    gtaoPass.updateGtaoMaterial({
      radius: 0.32,
      distanceExponent: 1.6,
      thickness: 1.0,
      distanceFallOff: 1.0,
      scale: 1.35,
      samples: 16,
      screenSpaceRadius: false,
    });
    gtaoPass.updatePdMaterial({
      lumaPhi: 10.0,
      depthPhi: 2.0,
      normalPhi: 3.0,
      radius: 4.0,
      radiusExponent: 1.0,
      rings: 2.0,
      samples: 16,
    });
    composer.addPass(gtaoPass);
  }

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(w, h),
    0.35, // strength
    0.45, // radius — tight halo, no wide veiling glow
    1.15  // threshold (HDR — only sun disc, muzzle flash core, tracers, fire)
  );
  composer.addPass(bloomPass);

  const gradePass = new ShaderPass(GradeShader);
  gradePass.uniforms.uResolution.value.set(w * pixelRatio, h * pixelRatio);
  composer.addPass(gradePass);

  const smaaPass = new SMAAPass(); // r185: no constructor args; runs pre-Output
  composer.addPass(smaaPass);

  const outputPass = new OutputPass(); // applies renderer ACESFilmic + sRGB
  composer.addPass(outputPass);

  // --- resize -----------------------------------------------------------------
  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, 2);

    renderer.setPixelRatio(pr);
    renderer.setSize(width, height);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    composer.setPixelRatio(pr);
    composer.setSize(width, height); // sizes every pass (incl. GTAO RTs) at pr

    gradePass.uniforms.uResolution.value.set(width * pr, height * pr);
  }
  window.addEventListener('resize', resize);
  resize();

  // --- public API ---------------------------------------------------------------
  return {
    renderer,
    scene,
    camera,
    quality: lowfx ? 'lowfx' : 'full',

    render(dt) {
      gradePass.uniforms.uTime.value = (gradePass.uniforms.uTime.value + dt) % 61.7;
      composer.render(dt);
    },

    setFov(deg) {
      if (camera.fov !== deg) {
        camera.fov = deg;
        camera.updateProjectionMatrix();
      }
    },
  };
}
