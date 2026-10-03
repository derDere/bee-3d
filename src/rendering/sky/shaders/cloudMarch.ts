// Raymarcher der Wolken (GLSL): Wolkentürme aus 3D-Rauschen in Wolkenfeldern mit klaren Zonen dazwischen, flache
// Basen in versetzten Schichten, zum Kugelrand hin seitlich und unten immer dichter, oben offen; Gewitterzellen,
// Nebelvolumen an Inseln, Lichtungen um Nester und Stöcke und Blitze im selben Medium. Hinter der Renderdistanz
// schließt eine analytische Wolkenhülle auf dem Kugelrand ab: unter dem Horizont ein beleuchtetes Wolkenmeer aus
// Haufenwolken-Kuppen, darüber Wolkenmassen mit Lücken für Sonne, Mond und Sterne. Ein Regenbogen liegt als Bogen
// um den Gegenpunkt der Sonne auf einem Regenvorhang im selben Strahl.
// Ausgabe: rgb = eingestreute Strahlung (vormultipliziert), a = Transmission.
// Die Dichtefunktion (coverageAt, massNoise, mistDensity, cloudDensity) hat ihr CPU-Gegenstück in
// cloudDensityField.ts; die Formelkonstanten CLOUD_* kommen als Defines aus cloudMedium.ts.

export const CloudMarchFragmentShader = /* glsl */ `
precision highp float;
precision highp sampler3D;

varying vec2 vUV;
varying vec3 vRay;

uniform sampler2D depthSampler;
uniform sampler3D shapeSampler;
uniform sampler3D detailSampler;
uniform sampler2D weatherSampler;

uniform vec3 cameraPosition;
uniform vec3 cameraForward;
uniform vec4 frameParams;      // Frame-Index, Zeit (s), Breite, Höhe der Wolkentextur

uniform vec3 toLight;
uniform vec3 lightColor;
uniform vec3 ambientTop;
uniform vec3 ambientBottom;
uniform vec4 phaseParams;      // g vorwärts, g rückwärts, Rückwärtsanteil, Powder-Stärke

uniform vec4 cloudParams;      // Bedeckung, Dichte, Kachel der Wolkenmassen (m), Stauchung in y
uniform vec4 noiseParams;      // Kachel Form (m), Kachel Detail (m), Extinktion je Dichte (1/m), Albedo
uniform vec4 erosionParams;    // Erosion, Mehrbedeckung je 7 km Tiefe, Ambient-Stärke, Abdunklung in Regenzellen
uniform vec4 stormParams;      // Zellbedeckung, Dichtezuschlag, Regen, Kachel der Wetterkarte (m)
uniform vec3 massOffset;       // Drift der Wolkenmassen (Kacheleinheiten)
uniform vec3 shapeOffset;      // Drift von Form- und Detailrauschen (m)

uniform vec4 marchParams;      // kleinste Schrittweite, Zuwachs je Meter, Renderdistanz, Abbruch-Transmission
uniform vec4 lightParams;      // erste Lichtschrittweite, Wachstum, Lichtdichte-Faktor, Mehrfachstreuung
uniform vec4 boundaryParams;   // Weltradius, Verdichtungsbreite (m), Dichtezuschlag am Rand, Offenheit oben
uniform vec4 hazeParams;       // Dunstweite (m), Dunststärke, Nebelvolumen aktiv, unbenutzt
uniform vec3 hazeColor;
uniform vec4 mistSpheres[MIST_COUNT];
uniform vec4 mistData[MIST_COUNT];
uniform float mistCount;
uniform vec4 lightningParams;  // Position, Stärke
uniform vec3 lightningColor;
uniform vec4 clearings[CLEARING_COUNT]; // Lichtungen: Mittelpunkt, Radius (m)
uniform float clearingCount;
uniform vec4 seaParams;        // Wolkenmeer-Ebene (Welt-y, m), Relief der Kuppen (m), Blickwinkel je Texel (rad), unbenutzt
uniform vec4 rainbowParams;    // Stärke 0..1, Entfernung des Regenvorhangs (m), unbenutzt, unbenutzt

const float PI = 3.14159265;
// Wolkenmeer im Fernfeld: Kachel der Kuppen im Formrauschen (m), Drift relativ zur Massendrift, Reichweite der
// Schattenprobe zur Lichtquelle (m), Schritte durch die Kuppenschicht und Halbierungen am Schnittpunkt.
const float SEA_TILE = 6000.0;
const float SEA_DRIFT = 0.6;
const float SEA_SHADOW_REACH = 260.0;
const int SEA_STEPS = 12;
const int SEA_REFINE_STEPS = 2;
// Frequenz der Haufenwolken-Zellen (Wetterkarte) relativ zur Kachel des Wolkenmeers.
const float SEA_CELL_SCALE = 0.33;
// Luftperspektive des Wolkenmeers: Entfernungsfaktor (< 1: die Kuppen bleiben bis weit zum Horizont plastisch).
const float SEA_HAZE_SCALE = 0.5;
// Hülle über dem Horizont: Höhe (Anteil y / Radius), ab der sie offen ist.
const float HULL_OPEN_Y = 0.25;
// Obergrenze des Streuwinkel-Kosinus für die Hüllmassen: keine Vorwärtsspitze auf den flachen Massen.
const float HULL_PHASE_LIMIT = 0.6;
// Obergrenze des Streuwinkel-Kosinus für Nebel: Nebelschleier im Gegenlicht leuchten weich, ohne die Bildmitte zu
// überstrahlen; Wolken behalten ihre Vorwärtsspitze (Silberränder).
const float MIST_PHASE_LIMIT = 0.6;
// Dunstband am Horizont: halbe Breite (Anteil y der Blickrichtung) und Dichte relativ zur Dunststärke.
const float HORIZON_BAND = 0.07;
const float HORIZON_HAZE = 1.35;
// Leuchten des Dunsts zur Lichtquelle hin, relativ zum Licht.
const float HAZE_GLOW = 0.2;
// Regenbogen: Hauptbogen innen violett (40,6°) bis außen rot (42,4°), Nebenbogen innen rot (50,1°) bis außen violett
// (53,6°) mit einem Drittel der Helligkeit; Helligkeit relativ zum Sonnenlicht.
const float BOW_INNER = 40.6;
const float BOW_WIDTH = 1.8;
const float SECONDARY_INNER = 50.1;
const float SECONDARY_WIDTH = 3.5;
const float BOW_GAIN = 0.15;

// Je Pixel bzw. Schritt gesetzt: Lichtungen und Nebelvolumen werden nur dort ausgewertet, wo der Sichtstrahl sie
// berührt; Lichtproben lassen beide aus (dünn und lokal, kaum Einfluss auf die Beschattung).
bool rayTouchesClearing = true;
bool sampleInMist = true;
// Lichtproben liegen höchstens einige hundert Meter vom Abtastpunkt entfernt; die Wetterkarte ändert sich erst
// über größere Strecken. Sie übernehmen daher Wolkenfeld (R) und Regenzelle (B) des Abtastpunkts.
bool reuseWeather = false;
vec2 sampledWeather = vec2(0.5, 0.0);
// Nebelanteil der zuletzt berechneten Dichte (cloudDensity setzt ihn).
float sampledMist = 0.0;

float saturate1(float x) { return clamp(x, 0.0, 1.0); }
float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }

// Henyey-Greenstein-Phasenfunktion, über die Kugel normiert.
float hg(float mu, float g) {
  float g2 = g * g;
  float denom = max(1e-4, 1.0 + g2 - 2.0 * g * mu);
  return (1.0 - g2) / (4.0 * PI * denom * sqrt(denom));
}

// Verschachteltes Gradientenrauschen (Jimenez) für den Startversatz der Strahlen.
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

// Großräumige Wolkenmassen aus 3D-Rauschen; detailed = zweite Oktave für Abwechslung.
float massNoise(vec3 p, bool detailed) {
  vec3 c = vec3(p.x, p.y * cloudParams.w, p.z) / cloudParams.z + massOffset;
  float a = textureLod(shapeSampler, c, 0.0).r;
  if (!detailed) return a;
  float b = textureLod(shapeSampler, c * CLOUD_MASS_OCTAVE_SCALE + CLOUD_MASS_OCTAVE_OFFSET, 0.0).r;
  return mix(a, b, CLOUD_MASS_OCTAVE_WEIGHT);
}

// Lichtungen um Nester und Stöcke: Faktor 0 im Kern, weicher Rand bis zum Radius.
float clearingFactor(vec3 p) {
  float factor = 1.0;
  for (int i = 0; i < CLEARING_COUNT; i++) {
    if (float(i) >= clearingCount) break;
    vec4 clearing = clearings[i];
    vec3 d = p - clearing.xyz;
    float distanceSquared = dot(d, d);
    if (distanceSquared < clearing.w * clearing.w) {
      factor = min(factor, smoothstep(clearing.w * CLOUD_CLEARING_INNER, clearing.w, sqrt(distanceSquared)));
    }
  }
  return factor;
}

// Örtliche Bedeckung: Grundwert des Wetters, Wolkenfelder (Wetterkarte R), Schichten mit flachen Basen und nach
// oben verjüngten Türmen, Regenzellen (B) als durchgehende hohe Türme, Kugelrand seitlich und unten sehr wolkig,
// oben offen (topOpen); Lichtungen um Nester und Stöcke.
float coverageAt(vec3 p, float r, float topOpen, out float rainCell) {
  if (!reuseWeather) {
    sampledWeather = textureLod(weatherSampler, p.xz / stormParams.w + massOffset.xz * CLOUD_WEATHER_DRIFT, 0.0).rb;
  }
  float cluster = sampledWeather.x;
  float cover = cloudParams.x - p.y / CLOUD_DEPTH_BIAS_METERS * erosionParams.y + (cluster - 0.5) * CLOUD_CLUSTER_STRENGTH;
  float phase = fract((p.y + cluster * CLOUD_LAYER_SPACING) / CLOUD_LAYER_SPACING);
  float profile = smoothstep(0.0, CLOUD_LAYER_BASE_SOFTNESS, phase) * (1.0 - smoothstep(CLOUD_LAYER_TOP_TAPER, 1.0, phase));
  rainCell = 0.0;
  if (stormParams.x > 0.001) {
    rainCell = saturate1(remap(sampledWeather.y, 1.0 - stormParams.x, 1.0, 0.0, 1.0));
  }
  cover = cover * mix(profile, 1.0, rainCell) + rainCell * CLOUD_RAIN_CELL_COVERAGE;
  float edge = smoothstep(boundaryParams.x - boundaryParams.y, boundaryParams.x + CLOUD_BOUNDARY_OVERSHOOT, r);
  float rimCover = mix(CLOUD_BOUNDARY_COVERAGE, cover + CLOUD_RIM_TOP_EXTRA, topOpen);
  float clearing = rayTouchesClearing ? clearingFactor(p) : 1.0;
  return saturate1(mix(cover, rimCover, edge)) * clearing;
}

float mistDensity(vec3 p) {
  float m = 0.0;
  for (int i = 0; i < MIST_COUNT; i++) {
    if (float(i) >= mistCount) break;
    vec4 sphere = mistSpheres[i];
    vec4 data = mistData[i];
    vec3 d = p - sphere.xyz;
    d.y *= data.z;
    float q = length(d) / sphere.w;
    m += saturate1((1.0 - q) / max(data.y, CLOUD_MIST_MIN_SOFTNESS)) * data.x;
  }
  return m;
}

// Dichte des Mediums an p. full = mit Detail-Erosion und zweiter Massenoktave. body = Tiefe in der Wolke (0..1).
float cloudDensity(vec3 p, float lod, bool full, out float body, out float rainCell) {
  float r = length(p);
  float topOpen = smoothstep(CLOUD_RIM_OPEN_FROM, CLOUD_RIM_OPEN_TO, p.y / max(r, 1.0)) * boundaryParams.w;
  float cover = coverageAt(p, r, topOpen, rainCell);
  float mass = massNoise(p, full);
  body = saturate1((mass - (1.0 - cover)) / CLOUD_BODY_RAMP);
  float mist = hazeParams.z > 0.5 && sampleInMist ? mistDensity(p) : 0.0;
  sampledMist = 0.0;
  if (body <= 0.0 && mist <= 0.0) return 0.0;
  float shape = textureLod(shapeSampler, (p + shapeOffset) / noiseParams.x, lod).r;
  // Das Formrauschen formt den Rand und lässt die Dichte im Inneren schwanken; so bekommt das Wolkeninnere Struktur.
  float base = saturate1(remap(body, (1.0 - shape) * CLOUD_SHAPE_THRESHOLD, 1.0, 0.0, 1.0)) * mix(CLOUD_SHAPE_DENSITY_FLOOR, 1.0, shape);
  // Nebelschleier: das Formrauschen bricht die Ellipsoide der Nebelvolumen zu unregelmäßigen Bänken auf
  mist *= mix(CLOUD_MIST_SHAPE_FLOOR, 1.0, shape);
  if (full && base > 0.0) {
    float detail = textureLod(detailSampler, (p + shapeOffset * CLOUD_DETAIL_DRIFT) / noiseParams.y, 0.0).r;
    // Am Rand der Masse fasrig, innen blumenkohlartig
    float erode = mix(1.0 - detail, detail, body) * erosionParams.x;
    base = saturate1(remap(base, erode, 1.0, 0.0, 1.0));
    mist *= mix(CLOUD_MIST_DETAIL_FLOOR, 1.0, detail);
  }
  float edgeBoost = 1.0 + boundaryParams.z * smoothstep(boundaryParams.x - boundaryParams.y, boundaryParams.x, r) * (1.0 - topOpen);
  sampledMist = mist;
  return base * cloudParams.y * edgeBoost * (1.0 + rainCell * stormParams.y) + mist;
}

// Optische Tiefe zur Lichtquelle. cheap: nur die ersten Nahproben und der weite Schritt (dünnes Medium oder ein
// schon weitgehend verdeckter Strahl, Horizon-Zero-Dawn-Kniff), sonst alle LIGHT_SAMPLES.
float lightOpticalDepth(vec3 p, bool cheap) {
  bool viewClearing = rayTouchesClearing;
  bool viewMist = sampleInMist;
  rayTouchesClearing = false;
  sampleInMist = false;
  reuseWeather = true;
  float tau = 0.0;
  float stepLength = lightParams.x;
  float travelled = 0.0;
  float body;
  float rain;
  for (int i = 0; i < LIGHT_SAMPLES; i++) {
    if (cheap && i >= CHEAP_LIGHT_SAMPLES) break;
    vec3 q = p + toLight * (travelled + stepLength * 0.5);
    tau += cloudDensity(q, 1.0, false, body, rain) * stepLength;
    travelled += stepLength;
    stepLength *= lightParams.y;
  }
  // Ein weiter Schritt: große Wolkenmassen beschatten ihre lichtabgewandte Seite.
  vec3 far = p + toLight * (travelled + 180.0);
  tau += cloudDensity(far, 2.0, false, body, rain) * 240.0;
  rayTouchesClearing = viewClearing;
  sampleInMist = viewMist;
  reuseWeather = false;
  return tau * noiseParams.z * lightParams.z;
}

// Licht von Sonne oder Mond mit Mehrfachstreuung nach Wrenninge (drei Oktaven).
vec3 keyLightRadiance(float tauLight, float mu) {
  float a = 1.0;
  float b = 1.0;
  float c = 1.0;
  float sum = 0.0;
  for (int octave = 0; octave < 3; octave++) {
    float phase = mix(hg(mu, phaseParams.x * c), hg(mu, phaseParams.y * c), phaseParams.z);
    sum += a * exp(-b * tauLight) * phase;
    a *= lightParams.w;
    b *= 0.5;
    c *= 0.5;
  }
  return lightColor * sum * 4.0 * PI;
}

float raySphereInside(vec3 origin, vec3 dir, float radius) {
  float b = dot(origin, dir);
  float c = dot(origin, origin) - radius * radius;
  float h = b * b - c;
  if (h < 0.0) return -1.0;
  return -b + sqrt(h);
}

// Anteil der Dunstfarbe nach Entfernung (Luftperspektive).
float hazeAmount(float distance) {
  return (1.0 - exp(-distance / hazeParams.x)) * hazeParams.y;
}

// Dunstband am Horizont (0..1) nach dem Abstand der Blickrichtung zur Horizontebene; Wolkenmeer und Himmel laufen dort in
// derselben Dunstfarbe zusammen.
float horizonHaze(float elevation) {
  return (1.0 - smoothstep(0.0, HORIZON_BAND, abs(elevation))) * min(1.0, hazeParams.y * HORIZON_HAZE);
}

// Dunstfarbe in Blickrichtung: zur Lichtquelle hin leuchtet der Dunst in ihrer Farbe (Vorwärtsstreuung), bei tiefer
// Sonne als goldener Schein über dem Wolkenmeer.
vec3 hazeTint(float mu) {
  return hazeColor + lightColor * (HAZE_GLOW * pow(saturate1(mu), 12.0));
}

// Höhenfeld des Wolkenmeers 0 (Tal) .. 1 (Kuppe): nah ein Schnitt durch das Formrauschen (Perlin-Worley) mit
// blumenkohlartigen Kuppen und kleineren Quellungen, fern die Haufenwolken-Zellen der Wetterkarte (G) mit Mip-Stufen.
// Das Formrauschen hat keine Mip-Stufen; mit wachsender Fläche je Bildtexel (footprint, m) übernehmen deshalb die
// Zellen, so flimmert die Ferne nicht.
float seaHeight(vec2 xz, float footprint) {
  vec2 uv = xz / SEA_TILE + massOffset.xz * SEA_DRIFT;
  float nearWeight = 1.0 - smoothstep(1.5, 4.0, footprint / (SEA_TILE / 128.0));
  float cellLod = log2(max(footprint * SEA_CELL_SCALE * 512.0 / SEA_TILE, 1.0));
  float cells = textureLod(weatherSampler, uv * SEA_CELL_SCALE, cellLod).g;
  float far = mix(0.5, smoothstep(0.15, 0.95, cells), 0.6);
  if (nearWeight <= 0.0) return far;
  float billows = smoothstep(0.2, 0.9, textureLod(shapeSampler, vec3(uv.x, 0.37, uv.y), 0.0).r);
  return mix(far, billows, nearWeight);
}

// Wolkenmeer unter dem Horizont: Kuppenschicht über einer gedachten Ebene tief unter der Kamera, perspektivisch bis zum
// Horizont verkürzt. Wenige Schritte durch die Schicht finden die erste Kuppe im Strahl, so verdecken vordere Kuppen
// die hinteren. Normalen aus dem Gradienten des Höhenfelds und Schatten benachbarter Kuppen bei tiefem Licht ergeben
// helle Kuppen zur Lichtquelle und himmelblau getönte Täler. Ergebnis: Strahlung mit Luftperspektive, deckend.
vec3 cloudSea(vec3 dir, float mu) {
  float slope = max(-dir.y, 1e-4);
  float relief = seaParams.y;
  // Bei streifendem Blick reichen die Schritte nicht für einzelne Kuppen: dort bleibt nur die Schattierung
  float stepRelief = relief * smoothstep(0.03, 0.15, slope);
  float above = max(cameraPosition.y - seaParams.x - stepRelief, 1.0);
  float tTop = above / slope;
  float tBase = (above + stepRelief) / slope;
  float texel = SEA_TILE / 128.0;
  // Fläche eines Bildtexels auf dem Wolkenmeer, in Blickrichtung um die Neigung gestreckt
  float spread = seaParams.z / max(slope, 0.05);
  float t = tBase;
  float fractionPrevious = 0.0;
  for (int i = 1; i <= SEA_STEPS; i++) {
    float fraction = float(i) / float(SEA_STEPS);
    float ts = mix(tTop, tBase, fraction);
    if (1.0 - fraction <= seaHeight(cameraPosition.xz + dir.xz * ts, ts * spread)) {
      // Schnittpunkt zwischen den letzten beiden Schritten durch Halbieren verfeinert
      float low = fractionPrevious;
      float high = fraction;
      for (int j = 0; j < SEA_REFINE_STEPS; j++) {
        float middle = 0.5 * (low + high);
        float tm = mix(tTop, tBase, middle);
        if (1.0 - middle <= seaHeight(cameraPosition.xz + dir.xz * tm, tm * spread)) {
          high = middle;
        } else {
          low = middle;
        }
      }
      t = mix(tTop, tBase, 0.5 * (low + high));
      break;
    }
    fractionPrevious = fraction;
  }
  vec2 xz = cameraPosition.xz + dir.xz * t;
  float footprint = t * spread;
  float e = max(footprint, 1.5 * texel);
  float h = seaHeight(xz, footprint);
  float hx = seaHeight(xz + vec2(e, 0.0), footprint);
  float hz = seaHeight(xz + vec2(0.0, e), footprint);
  vec3 normal = normalize(vec3((h - hx) * relief / e, 1.0, (h - hz) * relief / e));
  float across = max(length(toLight.xz), 1e-3);
  float hShadow = seaHeight(xz + toLight.xz / across * SEA_SHADOW_REACH, footprint);
  float rise = SEA_SHADOW_REACH * max(toLight.y, 0.0) / across / relief;
  float shadow = smoothstep(-0.1, 0.12, h + rise - hShadow);
  // Kuppen verdecken die Täler: dort kaum Sonnenlicht und weniger Himmelslicht, die Schatten bleiben himmelblau
  float lit = saturate1((dot(normal, toLight) + 0.35) / 1.35) * shadow * mix(0.25, 1.0, h);
  vec3 key = keyLightRadiance(mix(9.0, 0.25, lit), mu) * noiseParams.w;
  vec3 ambient = (ambientTop * mix(0.7, 1.0, normal.y) + ambientBottom * 0.4) * mix(0.3, 1.0, h) * erosionParams.z;
  return mix(key + ambient, hazeTint(mu), max(hazeAmount(t * SEA_HAZE_SCALE), horizonHaze(slope)));
}

// Wolkenmassen der Hülle über dem Horizont, nach oben immer offener; um eine tief stehende Lichtquelle bleibt die Hülle
// offen, damit Sonne und Mond über dem Wolkenmeer frei stehen. Ergebnis: rgb vormultipliziert, a = Deckung.
vec4 hullMasses(vec3 dir, float hullT, float mu) {
  vec3 normal = (cameraPosition + dir * hullT) / (boundaryParams.x - 100.0);
  vec3 coordinate = normal * 1.8 + massOffset * 0.25;
  float masses = textureLod(shapeSampler, coordinate, 0.0).r * 0.75 + textureLod(shapeSampler, coordinate * 2.7 + 0.13, 0.0).r * 0.25;
  float lowLight = 1.0 - smoothstep(0.12, 0.35, toLight.y);
  float window = smoothstep(0.96, 0.998, mu) * lowLight;
  float openness = boundaryParams.w * max(smoothstep(-0.02, HULL_OPEN_Y, normal.y), window) * (1.0 - stormParams.x * 0.6);
  float thickness = saturate1((masses - openness) / 0.3);
  float opacity = 1.0 - exp(-thickness * 7.0);
  vec3 light = keyLightRadiance(mix(0.4, 3.2, thickness), min(mu, HULL_PHASE_LIMIT)) * noiseParams.w * 0.9
    + (ambientTop * mix(0.6, 1.0, normal.y * 0.5 + 0.5) + ambientBottom * 0.5) * erosionParams.z;
  return vec4(mix(light, hazeTint(mu), hazeAmount(hullT)) * opacity, opacity);
}

// Fernfeld hinter der Renderdistanz: Wolkenmeer unter dem Horizont, Wolkenmassen und Dunstband darüber. Nahe am
// Kugelrand blendet es aus, dort übernehmen die Volumenwolken. Ergebnis: rgb vormultipliziert, a = Deckung.
vec4 farField(vec3 dir, float hullT, float mu) {
  vec4 far;
  if (dir.y < 0.0) {
    far = vec4(cloudSea(dir, mu), 1.0);
  } else {
    far = hullMasses(dir, hullT, mu);
    float band = horizonHaze(dir.y);
    far = vec4(far.rgb * (1.0 - band) + hazeTint(mu) * band, 1.0 - (1.0 - far.a) * (1.0 - band));
  }
  float marchReach = marchParams.z;
  return far * smoothstep(marchReach * 0.5, marchReach * 0.85, hullT + marchReach * 0.3);
}

// Spektralfarbe 0 (violett) .. 1 (rot).
vec3 spectrum(float x) {
  float hue = (1.0 - saturate1(x)) * 0.78;
  return clamp(abs(fract(hue + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
}

// Regenbogen aus Haupt- und Nebenbogen um den Gegenpunkt der Lichtquelle, innerhalb des Hauptbogens etwas aufgehellt.
vec3 rainbowRadiance(vec3 dir) {
  float angle = degrees(acos(clamp(dot(dir, -toLight), -1.0, 1.0)));
  float primary = (angle - BOW_INNER) / BOW_WIDTH;
  float primaryWeight = smoothstep(-0.35, 0.12, primary) * (1.0 - smoothstep(0.88, 1.3, primary));
  float secondary = (SECONDARY_INNER + SECONDARY_WIDTH - angle) / SECONDARY_WIDTH;
  float secondaryWeight = smoothstep(-0.25, 0.12, secondary) * (1.0 - smoothstep(0.88, 1.25, secondary)) * 0.33;
  float inner = smoothstep(BOW_INNER - 12.0, BOW_INNER, angle) * (1.0 - smoothstep(BOW_INNER, BOW_INNER + 0.4, angle));
  // Die Spektralfarben überlagern sich in echten Regenbögen: etwas Weiß nimmt ihnen die Härte
  vec3 bow = mix(vec3(0.4), spectrum(primary), 0.75) * primaryWeight
    + mix(vec3(0.4), spectrum(secondary), 0.75) * secondaryWeight
    + vec3(inner * 0.06);
  return bow * lightColor * (BOW_GAIN * rainbowParams.x);
}

void main(void) {
  vec3 dir = normalize(vRay);
  float viewZ = textureLod(depthSampler, vUV, 0.0).r;
  bool hitsGeometry = viewZ > 0.0;
  float sceneT = hitsGeometry ? viewZ / max(1e-4, dot(dir, cameraForward)) : 1e9;
  float renderDistance = marchParams.z;
  float tEnd = min(sceneT, renderDistance);
  float shellT = raySphereInside(cameraPosition, dir, boundaryParams.x + 500.0);
  if (shellT > 0.0) tEnd = min(tEnd, shellT);

  float mu = dot(dir, toLight);
  vec3 radiance = vec3(0.0);
  float transmittance = 1.0;
  // Nach Deckung gewichtete mittlere Entfernung des Mediums: Maß für die Luftperspektive der Wolken.
  float hazeDepthSum = 0.0;
  float hazeWeight = 0.0;

  // Abschnitte des Strahls in den Nebelvolumen (Ellipsoide): dort bleiben die Leerschritte kurz.
  float mistNear[MIST_COUNT];
  float mistFar[MIST_COUNT];
  bool mistActive = hazeParams.z > 0.5;
  if (mistActive) {
    for (int k = 0; k < MIST_COUNT; k++) {
      mistNear[k] = 1e9;
      mistFar[k] = -1e9;
      if (float(k) >= mistCount) continue;
      vec4 sphere = mistSpheres[k];
      vec3 o = cameraPosition - sphere.xyz;
      vec3 d = dir;
      o.y *= mistData[k].z;
      d.y *= mistData[k].z;
      float a = dot(d, d);
      float b = dot(o, d);
      float h = b * b - a * (dot(o, o) - sphere.w * sphere.w);
      if (h > 0.0) {
        float root = sqrt(h);
        mistNear[k] = (-b - root) / a;
        mistFar[k] = (-b + root) / a;
      }
    }
  }

  // Lichtungen nur prüfen, wenn der Sichtstrahl eine berührt (Strahl-Kugel-Test je Pixel).
  rayTouchesClearing = false;
  for (int k = 0; k < CLEARING_COUNT; k++) {
    if (float(k) >= clearingCount) break;
    vec3 o = cameraPosition - clearings[k].xyz;
    float b = dot(o, dir);
    float c = dot(o, o) - clearings[k].w * clearings[k].w;
    if (c < 0.0 || (b < 0.0 && b * b > c)) {
      rayTouchesClearing = true;
    }
  }

  // Regenvorhang des Regenbogens: Transmission bis zu ihm (< 0, solange der Strahl ihn nicht erreicht hat).
  float curtain = rainbowParams.y;
  float curtainTransmittance = -1.0;

  // Jede Probe liegt an einer je Pixel und Frame versetzten Stelle ihres Grundschritts. Feste Probenabstände
  // zeichneten Höhenlinien, etwa in Wolken hinter Nebelvolumen; das Restrauschen mittelt die zeitliche Glättung.
  float jitter = fract(ign(gl_FragCoord.xy) + frameParams.x * 0.6180339);
  float t = 0.0;
  for (int i = 0; i < MAX_STEPS; i++) {
    float baseStep = marchParams.x + marchParams.y * t;
    float ts = t + jitter * baseStep;
    if (curtainTransmittance < 0.0 && ts >= curtain) curtainTransmittance = transmittance;
    if (ts > tEnd || transmittance < marchParams.w) break;
    vec3 p = cameraPosition + dir * ts;
    float lod = clamp(log2(1.0 + ts * 0.0025), 0.0, 3.0);
    bool inMist = false;
    if (mistActive) {
      for (int k = 0; k < MIST_COUNT; k++) {
        if (float(k) >= mistCount) break;
        if (ts >= mistNear[k] && ts <= mistFar[k]) {
          inMist = true;
          break;
        }
      }
    }
    sampleInMist = inMist;
    float body;
    float rainCell;
    float density = cloudDensity(p, lod, true, body, rainCell);
    // Nahe der Renderdistanz blenden die Volumenwolken aus; dahinter übernimmt die Hülle. Direkt an der Kamera
    // ist das Medium weicher: beim Durchfliegen bleibt Sicht durch das Wolkeninnere.
    float fade = (1.0 - smoothstep(renderDistance * 0.72, renderDistance, ts)) * mix(0.25, 1.0, smoothstep(0.0, 55.0, ts));
    density *= fade;
    // Schrittweite und Lichtpfad richten sich nach dem Wolkenanteil; für den dünnen Nebel gelten feste Regeln, damit
    // keine Umschaltschwelle Ringe in den Nebel zeichnet.
    float cloudPart = max(density - sampledMist * fade, 0.0);
    float dt = baseStep;
    if (density > 0.0005) {
      // Kürzere Schritte nur in merklicher Wolkendichte; dünnes Medium kostet so keine zusätzlichen Schritte.
      dt *= cloudPart > 0.05 ? 0.65 : 1.0;
      float sigma = density * noiseParams.z;
      float tauLight = lightOpticalDepth(p, transmittance < 0.85 || cloudPart < 0.12);
      float mistShare = 1.0 - cloudPart / max(density, 1e-6);
      vec3 key = keyLightRadiance(tauLight, mix(mu, min(mu, MIST_PHASE_LIMIT), mistShare));
      // Powder: frontal beleuchtete Ränder dunkler, Gegenlicht leuchtend
      float powder = mix(1.0, 1.0 - exp(-2.0 * sigma * 6.0), phaseParams.w * (0.5 - 0.5 * mu));
      // Himmelslicht von oben, von Wolken darüber verdeckt; von unten das Streulicht tieferer Wolken
      float covered = saturate1((massNoise(p + vec3(0.0, 90.0, 0.0), false) - (1.0 - cloudParams.x)) / 0.3);
      vec3 ambient = (ambientTop * (1.0 - 0.7 * covered) + ambientBottom * 0.6) * mix(0.55, 1.0, 1.0 - body * 0.5) * erosionParams.z;
      vec3 inScatter = key * powder + ambient;
      if (lightningParams.w > 0.0) {
        // Blitz in der Wolke: Leuchtradius 350 m, quadrierter Abfall hält das Leuchten in der Gewitterzelle
        vec3 toFlash = lightningParams.xyz - p;
        float flashFalloff = 1.0 / (1.0 + dot(toFlash, toFlash) / 122500.0);
        inScatter += lightningColor * lightningParams.w * flashFalloff * flashFalloff;
      }
      float albedo = noiseParams.w * (1.0 - erosionParams.w * rainCell);
      vec3 S = sigma * albedo * inScatter;
      float stepT = exp(-sigma * dt);
      float absorbed = transmittance * (1.0 - stepT);
      hazeDepthSum += ts * absorbed;
      hazeWeight += absorbed;
      radiance += transmittance * (S - S * stepT) / max(sigma, 1e-6);
      transmittance *= stepT;
    } else {
      dt = inMist ? min(dt, max(CLOUD_MIST_STEP, ts * 0.015)) : dt * 1.8;
    }
    t += dt;
  }

  // Luftperspektive der Volumenwolken: entfernte Wolken nähern sich der Dunstfarbe. Maßgeblich ist die mittlere
  // Entfernung des sichtbaren Mediums; dünner Nebel vor fernen Wolken verschiebt sie kaum.
  if (hazeWeight > 1e-4) {
    radiance = mix(radiance, hazeTint(mu) * (1.0 - transmittance), hazeAmount(hazeDepthSum / hazeWeight));
  }

  // Regenbogen auf dem Regenvorhang: verdeckt von Wolken davor und von Geometrie vor dem Vorhang.
  if (rainbowParams.x > 0.0) {
    if (curtainTransmittance < 0.0 && tEnd >= curtain) curtainTransmittance = transmittance;
    radiance += rainbowRadiance(dir) * max(curtainTransmittance, 0.0);
  }

  // Fernfeld nur für Himmelspixel, mit eigener Luftperspektive.
  if (!hitsGeometry && transmittance > marchParams.w) {
    float hullT = raySphereInside(cameraPosition, dir, boundaryParams.x - 100.0);
    if (hullT > 0.0) {
      vec4 far = farField(dir, hullT, mu);
      radiance += transmittance * far.rgb;
      transmittance *= 1.0 - far.a;
    }
  }
  gl_FragColor = vec4(radiance, transmittance);
}
`;
