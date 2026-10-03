// Zeitliche Glättung der Wolken (GLSL): Vorbild per Rotation reprojiziert (Wolken als fern angenommen),
// auf die 3×3-Nachbarschaft des aktuellen Bilds geklemmt und eingeblendet.

export const CloudResolveFragmentShader = /* glsl */ `
precision highp float;

varying vec2 vUV;
varying vec3 vRay;

uniform sampler2D currentSampler;
uniform sampler2D historySampler;
uniform mat4 previousViewProjectionNoTranslation;
uniform vec4 resolveParams;    // Vorbildgewicht, Vorbild gültig, Texelbreite, Texelhöhe

void main(void) {
  vec4 current = textureLod(currentSampler, vUV, 0.0);
  if (resolveParams.y < 0.5) {
    gl_FragColor = current;
    return;
  }
  vec3 dir = normalize(vRay);
  vec4 clip = previousViewProjectionNoTranslation * vec4(dir, 0.0);
  if (clip.w <= 1e-5) {
    gl_FragColor = current;
    return;
  }
  vec2 previousUV = clip.xy / clip.w * 0.5 + 0.5;
  if (previousUV.x < 0.0 || previousUV.y < 0.0 || previousUV.x > 1.0 || previousUV.y > 1.0) {
    gl_FragColor = current;
    return;
  }
  vec4 minimum = current;
  vec4 maximum = current;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec4 neighbour = textureLod(currentSampler, vUV + vec2(float(x), float(y)) * resolveParams.zw, 0.0);
      minimum = min(minimum, neighbour);
      maximum = max(maximum, neighbour);
    }
  }
  vec4 history = clamp(textureLod(historySampler, previousUV, 0.0), minimum, maximum);
  gl_FragColor = mix(current, history, resolveParams.x);
}
`;
