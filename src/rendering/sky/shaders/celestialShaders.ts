// Shader der Himmelskörper (GLSL): Sonnenscheibe mit Randverdunklung und Glanzstern, Mond mit Phase, Kratern und
// weichem Hof, prozeduraler Sternenhimmel mit dunklem Nachtblau, Milchstraße und Funkeln.

export const BillboardVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;
void main(void) {
  vUV = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

export const SunFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform vec3 sunColor;
uniform float discRadius;
void main(void) {
  vec2 p = vUV * 2.0 - 1.0;
  float r = length(p);
  float edge = discRadius * 0.04;
  float disc = 1.0 - smoothstep(discRadius - edge, discRadius, r);
  float cosine = sqrt(max(0.0, 1.0 - min(1.0, (r * r) / (discRadius * discRadius))));
  float limb = 1.0 - 0.6 * (1.0 - cosine);
  float glow = exp(-r * 5.0) * 0.05 + exp(-r * 16.0) * 0.18;
  // Glanzstern: sechs schmale Strahlen, die mit dem Abstand verblassen
  float angle = atan(p.y, p.x);
  float spikes = pow(abs(cos(angle * 3.0)), 90.0) + 0.6 * pow(abs(cos(angle * 3.0 + 0.5236)), 140.0);
  float star = spikes * exp(-r * 4.5) * 0.12;
  gl_FragColor = vec4(sunColor * (disc * limb + glow + star), 1.0);
}
`;

export const MoonFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform vec3 moonColor;
uniform float phase;
uniform float sunSide;
uniform vec2 haloParams;   // Größe der Fläche relativ zur Scheibe, Stärke des Hofs

float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
}
float craters(vec2 p) {
  float maria = smoothstep(0.35, 0.75, valueNoise(p * 2.3 + 4.0)) * 0.45;
  float detail = valueNoise(p * 9.0) * 0.18 + valueNoise(p * 23.0) * 0.08;
  return 1.0 - maria - detail * 0.6;
}
void main(void) {
  vec2 p = (vUV * 2.0 - 1.0) * haloParams.x;
  float r = length(p);
  float mask = 1.0 - smoothstep(0.97, 1.0, r);
  vec3 color = vec3(0.0);
  if (mask > 0.0) {
    vec3 normal = vec3(p, sqrt(max(0.0, 1.0 - r * r)));
    float angle = phase * 6.2831853;
    vec3 light = normalize(vec3(sin(angle) * sunSide, 0.0, -cos(angle)));
    float lit = smoothstep(-0.06, 0.12, dot(normal, light));
    float albedo = craters(p * 1.1);
    color = moonColor * albedo * (lit + 0.025) * mask;
  }
  // Weicher Hof aus Streulicht in Dunst und dünnen Wolken um die Scheibe
  float outside = max(0.0, r - 1.0);
  float halo = exp(-outside * 7.0) * 0.6 + exp(-outside * 1.8) * 0.25;
  color += moonColor * halo * haloParams.y * (1.0 - mask);
  gl_FragColor = vec4(color, 1.0);
}
`;

export const StarsVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
uniform mat4 starRotation;
varying vec3 vDirection;
varying vec3 vWorldDirection;
void main(void) {
  vDirection = (starRotation * vec4(position, 0.0)).xyz;
  vWorldDirection = position;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

export const StarsFragmentShader = /* glsl */ `
precision highp float;
varying vec3 vDirection;
varying vec3 vWorldDirection;
uniform float starIntensity;
uniform float time;

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// Weiches Wertrauschen (trilinear) für die Milchstraße; Zellwerte ohne Interpolation wirkten facettiert.
float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash3(i);
  float n100 = hash3(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash3(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash3(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash3(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash3(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash3(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash3(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

vec3 starColor(float temperature) {
  // 3 000 K rötlich … 12 000 K bläulich
  return mix(vec3(1.0, 0.72, 0.5), vec3(0.72, 0.82, 1.0), temperature);
}

// Eine Sternschicht: je Zelle höchstens ein Stern. Der Kern ist mindestens etwa ein Pixel breit und behält bei
// Verbreiterung seine Energie, so bleiben Sterne scharf und flimmern nicht.
float starLayer(vec3 d, float scale, float threshold, float pixelAngle, out vec3 color) {
  vec3 p = d * scale;
  vec3 cell = floor(p);
  vec3 local = fract(p) - 0.5;
  float h = hash3(cell);
  color = vec3(0.0);
  if (h < threshold) return 0.0;
  vec3 offset = (vec3(hash3(cell + 1.7), hash3(cell + 9.2), hash3(cell + 4.1)) - 0.5) * 0.7;
  float dist = length(local - offset);
  float magnitude = pow((h - threshold) / (1.0 - threshold), 1.8);
  float twinkle = 0.7 + 0.3 * sin(time * (2.0 + h * 9.0) + h * 40.0);
  color = starColor(hash3(cell + 3.3));
  float radius = mix(0.04, 0.1, magnitude);
  float sigma = max(radius, scale * pixelAngle * 0.55);
  float energy = (radius * radius) / (sigma * sigma);
  return magnitude * twinkle * energy * exp(-dist * dist / (2.0 * sigma * sigma));
}

void main(void) {
  vec3 d = normalize(vDirection);
  float pixelAngle = length(fwidth(d));
  vec3 c1;
  vec3 c2;
  vec3 c3;
  float s1 = starLayer(d, 150.0, 0.955, pixelAngle, c1);
  float s2 = starLayer(d, 340.0, 0.97, pixelAngle, c2) * 0.55;
  float s3 = starLayer(d, 700.0, 0.982, pixelAngle, c3) * 0.3;
  // Milchstraße als weiches Band mit Wolkenstruktur, zurückhaltend
  vec3 bandNormal = normalize(vec3(0.35, 0.55, -0.76));
  float band = exp(-pow(dot(d, bandNormal) * 3.2, 2.0));
  float dust = valueNoise(d * 9.0) * 0.6 + valueNoise(d * 23.0) * 0.4;
  vec3 milky = vec3(0.55, 0.6, 0.85) * band * (0.35 + 0.65 * dust) * 0.07;
  // Nachthimmel: fast schwarzes Nachtblau, zum Horizont ein Hauch heller
  float up = clamp(normalize(vWorldDirection).y, 0.0, 1.0);
  vec3 night = mix(vec3(0.0116, 0.0262, 0.0953), vec3(0.0030, 0.0070, 0.0290), sqrt(up)) * 0.3;
  vec3 color = (c1 * s1 + c2 * s2 + c3 * s3) * 4.0 + milky + night;
  gl_FragColor = vec4(color * starIntensity, 1.0);
}
`;
