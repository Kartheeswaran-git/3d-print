import { Color, MeshStandardMaterial, Vector3, type IUniform } from "three";
import { THICKNESS_ATTRIBUTE } from "./geometry";

/**
 * Shared by every lithophane material, so toggling or animating the backlight only writes uniform
 * values and never recompiles a program (FIXES K6).
 */
export interface BacklightUniforms {
  /** 0 = lamp off, 1 = fully lit; animated. */
  uGlow: IUniform<number>;
  /** Wall thickness (mm) that glows brightest. */
  uMinThickness: IUniform<number>;
  /** Wall thickness (mm) that stays nearly dark. */
  uMaxThickness: IUniform<number>;
  /** Beer–Lambert attenuation across the normalised range; e^-a is the glow left at the thickest wall. */
  uAttenuation: IUniform<number>;
  /** Emissive gain before tone mapping; highlights roll off to warm white under ACES. */
  uStrength: IUniform<number>;
  /** 1 for hollow shells (the sphere lamp), 0 for plates. */
  uShell: IUniform<number>;
  /** World-space centre of a shell; its light leaves radially. */
  uShellCenter: IUniform<Vector3>;
  uCoreColor: IUniform<Color>;
  uWarmColor: IUniform<Color>;
  uDeepColor: IUniform<Color>;
}

/** Warm translucent white of unlit PLA. */
const LITHOPHANE_COLOR = "#ebe4d8";

export function createBacklightUniforms(): BacklightUniforms {
  return {
    uGlow: { value: 0 },
    uMinThickness: { value: 0.8 },
    uMaxThickness: { value: 3 },
    // Thickest wall keeps ~1.5% of the thinnest wall's light.
    uAttenuation: { value: 4.2 },
    uStrength: { value: 5.2 },
    uShell: { value: 0 },
    uShellCenter: { value: new Vector3() },
    // Thin walls pass a pale warm light, mid walls the lamp's amber, thick walls a deep orange-brown.
    // Saturated on purpose: ACES tone mapping pulls bright emission towards white.
    uCoreColor: { value: new Color("#ffe3bd") },
    uWarmColor: { value: new Color("#ffc27f") },
    uDeepColor: { value: new Color("#c9581c") },
  };
}

const VERTEX_PARS = /* glsl */ `
attribute float ${THICKNESS_ATTRIBUTE};
varying float vWallThickness;
varying vec3 vLunaWorldPosition;
`;

const VERTEX_MAIN = /* glsl */ `
vWallThickness = ${THICKNESS_ATTRIBUTE};
vLunaWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform float uGlow;
uniform float uMinThickness;
uniform float uMaxThickness;
uniform float uAttenuation;
uniform float uStrength;
uniform float uShell;
uniform vec3 uShellCenter;
uniform vec3 uCoreColor;
uniform vec3 uWarmColor;
uniform vec3 uDeepColor;
varying float vWallThickness;
varying vec3 vLunaWorldPosition;
`;

const FRAGMENT_GLOW = /* glsl */ `
if (uGlow > 0.0) {
  float wall = vWallThickness < 0.0 ? 0.5 * (uMinThickness + uMaxThickness) : vWallThickness;
  float depth = clamp((wall - uMinThickness) / max(uMaxThickness - uMinThickness, 0.001), 0.0, 1.0);
  float transmitted = exp(-uAttenuation * depth);
  // A shell glows fullest where it faces the viewer and dims towards its silhouette. The radial
  // direction stands in for the bumpy relief normal, which would turn the falloff into speckle.
  if (uShell > 0.5) {
    vec3 radial = normalize(vLunaWorldPosition - uShellCenter);
    float facing = abs(dot(radial, normalize(cameraPosition - vLunaWorldPosition)));
    transmitted *= mix(0.35, 1.0, facing);
  }
  vec3 tint = mix(uCoreColor, uWarmColor, smoothstep(0.0, 0.5, depth));
  tint = mix(tint, uDeepColor, smoothstep(0.5, 1.0, depth));
  totalEmissiveRadiance += tint * (transmitted * uStrength * uGlow);
}
`;

/** Lithophane PLA: lit relief when the lamp is off, thickness-driven warm glow when it is on. */
export function createLithophaneMaterial(uniforms: BacklightUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: LITHOPHANE_COLOR, roughness: 0.55, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_PARS}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${FRAGMENT_GLOW}`);
  };
  material.customProgramCacheKey = () => "luna-lithophane-backlight-v2";
  return material;
}

/** Satin filament plastic; colour is set by the caller and updated in place. */
export function createPlasticMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({ roughness: 0.45, metalness: 0 });
}
