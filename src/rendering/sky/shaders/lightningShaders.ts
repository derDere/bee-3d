// Shader des sichtbaren Blitzkanals (GLSL; unter WebGPU übersetzt Babylon sie): jedes Kanalstück ist ein zur
// Kamera gedrehtes, selbstleuchtendes Band mit Mindestbreite in Pixeln, weißem Kern und blauem Hof; ferne Stücke
// verblassen im Dunst.

export const LightningVertexShader = /* glsl */ `
precision highp float;

attribute vec3 position;       // Endpunkt des Kanalstücks
attribute vec3 boltAxis;       // Richtung des Kanalstücks (Einheitsvektor)
attribute vec4 boltInfo;       // x Seite (−1/1), y halbe Breite (m), z Helligkeit des Asts, w Sichtbarkeit durch Wolken

uniform mat4 viewProjection;
uniform vec3 cameraPosition;
uniform float pixelAngle;      // Winkel eines Pixels (rad)

varying float vSide;
varying float vIntensity;
varying float vDistance;

void main(void) {
  vec3 toCamera = cameraPosition - position;
  float dist = max(length(toCamera), 1e-3);
  vec3 across = cross(boltAxis, toCamera / dist);
  float acrossLength = length(across);
  vec3 side = acrossLength > 1e-4 ? across / acrossLength : vec3(1.0, 0.0, 0.0);
  // Mindestens gut ein Pixel breit, damit ferne Kanäle nicht flimmern; die Verbreiterung dämpft maßvoll.
  float halfWidth = max(boltInfo.y, dist * pixelAngle * 1.2);
  float thinning = sqrt(boltInfo.y / halfWidth);
  vSide = boltInfo.x;
  vIntensity = boltInfo.z * boltInfo.w * thinning;
  vDistance = dist;
  // Das Band ist dreimal so breit wie der Kern: Platz für den Hof.
  gl_Position = viewProjection * vec4(position + side * (boltInfo.x * halfWidth * 3.0), 1.0);
}
`;

export const LightningFragmentShader = /* glsl */ `
precision highp float;

varying float vSide;
varying float vIntensity;
varying float vDistance;

uniform vec3 boltColor;        // Farbe × Helligkeit des Blitzes in diesem Frame (HDR)
uniform vec2 hazeParams;       // Dunstweite (m), Dunststärke

void main(void) {
  float x = vSide * 3.0;
  float core = exp(-x * x * 5.0);
  float halo = exp(-x * x * 0.45) * 0.3;
  float haze = (1.0 - exp(-vDistance / hazeParams.x)) * hazeParams.y;
  gl_FragColor = vec4(boltColor * (vIntensity * (core + halo) * (1.0 - haze)), 1.0);
}
`;
