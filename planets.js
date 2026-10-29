/* Shared procedural world shaders. The homepage and the timelines draw
   their worlds from the same GLSL so the two pages always agree.

   Accuracy notes (all artistic approximations, no textures):
   - rock: basalt maria (uMaria), three-scale craters with rims and rays,
     molten cracks (uLava), a large impact basin (uBasin), transient
     surface water (uWater), and noisy polar caps.
   - air: zonal bands with curl-warped flow, methane cirrus, polar hoods,
     an elliptical dark storm, bright convective clouds (uBright), and a
     rocky/ocean surface that can show through thinner clouds (uSurface).
   - gas: turbulent belts/zones, polar dimming, a sheared red spot with a
     pale collar, and a chain of comet-impact scars (uScars).
   - Sun: granulation, sunspots, faculae, limb darkening and a warm limb.
   - rings: C/B/A structure with the Cassini division and Encke gap.
*/

export const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vObj;
  varying vec3 vNormalV;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;
    vObj = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

export const noiseChunk = /* glsl */ `
  precision highp float;

  uniform vec3 uLight;
  uniform float uTime;
  uniform float uHover;

  varying vec2 vUv;
  varying vec3 vObj;
  varying vec3 vNormalV;
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
      mix(
        mix(hash13(i + vec3(0.0, 0.0, 0.0)), hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x),
        f.y
      ),
      mix(
        mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x),
        f.y
      ),
      f.z
    );
  }

  float fbm(vec3 p) {
    float value = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      value += amp * noise(p);
      p = p * 2.03 + 17.17;
      amp *= 0.5;
    }
    return value;
  }

  vec3 lightSurface(vec3 albedo, vec3 N, vec3 V, float rimAmount, vec3 rimColor) {
    float ndl = dot(N, uLight);
    // A deep night side with a soft terminator. The extra wrap term keeps
    // the shadowed limb from reading as a pasted-on flat disc.
    float lit = smoothstep(-0.18, 0.84, ndl);
    float wrap = clamp((ndl + 0.16) / 1.16, 0.0, 1.0);
    float key = lit * (0.36 + 0.64 * sqrt(max(ndl, 0.0)));
    vec3 col = albedo * (0.054 + 1.0 * key + 0.08 * wrap * wrap);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    // Limb darkening gives the sphere its roundness.
    col *= 0.64 + 0.36 * pow(ndv, 0.36);
    col += albedo * 0.028 * uHover;
    float fres = pow(1.0 - ndv, 2.4);
    col += rimColor * fres * rimAmount * smoothstep(-0.30, 0.55, ndl);
    return col;
  }

  void finish(vec3 col) {
    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    #include <colorspace_fragment>
  }
`;

export const sunFragment = /* glsl */ `
  ${noiseChunk}

  uniform float uSeed;
  uniform float uHeat;
  uniform float uSpots;
  uniform vec3 uTint;

  void main() {
    vec3 N = normalize(vNormalV);
    vec3 V = normalize(vViewDir);
    vec3 p = vObj;

    float t = uTime * 0.045;
    float n1 = fbm(p * 2.1 + vec3(t * 0.5, -t * 0.25, t * 0.35) + vec3(uSeed));
    float n2 = fbm(p * 6.4 + vec3(-t * 0.8, t * 0.55, 0.0) + vec3(uSeed * 1.7));
    float n3 = fbm(p * 17.0 + vec3(t * 1.2, 0.0, -t * 0.7) + vec3(uSeed * 2.3));
    float cells = fbm(p * 38.0 + vec3(-t * 1.6, t * 1.1, t * 0.4) + vec3(uSeed * 3.1));

    float muTop = clamp(dot(N, V), 0.0, 1.0);
    float heat = clamp(0.34 + n1 * 0.26 + n2 * 0.21 + n3 * 0.12 + cells * 0.05 + muTop * 0.04, 0.0, 1.0);
    heat = clamp(heat * uHeat, 0.0, 1.0);

    vec3 col = mix(vec3(0.42, 0.035, 0.0), vec3(1.0, 0.32, 0.006), smoothstep(0.02, 0.28, heat));
    col = mix(col, vec3(1.0, 0.62, 0.06), smoothstep(0.26, 0.48, heat));
    col = mix(col, vec3(1.0, 0.85, 0.38), smoothstep(0.46, 0.68, heat));
    col = mix(col, vec3(1.0, 0.98, 0.9), smoothstep(0.68, 0.92, heat));
    col *= uTint;

    // Bright granule walls and darker intergranular lanes. The lanes are
    // what make the photosphere look boiling instead of painted.
    float gran = 1.0 - abs(fbm(p * 70.0 + vec3(t * 1.4, -t * 0.9, t * 0.5) + vec3(uSeed * 4.7)) * 2.0 - 1.0);
    gran = pow(gran, 2.6);
    float meso = fbm(p * 24.0 + vec3(-t * 0.8, t * 0.6, 0.0) + vec3(uSeed * 6.2));
    col *= 0.86 + 0.18 * gran;
    col *= 0.92 + 0.13 * meso;
    col += vec3(1.0, 0.93, 0.62) * gran * 0.08;

    // Sunspots: cool, dark pores with a slight penumbra. A noisy field
    // keeps the active regions irregular; two explicit pores guarantee
    // that a sunspot is visible at the homepage angle.
    float spotField = fbm(p * 4.6 + vec3(4.0, 1.0, 7.0) + vec3(uSeed));
    float spots = smoothstep(0.70, 0.81, spotField);
    float penumbra = smoothstep(0.64, 0.70, spotField) * (1.0 - spots);
    float spotAmt = clamp(uSpots, 0.0, 1.6);
    col *= 1.0 - (spots * 0.72 + penumbra * 0.12) * spotAmt;

    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      vec3 spotDir = normalize(vec3(
        0.52 - fi * 0.72,
        0.20 - fi * 0.44,
        0.84 - fi * 0.04
      ));
      float ang = acos(clamp(dot(p, spotDir), -1.0, 1.0));
      float radius = 0.035 + fi * 0.045;
      float umbra = 1.0 - smoothstep(radius * 0.50, radius, ang);
      float halo = smoothstep(radius * 0.74, radius, ang) * (1.0 - smoothstep(radius, radius * 1.80, ang));
      col *= 1.0 - (umbra * 0.95 + halo * 0.24) * clamp(uSpots, 0.0, 1.0);
      col += vec3(1.0, 0.70, 0.22) * halo * 0.026 * clamp(uSpots, 0.0, 1.0);
    }

    // Faculae: bright magnetic veins around active regions.
    float fac = smoothstep(0.62, 0.78, fbm(p * 7.5 + vec3(9.0, 3.0, 1.0) + vec3(uSeed)));
    col += vec3(1.0, 0.80, 0.38) * fac * 0.075 * min(uSpots, 1.0) * gran;

    // Limb darkening plus a warm limb and a thin corona. The disc goes
    // from pale gold in the centre to deep orange at the edge.
    float mu = clamp(dot(N, V), 0.0, 1.0);
    col *= 0.40 + 0.60 * pow(mu, 0.48);
    col = mix(col, vec3(1.0, 0.34, 0.02), pow(1.0 - mu, 2.8) * 0.58);
    float limb = pow(1.0 - mu, 5.0);
    col += vec3(1.0, 0.22, 0.008) * limb * 0.42;
    col += vec3(1.0, 0.58, 0.10) * uHover * 0.07;

    finish(col);
  }
`;

export const rockFragment = /* glsl */ `
  ${noiseChunk}

  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uSeed;
  uniform float uCrater;
  uniform float uCaps;
  uniform float uMaria;
  uniform float uBasin;
  uniform float uLava;
  uniform float uWater;
  uniform float uScarp;
  uniform float uCanyon;
  uniform float uVolcano;
  uniform float uMars;

  void main() {
    vec3 N = normalize(vNormalV);
    vec3 V = normalize(vViewDir);
    vec3 obj = normalize(vObj);

    float broad = fbm(obj * 3.4 + vec3(uSeed));
    float mid = fbm(obj * 9.0 - vec3(uSeed * 1.3));
    float fine = fbm(obj * 24.0 + vec3(uSeed * 2.1));
    float micro = fbm(obj * 52.0 + vec3(uSeed * 3.7));

    vec3 albedo = mix(uColorA, uColorB, smoothstep(0.24, 0.68, broad));
    albedo = mix(albedo, uColorC, smoothstep(0.46, 0.80, mid) * mix(0.62, 0.18, uMars));

    // Maria / dark basaltic basins (Moon, Mercury) or dusty lowlands (Mars).
    float basins = fbm(obj * mix(2.2, 4.0, uMars) + vec3(uSeed * 3.7));
    float maria = smoothstep(mix(0.46, 0.50, uMars), mix(0.60, 0.555, uMars), basins);
    albedo = mix(albedo, uColorC * mix(0.58, 0.82, uMars), maria * uMaria * mix(1.0, 0.80, uMars));

    // Craters at three scales: a shadowed bowl, a raised rim, a central
    // peak in the larger ones, and faint ejecta rays. The Moon keeps a
    // soft, dark rim; Mercury and Mars get the crisper, brighter profile.
    float craterDetail = clamp(uScarp + uMars, 0.0, 1.0);
    float craterAmt = uCrater * mix(1.0, 0.30, uMars);
    float bowlDark = mix(0.52, 0.34, uMars);
    for (int i = 0; i < 26; i++) {
      float fi = float(i);
      vec3 dir = vec3(
        fract(sin(fi * 12.9898 + uSeed * 2.3) * 43758.5453),
        fract(sin(fi * 78.233 + uSeed * 4.1) * 43758.5453),
        fract(sin(fi * 37.719 + uSeed * 6.7) * 43758.5453)
      ) * 2.0 - 1.0;
      dir = normalize(dir + vec3(0.0001));
      float sizeClass = fract(sin(fi * 5.31 + uSeed * 1.9) * 43758.5453);
      float radius = mix(0.016, 0.125, pow(sizeClass, 1.6));
      float ang = acos(clamp(dot(obj, dir), -1.0, 1.0));
      float bowlEdge = mix(0.54, 0.66, craterDetail);
      float bowl = 1.0 - smoothstep(radius * bowlEdge, radius, ang);
      float rim = smoothstep(radius * 0.78, radius, ang) * (1.0 - smoothstep(radius, radius * 1.14, ang));
      float peak = (1.0 - smoothstep(0.0, radius * 0.13, ang)) * smoothstep(0.045, 0.078, radius);
      albedo *= 1.0 - bowl * bowlDark * craterAmt;
      vec3 rimCol = mix(vec3(0.10, 0.093, 0.085), mix(uColorB, vec3(0.96, 0.94, 0.88), 0.30), craterDetail);
      albedo += rimCol * (rim * 0.24 + peak * 0.08) * craterAmt;
      float ray = smoothstep(radius * 1.08, radius * 1.16, ang) * (1.0 - smoothstep(radius * 1.55, radius * 2.5, ang));
      albedo += mix(vec3(0.05, 0.047, 0.043), uColorB, craterDetail) * ray * craterAmt * 0.075;
    }

    // One giant basin for Caloris (Mercury) and Hellas (Mars): a warped
    // floor, a bright raised rim, and a short fan of ejecta. The warp
    // keeps it from reading as a perfect bullseye.
    vec3 basinDir = normalize(vec3(0.86, 0.12, -0.48));
    float basinWarp = (fbm(obj * 5.0 + vec3(uSeed * 4.0)) - 0.5) * 0.06;
    float basinAng = acos(clamp(dot(obj, basinDir), -1.0, 1.0)) + basinWarp;
    float basinFloor = 1.0 - smoothstep(0.20, 0.36, basinAng);
    float basinRim = smoothstep(0.32, 0.365, basinAng) * (1.0 - smoothstep(0.365, 0.43, basinAng));
    float basinRays = smoothstep(0.40, 0.44, basinAng) * (1.0 - smoothstep(0.46, 0.72, basinAng));
    float basinMottle = 0.55 + 0.45 * fbm(obj * 6.5 + vec3(uSeed * 7.7));
    albedo *= 1.0 - basinFloor * 0.25 * basinMottle * uBasin;
    albedo = mix(albedo, uColorB * 1.04, basinFloor * smoothstep(0.48, 0.72, fbm(obj * 4.0 + vec3(uSeed * 2.6))) * 0.09 * uBasin);
    albedo += uColorB * (basinRim * 0.24 + basinRays * 0.018) * uBasin;

    // Molten cracks for the first hundred million years.
    float crackField = abs(fbm(obj * 5.2 + vec3(uSeed * 5.1)) - 0.5);
    float cracks = 1.0 - smoothstep(0.015, 0.055, crackField);
    float veinField = fbm(obj * 2.1 + vec3(uSeed * 8.3));
    float veins = pow(max(0.0, sin((obj.x + obj.y * 0.6 + obj.z) * 22.0 + veinField * 7.0)), 10.0);
    float lavaMask = clamp(cracks * 0.75 + veins * 0.45, 0.0, 1.0) * clamp(uLava, 0.0, 1.0);
    albedo = mix(albedo, vec3(0.17, 0.055, 0.025), lavaMask * 0.75);

    // Mercury's lobate scarps and bright hollows. The scarps are thin,
    // curved cliffs, kept to cool provinces so they do not scribble over
    // the whole disk; the hollows are the pale patches MESSENGER found.
    if (uScarp > 0.001) {
      float scarpField = fbm(vec3(obj.x * 2.2, obj.y * 6.5, obj.z * 2.2) + vec3(uSeed * 7.0)) - 0.5;
      float scarpMask = smoothstep(0.38, 0.64, fbm(obj * 1.9 + vec3(uSeed * 2.2)));
      float scarp = (1.0 - smoothstep(0.003, 0.013, abs(scarpField))) * scarpMask;
      float crest = (1.0 - smoothstep(0.003, 0.011, abs(scarpField - 0.013))) * scarpMask;
      float hollowField = smoothstep(0.60, 0.76, fbm(obj * 8.4 + vec3(uSeed * 9.1)));
      float hollowMask = hollowField * (0.35 + 0.65 * smoothstep(0.25, 0.70, fbm(obj * 2.7 + vec3(uSeed * 3.3))));
      albedo *= 1.0 - scarp * 0.18 * uScarp;
      albedo += vec3(0.10, 0.095, 0.088) * crest * uScarp * 0.36;
      albedo = mix(albedo, uColorB * 1.08, hollowMask * uScarp * 0.26);
      // Fine dark grain keeps the regolith from looking airbrushed.
      float speck = smoothstep(0.46, 0.80, fbm(obj * 30.0 + vec3(uSeed * 12.0)));
      albedo *= 1.0 - speck * 0.13 * uScarp;
    }

    // Mars keeps its dark wind-scoured regions, the Valles Marineris gash
    // and the Tharsis shield volcanoes.
    if (uMars > 0.001) {
      vec3 syrtis = normalize(vec3(0.55, 0.12, 0.70));
      float syrtisAng = acos(clamp(dot(obj, syrtis), -1.0, 1.0));
      float syrtisMask = 1.0 - smoothstep(0.15, 0.40, syrtisAng);
      vec3 arcDir = normalize(vec3(0.05, -0.30, 0.88));
      float arcAng = acos(clamp(dot(obj, arcDir), -1.0, 1.0));
      float arcMask = 1.0 - smoothstep(0.08, 0.24, arcAng);
      float mottle = smoothstep(0.28, 0.72, fbm(obj * 7.5 + vec3(uSeed * 3.1)));
      float dark = clamp(syrtisMask * 0.85 + arcMask * 0.55, 0.0, 1.0);
      albedo = mix(albedo, uColorC * 0.74, dark * mottle * uMars * 0.70);

      if (uCanyon > 0.001) {
        vec3 canyonDir = normalize(vec3(0.86, -0.10, -0.48));
        vec3 canyonAxis = normalize(cross(vec3(0.0, 1.0, 0.0), canyonDir));
        vec3 canyonNorth = cross(canyonDir, canyonAxis);
        vec3 rel = obj - canyonDir * dot(obj, canyonDir);
        vec2 cq = vec2(dot(rel, canyonAxis) / 0.50, dot(rel, canyonNorth) / 0.032);
        float jag = (fbm(obj * 15.0 + vec3(uSeed * 12.0)) - 0.5);
        float jag2 = (fbm(obj * 7.0 + vec3(uSeed * 4.0)) - 0.5);
        cq.x += jag2 * 0.18;
        cq.y += jag * 0.45;
        // A slow meander and a varying width stop the canyon from reading
        // as a ruled line across the disk.
        float bend = 0.85 * sin(cq.x * 2.6 + 0.4) + 0.30 * sin(cq.x * 6.4 - 0.9);
        cq.y += bend;
        float widthMod = 0.72 + 0.55 * smoothstep(0.25, 0.80, fbm(obj * 5.5 + vec3(uSeed * 9.5)));
        cq.y /= widthMod;
        float cd = length(cq);
        float canyon = 1.0 - smoothstep(0.60, 1.0, cd);
        float canyonRim = smoothstep(0.80, 1.0, cd) * (1.0 - smoothstep(1.0, 1.32, cd));
        float gap = smoothstep(0.24, 0.60, fbm(obj * 8.0 + vec3(uSeed * 6.0)));
        canyon *= mix(0.42, 1.0, gap);
        vec3 floorCol = mix(uColorC * 0.78, uColorB * 0.40, 0.42);
        albedo = mix(albedo, floorCol, canyon * uCanyon * 0.60);
        albedo += uColorB * canyonRim * uCanyon * 0.12;
      }

      if (uVolcano > 0.001) {
        vec3 tharsis = normalize(vec3(0.66, 0.22, -0.52));
        float tharsisAng = acos(clamp(dot(obj, tharsis), -1.0, 1.0));
        float bulge = 1.0 - smoothstep(0.12, 0.52, tharsisAng);
        albedo = mix(albedo, uColorB * 1.06, bulge * uVolcano * 0.16);
        for (int i = 0; i < 3; i++) {
          float fi = float(i);
          vec3 vdir = normalize(vec3(
            0.54 + fi * 0.12,
            0.36 - fi * 0.10,
            -0.55 - fi * 0.04
          ));
          float va = acos(clamp(dot(obj, vdir), -1.0, 1.0));
          float vrad = 0.105 - fi * 0.014;
          float vnoise = fbm(obj * 18.0 + vec3(uSeed * 7.0));
          float vr = vrad * (0.92 + 0.10 * vnoise);
          float cone = exp(-3.2 * pow(va / vr, 2.0));
          float caldera = 1.0 - smoothstep(0.0, vrad * 0.085, va);
          float apron = smoothstep(vrad * 0.96, vrad * 1.02, va) * (1.0 - smoothstep(vrad * 1.02, vrad * 1.22, va));
          vec3 coneCol = mix(uColorB, vec3(0.82, 0.62, 0.46), 0.25);
          albedo = mix(albedo, coneCol, cone * uVolcano * 0.16);
          albedo = mix(albedo, uColorC * 0.82, caldera * uVolcano * 0.50);
          albedo = mix(albedo, uColorC * 0.92, apron * uVolcano * 0.05);
        }
      }
    }

    // Regolith grain.
    albedo *= 0.93 + 0.10 * fine + 0.06 * micro;

    // Polar caps: broken frost over a solid, slightly dirty heart. The
    // northern cap is the wider of the two, as it is on Mars today.
    float northCap = smoothstep(0.925, 0.985, obj.y);
    float southCap = smoothstep(0.940, 0.992, -obj.y);
    float cap = max(northCap, southCap);
    float capNoise = smoothstep(0.28, 0.66, fbm(obj * 16.0 + vec3(11.0)));
    vec3 capColor = mix(vec3(0.88, 0.87, 0.85), vec3(0.97, 0.96, 0.94), capNoise);
    albedo = mix(albedo, capColor, cap * mix(0.50, 0.92, capNoise) * uCaps);

    // Ancient rivers and lakes on Mars (and none elsewhere): broad seas
    // and branching channels cut into the dusty highlands.
    float lakeField = smoothstep(0.52, 0.64, fbm(obj * 2.4 + vec3(uSeed * 4.7)));
    float riverField = abs(fbm(obj * 3.1 + vec3(uSeed * 6.3)) - 0.5);
    float rivers = 1.0 - smoothstep(0.018, 0.060, riverField);
    float water = clamp(lakeField + rivers * 0.70, 0.0, 1.0) * clamp(uWater, 0.0, 1.0);
    vec3 waterCol = mix(uColorC * 0.45, vec3(0.06, 0.19, 0.22), 0.75);
    albedo = mix(albedo, waterCol, water * 0.88);

    vec3 rimColor = uColorB * 0.34;
    vec3 col = lightSurface(albedo, N, V, 0.10, rimColor);
    col += vec3(1.0, 0.30, 0.03) * lavaMask * (0.55 + 0.45 * fine);
    vec3 halfDir = normalize(uLight + V);
    col += vec3(0.42, 0.58, 0.55) * pow(max(dot(N, halfDir), 0.0), 28.0) * water * 0.38;
    finish(col);
  }
`;

export const airFragment = /* glsl */ `
  ${noiseChunk}

  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uSeed;
  uniform float uBands;
  uniform float uStreak;
  uniform float uStorm;
  uniform float uBright;
  uniform float uHood;
  uniform float uSurface;
  uniform float uOcean;
  uniform float uLava;
  uniform float uCalm;
  uniform float uSwirl;

  void main() {
    vec3 N = normalize(vNormalV);
    vec3 V = normalize(vViewDir);
    vec3 obj = normalize(vObj);

    float lon = atan(obj.z, obj.x);
    float lat = obj.y;
    float warp = fbm(vec3(obj.x * 1.7, obj.y * 4.4, obj.z * 1.7) + vec3(uSeed)) - 0.5;
    float curl = fbm(vec3(obj.x * 3.6, obj.y * 9.5, obj.z * 3.6) + vec3(uSeed * 1.9)) - 0.5;
    float bandPhase = lat * uBands + warp * 0.85 + curl * 0.30;
    bandPhase += uSwirl * (
      0.38 * sin(lon * 2.0 + lat * 4.0 + warp * 2.0) +
      0.16 * sin(lon * 5.0 - lat * 2.0)
    );
    float band = sin(bandPhase * 3.14159);
    float band2 = sin((bandPhase * 2.20 + 0.70 + curl * 1.4) * 3.14159);
    float fine = fbm(vec3(obj.x * 2.6, obj.y * 18.0, obj.z * 2.6) + vec3(uSeed * 2.3));
    float wisps = fbm(vec3(obj.x * 7.0, obj.y * 36.0, obj.z * 7.0) + vec3(uSeed * 3.1));
    float threads = fbm(vec3(obj.x * 12.0, obj.y * 70.0, obj.z * 12.0) + vec3(uSeed * 4.4));
    float cloudA = fbm(vec3(obj.x * 2.6, obj.y * 5.0, obj.z * 2.6) + vec3(uSeed * 4.1));
    float cloudB = fbm(vec3(obj.x * 5.8, obj.y * 10.5, obj.z * 5.8) + vec3(uSeed * 5.3));

    float calm = clamp(uCalm, 0.0, 1.0);
    float bandAmt = mix(0.56, 0.04, calm);
    float detail = mix(1.0, 0.20, calm);

    vec3 albedo = mix(uColorA, uColorB, smoothstep(-0.55, 0.68, band) * bandAmt + (fine - 0.5) * 0.10 * detail);
    albedo = mix(albedo, uColorC, smoothstep(0.22, 0.80, band2) * bandAmt * 0.30);
    albedo = mix(albedo, uColorC, smoothstep(0.50, 0.72, wisps) * uStreak * 0.42 * detail);
    albedo = mix(albedo, uColorA * 1.04, smoothstep(0.56, 0.80, threads) * uStreak * 0.26 * detail);
    albedo = mix(albedo, uColorC, smoothstep(0.52, 0.78, cloudA) * uSwirl * 0.30);
    albedo = mix(albedo, uColorC, smoothstep(0.58, 0.82, cloudB) * uSwirl * 0.16);

    // Polar hoods sit above the main cloud deck, pale but not opaque.
    float polar = smoothstep(0.66, 0.98, abs(lat));
    float hood = clamp(uHood, 0.0, 1.0);
    albedo = mix(albedo, mix(uColorC, vec3(0.93, 0.98, 1.0), 0.35), polar * hood * 0.56);

    albedo *= 0.94 + 0.10 * fine;

    // A young Venus can show its surface through a thinner cloud deck.
    float ground = fbm(obj * 3.0 + vec3(uSeed * 5.1));
    float floorFine = fbm(obj * 8.5 - vec3(uSeed * 2.7));
    vec3 rock = mix(uColorA * 0.60, uColorC * 0.88, smoothstep(0.28, 0.72, ground));
    rock = mix(rock, rock * 0.70, smoothstep(0.55, 0.84, floorFine));
    float seaField = smoothstep(0.44, 0.61, fbm(obj * 2.2 + vec3(uSeed * 7.3)));
    float sea = seaField * clamp(uOcean, 0.0, 1.0);
    vec3 seaCol = mix(vec3(0.05, 0.16, 0.19), vec3(0.10, 0.34, 0.37), smoothstep(0.30, 0.70, ground));
    vec3 surfaceCol = mix(rock, seaCol, sea);

    float crackField = abs(fbm(obj * 5.0 + vec3(uSeed * 6.1)) - 0.5);
    float cracks = 1.0 - smoothstep(0.012, 0.050, crackField);
    float veinField = fbm(obj * 2.4 + vec3(uSeed * 9.0));
    float veins = pow(max(0.0, sin((obj.x + obj.y * 0.5 + obj.z) * 20.0 + veinField * 7.0)), 12.0);
    float lavaMask = clamp(cracks * 0.80 + veins * 0.50, 0.0, 1.0) * clamp(uLava, 0.0, 1.0);
    surfaceCol = mix(surfaceCol, vec3(0.40, 0.09, 0.015), lavaMask * 0.80);

    float surfaceMix = clamp(uSurface, 0.0, 1.0);
    albedo = mix(albedo, surfaceCol, surfaceMix);

    // Small convective clouds break through the haze on the ice giants.
    if (uBright > 0.001) {
      vec3 dir = normalize(vec3(0.52, 0.16, 0.84));
      vec3 axis1 = normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
      vec3 axis2 = cross(dir, axis1);
      vec3 rel = obj - dir * dot(obj, dir);
      vec2 q = vec2(dot(rel, axis1) / 0.105, dot(rel, axis2) / 0.050);
      float d = length(q);
      float oval = 1.0 - smoothstep(0.55, 1.0, d);
      float veil = smoothstep(0.85, 1.0, d) * (1.0 - smoothstep(1.0, 1.45, d));
      vec3 cloudCol = mix(uColorC, vec3(0.96, 0.99, 1.0), 0.55);
      albedo = mix(albedo, cloudCol, oval * uBright * mix(0.62, 0.30, calm));
      albedo = mix(albedo, cloudCol, veil * uBright * mix(0.18, 0.08, calm));
    }

    if (uStorm > 0.001) {
      // Neptune's Great Dark Spot, ringed by high methane cirrus.
      vec3 dir = normalize(vec3(-0.46, -0.18, 0.87));
      vec3 axis1 = normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
      vec3 axis2 = cross(dir, axis1);
      vec3 rel = obj - dir * dot(obj, dir);
      vec2 q = vec2(dot(rel, axis1) / 0.25, dot(rel, axis2) / 0.105);
      float d = length(q);
      float oval = 1.0 - smoothstep(0.48, 1.0, d);
      float mottle = fbm(obj * 9.0 + vec3(uSeed * 3.0));
      vec3 spotCol = mix(vec3(0.008, 0.025, 0.09), vec3(0.035, 0.10, 0.26), 0.30 + 0.45 * mottle);
      albedo = mix(albedo, spotCol, oval * uStorm * 0.94);
      // A compact companion cirrus streak beyond the spot. Keeping it on
      // one side avoids the bright ring that made the storm look enclosed.
      vec2 cq = vec2((q.x + 0.28) / 0.42, (q.y - 1.12) / 0.16);
      float companion = 1.0 - smoothstep(0.48, 1.0, length(cq));
      companion *= 0.62 + 0.38 * smoothstep(0.28, 0.72, fbm(obj * 17.0 + vec3(uSeed * 6.2)));
      albedo = mix(albedo, vec3(0.92, 0.96, 1.0), companion * uStorm * 0.36);
    }

    vec3 col = lightSurface(albedo, N, V, 0.32, mix(uColorB, uColorC, 0.55) * 0.42);
    // A thin scattering layer keeps the night limb of a gas envelope from
    // going completely black.
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    col += albedo * 0.035;
    col += mix(uColorB, uColorC, 0.45) * pow(1.0 - ndv, 2.0) * 0.05;
    col += vec3(1.0, 0.28, 0.02) * lavaMask * surfaceMix * (0.55 + 0.45 * ground);
    vec3 halfDir = normalize(uLight + V);
    col += vec3(0.52, 0.72, 0.68) * pow(max(dot(N, halfDir), 0.0), 34.0) * sea * surfaceMix * 0.35;
    finish(col);
  }
`;

export const gasFragment = /* glsl */ `
  ${noiseChunk}

  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform vec3 uColorD;
  uniform float uSeed;
  uniform float uBands;
  uniform float uSpot;
  uniform float uCool;
  uniform float uScars;

  void main() {
    vec3 N = normalize(vNormalV);
    vec3 V = normalize(vViewDir);
    vec3 obj = normalize(vObj);

    float lat = obj.y;
    float warp = fbm(vec3(obj.x * 1.9, obj.y * 4.2, obj.z * 1.9) + vec3(uSeed)) - 0.5;
    float warp2 = fbm(vec3(obj.x * 4.8, obj.y * 13.0, obj.z * 4.8) + vec3(uSeed * 1.7)) - 0.5;
    float turb = fbm(vec3(obj.x * 7.5, obj.y * 24.0, obj.z * 7.5) + vec3(uSeed * 2.6)) - 0.5;
    float shear = fbm(vec3(obj.x * 5.4, obj.y * 31.0, obj.z * 5.4) + vec3(uSeed * 7.7)) - 0.5;
    // Squeeze the band spacing unevenly in latitude: broad tropical belts,
    // tighter ones toward the poles.
    float latWarp = lat + 0.14 * sin(lat * 6.2832) + 0.055 * sin(lat * 15.708);
    float phase = latWarp * uBands + warp * 0.45 + warp2 * 0.20 + turb * 0.10 + shear * 0.14;
    phase += 0.30 * sin(lat * 4.7 + 1.2) + 0.14 * sin(lat * 10.3 - 0.6);
    // Long, slow meanders along each boundary. They shift the bands without
    // folding them back on themselves, which used to shred the belts into
    // disconnected cloud patches.
    phase += 0.18 * sin(atan(obj.z, obj.x) * 1.3 + lat * 5.2) * smoothstep(0.10, 0.85, abs(lat));
    float edgeNoise = fbm(vec3(obj.x * 6.2, obj.y * 21.0, obj.z * 6.2) + vec3(uSeed * 6.1)) - 0.5;
    float edgeFine = fbm(vec3(obj.x * 14.0, obj.y * 52.0, obj.z * 14.0) + vec3(uSeed * 10.3)) - 0.5;
    float edgeSwirl = fbm(vec3(obj.x * 27.0, obj.y * 96.0, obj.z * 27.0) + vec3(uSeed * 13.1)) - 0.5;
    float edgeMask = smoothstep(0.18, 0.88, abs(cos(phase * 3.14159)));
    phase += (edgeNoise * 0.22 + edgeFine * 0.05 + edgeSwirl * 0.04) * edgeMask;
    float s = sin(phase * 3.14159);

    // Alternating belts and zones. The belts are narrower than the pale
    // zones, as they are on Jupiter, with a darker core down the middle.
    float zone = smoothstep(-0.34, 0.54, s);
    float belt = smoothstep(0.12, 0.70, -s);
    float beltCore = smoothstep(0.42, 0.94, -s);
    float equatorial = 1.0 - smoothstep(0.02, 0.17, abs(lat));
    zone = max(zone, equatorial * 0.92);

    float bandPatch = fbm(vec3(obj.x * 3.4, obj.y * 7.5, obj.z * 3.4) + vec3(uSeed * 8.9));
    float beltMod = 0.68 + 0.52 * smoothstep(0.28, 0.74, bandPatch);

    vec3 albedo = mix(uColorB, uColorA, zone);
    albedo = mix(albedo, uColorB * 0.90, belt * beltMod * 0.27);
    albedo = mix(albedo, uColorC, beltCore * beltMod * 0.11);

    // Fine filaments: dark festoons where the belts stir into the zones,
    // and pale ammonia streaks inside the zones. Stretching the noise in
    // latitude keeps these features zonal instead of blobby.
    float streak = fbm(vec3(obj.x * 4.2, obj.y * 44.0, obj.z * 4.2) + vec3(uSeed * 3.4));
    float thread = fbm(vec3(obj.x * 11.0, obj.y * 90.0, obj.z * 11.0) + vec3(uSeed * 4.9));
    float festoon = smoothstep(0.54, 0.72, streak) * (0.22 + 0.78 * belt);
    albedo = mix(albedo, uColorC, festoon * 0.22);
    albedo = mix(albedo, mix(uColorA, vec3(1.0), 0.35), smoothstep(0.56, 0.78, thread) * zone * 0.16);
    albedo = mix(albedo, uColorB, smoothstep(0.60, 0.82, thread) * belt * 0.12);
    // Small ammonia puffs and white ovals breaking up the belts.
    float puff = smoothstep(0.68, 0.86, fbm(vec3(obj.x * 10.0, obj.y * 26.0, obj.z * 10.0) + vec3(uSeed * 9.4)));
    albedo = mix(albedo, mix(uColorA, vec3(1.0), 0.55), puff * belt * 0.10);
    // Fine turbulent filaments and a little grain keep the belts from
    // reading as smooth paint when the globe fills the timeline stage.
    float fil = fbm(vec3(obj.x * 13.0, obj.y * 58.0, obj.z * 13.0) + vec3(uSeed * 6.6));
    albedo = mix(albedo, uColorC * 0.88, smoothstep(0.56, 0.80, fil) * (0.06 + 0.14 * belt));
    float grain = noise(vec3(obj.x, obj.y, obj.z) * 74.0 + vec3(uSeed * 11.0));
    albedo *= 0.972 + 0.056 * grain;

    float cool = smoothstep(0.38, 0.78, fbm(vec3(obj.x * 1.8, obj.y * 4.0, obj.z * 1.8) + vec3(uSeed * 3.3)));
    albedo = mix(albedo, uColorD, cool * uCool);

    // Polar hazes are darker, bluer and less banded than the tropics.
    float polar = smoothstep(0.56, 0.99, abs(lat));
    albedo = mix(albedo, uColorD, polar * (0.20 + 0.68 * uCool));
    albedo *= 1.0 - polar * 0.12;

    albedo *= 0.95 + 0.09 * thread;

    if (uSpot > 0.001) {
      // The Great Red Spot: a sheared oval with a pale collar and a
      // turbulent wake trailing to its east.
      vec3 dir = normalize(vec3(-0.32, -0.24, 0.90));
      vec3 axis1 = normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
      vec3 axis2 = cross(dir, axis1);
      vec3 rel = obj - dir * dot(obj, dir);
      vec2 q = vec2(dot(rel, axis1) / 0.36, dot(rel, axis2) / 0.155);
      float d = length(q) + (fbm(obj * 18.0 + vec3(uSeed * 7.0)) - 0.5) * 0.06;
      float spot = 1.0 - smoothstep(0.50, 0.98, d);
      float collar = smoothstep(0.82, 1.0, d) * (1.0 - smoothstep(1.0, 1.34, d));
      collar *= 0.45 + 0.55 * smoothstep(0.30, 0.70, fbm(obj * 9.0 + vec3(uSeed * 5.5)));
      float rimDark = smoothstep(0.80, 0.96, d) * (1.0 - smoothstep(1.0, 1.18, d));
      float swirl = 0.5 + 0.5 * smoothstep(0.25, 0.80, fbm(vec3(q * 2.7, uSeed * 2.0)));
      float curl = 0.5 + 0.5 * sin(q.y * 8.0 + swirl * 5.0 + q.x * 2.2);
      vec3 spotCol = mix(vec3(0.48, 0.10, 0.028), vec3(0.95, 0.39, 0.17), swirl);
      spotCol *= 0.86 + 0.26 * curl;
      albedo = mix(albedo, spotCol, spot * uSpot * 0.96);
      albedo = mix(albedo, uColorC * 0.70, rimDark * uSpot * 0.30);
      albedo = mix(albedo, mix(uColorA, vec3(1.0), 0.55), collar * uSpot * 0.26);
      vec2 wake = vec2((q.x - 1.85) / 0.62, (q.y + 0.12) / 0.24);
      float wakeMask = (1.0 - smoothstep(0.35, 1.0, length(wake))) * uSpot;
      albedo = mix(albedo, mix(uColorA, uColorC, 0.35), wakeMask * 0.28);

      // A white oval in the southern belt.
      vec3 ovalDir = normalize(vec3(0.10, -0.56, 0.82));
      vec3 oa = normalize(cross(ovalDir, vec3(0.0, 1.0, 0.0)));
      vec3 ob = cross(ovalDir, oa);
      vec3 orel = obj - ovalDir * dot(obj, ovalDir);
      vec2 oq = vec2(dot(orel, oa) / 0.085, dot(orel, ob) / 0.038);
      float oval = 1.0 - smoothstep(0.55, 1.0, length(oq));
      albedo = mix(albedo, mix(uColorA, vec3(1.0), 0.65), oval * uSpot * 0.50);
    }

    // Shoemaker–Levy 9 left a chain of dark scars across Jupiter's south.
    if (uScars > 0.001) {
      for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float lon = 0.55 + fi * 0.18;
        float latScar = -0.42 + 0.015 * sin(fi * 2.1);
        vec3 dir = normalize(vec3(cos(lon) * 0.94, latScar, sin(lon) * 0.94));
        vec3 axis1 = normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
        vec3 axis2 = cross(dir, axis1);
        vec3 rel = obj - dir * dot(obj, dir);
        vec2 q = vec2(dot(rel, axis1) / 0.052, dot(rel, axis2) / 0.034);
        float d = length(q);
        float scar = 1.0 - smoothstep(0.42, 1.0, d);
        float rim = smoothstep(0.78, 1.0, d) * (1.0 - smoothstep(1.0, 1.45, d));
        albedo = mix(albedo, vec3(0.11, 0.048, 0.030), scar * uScars * 0.88);
        albedo = mix(albedo, vec3(0.74, 0.58, 0.42), rim * uScars * 0.20);
      }
    }

    vec3 col = lightSurface(albedo, N, V, 0.22, mix(uColorA, uColorD, 0.55) * 0.55);
    finish(col);
  }
`;

export const ringVertexShader = /* glsl */ `
  varying float vRadius;
  varying float vAngle;

  void main() {
    vRadius = length(position.xy);
    vAngle = atan(position.y, position.x);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const ringFragment = /* glsl */ `
  precision highp float;

  uniform vec3 uRingA;
  uniform vec3 uRingB;
  uniform float uHover;
  uniform float uAlpha;
  uniform float uRingStyle;

  varying float vRadius;
  varying float vAngle;

  float peak(float r, float c, float w) {
    float x = (r - c) / w;
    return exp(-x * x);
  }

  float ringDensity(float r) {
    if (uRingStyle < 0.5) {
      float cRing = smoothstep(1.38, 1.40, r) * (1.0 - smoothstep(1.50, 1.53, r));
      float bRing = smoothstep(1.51, 1.54, r) * (1.0 - smoothstep(1.94, 1.97, r));
      float aRing = smoothstep(2.02, 2.05, r) * (1.0 - smoothstep(2.30, 2.34, r));
      float density = cRing * 0.22 + bRing * 1.00 + aRing * 0.78;
      float cassini = 1.0 - 0.97 * exp(-pow((r - 1.985) / 0.022, 2.0));
      float encke = 1.0 - 0.90 * exp(-pow((r - 2.214) / 0.0065, 2.0));
      float keeler = 1.0 - 0.55 * exp(-pow((r - 2.266) / 0.0045, 2.0));
      float ringlets = 1.0 + 0.10 * sin(r * 232.0) + 0.05 * sin(r * 518.0 + 1.3);
      return clamp(density * cassini * encke * keeler * ringlets, 0.0, 1.0) * smoothstep(1.38, 1.40, r);
    }

    if (uRingStyle < 1.5) {
      // Uranus: a handful of narrow, charcoal-dark rings. Keep them wide
      // enough to read as rings rather than as a cage of hairlines.
      float density = 0.0;
      density += peak(r, 1.60, 0.014) * 0.34;
      density += peak(r, 1.71, 0.012) * 0.58;
      density += peak(r, 1.81, 0.011) * 0.44;
      density += peak(r, 1.91, 0.013) * 0.70;
      density += peak(r, 2.00, 0.016) * 0.92;
      float haze = smoothstep(1.55, 1.62, r) * (1.0 - smoothstep(1.96, 2.04, r)) * 0.030;
      return density + haze;
    }

    // Neptune: four narrow rings. The Adams and Le Verrier arcs brighten
    // part of the circumference; there is no broad sheet, which used to
    // wash the background with a milky rectangle.
    float galle = peak(r, 1.78, 0.017) * 0.36;
    float leverrier = peak(r, 2.12, 0.016) * 0.74;
    float lassell = peak(r, 2.19, 0.014) * 0.34;
    float adams = peak(r, 2.27, 0.015) * 0.92;
    return galle + leverrier + lassell + adams;
  }

  void main() {
    float r = vRadius;
    float density = ringDensity(r);
    float bands;
    float arc = 1.0;
    float colorMix;

    if (uRingStyle < 0.5) {
      bands = 0.84 + 0.10 * sin(r * 44.0) + 0.045 * sin(r * 118.0 + 1.7) + 0.02 * sin(r * 260.0);
      colorMix = 0.10 + 0.58 * smoothstep(1.50, 1.62, r) + 0.24 * smoothstep(1.96, 2.08, r);
      colorMix += 0.035 * sin(r * 74.0 + 0.4);
    } else if (uRingStyle < 1.5) {
      bands = 0.95 + 0.035 * sin(r * 30.0) + 0.015 * sin(r * 74.0 + 1.1);
      colorMix = bands * 0.42;
      arc = 0.94 + 0.06 * sin(vAngle * 2.0 + 0.7);
    } else {
      bands = 0.96 + 0.03 * sin(r * 26.0) + 0.012 * sin(r * 68.0 + 0.9);
      colorMix = bands * 0.66;
      arc = 0.74 + 0.26 * pow(0.5 + 0.5 * sin(vAngle * 3.0 + 1.2), 6.0);
    }

    float alpha = clamp(density * bands * uAlpha * arc, 0.0, 1.0);
    vec3 col = mix(uRingA, uRingB, colorMix);
    col *= 0.94 + 0.10 * smoothstep(1.9, 2.1, r);
    col *= 0.96 + 0.08 * uHover;
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`;
