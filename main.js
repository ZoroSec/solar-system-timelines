import * as THREE from "three";
import { sunFragment, rockFragment, airFragment, gasFragment, ringFragment, ringVertexShader } from "./planets.js";
import { PLANETS, PLANET_ORDER } from "./planet-eras.js";
import { EARTH_ERAS } from "./earth-eras.js";

/* ---------------------------------------------------------------------
   The story. Positions are hand-placed on the line: deep time is not
   linear on a human scale, so the spacing is editorial, not to scale.
--------------------------------------------------------------------- */

const DEFAULT = {
  ocean: "#0a1a2c",
  land: "#3a3a30",
  accent: "#5c6a55",
  hazeColor: "#c7d8e2",
  plasma: 0,
  rock: 0,
  lava: 0,
  ice: 0,
  pangaea: 0,
  ancient: 0,
  ancientThreshold: 0.55,
  today: 0,
  gloss: 0.35,
  clouds: 0,
  cloudTint: "#ffffff",
  impact: 0,
  haze: 0.07,
  spin: 0,
  glow: "#dce9f2",
  glowAlpha: 0.06,
  glowScale: 1,
  coastGlow: 0,
};

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

EARTH_ERAS.forEach((era) => {
  const merged = { ...DEFAULT, ...era };
  Object.assign(era, merged);
  era.ocean = new THREE.Color(merged.ocean);
  era.land = new THREE.Color(merged.land);
  era.accent = new THREE.Color(merged.accent);
  era.hazeColor = new THREE.Color(merged.hazeColor);
  era.glowColor = new THREE.Color(merged.glow);
  era.cloudTint = new THREE.Color(merged.cloudTint);
});

/* ---------------------------------------------------------------------
   World timelines. ?planet=mars serves the same layout for another
   world — including the Sun and the Moon. Earth (no param, or
   ?planet=earth) keeps the texture pipeline.
--------------------------------------------------------------------- */

const PLANET_PARAM = (new URLSearchParams(window.location.search).get("planet") || "").toLowerCase();
const PLANET_KEY = PLANET_PARAM && PLANETS[PLANET_PARAM] && PLANET_PARAM !== "earth" ? PLANET_PARAM : "";
const PLANET_INTRO = PLANET_KEY ? PLANETS[PLANET_KEY] : null;
const PLANET_LIGHT = new THREE.Vector3(-0.38, 0.5, 0.78).normalize();

const PLANET_LOOKS = {
  rock: { colors: ["colorA", "colorB", "colorC"], scalars: ["crater", "caps", "maria", "basin", "lava", "water", "scarp", "canyon", "volcano", "mars"] },
  air: { colors: ["colorA", "colorB", "colorC"], scalars: ["bands", "streak", "storm", "bright", "hood", "surface", "ocean", "lava", "calm", "swirl"] },
  gas: { colors: ["colorA", "colorB", "colorC", "colorD"], scalars: ["bands", "spot", "cool", "scars"] },
  sun: { colors: ["tint"], scalars: ["heat", "spots"] },
};

const PLANET_FILL = {
  colorA: "#929292",
  colorB: "#b0b0b0",
  colorC: "#6f6f6f",
  colorD: "#7a7a7a",
  crater: 0,
  caps: 0,
  maria: 0,
  basin: 0,
  lava: 0,
  water: 0,
  scarp: 0,
  canyon: 0,
  volcano: 0,
  mars: 0,
  bands: 6,
  streak: 0.3,
  storm: 0,
  bright: 0,
  hood: 0,
  surface: 0,
  ocean: 0,
  calm: 0,
  swirl: 0,
  spot: 0,
  cool: 0,
  scars: 0,
  heat: 1,
  spots: 1,
  tint: "#ffffff",
  ringAlpha: 1,
};

const PLANET_UNIFORMS = {
  colorA: "uColorA",
  colorB: "uColorB",
  colorC: "uColorC",
  colorD: "uColorD",
  crater: "uCrater",
  caps: "uCaps",
  maria: "uMaria",
  basin: "uBasin",
  lava: "uLava",
  water: "uWater",
  scarp: "uScarp",
  canyon: "uCanyon",
  volcano: "uVolcano",
  mars: "uMars",
  bands: "uBands",
  streak: "uStreak",
  storm: "uStorm",
  bright: "uBright",
  hood: "uHood",
  surface: "uSurface",
  ocean: "uOcean",
  calm: "uCalm",
  swirl: "uSwirl",
  spot: "uSpot",
  cool: "uCool",
  scars: "uScars",
  heat: "uHeat",
  spots: "uSpots",
  tint: "uTint",
};

const PLANET_COLOR_KEYS = PLANET_KEY
  ? [...PLANET_LOOKS[PLANET_INTRO.type].colors]
  : [];

const PLANET_SCALAR_KEYS = PLANET_KEY
  ? [...PLANET_LOOKS[PLANET_INTRO.type].scalars]
  : [];

function buildPlanetChapters(key) {
  const intro = PLANETS[key];
  return intro.chapters.map((chapter) => {
    const merged = { ...intro.base, ...chapter };
    Array.from(new Set(Object.values(PLANET_LOOKS).flatMap((look) => [...look.colors, ...look.scalars]))).forEach((k) => {
      if (merged[k] === undefined) merged[k] = PLANET_FILL[k];
    });
    PLANET_COLOR_KEYS.forEach((k) => {
      merged[k] = merged[k] instanceof THREE.Color ? merged[k] : new THREE.Color(merged[k]);
    });
    merged.glowColor = new THREE.Color(merged.glow);
    return merged;
  });
}

const PLANET_CHAPTERS = PLANET_KEY ? buildPlanetChapters(PLANET_KEY) : null;
let ERAS = PLANET_KEY ? PLANET_CHAPTERS : EARTH_ERAS;
const isPlanet = Boolean(PLANET_KEY);


/* ---------------------------------------------------------------------
   DOM
--------------------------------------------------------------------- */

const stage = document.querySelector(".stage");
const globeEl = document.querySelector(".globe");
const container = document.querySelector("#globe-canvas");
const haloEl = document.querySelector(".globe__halo");
const caption = document.querySelector("#caption");
const epochEl = document.querySelector("#epoch");
const eventEl = document.querySelector("#event");
const noteEl = document.querySelector("#note");
const scrubber = document.querySelector("#scrubber");
const track = document.querySelector("#track");
const ticksEl = document.querySelector("#ticks");
const playhead = document.querySelector("#playhead");
const endStart = document.querySelector("#end-start");
const endFinish = document.querySelector("#end-finish");
const hint = document.querySelector("#hint");

const state = {
  target: 1,
  current: 1,
  chapter: -1,
  dragging: false,
  spun: 0,
  viewSpin: ERAS[ERAS.length - 1].spin,
  dragRot: 0,
  dragVel: 0,
  pointerId: null,
};

/* ---------------------------------------------------------------------
   Timeline ticks
--------------------------------------------------------------------- */

function hashFrame(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const fragment = document.createDocumentFragment();

for (let i = 0; i < 76; i += 1) {
  const p = i / 75;
  if (ERAS.some((era) => Math.abs(era.at - p) < 0.0085)) continue;
  const tick = document.createElement("span");
  const h = 6 + Math.round(hashFrame(i + 4) * 10) + (i % 12 === 0 ? 3 : 0);
  tick.className = "tick";
  tick.style.left = `${p * 100}%`;
  tick.style.height = `${h}px`;
  fragment.appendChild(tick);
}

const chapterTicks = ERAS.map((era) => {
  const tick = document.createElement("span");
  tick.className = "tick tick--chapter";
  tick.style.left = `${era.at * 100}%`;
  tick.style.height = "20px";
  tick.dataset.at = String(era.at);
  fragment.appendChild(tick);
  return tick;
});

ticksEl.appendChild(fragment);

/* ---------------------------------------------------------------------
   Three.js
--------------------------------------------------------------------- */

let renderer;
let scene;
let camera;
let uniforms;
let cloudMaterial;
let earthGroup;
let floatGroup;
let cloudMesh;

function makeRenderer() {
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
  } catch (error) {
    return false;
  }
  if (!renderer.getContext()) return false;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute("aria-hidden", "true");
  container.appendChild(renderer.domElement);
  return true;
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vObj;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;
    vObj = normalize(position);
    vNormalV = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uDay;
  uniform sampler2D uSpec;
  uniform sampler2D uPangaeaMap;

  uniform float uTime;
  uniform vec3 uLight;
  uniform vec3 uOcean;
  uniform vec3 uLand;
  uniform vec3 uAccent;
  uniform vec3 uHazeColor;

  uniform float uPlasma;
  uniform float uRock;
  uniform float uLava;
  uniform float uIce;
  uniform float uPangaea;
  uniform float uAncient;
  uniform float uAncientThreshold;
  uniform float uToday;
  uniform float uGloss;
  uniform float uImpact;
  uniform float uCoastGlow;
  uniform float uHaze;
  uniform vec3 uImpactDir;

  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vObj;
  varying vec3 vViewDir;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i + vec3(0.0, 0.0, 0.0)), hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z
    );
  }

  float fbm(vec3 p) {
    float value = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amp * noise(p);
      p = p * 2.03 + 17.17;
      amp *= 0.5;
    }
    return value;
  }

  void main() {
    vec3 obj = normalize(vObj);
    vec3 normalV = normalize(vNormalV);
    vec3 viewDir = normalize(vViewDir);
    vec3 lightDir = normalize(uLight);

    vec4 daySample = texture2D(uDay, vUv);
    vec3 dayCol = daySample.rgb;

    float oceanMask = smoothstep(0.18, 0.7, texture2D(uSpec, vUv).r);
    float modernLand = 1.0 - oceanMask;

    vec4 pangaeaSample = texture2D(uPangaeaMap, vUv);

    float ancientField = 0.0;
    float ancientLand = 0.0;
    float ancientShelf = 0.0;
    float ancientCoast = 0.0;
    if (uAncient > 0.001) {
      ancientField = fbm(obj * 1.55 + vec3(7.0, 3.0, 11.0));
      ancientField += (fbm(obj * 3.6 + vec3(19.0, 7.0, 2.0)) - 0.5) * 0.38;
      ancientField += (fbm(obj * 9.5 + vec3(2.0, 31.0, 23.0)) - 0.5) * 0.14;
      float threshold = uAncientThreshold;
      ancientLand = smoothstep(threshold, threshold + 0.008, ancientField);
      ancientShelf = smoothstep(threshold - 0.09, threshold, ancientField) * (1.0 - ancientLand);
      ancientCoast = ancientLand * (1.0 - smoothstep(threshold, threshold + 0.08, ancientField));
    }

    float modernWeight = clamp(1.0 - uAncient - uPangaea, 0.0, 1.0);
    float styledLand = mix(ancientLand, pangaeaSample.r, uPangaea);
    float landMask = mix(styledLand, modernLand, modernWeight);
    float shelf = mix(ancientShelf, pangaeaSample.b, uPangaea) * (1.0 - modernWeight);
    float waterMask = 1.0 - landMask;

    float coastEdge = 0.0;
    if (uCoastGlow > 0.001) {
      vec2 px = vec2(2.0 / 2048.0, 2.0 / 1024.0);
      float mR = texture2D(uSpec, vUv + vec2(px.x, 0.0), 4.0).r;
      float mL = texture2D(uSpec, vUv - vec2(px.x, 0.0), 4.0).r;
      float mU = texture2D(uSpec, vUv + vec2(0.0, px.y), 4.0).r;
      float mD = texture2D(uSpec, vUv - vec2(0.0, px.y), 4.0).r;
      coastEdge = clamp((abs(mR - mL) + abs(mU - mD)) * 5.0, 0.0, 1.0);
    }

    float luma = dot(dayCol, vec3(0.299, 0.587, 0.114));
    float ancientTerrain = 0.5;
    if (uAncient > 0.001) {
      ancientTerrain = fbm(obj * 5.2 + vec3(9.0, 41.0, 3.0));
    }
    float terrain = mix(mix(ancientTerrain, pangaeaSample.g, uPangaea), luma, modernWeight);

    vec3 oceanCol = uOcean * (0.9 + 0.18 * terrain);
    oceanCol = mix(oceanCol, oceanCol * 1.42 + vec3(0.006, 0.018, 0.03), clamp(shelf * 0.65, 0.0, 0.42));
    float landDetail = (0.88 + 0.24 * fbm(obj * 17.0 + 7.0)) * (0.93 + 0.14 * fbm(obj * 43.0 + 11.0));
    float relief = smoothstep(0.18, 0.74, terrain);
    float styledWeight = 1.0 - modernWeight;
    float landShade = mix(0.93 + 0.12 * luma, 0.6 + 0.62 * relief, styledWeight);
    vec3 landCol = uLand * landShade * mix(1.0, landDetail, styledWeight);
    float basin = smoothstep(0.4, 0.82, fbm(obj * 3.4 + 33.0)) * uPangaea;
    landCol = mix(landCol, landCol * vec3(0.78, 0.86, 0.66), basin * 0.5);
    float greenery = smoothstep(0.44, 0.76, fbm(obj * 5.6 + 61.0)) * uPangaea;
    landCol = mix(landCol, landCol * vec3(0.84, 1.0, 0.7), greenery * 0.34);
    float mottle = fbm(obj * 12.0 + 19.0) * uPangaea;
    landCol *= mix(1.0, 0.88 + 0.24 * mottle, uPangaea);
    float pangaeaCoast = pangaeaSample.a * (0.7 + 0.5 * fbm(obj * 15.0 + 3.0));
    float coast = mix(ancientCoast, pangaeaCoast, uPangaea) * (1.0 - modernWeight);
    landCol = mix(landCol, uAccent, clamp(coast, 0.0, 0.95) * 0.66);
    vec3 styled = mix(oceanCol, landCol, landMask);
    styled *= 0.95 + 0.12 * terrain;

    vec3 realistic = dayCol * 1.16;
    realistic = mix(realistic, realistic * vec3(1.12, 1.5, 2.4) + vec3(0.001, 0.005, 0.016), waterMask * 0.65);
    realistic = mix(vec3(luma), realistic, 1.1);
    vec3 base = mix(styled, realistic, uToday);

    if (uIce > 0.001) {
      float iceNoise = fbm(obj * 1.7 + 4.2);
      float fine = fbm(obj * 7.0 + 1.0);
      float lat = abs(obj.y);
      float vein = 1.0 - abs(fbm(obj * 8.0 + 12.0) * 2.0 - 1.0);
      float fracture = smoothstep(0.89, 0.995, vein);
      vec3 iceCol = mix(vec3(0.8, 0.86, 0.92), vec3(0.985, 0.99, 1.0), smoothstep(0.35, 0.7, iceNoise));
      iceCol = mix(iceCol, vec3(0.9, 0.94, 0.98), smoothstep(0.45, 0.85, fine) * 0.25);
      iceCol = mix(iceCol, vec3(0.48, 0.6, 0.72), fracture * 0.26);
      iceCol *= 1.0 - landMask * 0.015;
      float open = smoothstep(0.57, 0.68, fbm(obj * 3.0 + 30.0))
                 * (1.0 - smoothstep(0.14, 0.4, lat))
                 * smoothstep(0.5, 0.85, 1.0 - landMask);
      iceCol = mix(iceCol, vec3(0.38, 0.53, 0.63), open * 0.62);
      base = mix(base, iceCol, uIce);
    }

    float ndl = dot(normalV, lightDir);
    float diffuse = smoothstep(-0.55, 0.9, ndl);
    diffuse = 0.58 + 0.5 * diffuse;

    vec3 emission = vec3(0.0);

    if (uRock > 0.001) {
      float grain = fbm(obj * 4.6 + 17.0);
      float lavaTint = smoothstep(0.45, 0.9, uLava);
      vec3 crustDark = mix(vec3(0.028, 0.023, 0.019), vec3(0.075, 0.008, 0.002), lavaTint);
      vec3 crustLight = mix(vec3(0.17, 0.135, 0.105), vec3(0.22, 0.045, 0.012), lavaTint);
      vec3 crust = mix(crustDark, crustLight, grain);
      float platesN = smoothstep(0.32, 0.68, fbm(obj * 2.15 + 29.0));
      crust *= 0.66 + 0.58 * platesN;
      float pit = smoothstep(0.4, 0.5, fbm(obj * 7.2 + 3.1)) * (1.0 - smoothstep(0.5, 0.62, fbm(obj * 7.2 + 3.1)));
      crust *= 1.0 - pit * 0.35;
      crust *= 0.93 + 0.14 * fbm(obj * 24.0 + 5.0);

      float craterWeight = 1.0 - smoothstep(0.3, 0.72, uLava);
      for (int i = 0; i < 11; i++) {
        float fi = float(i);
        vec3 dir = vec3(
          fract(sin(fi * 12.9898 + 4.1) * 43758.5453),
          fract(sin(fi * 78.233 + 7.3) * 43758.5453),
          fract(sin(fi * 37.719 + 1.7) * 43758.5453)
        ) * 2.0 - 1.0;
        dir = normalize(dir + vec3(0.001));
        float radius = 0.045 + 0.085 * fract(sin(fi * 9.21 + 3.3) * 43758.5453);
        float ang = acos(clamp(dot(obj, dir), -1.0, 1.0));
        float bowl = 1.0 - smoothstep(radius * 0.55, radius, ang);
        float rim = smoothstep(radius * 0.78, radius, ang) * (1.0 - smoothstep(radius, radius * 1.22, ang));
        crust *= 1.0 - bowl * 0.4 * craterWeight;
        crust += vec3(0.018, 0.014, 0.01) * rim * craterWeight;
      }

      base = mix(base, crust, uRock);
    }

    if (uLava > 0.001) {
      float t = uTime * 0.004;
      vec3 q = obj * 3.2;
      q += vec3(fbm(q * 1.3 + 1.0)) * 0.8;
      float ridge = 1.0 - abs(fbm(q + t) * 2.0 - 1.0);
      float crack = smoothstep(0.93, 0.998, ridge);
      crack = pow(crack, 1.25);
      float platesN = smoothstep(0.26, 0.72, fbm(obj * 1.7 + 11.0));
      crack *= mix(0.45, 1.0, platesN);
      crack *= smoothstep(0.5, 0.9, uLava);
      float pool = smoothstep(mix(0.7, 0.58, uLava), mix(0.82, 0.72, uLava), fbm(obj * 3.1 + 21.0));
      float poolAmt = smoothstep(0.03, 0.18, uLava);
      vec3 lavaCol = mix(vec3(0.55, 0.07, 0.002), vec3(1.0, 0.38, 0.015), pow(crack, 1.1));
      lavaCol = mix(lavaCol, vec3(1.0, 0.56, 0.1), pow(crack, 3.2) * 0.85);
      base *= 0.88 + 0.24 * platesN;
      base = mix(base, vec3(1.0, 0.48, 0.07), pool * poolAmt * 0.9);
      base = mix(base, lavaCol * (0.72 + 0.3 * diffuse), crack * uLava * 0.9);
      emission += vec3(1.0, 0.36, 0.03) * pool * poolAmt * 0.7;
      emission += (vec3(1.0, 0.22, 0.006) * crack * 0.5 + vec3(1.0, 0.48, 0.07) * pow(crack, 2.4) * 0.42) * uLava;
    }

    if (uImpact > 0.001) {
      float angle = acos(clamp(dot(obj, normalize(uImpactDir)), -1.0, 1.0));
      float core = 1.0 - smoothstep(0.008, 0.036, angle);
      float halo = exp(-angle * 18.0) * 0.68;
      float ring = smoothstep(0.046, 0.062, angle) * (1.0 - smoothstep(0.062, 0.105, angle));
      vec3 impactCol = vec3(1.0, 0.9, 0.6) * core * 1.5
                     + vec3(1.0, 0.55, 0.1) * halo
                     + vec3(1.0, 0.58, 0.14) * ring * 0.18;
      emission += impactCol * uImpact * (0.94 + 0.06 * sin(uTime * 5.0));
    }

    vec3 col = base * diffuse;

    vec3 halfDir = normalize(lightDir + viewDir);
    float specular = pow(max(dot(normalV, halfDir), 0.0), 110.0);
    float broadSpec = pow(max(dot(normalV, halfDir), 0.0), 22.0);
    float glintAmt = smoothstep(0.05, 0.28, uGloss);
    float broadAmt = broadSpec * 0.07 * (1.0 - uToday * 0.85);
    col += vec3(1.0, 0.96, 0.88) * (specular * 0.8 + broadAmt) * waterMask * glintAmt;

    col += emission * (0.72 + 0.35 * diffuse);
    col += vec3(0.04, 0.34, 0.32) * coastEdge * uCoastGlow * 0.4 * (0.35 + 0.65 * landMask);

    if (uPlasma > 0.001) {
      float t = uTime * 0.03;
      float facing = clamp(dot(normalV, viewDir), 0.0, 1.0);
      float n1 = fbm(obj * 1.9 + vec3(t * 0.5, -t * 0.3, t * 0.2));
      float n2 = fbm(obj * 4.6 + vec3(-t * 0.8, t * 0.5, t * 0.3));
      float gran = fbm(obj * 8.5 + vec3(-t * 1.6, t * 1.0, t * 0.4));
      float heat = 0.14 + 0.24 * n1 + 0.12 * n2 + 0.18 * gran + 0.46 * pow(facing, 1.8);
      heat = clamp(heat, 0.0, 1.0);
      vec3 plasma = mix(vec3(0.72, 0.09, 0.002), vec3(1.0, 0.32, 0.01), smoothstep(0.06, 0.36, heat));
      plasma = mix(plasma, vec3(1.0, 0.5, 0.03), smoothstep(0.3, 0.62, heat));
      plasma = mix(plasma, vec3(1.0, 0.76, 0.3), smoothstep(0.55, 0.8, heat));
      plasma = mix(plasma, vec3(1.0, 0.95, 0.78), smoothstep(0.8, 0.99, heat));
      plasma *= 0.88 + 0.2 * gran;
      plasma = mix(plasma, vec3(0.62, 0.1, 0.0), pow(1.0 - facing, 2.2) * 0.52);
      col = mix(col, plasma * (0.86 + 0.2 * diffuse), uPlasma);
    }

    float fresnel = pow(1.0 - clamp(dot(normalV, viewDir), 0.0, 1.0), 3.0);
    col = mix(col, uHazeColor, fresnel * uHaze);
    col *= 1.0 - fresnel * 0.14;

    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    #include <colorspace_fragment>
  }
`;

const cloudFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform vec3 uTint;
  uniform vec3 uLight;

  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vObj;
  varying vec3 vViewDir;

  void main() {
    float a = texture2D(uMap, vUv).a;
    a = smoothstep(0.0, 0.3, a);
    a = min(pow(a, 0.92) * uOpacity * 1.12, 1.0);

    float diffuse = smoothstep(-0.46, 0.85, dot(normalize(vNormalV), normalize(uLight)));
    vec3 col = uTint * (0.72 + 0.36 * diffuse);
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

function createScene() {
  if (isPlanet) {
    buildPlanetScene();
    return;
  }

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
  camera.position.set(0, 0, 4.62);

  const textureLoader = new THREE.TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const load = (path, colorSpace = THREE.NoColorSpace) => {
    const texture = textureLoader.load(path);
    texture.colorSpace = colorSpace;
    texture.anisotropy = anisotropy;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  };

  const dayTexture = load("./assets/earth_atmos_2048.jpg", THREE.SRGBColorSpace);
  const cloudTexture = load("./assets/earth_clouds_1024.png", THREE.NoColorSpace);
  const specTexture = load("./assets/earth_specular_2048.jpg", THREE.NoColorSpace);
  const pangaeaTexture = load("./assets/pangaea.png", THREE.NoColorSpace);

  uniforms = {
    uDay: { value: dayTexture },
    uSpec: { value: specTexture },
    uPangaeaMap: { value: pangaeaTexture },
    uTime: { value: 0 },
    uLight: { value: new THREE.Vector3(-0.38, 0.5, 0.78).normalize() },
    uOcean: { value: new THREE.Color("#0b2a4a") },
    uLand: { value: new THREE.Color("#4e4b36") },
    uAccent: { value: new THREE.Color("#8e8a62") },
    uHazeColor: { value: new THREE.Color("#bcd4e7") },
    uPlasma: { value: 0 },
    uRock: { value: 0 },
    uLava: { value: 0 },
    uIce: { value: 0 },
    uPangaea: { value: 0 },
    uAncient: { value: 0 },
    uAncientThreshold: { value: 0.55 },
    uToday: { value: 1 },
    uGloss: { value: 1 },
    uImpact: { value: 0 },
    uCoastGlow: { value: 0 },
    uHaze: { value: 0.1 },
    uImpactDir: { value: new THREE.Vector3(0.008, 0.365, 0.931).normalize() },
  };

  const earthMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
  });

  const geometry = new THREE.SphereGeometry(1, 128, 96);
  const earth = new THREE.Mesh(geometry, earthMaterial);

  cloudMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: cloudTexture },
      uOpacity: { value: 0.9 },
      uTint: { value: new THREE.Color("#ffffff") },
      uLight: uniforms.uLight,
    },
    vertexShader,
    fragmentShader: cloudFragmentShader,
    transparent: true,
    depthWrite: false,
  });

  cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(1.012, 96, 64), cloudMaterial);
  cloudMesh.renderOrder = 2;

  earthGroup = new THREE.Group();
  earthGroup.add(earth);
  earthGroup.add(cloudMesh);

  floatGroup = new THREE.Group();
  floatGroup.add(earthGroup);
  floatGroup.rotation.z = -0.075;
  scene.add(floatGroup);

  resizeScene();
}

function resizeScene() {
  if (!renderer) return;
  const rect = container.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  lastCssWidth = width;
  lastCssHeight = height;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

/* Planet timelines construct the same rig out of the shared shaders. */
function buildPlanetScene() {
  const intro = PLANET_INTRO;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
  camera.position.set(0, 0, intro.cameraZ || 4.62);

  uniforms = {
    uLight: { value: PLANET_LIGHT.clone() },
    uTime: { value: 0 },
    uHover: { value: 0 },
    uColorA: { value: new THREE.Color() },
    uColorB: { value: new THREE.Color() },
    uColorC: { value: new THREE.Color() },
    uColorD: { value: new THREE.Color() },
    uSeed: { value: intro.base.seed },
    uCrater: { value: 0 },
    uCaps: { value: 0 },
    uMaria: { value: 0 },
    uBasin: { value: 0 },
    uLava: { value: 0 },
    uWater: { value: 0 },
    uScarp: { value: 0 },
    uCanyon: { value: 0 },
    uVolcano: { value: 0 },
    uMars: { value: 0 },
    uBands: { value: 0 },
    uStreak: { value: 0 },
    uStorm: { value: 0 },
    uBright: { value: 0 },
    uHood: { value: 0 },
    uSurface: { value: 0 },
    uOcean: { value: 0 },
    uCalm: { value: 0 },
    uSwirl: { value: 0 },
    uSpot: { value: 0 },
    uCool: { value: 0 },
    uScars: { value: 0 },
    uHeat: { value: 1 },
    uSpots: { value: 1 },
    uTint: { value: new THREE.Color("#ffffff") },
  };

  const planetMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader: {
      rock: rockFragment,
      air: airFragment,
      gas: gasFragment,
      sun: sunFragment,
    }[intro.type],
  });

  const geometry = new THREE.SphereGeometry(1, 128, 96);
  const planet = new THREE.Mesh(geometry, planetMaterial);

  earthGroup = new THREE.Group();
  earthGroup.add(planet);

  if (intro.rings) {
    ringMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uRingA: { value: new THREE.Color(intro.ringA) },
        uRingB: { value: new THREE.Color(intro.ringB) },
        uHover: uniforms.uHover,
        uAlpha: { value: 0 },
        uRingStyle: { value: intro.ringStyle || 0 },
      },
      vertexShader: ringVertexShader,
      fragmentShader: ringFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.38, 2.36, 128, 1), ringMaterial);
    ringMesh = ring;
    ring.rotation.x = intro.base.ringTilt || 1.2;
    ring.renderOrder = 2;
    earthGroup.add(ring);
  }

  floatGroup = new THREE.Group();
  floatGroup.add(earthGroup);
  floatGroup.rotation.x = intro.viewTilt || 0;
  floatGroup.rotation.z = intro.floatZ || 0;
  scene.add(floatGroup);

  window.__globe = {
    type: intro.type,
    rings: Boolean(intro.rings),
    floatZ: intro.floatZ,
    viewTilt: intro.viewTilt || 0,
    cameraZ: camera.position.z,
    ringAlpha: intro.rings ? ringMaterial.uniforms.uAlpha.value : null,
    ringTilt: intro.rings ? ringMesh.rotation.x : null,
    ringStyle: intro.rings ? ringMaterial.uniforms.uRingStyle.value : null,
    storm: uniforms.uStorm.value,
    spot: uniforms.uSpot.value,
    maria: uniforms.uMaria.value,
    basin: uniforms.uBasin.value,
    lava: uniforms.uLava.value,
    water: uniforms.uWater.value,
    surface: uniforms.uSurface.value,
    ocean: uniforms.uOcean.value,
    bright: uniforms.uBright.value,
    hood: uniforms.uHood.value,
    scars: uniforms.uScars.value,
    scarp: uniforms.uScarp.value,
    canyon: uniforms.uCanyon.value,
    volcano: uniforms.uVolcano.value,
    mars: uniforms.uMars.value,
    calm: uniforms.uCalm.value,
    swirl: uniforms.uSwirl.value,
    heat: uniforms.uHeat.value,
    spots: uniforms.uSpots.value,
  };

  resizeScene();
}

function mixEra(progress) {
  let index = 0;
  for (let i = 0; i < ERAS.length - 1; i += 1) {
    if (progress >= ERAS[i].at && progress <= ERAS[i + 1].at) {
      index = i;
      break;
    }
    if (progress > ERAS[i + 1].at) index = i + 1;
  }
  index = clamp(index, 0, ERAS.length - 2);
  const a = ERAS[index];
  const b = ERAS[index + 1];
  const local = smoothstep(a.at, b.at, progress);
  return { a, b, t: local, index };
}

const tmpColor = new THREE.Color();

function applyEra(progress, elapsed) {
  if (!uniforms) return;
  if (isPlanet) return applyPlanetEra(progress, elapsed);
  const { a, b, t } = mixEra(progress);

  const setColor = (uniform, key) => {
    tmpColor.copy(a[key]).lerp(b[key], t);
    uniform.value.copy(tmpColor);
  };

  setColor(uniforms.uOcean, "ocean");
  setColor(uniforms.uLand, "land");
  setColor(uniforms.uAccent, "accent");
  setColor(uniforms.uHazeColor, "hazeColor");

  const scalar = (key) => lerp(a[key], b[key], t);
  uniforms.uPlasma.value = scalar("plasma");
  uniforms.uRock.value = scalar("rock");
  uniforms.uLava.value = scalar("lava");
  uniforms.uIce.value = scalar("ice");
  uniforms.uPangaea.value = scalar("pangaea");
  uniforms.uAncient.value = scalar("ancient");
  uniforms.uAncientThreshold.value = scalar("ancientThreshold");
  uniforms.uToday.value = scalar("today");
  uniforms.uGloss.value = scalar("gloss");
  uniforms.uImpact.value = scalar("impact");
  uniforms.uCoastGlow.value = scalar("coastGlow");
  uniforms.uHaze.value = scalar("haze");
  uniforms.uTime.value = elapsed;

  cloudMaterial.uniforms.uOpacity.value = scalar("clouds");
  tmpColor.copy(a.cloudTint).lerp(b.cloudTint, t);
  cloudMaterial.uniforms.uTint.value.copy(tmpColor);

  const spin = lerp(a.spin, b.spin, t);
  const glow = tmpColor.copy(a.glowColor).lerp(b.glowColor, t);
  const glowAlpha = lerp(a.glowAlpha, b.glowAlpha, t);
  const glowScale = lerp(a.glowScale, b.glowScale, t);
  haloEl.style.setProperty("--halo-color",
    `rgba(${Math.round(glow.r * 255)}, ${Math.round(glow.g * 255)}, ${Math.round(glow.b * 255)}, ${glowAlpha})`
  );
  haloEl.style.setProperty("--halo-scale", glowScale.toFixed(3));

  return spin;
}

/* Planet mode: same mixer shape, but writing the shared shader looks. */
let ringMaterial = null;
let ringMesh = null;

function applyPlanetEra(progress, elapsed) {
  const { a, b, t } = mixEra(progress);

  PLANET_COLOR_KEYS.forEach((key) => {
    uniforms[PLANET_UNIFORMS[key]].value.copy(a[key]).lerp(b[key], t);
  });
  PLANET_SCALAR_KEYS.forEach((key) => {
    uniforms[PLANET_UNIFORMS[key]].value = lerp(a[key], b[key], t);
  });
  uniforms.uTime.value = elapsed;

  if (ringMaterial) {
    ringMaterial.uniforms.uAlpha.value = lerp(a.ringAlpha, b.ringAlpha, t);
  }
  if (ringMesh) {
    ringMesh.rotation.x = lerp(a.ringTilt ?? 1.2, b.ringTilt ?? 1.2, t);
  }
  if (window.__globe) {
    window.__globe.ringAlpha = ringMaterial ? ringMaterial.uniforms.uAlpha.value : null;
    window.__globe.ringTilt = ringMesh ? ringMesh.rotation.x : null;
    window.__globe.storm = uniforms.uStorm.value;
    window.__globe.spot = uniforms.uSpot.value;
    window.__globe.maria = uniforms.uMaria.value;
    window.__globe.basin = uniforms.uBasin.value;
    window.__globe.lava = uniforms.uLava.value;
    window.__globe.water = uniforms.uWater.value;
    window.__globe.surface = uniforms.uSurface.value;
    window.__globe.ocean = uniforms.uOcean.value;
    window.__globe.bright = uniforms.uBright.value;
    window.__globe.hood = uniforms.uHood.value;
    window.__globe.scars = uniforms.uScars.value;
    window.__globe.scarp = uniforms.uScarp.value;
    window.__globe.canyon = uniforms.uCanyon.value;
    window.__globe.volcano = uniforms.uVolcano.value;
    window.__globe.mars = uniforms.uMars.value;
    window.__globe.calm = uniforms.uCalm.value;
    window.__globe.swirl = uniforms.uSwirl.value;
    window.__globe.heat = uniforms.uHeat.value;
    window.__globe.spots = uniforms.uSpots.value;
  }

  const spin = lerp(a.spin, b.spin, t);
  const glow = tmpColor.copy(a.glowColor).lerp(b.glowColor, t);
  const glowAlpha = lerp(a.glowAlpha, b.glowAlpha, t);
  const glowScale = lerp(a.glowScale, b.glowScale, t);
  haloEl.style.setProperty("--halo-color",
    `rgba(${Math.round(glow.r * 255)}, ${Math.round(glow.g * 255)}, ${Math.round(glow.b * 255)}, ${glowAlpha})`
  );
  haloEl.style.setProperty("--halo-scale", glowScale.toFixed(3));

  return spin;
}

/* ---------------------------------------------------------------------
   Caption + timeline state
--------------------------------------------------------------------- */

function chapterAt(progress) {
  let index = 0;
  for (let i = 0; i < ERAS.length; i += 1) {
    if (progress >= ERAS[i].at - 0.0001) index = i;
  }
  return index;
}

function renderChapter(index, animate) {
  if (index === state.chapter) return;
  state.chapter = index;
  const era = ERAS[index];

  epochEl.textContent = era.time;
  eventEl.textContent = era.event;
  noteEl.textContent = era.note;

  scrubber.setAttribute("aria-valuenow", String(index));
  scrubber.setAttribute("aria-valuetext", `${era.time}. ${era.event}. ${era.note}.`);

  chapterTicks.forEach((tick, i) => {
    tick.classList.toggle("is-past", i < index);
    tick.classList.toggle("is-active", i === index);
  });

  endStart.classList.toggle("is-current", index === 0);
  endFinish.classList.toggle("is-current", index === ERAS.length - 1);

  if (animate && !REDUCED) {
    caption.getAnimations().forEach((animation) => animation.cancel());
    caption.animate(
      [
        { opacity: 0.18, filter: "blur(5px)", transform: "translateY(3px)" },
        { opacity: 1, filter: "blur(0px)", transform: "translateY(0px)" },
      ],
      { duration: 430, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
    );
  }

  if (isPlanet) {
    document.title = index === ERAS.length - 1
      ? `${PLANET_INTRO.name} — a timeline`
      : `${era.event} — ${PLANET_INTRO.name}, a timeline`;
  } else {
    document.title = era.event === "Earth" ? "Earth — a timeline" : `${era.event} — Earth, a timeline`;
  }
}

function setTarget(progress, { source = "pointer" } = {}) {
  state.target = clamp(progress, 0, 1);
  playhead.style.left = `${state.target * 100}%`;
  const index = chapterAt(state.target);
  renderChapter(index, source !== "init");
  if (source !== "init") {
    document.body.classList.add("has-interacted");
    hint.setAttribute("aria-hidden", "true");
  }
}

/* ---------------------------------------------------------------------
   Input
--------------------------------------------------------------------- */

function progressFromPointer(event) {
  const rect = track.getBoundingClientRect();
  return clamp((event.clientX - rect.left) / rect.width, 0, 1);
}

scrubber.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  state.dragging = true;
  state.pointerId = event.pointerId;
  scrubber.setPointerCapture(event.pointerId);
  scrubber.focus({ preventScroll: true });
  setTarget(progressFromPointer(event), { source: "pointer" });
  event.preventDefault();
});

scrubber.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;
  setTarget(progressFromPointer(event), { source: "pointer" });
});

/* Moving across the track previews a time without pressing. */
track.addEventListener("pointermove", (event) => {
  if (state.dragging || event.pointerType === "touch") return;
  setTarget(progressFromPointer(event), { source: "hover" });
});

const endScrub = (event) => {
  if (!state.dragging) return;
  state.dragging = false;
  if (state.pointerId !== null && scrubber.hasPointerCapture(state.pointerId)) {
    scrubber.releasePointerCapture(state.pointerId);
  }
  state.pointerId = null;
  if (event) event.preventDefault();
};

scrubber.addEventListener("pointerup", endScrub);
scrubber.addEventListener("pointercancel", endScrub);

scrubber.addEventListener("keydown", (event) => {
  const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];
  if (!keys.includes(event.key)) return;
  event.preventDefault();

  if (event.key === "Home") {
    setTarget(0, { source: "key" });
    return;
  }
  if (event.key === "End") {
    setTarget(1, { source: "key" });
    return;
  }

  const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "PageUp" ? -1 : 1;
  const current = chapterAt(state.target);
  const next = clamp(current + direction, 0, ERAS.length - 1);
  setTarget(ERAS[next].at, { source: "key" });
});

/* rotation of the globe itself */

function bindGlobeDrag() {
  let lastX = 0;

  container.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    state.draggingGlobe = true;
    state.dragPointerId = event.pointerId;
    lastX = event.clientX;
    state.dragVel = 0;
    container.setPointerCapture(event.pointerId);
    container.classList.add("is-grabbing");
  });

  container.addEventListener("pointermove", (event) => {
    if (!state.draggingGlobe) return;
    const delta = event.clientX - lastX;
    lastX = event.clientX;
    const change = delta * 0.0062;
    state.dragRot += change;
    state.dragVel = change;
    document.body.classList.add("has-interacted");
  });

  const release = (event) => {
    if (!state.draggingGlobe) return;
    state.draggingGlobe = false;
    container.classList.remove("is-grabbing");
    if (state.dragPointerId !== null && container.hasPointerCapture(state.dragPointerId)) {
      container.releasePointerCapture(state.dragPointerId);
    }
    state.dragPointerId = null;
    if (event) event.preventDefault();
  };

  container.addEventListener("pointerup", release);
  container.addEventListener("pointercancel", release);
}

/* ---------------------------------------------------------------------
   Boot + render loop
--------------------------------------------------------------------- */

let lastTime = performance.now();
let elapsed = 0;
let lastCssWidth = 0;
let lastCssHeight = 0;

function tick(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  elapsed += dt;

  if (container.clientWidth !== lastCssWidth || container.clientHeight !== lastCssHeight) {
    resizeScene();
  }

  const keep = 1 - Math.exp(-dt * 10.5);
  state.current += (state.target - state.current) * keep;

  const spin = applyEra(state.current, elapsed);
  state.viewSpin += (spin - state.viewSpin) * (1 - Math.exp(-dt * 5.2));

  if (!REDUCED) {
    state.spun += dt * 0.0052;
    state.dragRot += state.dragVel;
    state.dragVel *= Math.pow(0.9, dt * 60);
    if (Math.abs(state.dragVel) < 0.00001) state.dragVel = 0;
    floatGroup.position.y = Math.sin(elapsed * 0.62) * 0.006;
    floatGroup.rotation.z = (PLANET_INTRO ? PLANET_INTRO.floatZ : -0.075) + Math.sin(elapsed * 0.21) * 0.005;
  }

  if (cloudMesh) cloudMesh.rotation.y = elapsed * 0.0045;
  earthGroup.rotation.y = state.viewSpin + state.spun + state.dragRot;
  if (window.__globe) window.__globe.viewSpin = earthGroup.rotation.y;

  renderer.render(scene, camera);
}

async function boot() {
  const ok = makeRenderer();
  if (!ok) {
    document.body.classList.add("is-ready", "has-error");
    hint.textContent = "This browser cannot render the globe.";
    return;
  }

  /* Per-planet copy lives in planet-eras.js; Earth keeps what HTML sets. */
  const currentKey = PLANET_KEY || "earth";
  document.body.dataset.planet = currentKey;
  if (PLANET_INTRO) {
    document.querySelector(".masthead__note").textContent = PLANET_INTRO.headline;
    const wordmark = document.querySelector(".wordmark");
    if (wordmark && wordmark.firstChild) {
      /* "earth / timeline" becomes "mars / timeline" on planet pages. */
      wordmark.firstChild.nodeValue = `${PLANET_INTRO.name.toLowerCase()} `;
    }
    const creditEl = document.querySelector("#credit");
    if (creditEl) creditEl.textContent = PLANET_INTRO.credit;
    endStart.textContent = PLANET_INTRO.startShort;
    scrubber.setAttribute(
      "aria-label",
      `${PLANET_INTRO.name} timeline, ${ERAS[0].time} to ${ERAS[ERAS.length - 1].time}`
    );
  }

  /* Every timeline — Earth included — can hop to its orbital neighbours. */
  {
    const indexNow = PLANET_ORDER.indexOf(currentKey);
    const prev = document.querySelector("#planet-prev");
    const next = document.querySelector("#planet-next");
    if (prev && next) {
      const prevKey = PLANET_ORDER[(indexNow + PLANET_ORDER.length - 1) % PLANET_ORDER.length];
      const nextKey = PLANET_ORDER[(indexNow + 1) % PLANET_ORDER.length];
      prev.textContent = `‹ ${PLANETS[prevKey].name}`;
      prev.href = `./timeline.html?planet=${prevKey}`;
      next.textContent = `${PLANETS[nextKey].name} ›`;
      next.href = `./timeline.html?planet=${nextKey}`;
      prev.setAttribute("aria-label", `Open the ${PLANETS[prevKey].name} timeline`);
      next.setAttribute("aria-label", `Open the ${PLANETS[nextKey].name} timeline`);
    }
  }

  createScene();
  bindGlobeDrag();

  const ro = new ResizeObserver(() => resizeScene());
  ro.observe(container);
  window.addEventListener("resize", resizeScene);

  const eraParam = Number.parseInt(new URLSearchParams(window.location.search).get("era"), 10);
  const startIndex = Number.isFinite(eraParam) ? clamp(eraParam, 0, ERAS.length - 1) : ERAS.length - 1;
  const startEra = ERAS[startIndex];
  state.target = startEra.at;
  state.current = startEra.at;
  state.viewSpin = startEra.spin;

  setTarget(startEra.at, { source: "init" });
  applyEra(startEra.at, 0);
  renderer.setAnimationLoop(tick);

  // Give the local textures a moment, but never leave the page blank.
  // Planet timelines are fully procedural, so there is nothing to await.
  if (!PLANET_KEY) {
    await Promise.race([
      new Promise((resolve) => {
        const check = () => {
          const textures = [uniforms.uDay.value, uniforms.uSpec.value, uniforms.uPangaeaMap.value];
          const clouds = cloudMaterial.uniforms.uMap.value;
          const all = [...textures, clouds];
          if (all.every((texture) => texture.image && texture.image.width > 0)) {
            resolve();
          } else {
            setTimeout(check, 60);
          }
        };
        check();
      }),
      new Promise((resolve) => setTimeout(resolve, 2600)),
    ]);
  }

  await document.fonts.ready.catch(() => {});
  requestAnimationFrame(() => {
    document.body.classList.add("is-ready");
  });
}

boot();
