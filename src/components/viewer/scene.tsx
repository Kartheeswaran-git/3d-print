"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentRef,
  type Ref,
  type RefObject,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  MathUtils,
  MeshStandardMaterial,
  PMREMGenerator,
  PerspectiveCamera,
  Raycaster,
  Spherical,
  Vector2,
  Vector3,
  type Camera,
  type DirectionalLight,
  type HemisphereLight,
  type Mesh,
  type PointLight,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildPartGeometry, computeSceneBounds, glowRange, type SceneBounds } from "./geometry";
import {
  clipPlanes,
  distanceLimits,
  easeInOutCubic,
  fitDecision,
  fitDistance,
  interpolatePose,
  prefersReducedMotion,
  viewDirection,
  VIEW_TRANSITION_MS,
  type CameraPose,
} from "./framing";
import { createBacklightUniforms, createLithophaneMaterial, createPlasticMaterial, type BacklightUniforms } from "./materials";
import { mouseButtonsFor, pointerToNdc } from "./placement";
import { raycastParts } from "./raycast";
import type { BacklightSettings, CameraView, InteractionMode, ViewerPart } from "./types";

// three.js objects are mutable resources owned through refs and changed only in effects and frame
// callbacks; the renderer reads them, React never does.

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>;

/** Camera operations the DOM side of the viewer can call into the canvas. */
export interface SceneRigHandle {
  frame(view: CameraView, animate: boolean): void;
  /** Orbit by the given angles (radians) around the target. */
  orbitBy(deltaAzimuth: number, deltaPolar: number): void;
  /** Multiply the camera distance (< 1 zooms in). */
  zoomBy(factor: number): void;
  /**
   * Surface point (mm, the parts' own coordinates) on the nearest front face under a client position, or null
   * when the pointer is off the canvas or over empty space.
   */
  pick(clientX: number, clientY: number): [number, number, number] | null;
  /**
   * Start or finish a placement drag. While active the camera controls are paused (and any leftover drag
   * momentum is dropped), and picks keep using the meshes shown at the start, so previews that arrive
   * mid-drag never rebuild the pick structure.
   */
  setPlacing(active: boolean): void;
}

export interface ViewerSceneProps {
  parts: ViewerPart[];
  fitKey: string;
  appearance: "lithophane" | "plastic";
  wireframe: boolean;
  backlight: BacklightSettings | null;
  interactionMode: InteractionMode;
  rigRef: Ref<SceneRigHandle>;
  /** Preset used for automatic framing; owned by the DOM side so it survives before the canvas is ready. */
  viewRef: RefObject<CameraView>;
}

/** Light levels with the lamp off and on. The backlit room is dim so transmitted light carries the image. */
const LIGHTS = {
  hemisphere: { off: 1.6, on: 0.05 },
  key: { off: 2.4, on: 0.1 },
  rim: { off: 0.9, on: 0.06 },
  lamp: { off: 0, on: 1.5 },
  environment: { lithophane: 0.15, plastic: 0.3, backlit: 0.02 },
} as const;
const GLOW_FADE_S = 0.28;

export function ViewerScene({
  parts,
  fitKey,
  appearance,
  wireframe,
  backlight,
  interactionMode,
  rigRef,
  viewRef,
}: ViewerSceneProps) {
  const invalidate = useThree((s) => s.invalidate);
  const bounds = useMemo(() => computeSceneBounds(parts), [parts]);
  const lit = appearance === "lithophane" && !!backlight?.enabled;
  // Primitive deps, so an inline `backlight={{ … }}` prop does not redo this on every parent render.
  const minThickness = backlight?.minThickness;
  const maxThickness = backlight?.maxThickness;
  const range = useMemo(
    () =>
      glowRange(
        minThickness === undefined || maxThickness === undefined ? null : { minThickness, maxThickness },
        bounds?.thickness ?? null,
      ),
    [minThickness, maxThickness, bounds],
  );

  const uniformsRef = useRef<BacklightUniforms>(null);
  if (uniformsRef.current === null) uniformsRef.current = createBacklightUniforms();
  const hemisphereRef = useRef<HemisphereLight>(null);
  const keyRef = useRef<DirectionalLight>(null);
  const rimRef = useRef<DirectionalLight>(null);
  const lampRef = useRef<PointLight>(null);
  // Starts at the initial state so a lamp that is already on does not fade in on load.
  const glowRef = useRef({ value: lit ? 1 : 0, target: lit ? 1 : 0 });

  useEffect(() => {
    const uniforms = uniformsRef.current;
    if (!uniforms) return;
    uniforms.uMinThickness.value = range.min;
    uniforms.uMaxThickness.value = range.max;
    uniforms.uShell.value = bounds && !bounds.isPlate ? 1 : 0;
    if (bounds) uniforms.uShellCenter.value.copy(bounds.center);
    invalidate();
  }, [range, bounds, invalidate]);

  useEffect(() => {
    const glow = glowRef.current;
    glow.target = lit ? 1 : 0;
    if (prefersReducedMotion()) glow.value = glow.target;
    invalidate();
  }, [lit, invalidate]);

  useEffect(() => {
    invalidate();
  }, [appearance, bounds, invalidate]);

  useFrame((state, delta) => {
    const glow = glowRef.current;
    if (glow.value !== glow.target) {
      const step = Math.min(delta, 0.1) / GLOW_FADE_S;
      glow.value =
        glow.target > glow.value ? Math.min(glow.target, glow.value + step) : Math.max(glow.target, glow.value - step);
      state.invalidate();
    }
    const g = easeInOutCubic(glow.value);
    if (uniformsRef.current) uniformsRef.current.uGlow.value = g;
    if (hemisphereRef.current) hemisphereRef.current.intensity = MathUtils.lerp(LIGHTS.hemisphere.off, LIGHTS.hemisphere.on, g);
    if (keyRef.current) keyRef.current.intensity = MathUtils.lerp(LIGHTS.key.off, LIGHTS.key.on, g);
    if (rimRef.current) rimRef.current.intensity = MathUtils.lerp(LIGHTS.rim.off, LIGHTS.rim.on, g);
    const lamp = lampRef.current;
    if (lamp) {
      // Stays visible at intensity 0: toggling visibility would change the light count and recompile every program.
      lamp.intensity = MathUtils.lerp(LIGHTS.lamp.off, LIGHTS.lamp.on, g);
      // Shells are lit from inside; plates from behind their back face.
      if (bounds) {
        lamp.position.copy(bounds.center);
        if (bounds.isPlate) lamp.position.z = bounds.min.z - bounds.radius * 0.6;
      }
    }
    const base = appearance === "plastic" ? LIGHTS.environment.plastic : LIGHTS.environment.lithophane;
    state.scene.environmentIntensity = MathUtils.lerp(base, LIGHTS.environment.backlit, g);
  });

  return (
    <>
      <StudioEnvironment />
      {/* Intensities are driven every frame by the backlight fade above. */}
      <hemisphereLight ref={hemisphereRef} args={["#dfe8ff", "#1a1f2b", LIGHTS.hemisphere.off]} />
      {/* Key from front-left-top, a cool rim from behind-right; directions only, they aim at the origin. */}
      <directionalLight ref={keyRef} color="#fff1dc" position={[-1.3, 1.1, 0.8]} />
      <directionalLight ref={rimRef} color="#cfdcff" position={[1, 0.5, -1.3]} />
      <pointLight ref={lampRef} color="#ffd9a8" decay={0} />
      {parts.map((part) => (
        <PartMesh key={part.key} part={part} appearance={appearance} wireframe={wireframe} uniformsRef={uniformsRef} />
      ))}
      <CameraRig
        parts={parts}
        bounds={bounds}
        fitKey={fitKey}
        interactionMode={interactionMode}
        viewRef={viewRef}
        rigRef={rigRef}
      />
    </>
  );
}

interface PartMeshProps {
  part: ViewerPart;
  appearance: "lithophane" | "plastic";
  wireframe: boolean;
  uniformsRef: RefObject<BacklightUniforms | null>;
}

function PartMesh({ part, appearance, wireframe, uniformsRef }: PartMeshProps) {
  const invalidate = useThree((s) => s.invalidate);
  const meshRef = useRef<Mesh>(null);
  const { positions, indices, uvs, thickness, color } = part;

  // New typed arrays → new geometry; the previous one is released on the GPU (FIXES K5, G10).
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const geometry = buildPartGeometry(positions, indices, uvs, thickness);
    mesh.geometry = geometry;
    invalidate();
    return () => geometry.dispose();
  }, [positions, indices, uvs, thickness, invalidate]);

  // One material per part for the viewer's lifetime; only a change of appearance swaps it.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    const uniforms = uniformsRef.current;
    if (!mesh || !uniforms) return;
    const material = appearance === "lithophane" ? createLithophaneMaterial(uniforms) : createPlasticMaterial();
    mesh.material = material;
    return () => material.dispose();
  }, [appearance, uniformsRef]);

  // Colour and wireframe are applied in place, before the next frame (FIXES K6).
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const material = mesh.material;
    if (!(material instanceof MeshStandardMaterial)) return;
    if (appearance === "plastic") material.color.set(color);
    material.wireframe = wireframe;
    invalidate();
  }, [appearance, color, wireframe, invalidate]);

  // Geometry and material are disposed by the effects above, never by R3F.
  return <mesh ref={meshRef} dispose={null} />;
}

/** Soft studio reflections generated on the device (no HDR download), for satin highlights. */
function StudioEnvironment() {
  const get = useThree((s) => s.get);

  useEffect(() => {
    const { gl, scene, invalidate } = get();
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    scene.environment = target.texture;
    invalidate();
    return () => {
      if (scene.environment === target.texture) scene.environment = null;
      target.dispose();
    };
  }, [get]);

  return null;
}

interface CameraRigProps {
  parts: ViewerPart[];
  bounds: SceneBounds | null;
  fitKey: string;
  interactionMode: InteractionMode;
  viewRef: RefObject<CameraView>;
  rigRef: Ref<SceneRigHandle>;
}

interface Tween {
  from: CameraPose;
  to: CameraPose;
  start: number;
}

const pickRaycaster = new Raycaster();
const pickPointer = new Vector2();

function CameraRig({ parts, bounds, fitKey, interactionMode, viewRef, rigRef }: CameraRigProps) {
  const get = useThree((s) => s.get);
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const boundsRef = useRef<SceneBounds | null>(null);
  const tweenRef = useRef<Tween | null>(null);
  const fittedKeyRef = useRef<string | null>(null);
  const geometryRef = useRef<Float32Array[]>([]);
  const scratchRef = useRef<CameraPose>(null);
  if (scratchRef.current === null) scratchRef.current = { position: new Vector3(), target: new Vector3() };
  /** Meshes frozen for the placement drag in progress; null when there is none. */
  const placingRef = useRef<ViewerPart[] | null>(null);

  const applyLimits = useCallback(
    (b: SceneBounds) => {
      const controls = controlsRef.current;
      if (controls) {
        const limits = distanceLimits(b);
        controls.minDistance = limits.min;
        controls.maxDistance = limits.max;
      }
      const { camera } = get();
      if (camera instanceof PerspectiveCamera) {
        const planes = clipPlanes(b.radius);
        camera.near = planes.near;
        camera.far = planes.far;
        camera.updateProjectionMatrix();
      }
    },
    [get],
  );

  // The user drives the camera unless a view transition or a placement drag holds it.
  const syncControls = useCallback(() => {
    const controls = controlsRef.current;
    if (controls) controls.enabled = tweenRef.current === null && placingRef.current === null;
  }, []);

  const stopTween = useCallback(() => {
    tweenRef.current = null;
    syncControls();
  }, [syncControls]);

  const frame = useCallback(
    (view: CameraView, animate: boolean) => {
      const b = boundsRef.current;
      const controls = controlsRef.current;
      const { camera, invalidate } = get();
      if (!b || !controls || !(camera instanceof PerspectiveCamera)) return;
      const direction = viewDirection(view);
      const distance = fitDistance(b, direction, camera.fov, camera.aspect);
      const to: CameraPose = {
        position: b.center.clone().addScaledVector(direction, distance),
        target: b.center.clone(),
      };
      applyLimits(b);
      stopTween();
      // Settle any leftover drag momentum first so it cannot fight the new pose.
      flushDamping(controls);

      if (!animate || prefersReducedMotion()) {
        camera.position.copy(to.position);
        controls.target.copy(to.target);
        camera.lookAt(to.target);
        controls.update();
        invalidate();
        return;
      }

      tweenRef.current = {
        from: { position: camera.position.clone(), target: controls.target.clone() },
        to,
        start: -1,
      };
      syncControls();
      invalidate();
    },
    [get, applyLimits, stopTween, syncControls],
  );

  const orbit = useCallback(
    (deltaAzimuth: number, deltaPolar: number, zoom: number) => {
      const controls = controlsRef.current;
      if (!controls) return;
      const { camera, invalidate } = get();
      stopTween();
      flushDamping(controls);
      const offset = new Vector3().subVectors(camera.position, controls.target);
      const spherical = new Spherical().setFromVector3(offset);
      spherical.theta += deltaAzimuth;
      spherical.phi = MathUtils.clamp(spherical.phi + deltaPolar, 0.02, Math.PI - 0.02);
      spherical.radius = MathUtils.clamp(spherical.radius * zoom, controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
      camera.lookAt(controls.target);
      controls.update();
      invalidate();
    },
    [get, stopTween],
  );

  const pick = useCallback(
    (clientX: number, clientY: number): [number, number, number] | null => {
      const targets = placingRef.current ?? parts;
      if (targets.length === 0) return null;
      const { camera, gl } = get();
      const ndc = pointerToNdc(clientX, clientY, gl.domElement.getBoundingClientRect());
      if (!ndc) return null;
      camera.updateMatrixWorld();
      pickRaycaster.setFromCamera(pickPointer.set(ndc.x, ndc.y), camera);
      // Meshes are drawn untransformed, so world space is the parts' own millimetre space.
      return raycastParts(targets, pickRaycaster.ray.origin, pickRaycaster.ray.direction)?.point ?? null;
    },
    [get, parts],
  );

  const setPlacing = useCallback(
    (active: boolean) => {
      const controls = controlsRef.current;
      if (active && placingRef.current === null && controls && tweenRef.current === null) {
        // Grabbing the model stops it coasting; otherwise the leftover spin would resume after the drag.
        stopMomentum(controls, get().camera);
      }
      placingRef.current = active ? parts : null;
      syncControls();
    },
    [get, parts, syncControls],
  );

  useImperativeHandle(
    rigRef,
    () => ({
      frame,
      orbitBy: (deltaAzimuth, deltaPolar) => orbit(deltaAzimuth, deltaPolar, 1),
      zoomBy: (factor) => orbit(0, 0, factor),
      pick,
      setPlacing,
    }),
    [frame, orbit, pick, setPlacing],
  );

  // Refit only for a new fitKey (once its mesh has arrived) or the first mesh (FIXES L2).
  useEffect(() => {
    boundsRef.current = bounds;
    const arrays = parts.map((p) => p.positions);
    const previous = geometryRef.current;
    const geometryChanged = arrays.length !== previous.length || arrays.some((a, i) => a !== previous[i]);
    geometryRef.current = arrays;
    if (!bounds) return;
    if (geometryChanged) applyLimits(bounds);
    const decision = fitDecision(fittedKeyRef.current, fitKey, true, geometryChanged);
    if (decision === "keep") return;
    fittedKeyRef.current = fitKey;
    frame(viewRef.current, decision === "animate");
  }, [parts, bounds, fitKey, viewRef, frame, applyLimits]);

  useFrame((state) => {
    const tween = tweenRef.current;
    const controls = controlsRef.current;
    const pose = scratchRef.current;
    if (!tween || !controls || !pose) return;
    const now = performance.now();
    if (tween.start < 0) tween.start = now;
    const t = Math.min(1, (now - tween.start) / VIEW_TRANSITION_MS);
    interpolatePose(tween.from, tween.to, easeInOutCubic(t), pose);
    state.camera.position.copy(pose.position);
    controls.target.copy(pose.target);
    state.camera.lookAt(pose.target);
    if (t >= 1) {
      stopTween();
      controls.update();
    }
    state.invalidate();
  });

  return (
    <OrbitControls ref={controlsRef} enableDamping dampingFactor={0.08} mouseButtons={mouseButtonsFor(interactionMode)} />
  );
}

/** Apply any remaining damped motion at once so a programmatic move starts from rest. */
function flushDamping(controls: OrbitControlsImpl) {
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = damping;
}

/** Drop any remaining damped motion without moving the camera: flush it, then put the pose back. */
function stopMomentum(controls: OrbitControlsImpl, camera: Camera) {
  const position = camera.position.clone();
  const target = controls.target.clone();
  flushDamping(controls);
  camera.position.copy(position);
  controls.target.copy(target);
  controls.update();
}
