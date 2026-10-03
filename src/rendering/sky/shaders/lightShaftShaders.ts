// Shader der Sonnen- und Mondstrahlen (GLSL; unter WebGPU übersetzt Babylon sie). Radialunschärfe nach
// GPU Gems 3, Kapitel 13: Verdeckungsbild aus Himmelsmaske × Wolkentransmission × Winkelabfall um die
// Lichtquelle plus Silberränder der Wolken, Sammeln entlang der Linie zur Lichtquelle, Einmischen ins HDR-Bild
// vor der Bildpipeline mit Strahlenkontrast über den Winkel.

/** Name des Einmisch-Shaders im ShaderStore (Kamera-Post-Process). */
export const ShaftCompositeShaderName = "skyLightShaftComposite";

/**
 * Verdeckungsbild in reduzierter Auflösung: wie viel Licht um die Lichtquelle unverdeckt leuchtet. Quellen sind der
 * freie Himmel eng um Sonne bzw. Mond und die hell durchleuchteten Wolkenränder in einem weiteren Fenster; so gehen
 * Strahlen auch von Lücken und Silberrändern aus, wenn die Quelle selbst hinter einer Wolke steht.
 */
export const ShaftOcclusionFragmentShader = /* glsl */ `
precision highp float;

varying vec2 vUV;
varying vec3 vRay;

uniform sampler2D depthSampler;   // Kameraraum-Z in voller Auflösung, 0 = Himmel
uniform sampler2D cloudSampler;   // Wolkentextur: rgb = Streulicht, a = Transmission entlang des Sichtstrahls
uniform vec3 toLight;
uniform vec4 occlusionParams;     // Abstand der Tiefenproben (UV, x, y), 1/Winkelbreite² von Kern und Hof (rad⁻²)
uniform vec4 sourceParams;        // Gewicht des Hofs, Gewicht der Silberränder, 1/Helligkeit des Lichts, 1/Fensterbreite² der Ränder

// Silberränder: Streulicht der Wolke relativ zum Licht, ab dem ein Rand als Quelle zählt, und ab dem er voll zählt.
// Darunter bleiben die Wolkenkörper dunkel und zerteilen die Quelle in Strahlen.
const float RIM_LOW = 1.0;
const float RIM_HIGH = 3.0;

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
  float halo = sourceParams.x * exp(-angular * occlusionParams.w);
  float rimWindow = exp(-angular * sourceParams.w);
  float rim = smoothstep(RIM_LOW, RIM_HIGH, dot(cloud.rgb, vec3(0.2126, 0.7152, 0.0722)) * sourceParams.z);
  // Inseln, Bäume und die Biene verdecken beide Quellen über die Tiefenkarte.
  float source = sky * (cloud.a * (core + halo) + sourceParams.y * rim * rimWindow);
  gl_FragColor = vec4(source, 0.0, 0.0, 1.0);
}
`;

/**
 * Radiales Sammeln des Verdeckungsbilds zur Lichtquelle; Ergebnis normiert auf 0..1. Der Startversatz folgt einem
 * Bayer-Muster über 2 × 2 Pixel: Er vervierfacht die Stichproben gegen Treppen, und das Einmischen mittelt das Muster
 * mit seinem Zeltfilter über 3 × 3 Texel restlos heraus.
 */
export const ShaftGatherFragmentShader = /* glsl */ `
precision highp float;

varying vec2 vUV;
varying vec3 vRay;

uniform sampler2D occlusionSampler;
uniform vec4 gatherParams;        // Lichtquelle im Bild (u, v), Reichweite (Anteil des Wegs), Abklingen je Schritt

// Startversatz 1/8, 3/8, 5/8 oder 7/8 eines Schritts nach der Lage im 2 × 2-Block (Bayer-Matrix 0 2 / 3 1).
float bayerOffset(vec2 fragCoord) {
  vec2 q = mod(floor(fragCoord), 2.0);
  return (mod(q.x * 2.0 + q.y * 3.0, 4.0) + 0.5) * 0.25;
}

void main(void) {
  vec2 delta = (gatherParams.xy - vUV) * (gatherParams.z / float(SHAFT_SAMPLES));
  vec2 coord = vUV + delta * bayerOffset(gl_FragCoord.xy);
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

/**
 * Einmischen der Strahlen ins HDR-Bild (Kamera-Post-Process vor Bloom und Tonemapping). Der Strahlenkontrast
 * vergleicht die gesammelten Strahlen mit ihren Nachbarn bei gleichem Abstand zur Lichtquelle, aber um einen festen
 * Winkel gedreht: Helle Strahlen zwischen verdeckten Bereichen treten hervor, der gleichmäßige Schein um die Quelle
 * bleibt schwach und legt keinen Schleier über Himmel und Inseln. Jeder Abruf ist ein Zeltfilter über 3 × 3 Texel,
 * der das Bayer-Muster des Startversatzes herausmittelt.
 */
export const ShaftCompositeFragmentShader = /* glsl */ `
precision highp float;

varying vec2 vUV;

uniform sampler2D textureSampler; // Szene (HDR)
uniform sampler2D shaftSampler;   // gesammelte Strahlen, halbe Auflösung
uniform sampler2D depthSampler;   // Kameraraum-Z, 0 = Himmel
uniform vec4 shaftColor;          // rgb Farbe × Stärke, a Luftstrecke bis zur vollen Wirkung vor Geometrie (m)
uniform vec4 lightParams;         // Lichtquelle im Bild (u, v), Seitenverhältnis (Breite / Höhe), unbenutzt
uniform vec4 contrastParams;      // cos und sin des Vergleichswinkels, Anteil des Scheins, Verstärkung der Strahlen
uniform vec2 shaftSize;           // Größe der Strahlentextur (Texel)

// Zeltfilter über 3 × 3 Texel: vier bilineare Abrufe einen halben Texel um uv.
float shaftsAround(vec2 uv) {
  vec2 o = 0.5 / shaftSize;
  return 0.25 * (textureLod(shaftSampler, uv + vec2(o.x, o.y), 0.0).r + textureLod(shaftSampler, uv + vec2(-o.x, o.y), 0.0).r
    + textureLod(shaftSampler, uv + vec2(o.x, -o.y), 0.0).r + textureLod(shaftSampler, uv + vec2(-o.x, -o.y), 0.0).r);
}

// Dreht uv um die Lichtquelle (im Bildmaß, ohne Verzerrung durch das Seitenverhältnis).
vec2 rotateAroundLight(vec2 uv, float sine) {
  vec2 d = (uv - lightParams.xy) * vec2(lightParams.z, 1.0);
  d = vec2(contrastParams.x * d.x - sine * d.y, sine * d.x + contrastParams.x * d.y);
  return lightParams.xy + d / vec2(lightParams.z, 1.0);
}

void main(void) {
  vec4 scene = texture2D(textureSampler, vUV);
  if (shaftColor.r + shaftColor.g + shaftColor.b <= 0.0) {
    gl_FragColor = scene;
    return;
  }
  float shafts = shaftsAround(vUV);
  float neighbours = 0.5 * (shaftsAround(rotateAroundLight(vUV, contrastParams.y)) + shaftsAround(rotateAroundLight(vUV, -contrastParams.y)));
  float rays = max(0.0, contrastParams.z * shafts + contrastParams.w * (shafts - neighbours));
  // Vor nahen Objekten liegt kaum Luft: die Strahlen wachsen mit der Entfernung bis zur vollen Stärke.
  float viewZ = texture2D(depthSampler, vUV).r;
  float air = viewZ > 0.0 ? smoothstep(0.0, shaftColor.a, viewZ) : 1.0;
  gl_FragColor = vec4(scene.rgb + shaftColor.rgb * (rays * air), scene.a);
}
`;
