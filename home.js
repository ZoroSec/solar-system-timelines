import * as THREE from "three";
import {
  vertexShader,
  sunFragment,
  rockFragment,
  airFragment,
  gasFragment,
  ringFragment,
  ringVertexShader,
} from "./planets.js";

/* The homepage's textured Earth preview — only ever drawn here, so it
   stays local while the other worlds share planets.js. */
const earthFragment = /* glsl */ `
  precision highp float;

  uniform sampler2D uDay;
  uniform sampler2D uSpec;
  uniform sampler2D uClouds;

  uniform vec3 uLight;
  uniform float uTime;
  uniform float uHover;

  varying vec2 vUv;
  varying vec3 vObj;
  varying vec3 vNormalV;
  varying vec3 vViewDir;

  void main() {
    vec3 N = normalize(vNormalV);
    vec3 V = normalize(vViewDir);

    vec4 day = texture2D(uDay, vUv);
    float ocean = smoothstep(0.2, 0.7, texture2D(uSpec, vUv).r);
    float cloud = texture2D(uClouds, vUv + vec2(uTime * 0.0009, 0.0)).a;

    vec3 albedo = day.rgb;
    albedo = mix(albedo, vec3(0.9, 0.93, 0.95), cloud * 0.66);

    float ndl = dot(N, uLight);
    float lit = smoothstep(-0.36, 0.96, ndl);
    vec3 col = albedo * (0.24 + 0.94 * lit);
    col += albedo * 0.04 * uHover;

    // A very tight, weak glint. A broad highlight turned into a white
    // blob at the lineup's thumbnail size.
    vec3 halfDir = normalize(uLight + V);
    float spec = pow(max(dot(N, halfDir), 0.0), 720.0);
    col += vec3(1.0, 0.95, 0.84) * spec * ocean * (1.0 - cloud) * 0.12 * smoothstep(0.05, 0.55, ndl);

    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.7);
    col += vec3(0.2, 0.45, 0.92) * fres * 0.46;

    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    #include <colorspace_fragment>
  }
`;

/* ---------------------------------------------------------------------
   The neighbourhood
   A single orthographic scene. The CSS line supplies the x positions and
   the sphere sizes; the canvas only draws the worlds on top.
--------------------------------------------------------------------- */

const line = document.querySelector("#solar-line");
const canvas = document.querySelector("#solar-canvas");
const bodies = [...document.querySelectorAll(".body")];
const readout = document.querySelector("#readout");
const subjectEl = document.querySelector("#readout-subject");
const factEl = document.querySelector("#readout-fact");
const ctaEl = document.querySelector(".solar__cta");

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const DEFAULT_FACT = "One star, eight planets, one moon — every one of them has a timeline.";

const FACTS = {
  sun: ["Sun", "99.9% of the solar system's mass, and the reason it all stays together."],
  mercury: ["Mercury", "The smallest planet. A single year passes in 88 Earth days."],
  venus: ["Venus", "The hottest world. 465°C beneath a permanent ceiling of cloud."],
  earth: ["Earth", "The only world known to hold life — and 4.5 billion years of it."],
  moon: ["Moon", "Born from a giant impact, and still drifting away at 3.8 cm a year."],
  mars: ["Mars", "Once wet, now rusty. Home to the tallest volcano in the solar system."],
  jupiter: ["Jupiter", "A storm wider than Earth has raged for centuries."],
  saturn: ["Saturn", "Rings of ice, almost 300,000 km wide and astonishingly thin."],
  uranus: ["Uranus", "Tilted 98°. It rolls around the Sun on its side."],
  neptune: ["Neptune", "The windiest world, with storms faster than sound."],
};

/* Axial tilt (radians off the ecliptic pole) and a slow artistic spin.
   The tilts are the real ones, scaled into screen space; the rates are
   deliberately unhurried so the lineup stays readable. */
const AXES = {
  sun: { tilt: 0.126, spin: 0.030 },
  mercury: { tilt: 0.001, spin: 0.018 },
  venus: { tilt: 0.046, spin: -0.014 },
  earth: { tilt: 0.409, spin: 0.085 },
  moon: { tilt: 0.117, spin: 0.034 },
  mars: { tilt: 0.440, spin: 0.080, flatten: 0.006 },
  jupiter: { tilt: 0.055, spin: 0.230, flatten: 0.065 },
  saturn: { tilt: 0.466, spin: 0.195, flatten: 0.098 },
  uranus: { tilt: 1.706, spin: 0.140, flatten: 0.023 },
  neptune: { tilt: 0.494, spin: 0.150, flatten: 0.017 },
};

let activeKey = null;
let revealed = false;
let layoutFrame = 0;
let renderer;
let camera;
let scene;
const objects = new Map();

const timeUniform = { value: 0 };
const light = new THREE.Vector3(-0.52, 0.34, 0.80).normalize();
const lightUniform = { value: light };

/* ---------------------------------------------------------------------
   Shaders
--------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
   Scene
--------------------------------------------------------------------- */

const sphereGeometry = new THREE.SphereGeometry(1, 128, 96);
const ringGeometry = new THREE.RingGeometry(1.38, 2.36, 160, 2);

function color(value) {
  return new THREE.Color(value);
}

function materialFor(key) {
  const common = {
    uLight: lightUniform,
    uTime: timeUniform,
    uHover: { value: 0 },
    uBasin: { value: 0 },
    uLava: { value: 0 },
    uWater: { value: 0 },
    uSurface: { value: 0 },
    uOcean: { value: 0 },
    uBright: { value: 0 },
    uHood: { value: 0 },
    uScars: { value: 0 },
    uScarp: { value: 0 },
    uCanyon: { value: 0 },
    uVolcano: { value: 0 },
    uMars: { value: 0 },
    uCalm: { value: 0 },
    uSwirl: { value: 0 },
  };

  if (key === "sun") {
    return new THREE.ShaderMaterial({
      uniforms: {
        ...common,
        uSeed: { value: 2.4 },
        uHeat: { value: 1.0 },
        uSpots: { value: 1.0 },
        uTint: { value: color("#fff4e2") },
      },
      vertexShader,
      fragmentShader: sunFragment,
    });
  }

  if (key === "mercury") {
    return new THREE.ShaderMaterial({
      uniforms: {
        ...common,
        uColorA: { value: color("#7b766e") },
        uColorB: { value: color("#c0b9ad") },
        uColorC: { value: color("#46423c") },
        uSeed: { value: 4.2 },
        uCrater: { value: 1.0 },
        uCaps: { value: 0.12 },
        uMaria: { value: 0.3 },
        uBasin: { value: 0.78 },
        uScarp: { value: 1.0 },
      },
      vertexShader,
      fragmentShader: rockFragment,
    });
  }

  if (key === "moon") {
    return new THREE.ShaderMaterial({
      uniforms: {
        ...common,
        uColorA: { value: color("#8f8b83") },
        uColorB: { value: color("#c9c4b8") },
        uColorC: { value: color("#4c4943") },
        uSeed: { value: 21.5 },
        uCrater: { value: 0.9 },
        uCaps: { value: 0.0 },
        uMaria: { value: 0.85 },
      },
      vertexShader,
      fragmentShader: rockFragment,
    });
  }

  if (key === "mars") {
    return new THREE.ShaderMaterial({
      uniforms: {
        ...common,
        uColorA: { value: color("#cf8757") },
        uColorB: { value: color("#eab37d") },
        uColorC: { value: color("#5d4638") },
        uSeed: { value: 8.7 },
        uCrater: { value: 0.18 },
        uCaps: { value: 1.0 },
        uMaria: { value: 0.30 },
        uMars: { value: 1.0 },
        uVolcano: { value: 0.9 },
        uCanyon: { value: 1.0 },
      },
      vertexShader,
      fragmentShader: rockFragment,
    });
  }

  if (key === "venus") {
    return new THREE.ShaderMaterial({
      uniforms: {
        ...common,
        uColorA: { value: color("#c2aa7c") },
        uColorB: { value: color("#e7d7ad") },
        uColorC: { value: color("#f8f0d8") },
        uSeed: { value: 2.7 },
        uBands: { value: 3.0 },
        uStreak: { value: 0.62 },
        uCalm: { value: 0.3 },
        uSwirl: { value: 0.9 },
        uHood: { value: 0.05 },
        uStorm: { value: 0.0 },
      },
      vertexShader,
      fragmentShader: airFragment,
    });
  }

  if (key === "uranus") {
    return new THREE.ShaderMaterial({
      uniforms: {
        ...common,
        uColorA: { value: color("#8fc5cb") },
        uColorB: { value: color("#b6dfe2") },
        uColorC: { value: color("#d8edee") },
        uSeed: { value: 13.2 },
        uBands: { value: 2.6 },
        uStreak: { value: 0.12 },
        uCalm: { value: 0.80 },
        uBright: { value: 0.40 },
        uHood: { value: 0.40 },
        uStorm: { value: 0.0 },
      },
      vertexShader,
      fragmentShader: airFragment,
    });
  }

  if (key === "neptune") {
    return new THREE.ShaderMaterial({
      uniforms: {
        ...common,
        uColorA: { value: color("#143a80") },
        uColorB: { value: color("#1d4795") },
        uColorC: { value: color("#88a8e4") },
        uSeed: { value: 18.4 },
        uBands: { value: 3.6 },
        uStreak: { value: 0.08 },
        uCalm: { value: 0.72 },
        uBright: { value: 0.40 },
        uHood: { value: 0.12 },
        uStorm: { value: 0.9 },
      },
      vertexShader,
      fragmentShader: airFragment,
    });
  }

  if (key === "jupiter") {
    return new THREE.ShaderMaterial({
      uniforms: {
        ...common,
        uColorA: { value: color("#f4ecd9") },
        uColorB: { value: color("#d7a97f") },
        uColorC: { value: color("#9a6a4d") },
        uColorD: { value: color("#98a2a6") },
        uSeed: { value: 7.1 },
        uBands: { value: 8.0 },
        uSpot: { value: 1.0 },
        uCool: { value: 0.13 },
      },
      vertexShader,
      fragmentShader: gasFragment,
    });
  }

  if (key === "saturn") {
    return new THREE.ShaderMaterial({
      uniforms: {
        ...common,
        uColorA: { value: color("#f5edd8") },
        uColorB: { value: color("#e9dbba") },
        uColorC: { value: color("#d6c4a2") },
        uColorD: { value: color("#c6bfae") },
        uSeed: { value: 3.3 },
        uBands: { value: 13 },
        uSpot: { value: 0.0 },
        uCool: { value: 0.08 },
      },
      vertexShader,
      fragmentShader: gasFragment,
    });
  }

  // Earth
  const dayTexture = loader.load("./assets/earth_atmos_2048.jpg", (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
  });
  const specTexture = loader.load("./assets/earth_specular_2048.jpg");
  const cloudTexture = loader.load("./assets/earth_clouds_1024.png");

  dayTexture.anisotropy = 8;
  specTexture.anisotropy = 8;
  cloudTexture.anisotropy = 8;

  return new THREE.ShaderMaterial({
    uniforms: {
      ...common,
      uDay: { value: dayTexture },
      uSpec: { value: specTexture },
      uClouds: { value: cloudTexture },
    },
    vertexShader,
    fragmentShader: earthFragment,
  });
}

/* ---------------------------------------------------------------------
   Textures and loading
--------------------------------------------------------------------- */

const manager = new THREE.LoadingManager();
const loader = new THREE.TextureLoader(manager);

manager.onLoad = () => reveal();

function reveal() {
  if (revealed) return;
  revealed = true;
  if (window.__home) window.__home.ready = true;
  requestAnimationFrame(() => {
    document.body.classList.add("is-ready");
    layout();
  });
}

/* ---------------------------------------------------------------------
   Build
--------------------------------------------------------------------- */

try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 1000);
  camera.position.z = 500;

  const rotations = {
    sun: 0.3,
    mercury: 0.35,
    venus: 2.1,
    earth: Math.PI * 0.5 + 0.18,
    moon: 0.55,
    mars: 1.5,
    jupiter: 0.26,
    saturn: 0.16,
    uranus: 1.4,
    neptune: 0.35,
  };

  bodies.forEach((body) => {
    const key = body.dataset.body;
    const axis = AXES[key] || { tilt: 0, spin: 0 };
    const material = materialFor(key);
    const group = new THREE.Group();
    const tiltGroup = new THREE.Group();
    tiltGroup.rotation.z = axis.tilt;
    group.add(tiltGroup);

    const mesh = new THREE.Mesh(sphereGeometry, material);
    mesh.rotation.y = rotations[key] || 0;
    mesh.scale.y = 1 - (axis.flatten || 0);
    tiltGroup.add(mesh);

    if (key === "saturn") {
      const ringMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uRingA: { value: color("#6b5f4b") },
          uRingB: { value: color("#dfd1b2") },
          uHover: material.uniforms.uHover,
          uAlpha: { value: 1 },
          uRingStyle: { value: 0 },
        },
        vertexShader: ringVertexShader,
        fragmentShader: ringFragment,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = 1.2;
      ring.renderOrder = 2;
      tiltGroup.add(ring);
    }

    group.visible = false;
    scene.add(group);
    objects.set(key, {
      key,
      body,
      group,
      tiltGroup,
      material,
      mesh,
      baseRotation: rotations[key] || 0,
      spinRate: axis.spin,
      baseX: 0,
      baseY: 0,
      active: 0,
      radius: 1,
    });
  });

  /* A small window into the scene for visual regression checks. */
  window.__home = {
    reduced: REDUCED,
    ready: false,
    count: objects.size,
    spinOf: (key) => {
      const object = objects.get(key);
      return object ? object.mesh.rotation.y : null;
    },
    tiltOf: (key) => {
      const object = objects.get(key);
      return object ? object.tiltGroup.rotation.z : null;
    },
  };

  layout();
  renderer.setAnimationLoop(render);
  window.setTimeout(reveal, 2600);
} catch (error) {
  document.body.classList.add("is-ready", "has-error");
  console.error(error);
}

/* ---------------------------------------------------------------------
   Layout: let the DOM place every world
--------------------------------------------------------------------- */

function layout() {
  if (!renderer || !camera || !scene) return;
  const width = line.clientWidth;
  const height = line.clientHeight;
  if (!width || !height) return;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);

  camera.left = 0;
  camera.right = width;
  camera.bottom = 0;
  camera.top = height;
  camera.updateProjectionMatrix();

  const lineRect = line.getBoundingClientRect();

  objects.forEach((object) => {
    const orb = object.body.querySelector(".body__orb");
    if (!orb) return;
    const rect = orb.getBoundingClientRect();
    const radius = rect.width / 2;
    const x = rect.left - lineRect.left + radius;
    const y = lineRect.bottom - rect.top - radius;

    object.baseX = x;
    object.baseY = y;
    object.radius = radius;
    object.group.position.set(x, y, 0);
    object.group.scale.setScalar(radius);
    object.group.visible = radius > 0;
  });
}

function queueLayout() {
  if (layoutFrame) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = 0;
    layout();
  });
}

/* ---------------------------------------------------------------------
   Hover readout
--------------------------------------------------------------------- */

function setReadout(key) {
  const [subject, fact] = key ? FACTS[key] : ["The solar system", DEFAULT_FACT];
  if (subjectEl.textContent === subject && factEl.textContent === fact) return;

  subjectEl.textContent = subject;
  factEl.textContent = fact;

  /* Every world links to its own timeline; the CTA follows the pointer. */
  if (key) {
    ctaEl.textContent = `Explore ${subject}'s timeline`;
    ctaEl.href = `./timeline.html?planet=${key}`;
  } else {
    ctaEl.textContent = "Explore Earth's timeline";
    ctaEl.href = "./timeline.html";
  }

  if (!REDUCED) {
    readout.getAnimations().forEach((animation) => animation.cancel());
    readout.animate(
      [
        { opacity: 0.15, transform: "translateY(2px)" },
        { opacity: 1, transform: "translateY(0px)" },
      ],
      { duration: 300, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
    );
  }
}

function setActive(key) {
  if (activeKey === key) return;
  activeKey = key;
  bodies.forEach((body) => {
    body.classList.toggle("is-active", body.dataset.body === key);
  });
  setReadout(key);
}

bodies.forEach((body) => {
  body.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    if (body.contains(event.relatedTarget)) return;
    setActive(body.dataset.body);
  });
  body.addEventListener("pointerout", (event) => {
    if (event.pointerType === "touch") return;
    if (body.contains(event.relatedTarget)) return;
    if (activeKey === body.dataset.body) setActive(null);
  });
});

/* Click any world — the Sun and Moon included — to open its timeline. */
bodies.forEach((body) => {
  const key = body.dataset.body;
  const destination = `./timeline.html?planet=${key}`;
  body.tabIndex = 0;
  body.setAttribute("role", "link");
  body.setAttribute("aria-label", `Open ${FACTS[key][0]}'s timeline`);
  body.setAttribute("data-timeline", destination);
  body.addEventListener("click", () => {
    window.location.assign(destination);
  });
  body.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    window.location.assign(destination);
  });
});

/* ---------------------------------------------------------------------
   Motion
--------------------------------------------------------------------- */

const clock = new THREE.Clock();
let elapsed = 0;

function render() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!REDUCED) elapsed += dt;
  timeUniform.value = elapsed;

  objects.forEach((object) => {
    const target = activeKey === object.key ? 1 : 0;
    object.active += (target - object.active) * (1 - Math.exp(-dt * 9.2));
    object.material.uniforms.uHover.value = object.active;
    object.group.position.y = object.baseY + object.active * 3.5;
    object.mesh.rotation.y = object.baseRotation + elapsed * object.spinRate;
  });

  renderer.render(scene, camera);
}

/* ---------------------------------------------------------------------
   Resize and boot
--------------------------------------------------------------------- */

const observer = new ResizeObserver(queueLayout);
observer.observe(line);
window.addEventListener("resize", queueLayout);

document.fonts.ready.then(queueLayout).catch(() => {});
requestAnimationFrame(queueLayout);
