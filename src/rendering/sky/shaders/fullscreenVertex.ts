// Gemeinsamer Vertex-Shader der Himmels-Vollbildpässe (GLSL; unter WebGPU übersetzt Babylon ihn).
// Der Sichtstrahl entsteht aus der Clip-Position wie im Atmosphäre-Addon — so stimmen Strahl und
// Texturkoordinate unter WebGPU und WebGL2 überein.

export const FullscreenVertexShader = /* glsl */ `
precision highp float;
attribute vec2 position;
uniform mat4 inverseViewProjectionNoTranslation;
uniform float nearNdc;
varying vec2 vUV;
varying vec3 vRay;

void main(void) {
  gl_Position = vec4(position, 0.0, 1.0);
  vUV = position * 0.5 + 0.5;
  vec4 nearPoint = inverseViewProjectionNoTranslation * vec4(position, nearNdc, 1.0);
  vRay = nearPoint.xyz / nearPoint.w;
}
`;
