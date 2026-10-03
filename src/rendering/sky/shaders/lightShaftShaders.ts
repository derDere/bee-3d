// Shader der Sonnen- und Mondstrahlen (GLSL; unter WebGPU übersetzt Babylon sie). Radialunschärfe nach
// GPU Gems 3, Kapitel 13: Verdeckungsbild aus Himmelsmaske × Wolkentransmission × Winkelabfall um die
// Lichtquelle, Sammeln entlang der Linie zur Lichtquelle, Einmischen ins HDR-Bild vor der Bildpipeline.

/** Name des Einmisch-Shaders im ShaderStore (Kamera-Post-Process). */
export const ShaftCompositeShaderName = "skyLightShaftComposite";

/** Verdeckungsbild in reduzierter Auflösung: wie viel Himmel um die Lichtquelle unverdeckt leuchtet. */
export const ShaftOcclusionFragmentShader = /* glsl */ `
precision highp float;

varying vec2 vUV;
varying vec3 vRay;

uniform sampler2D depthSampler;   // Kameraraum-Z in voller Auflösung, 0 = Himmel
uniform sampler2D cloudSampler;   // Wolkentextur: rgb = Streulicht, a = Transmission entlang des Sichtstrahls
uniform vec3 toLight;
uniform vec4 occlusionParams;     // Abstand der Tiefenproben (UV, x, y), 1/Winkelbreite² von Kern und Hof (rad⁻²)
uniform vec4 sourceParams;        // Gewicht des Hofs, Gewicht leuchtender Wolkenränder, 1/Helligkeit des Lichts, unbenutzt

float skyAt(vec2 uv) {
  return textureLod(depthSampler, uv, 0.0).r > 0.0 ? 0.0 : 1.0;
}

void main(void) {
  // Himmelsanteil aus vier Pixeln voller Auflösung im Block: weiche Kanten an Inseln, Bäumen und der Biene
  vec2 o = occlusionParams.xy;
  float sky = 0.25 * (skyAt(vUV + vec2(-o.x, -o.y)) + skyAt(vUV + vec2(o.x, -o.y)) + skyAt(vUV + vec2(-o.x, o.y)) + skyAt(vUV + vec2(o.x, o.y)));
  vec4 cloud = textureLod(cloudSampler, vUV, 0.0);
  // Gaußscher Abfall über den Winkel zur Lichtquelle; Winkel² / 2 ≈ 1 − cos für kleine Winkel
  float angular = 1.0 - dot(normalize(vRay), toLight);
  float core = exp(-angular * occlusionParams.z);
  float halo = exp(-angular * occlusionParams.w);
  float falloff = core + sourceParams.x * halo;
  // Quellen: freier Himmel um die Lichtquelle und hell durchleuchtete Wolkenränder (Silberränder) nahe der Quelle;
  // Inseln, Bäume und die Biene verdecken beides über die Tiefenkarte.
  float rim = clamp(dot(cloud.rgb, vec3(0.2126, 0.7152, 0.0722)) * sourceParams.z, 0.0, 1.0);
  float source = sky * (cloud.a + sourceParams.y * rim);
  gl_FragColor = vec4(source * falloff, 0.0, 0.0, 1.0);
}
`;

/** Radiales Sammeln des Verdeckungsbilds zur Lichtquelle; Ergebnis normiert auf 0..1. */
export const ShaftGatherFragmentShader = /* glsl */ `
precision highp float;

varying vec2 vUV;
varying vec3 vRay;

uniform sampler2D occlusionSampler;
uniform vec4 gatherParams;        // Lichtquelle im Bild (u, v), Reichweite (Anteil des Wegs), Abklingen je Schritt

// Verschachteltes Gradientenrauschen (Jimenez) als fester Startversatz gegen Streifen.
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main(void) {
  vec2 delta = (gatherParams.xy - vUV) * (gatherParams.z / float(SHAFT_SAMPLES));
  vec2 coord = vUV + delta * ign(gl_FragCoord.xy);
  float weight = 1.0;
  float sum = 0.0;
  float total = 0.0;
  for (int i = 0; i < SHAFT_SAMPLES; i++) {
    vec2 inside = step(vec2(0.0), coord) * step(coord, vec2(1.0));
    sum += textureLod(occlusionSampler, coord, 0.0).r * inside.x * inside.y * weight;
    total += weight;
    weight *= gatherParams.w;
    coord += delta;
  }
  gl_FragColor = vec4(sum / total, 0.0, 0.0, 1.0);
}
`;

/** Einmischen der Strahlen ins HDR-Bild (Kamera-Post-Process vor Bloom und Tonemapping). */
export const ShaftCompositeFragmentShader = /* glsl */ `
precision highp float;

varying vec2 vUV;

uniform sampler2D textureSampler; // Szene (HDR)
uniform sampler2D shaftSampler;   // gesammelte Strahlen, halbe Auflösung
uniform sampler2D depthSampler;   // Kameraraum-Z, 0 = Himmel
uniform vec4 shaftColor;          // rgb Farbe × Stärke, a Luftstrecke bis zur vollen Wirkung vor Geometrie (m)

void main(void) {
  vec4 scene = texture2D(textureSampler, vUV);
  float shafts = texture2D(shaftSampler, vUV).r;
  // Vor nahen Objekten liegt kaum Luft: die Strahlen wachsen mit der Entfernung bis zur vollen Stärke.
  float viewZ = texture2D(depthSampler, vUV).r;
  float air = viewZ > 0.0 ? smoothstep(0.0, shaftColor.a, viewZ) : 1.0;
  gl_FragColor = vec4(scene.rgb + shaftColor.rgb * (shafts * air), scene.a);
}
`;
