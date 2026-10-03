// Compositor der Wolken (GLSL): Hochskalieren der Wolkentextur auf volle Auflösung und vormultiplizierte
// Überblendung über die Szene (Ergebnis = L + Szene × T). Am reinen Himmel kubischer B-Spline (keine Treppen an
// Wolkenrändern), an Geometrie tiefenbewusst bilinear (keine Säume an Inselkanten). Die Luftperspektive auf Inseln
// und Objekten entsteht je Vollbildpixel aus der Tiefe, auch für ferne Inseln kleiner als ein Wolkentexel.

export const CloudCompositeFragmentShader = /* glsl */ `
precision highp float;

// Stärke des zusätzlichen Fern-Dunsts auf Geometrie (0..1).
const float FAR_FADE = 0.8;

varying vec2 vUV;
varying vec3 vRay;

uniform sampler2D cloudSampler;
uniform sampler2D depthSampler;
uniform vec4 cloudTexel;       // 1/Breite, 1/Höhe, Breite, Höhe der Wolkentextur
uniform float cloudOpacity;
uniform vec3 cameraForward;
uniform vec4 hazeParams;       // Dunstweite (m), Dunststärke
uniform vec3 hazeColor;

float linearDepth(float viewZ) {
  return viewZ > 0.0 ? viewZ : 1e6;
}

// Kubischer B-Spline aus vier bilinearen Abrufen (GPU Gems 2, Kapitel 20).
vec4 sampleBSpline(vec2 uv) {
  vec2 st = uv * cloudTexel.zw - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 h0 = (i - 1.0 + w1 / g0 + 0.5) * cloudTexel.xy;
  vec2 h1 = (i + 1.0 + w3 / g1 + 0.5) * cloudTexel.xy;
  vec4 a = textureLod(cloudSampler, vec2(h0.x, h0.y), 0.0);
  vec4 b = textureLod(cloudSampler, vec2(h1.x, h0.y), 0.0);
  vec4 c = textureLod(cloudSampler, vec2(h0.x, h1.y), 0.0);
  vec4 d = textureLod(cloudSampler, vec2(h1.x, h1.y), 0.0);
  return g0.y * (g0.x * a + g1.x * b) + g1.y * (g0.x * c + g1.x * d);
}

void main(void) {
  float viewZ = textureLod(depthSampler, vUV, 0.0).r;
  float depth = linearDepth(viewZ);
  vec2 lowPosition = vUV * cloudTexel.zw - 0.5;
  vec2 baseTexel = floor(lowPosition);
  vec2 fraction = lowPosition - baseTexel;
  vec4 sum = vec4(0.0);
  float weightSum = 0.0;
  bool allSky = depth > 1e5;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 offset = vec2(float(i), float(j));
      vec2 uv = (baseTexel + offset + 0.5) * cloudTexel.xy;
      float lowDepth = linearDepth(textureLod(depthSampler, uv, 0.0).r);
      allSky = allSky && lowDepth > 1e5;
      float bilinear = (i == 0 ? 1.0 - fraction.x : fraction.x) * (j == 0 ? 1.0 - fraction.y : fraction.y);
      float similarity = 1.0 / (1e-3 + abs(lowDepth - depth) / (0.02 * min(lowDepth, depth) + 0.3));
      float weight = bilinear * similarity;
      sum += textureLod(cloudSampler, uv, 0.0) * weight;
      weightSum += weight;
    }
  }
  vec4 cloud = allSky ? sampleBSpline(vUV) : (weightSum > 0.0 ? sum / weightSum : textureLod(cloudSampler, vUV, 0.0));
  // Luftperspektive: der durchgelassene Rest der Szene verblasst mit der Entfernung im Dunst. Ferne Inseln (wenige
  // Pixel groß) gehen ab 2 km zusätzlich im Dunst auf und lesen sich als blasse Tupfer.
  if (viewZ > 0.0) {
    float sceneT = viewZ / max(1e-4, dot(normalize(vRay), cameraForward));
    float sceneHaze = 1.0 - (1.0 - (1.0 - exp(-sceneT / hazeParams.x)) * hazeParams.y) * (1.0 - FAR_FADE * smoothstep(2000.0, 5500.0, sceneT));
    cloud.rgb += cloud.a * hazeColor * sceneHaze;
    cloud.a *= 1.0 - sceneHaze;
  }
  float alpha = (1.0 - cloud.a) * cloudOpacity;
  gl_FragColor = vec4(cloud.rgb * cloudOpacity, alpha);
}
`;
