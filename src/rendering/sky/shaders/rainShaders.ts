// Shader des Regens (GLSL; unter WebGPU übersetzt Babylon sie): jeder Tropfen ist ein zur Kamera gedrehtes
// Band entlang seiner Bewegung relativ zur Kamera (Bewegungsunschärfe einer kurzen Belichtung). Die Lage folgt
// aus Startpunkt in der Regenbox, gewanderter Strecke je Fallklasse und Faltung um die Kamera — ohne
// CPU-Arbeit je Tropfen. Kein Licht je Tropfen: Himmelslicht, Gegenlicht zur Sonne bzw. zum Mond, Blitz.

export const RainVertexShader = /* glsl */ `
precision highp float;

attribute vec3 position;       // Startlage des Tropfens in der Regenbox (0..1)
attribute vec4 dropData;       // x Seite (−1/1), y Ende (0 Kopf, 1 Schweif), z Auswahlwert, w Größe (0..1)

uniform mat4 viewProjection;
uniform vec3 cameraPosition;
uniform vec4 boxParams;        // Kante waagerecht (m), Höhe (m), Nahblende (m), Fernblende (m)
uniform vec4 classOffset[4];   // xyz gewanderte Strecke je Fallklasse (m, in der Box gefaltet)
uniform vec4 classStreak[4];   // xyz Schlierenvektor relativ zur Kamera (m)
uniform vec4 rainParams;       // Anteil sichtbarer Tropfen, Tropfenbreite (m), Helligkeit, Pixelwinkel (rad)
uniform vec3 toLight;
uniform vec3 ambientColor;
uniform vec3 glintColor;
uniform vec3 flashColor;

varying vec2 vCorner;
varying vec3 vColor;

void main(void) {
  float classIndex = floor(fract(dropData.z * 37.0) * 4.0);
  vec4 offset = classOffset[0];
  vec4 streak = classStreak[0];
  if (classIndex > 0.5) { offset = classOffset[1]; streak = classStreak[1]; }
  if (classIndex > 1.5) { offset = classOffset[2]; streak = classStreak[2]; }
  if (classIndex > 2.5) { offset = classOffset[3]; streak = classStreak[3]; }

  // Lage relativ zur Kamera, in die Box um die Kamera gefaltet: Tropfen stehen in der Welt, die Box wandert mit.
  vec3 box = vec3(boxParams.x, boxParams.y, boxParams.x);
  vec3 local = mod(position * box + offset.xyz - cameraPosition, box) - box * 0.5;
  vec3 head = cameraPosition + local;

  vec3 axis = streak.xyz;
  float streakLength = max(length(axis), 1e-4);
  vec3 direction = axis / streakLength;
  vec3 centre = head - axis * dropData.y;
  vec3 toCamera = cameraPosition - centre;
  float dist = max(length(toCamera), 1e-3);
  vec3 across = cross(direction, toCamera / dist);
  float acrossLength = length(across);
  vec3 side = acrossLength > 1e-3 ? across / acrossLength : vec3(1.0, 0.0, 0.0);

  // Mindestens etwa ein Pixel breit; was verbreitert wird, wird entsprechend schwächer (gleiche Energie).
  float width = rainParams.y * mix(0.7, 1.3, dropData.w);
  float shownWidth = max(width, dist * rainParams.w);
  vec3 world = centre + side * (dropData.x * shownWidth * 0.5);

  float nearFade = smoothstep(boxParams.z, boxParams.z * 4.0, dist);
  float farFade = 1.0 - smoothstep(boxParams.w * 0.55, boxParams.w, dist);
  float verticalFade = 1.0 - smoothstep(box.y * 0.35, box.y * 0.5, abs(local.y));
  // Lange Schlieren (schneller Flug) verteilen dasselbe Licht auf mehr Fläche
  float energy = (width / shownWidth) * mix(1.0, 0.45, smoothstep(0.4, 2.0, streakLength));

  vec3 viewDirection = -toCamera / dist;
  float forward = max(0.0, dot(viewDirection, toLight));
  vec3 light = ambientColor + glintColor * (pow(forward, 8.0) * 0.35 + pow(forward, 64.0) * 1.6) + flashColor;
  float visible = dropData.z < rainParams.x ? 1.0 : 0.0;
  vColor = light * (rainParams.z * nearFade * farFade * verticalFade * energy * visible);
  vCorner = dropData.xy;
  vec4 clip = viewProjection * vec4(world, 1.0);
  // Nicht gewählte Tropfen landen außerhalb des Bildes und werden verworfen.
  gl_Position = visible > 0.5 ? clip : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const RainFragmentShader = /* glsl */ `
precision highp float;

varying vec2 vCorner;
varying vec3 vColor;

void main(void) {
  float across = max(0.0, 1.0 - vCorner.x * vCorner.x);
  float along = smoothstep(0.0, 0.2, vCorner.y) * (1.0 - smoothstep(0.65, 1.0, vCorner.y));
  gl_FragColor = vec4(vColor * (across * along), 1.0);
}
`;
