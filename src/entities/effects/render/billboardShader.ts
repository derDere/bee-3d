// Shader der Effekt-Billboards (GLSL; unter WebGPU übersetzt Babylon ihn automatisch).
//
// Jede Instanz ist eine Kapsel von A nach B im Bildraum: Der Vertex-Shader projiziert beide Endpunkte,
// rechnet die Radien in Pixel um (mit Mindestgröße, damit kleine Effekte auch aus 60 m lesbar bleiben)
// und spannt ein Viereck in Pixeln auf. Der Fragment-Shader misst den Pixelabstand zur Achse und
// formt daraus Leuchten, Ring, Rauch, glänzenden Ballen, Stern oder Wellenschale. Ein Punkt ist eine
// Kapsel mit A = B.
//
// Instanzdaten liegen gepackt im Thin-Instance-Matrixpuffer (world0..world3):
//   world0 = A.xyz, Radius A (m)        world1 = B.xyz, Radius B (m)
//   world2 = Farbe vormultipliziert, Deckkraft (0 = rein additiv)
//   world3 = Formcode, Formparameter, Deckkraft am Ende A, Mindestradius und Tiefenvorzug (gepackt)
// Formcode = Form + 8 · Naht an A + 16 · Naht an B + Zufallswert in [0, 1). An einer Naht blenden zwei
// aneinanderhängende Kapseln gegeneinander über, damit Ketten (Rauchspuren, Ringe) ohne Perlen wirken.
// Gepackt = Mindestradius in px (0..63,9) + 64 · Tiefenvorzug in cm. Der Tiefenvorzug rückt die Kapsel
// zur Kamera (bei gleicher Bildgröße), damit Trefferglühen im Inneren eines Ziels über dessen Oberfläche liegt.

/** Vertex-Shader der Effekt-Billboards. Die Funktion main steht am Ende (WebGPU hängt dort den Y-Ausgleich an). */
export const BillboardVertexShader = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;

uniform mat4 viewProjection;
uniform mat4 projection;
uniform vec3 cameraPosition;
uniform vec2 viewportSize;
uniform float inflateExponent;

varying vec3 vPixel;
varying vec4 vSegment;
varying vec4 vRadius;
varying vec4 vColor;
varying vec4 vShape;
varying vec2 vEnergy;

const float NearW = 0.02;

void main(void) {
  float packed = world3.w;
  float pullCentimeters = floor(packed / 64.0);
  float minimumPixels = max(packed - pullCentimeters * 64.0, 0.3);
  float depthPull = pullCentimeters * 0.01;
  vec3 positionA = world0.xyz;
  vec3 positionB = world1.xyz;
  float radiusA = world0.w;
  float radiusB = world1.w;
  if (depthPull > 0.0) {
    // Zur Kamera rücken, Radius im selben Verhältnis verkleinern: Bildgröße bleibt, Tiefe wird kleiner
    vec3 toCameraA = cameraPosition - positionA;
    vec3 toCameraB = cameraPosition - positionB;
    float distanceA = max(length(toCameraA), 0.0001);
    float distanceB = max(length(toCameraB), 0.0001);
    float pullA = min(depthPull, distanceA * 0.9);
    float pullB = min(depthPull, distanceB * 0.9);
    positionA += toCameraA * (pullA / distanceA);
    positionB += toCameraB * (pullB / distanceB);
    radiusA *= (distanceA - pullA) / distanceA;
    radiusB *= (distanceB - pullB) / distanceB;
  }
  vec4 clipA = viewProjection * vec4(positionA, 1.0);
  vec4 clipB = viewProjection * vec4(positionB, 1.0);
  float fadeA = world3.z;
  float hidden = step(clipA.w, NearW) * step(clipB.w, NearW);

  // Abschnitt an der Nahebene kappen (homogen linear, daher exakt)
  if (clipA.w < NearW && clipB.w >= NearW) {
    float k = (NearW - clipA.w) / (clipB.w - clipA.w);
    clipA = mix(clipA, clipB, k);
    radiusA = mix(radiusA, radiusB, k);
    fadeA = mix(fadeA, 1.0, k);
  } else if (clipB.w < NearW && clipA.w >= NearW) {
    float k = (NearW - clipB.w) / (clipA.w - clipB.w);
    clipB = mix(clipB, clipA, k);
    radiusB = mix(radiusB, radiusA, k);
  }
  clipA.w = max(clipA.w, NearW);
  clipB.w = max(clipB.w, NearW);

  vec2 halfViewport = 0.5 * viewportSize;
  vec2 pixelA = clipA.xy / clipA.w * halfViewport;
  vec2 pixelB = clipB.xy / clipB.w * halfViewport;
  float pixelsPerMeter = projection[1][1] * halfViewport.y;
  float trueA = radiusA * pixelsPerMeter / clipA.w;
  float trueB = radiusB * pixelsPerMeter / clipB.w;
  float pixelsA = max(trueA, minimumPixels);
  float pixelsB = max(trueB, minimumPixels);
  // Aufgeblähte (zu kleine) Teile verlieren einen Teil ihrer Helligkeit, bleiben aber sichtbar
  vEnergy = vec2(pow(clamp(trueA / pixelsA, 0.0, 1.0), inflateExponent), pow(clamp(trueB / pixelsB, 0.0, 1.0), inflateExponent));

  float code = world3.x;
  float identifier = floor(code);
  float seed = code - identifier;
  float jointB = step(15.5, identifier);
  identifier -= 16.0 * jointB;
  float jointA = step(7.5, identifier);
  float shape = identifier - 8.0 * jointA;

  vec2 axis = pixelB - pixelA;
  float axisLength = length(axis);
  float angle = seed * 6.2831853;
  vec2 direction = axisLength > 0.01 ? axis / axisLength : vec2(cos(angle), sin(angle));
  vec2 normal = vec2(-direction.y, direction.x);
  float atB = position.x;
  float sideRadius = max(pixelsA, pixelsB) + 1.0;
  float capRadius = mix(pixelsA, pixelsB, atB) + 1.0;
  vec2 center = mix(pixelA, pixelB, atB);
  vec4 clip = mix(clipA, clipB, atB);
  vec2 pixel = center + normal * (position.y * sideRadius) + direction * ((atB * 2.0 - 1.0) * capRadius);

  gl_Position = mix(vec4(pixel / halfViewport * clip.w, clip.z, clip.w), vec4(0.0, 0.0, -2.0, 1.0), hidden);
  vPixel = vec3(pixel * clip.w, clip.w);
  vSegment = vec4(pixelA, pixelB);
  vRadius = vec4(pixelsA, pixelsB, fadeA, world3.y);
  vColor = world2;
  vShape = vec4(shape, seed, jointA, jointB);
}
`;

/** Fragment-Shader der Effekt-Billboards; Ausgabe vormultipliziert (Mischmodus ONE, ONE_MINUS_SRC_ALPHA). */
export const BillboardFragmentShader = /* glsl */ `
precision highp float;

varying vec3 vPixel;
varying vec4 vSegment;
varying vec4 vRadius;
varying vec4 vColor;
varying vec4 vShape;
varying vec2 vEnergy;

uniform float time;
uniform vec3 lightDirection;
uniform vec3 lightColor;
uniform vec3 ambientColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(cell);
  float b = hash12(cell + vec2(1.0, 0.0));
  float c = hash12(cell + vec2(0.0, 1.0));
  float d = hash12(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main(void) {
  // Bildschirmlinear interpolierte Pixelposition (Wert · w und w, siehe Vertex-Shader)
  vec2 pixel = vPixel.xy / vPixel.z;
  vec2 a = vSegment.xy;
  vec2 ab = vSegment.zw - a;
  float lengthSq = dot(ab, ab);
  float segmentLength = sqrt(lengthSq);
  float t = lengthSq > 0.0001 ? dot(pixel - a, ab) / lengthSq : 0.5;
  float tc = clamp(t, 0.0, 1.0);
  float radius = mix(vRadius.x, vRadius.y, tc);
  vec2 offset = pixel - (a + ab * tc);
  float q = length(offset) / radius;
  if (q >= 1.0) {
    discard;
  }
  float pixelQ = 1.0 / radius;
  float shape = vShape.x;
  float param = vRadius.w;
  vec2 local = offset / radius;
  vec3 rgb;
  float coverage;

  if (shape < 0.5) {
    // Leuchten: gefensterte Gauß-Glocke, param = Schärfe
    float sharp = max(param, 0.5);
    float g = (exp(-sharp * q * q) - exp(-sharp)) / (1.0 - exp(-sharp));
    rgb = vColor.rgb * g;
    coverage = g;
  } else if (shape < 1.5) {
    // Ring, param = Dicke relativ zum Radius (mindestens gut ein Pixel)
    float width = max(param, 1.25 * pixelQ);
    float center = 1.0 - width - pixelQ;
    float d = (q - center) / width;
    float g = exp(-3.0 * d * d) * min(1.0, param / width + 0.25);
    rgb = vColor.rgb * g;
    coverage = g;
  } else if (shape < 2.5) {
    // Rauch: Ballen mit Rauschen entlang und quer zur Achse, ausgefranstem Rand und Eigenschatten,
    // param = Zerfaserung. Rauschkoordinaten in Radien, damit Kapselketten nicht wie Rohre wirken.
    float seed = vShape.y * 61.0;
    vec2 axisDirection = segmentLength > 0.01 ? ab / segmentLength : vec2(1.0, 0.0);
    vec2 puff = segmentLength > 0.01
      ? vec2(t * segmentLength / radius, dot(offset, vec2(-axisDirection.y, axisDirection.x)) / radius)
      : local;
    float n = valueNoise(puff * 1.9 + vec2(seed, seed * 0.37 + time * 0.3)) * 0.6
      + valueNoise(puff * 4.3 - vec2(seed * 0.71, time * 0.45)) * 0.4;
    float breakup = clamp(param, 0.0, 1.0);
    float density = (1.0 - q * q) * mix(1.0, 0.3 + 1.4 * n, breakup);
    float g = clamp(density * 1.3 - 0.15 * breakup, 0.0, 1.0);
    g = g * g * (3.0 - 2.0 * g);
    float facing = clamp(dot(local, lightDirection.xy) * 1.2 + 0.25, -1.0, 1.0);
    vec3 light = ambientColor + lightColor * (0.8 + 0.2 * facing);
    rgb = vColor.rgb * light * g;
    coverage = g;
  } else if (shape < 3.5) {
    // Glänzender Ballen: Kugel-Impostor mit Glanzpunkt und Randlicht, param = Eigenleuchten
    float z = sqrt(max(0.0, 1.0 - q * q));
    vec3 n = vec3(local, z);
    float diffuse = max(dot(n, lightDirection), 0.0);
    vec3 halfway = normalize(lightDirection + vec3(0.0, 0.0, 1.0));
    float specular = pow(max(dot(n, halfway), 0.0), 56.0);
    float rim = (1.0 - z) * (1.0 - z);
    float edge = 1.0 - smoothstep(1.0 - 1.6 * pixelQ, 1.0, q);
    vec3 albedo = vColor.rgb;
    vec3 shaded = albedo * (ambientColor + lightColor * diffuse) + albedo * param * (0.55 + 0.9 * rim)
      + lightColor * (specular * 1.6 * vColor.a);
    rgb = shaded * edge;
    coverage = edge;
  } else if (shape < 4.5) {
    // Stern: heller Kern mit vier Strahlen, param = Strahlstärke
    float angle = vShape.y * 6.2831853;
    vec2 axisDirection = segmentLength > 0.01 ? ab / segmentLength : vec2(cos(angle), sin(angle));
    float u = dot(local, axisDirection);
    float v = dot(local, vec2(-axisDirection.y, axisDirection.x));
    float core = exp(-16.0 * q * q);
    float halo = exp(-4.0 * q * q) * 0.3;
    float rays = (exp(-abs(v) * 34.0) + exp(-abs(u) * 34.0)) * (1.0 - q) * param;
    float g = (core + halo + rays) * (1.0 - q * q);
    rgb = vColor.rgb * g;
    coverage = min(g, 1.0);
  } else {
    // Schale: heller Rand einer Kugelwelle, param = Füllung
    float rim = smoothstep(0.55, 0.96, q) * (1.0 - smoothstep(0.96, 1.0, q));
    float g = rim * rim * 1.4 + param * (1.0 - q * q);
    rgb = vColor.rgb * g;
    coverage = g;
  }

  float fade = mix(vRadius.z, 1.0, tc);
  float weightA = vShape.z > 0.5 ? clamp(0.5 + t * segmentLength / (2.0 * vRadius.x), 0.0, 1.0) : 1.0;
  float weightB = vShape.w > 0.5 ? clamp(0.5 + (1.0 - t) * segmentLength / (2.0 * vRadius.y), 0.0, 1.0) : 1.0;
  float energy = mix(vEnergy.x, vEnergy.y, tc);
  float k = fade * weightA * weightB * energy;
  gl_FragColor = vec4(rgb * k, vColor.a * coverage * k);
}
`;
