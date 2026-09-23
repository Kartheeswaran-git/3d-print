import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = id => document.getElementById(id);
const ui = [
  'keychainText', 'keychainFont', 'targetHeight', 'baseThickness', 'textThickness', 'outlineWidth', 'holeSize', 'format',
  'baseColor', 'textColor'
].map($);

function number(id) { return Number($(id).value); }
function value(id) { return $(id).value; }

let state = {
  previewMesh: null,
  activeView: 'model',
  imageData: null,
  maskData: null,
  physicalWidth: 0,
  physicalHeight: 0
};

// Viewer setup
const viewer = $('viewer');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, viewer.clientWidth / viewer.clientHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(viewer.clientWidth, viewer.clientHeight);
renderer.setPixelRatio(window.devicePixelRatio);
viewer.appendChild(renderer.domElement);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.05;

const meshGroup = new THREE.Group();
scene.add(meshGroup);

const backLight = new THREE.PointLight(0xfff5e6, 0);
scene.add(backLight);
const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyLight.position.set(50, 50, 100);
scene.add(keyLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.8));

window.addEventListener('resize', () => {
  if (!viewer.clientWidth) return;
  camera.aspect = viewer.clientWidth / viewer.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewer.clientWidth, viewer.clientHeight);
});

function drawKeychain() {
  const text = $('keychainText').value || ' ';
  const fontName = value('keychainFont');
  const targetHeightMm = number('targetHeight');
  const baseThickness = number('baseThickness');
  const textThickness = number('textThickness');
  const outlineWidthMm = number('outlineWidth');
  const holeSizeMm = number('holeSize');
  
  // Rendering resolution
  const dpmm = 10;
  const hPx = targetHeightMm * dpmm;
  const outlinePx = outlineWidthMm * dpmm;
  const holeSizePx = holeSizeMm * dpmm;
  
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  
  const fontSizePx = hPx - (outlinePx * 2);
  tempCtx.font = `bold ${fontSizePx}px "${fontName}"`;
  const metrics = tempCtx.measureText(text);
  const textWidthPx = metrics.width;
  
  const ringOuterRadius = holeSizePx / 2 + outlinePx;
  const ringInnerRadius = holeSizePx / 2;
  
  const totalWidthPx = Math.ceil(ringOuterRadius * 2 + textWidthPx + outlinePx * 2);
  const totalHeightPx = Math.ceil(hPx);
  
  const canvas = document.createElement('canvas');
  canvas.width = totalWidthPx;
  canvas.height = totalHeightPx;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  
  ctx.clearRect(0, 0, totalWidthPx, totalHeightPx);
  
  const ringX = ringOuterRadius;
  const ringY = totalHeightPx / 2;
  
  // Apply a slight blur to create perfect 3D chamfers/bevels!
  ctx.filter = 'blur(1.5px)';
  
  // Base outline (White)
  ctx.beginPath();
  ctx.arc(ringX, ringY, ringOuterRadius, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  
  const textX = ringOuterRadius * 2;
  const textY = totalHeightPx / 2;
  
  ctx.font = `bold ${fontSizePx}px "${fontName}"`;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = outlinePx * 2;
  ctx.strokeText(text, textX, textY);
  
  ctx.fillStyle = '#fff';
  ctx.fillText(text, textX, textY);
  
  // Cut out hole
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(ringX, ringY, ringInnerRadius, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.filter = 'none'; // Restore
  
  // Extract Base Mask
  const baseImgData = ctx.getImageData(0, 0, totalWidthPx, totalHeightPx).data;
  const baseMask = new Float32Array(totalWidthPx * totalHeightPx);
  const baseValues = new Float32Array(totalWidthPx * totalHeightPx);
  
  for (let i = 0; i < baseMask.length; i++) {
    const alpha = baseImgData[i*4 + 3] / 255.0;
    baseMask[i] = alpha;
    baseValues[i] = 1.0 - alpha; // 0 (maxThickness) where text is solid, 1 (minThickness) at edges
  }
  
  // Extract Text Mask
  ctx.clearRect(0, 0, totalWidthPx, totalHeightPx);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#fff';
  ctx.filter = 'blur(1.5px)'; // Bevel the text
  ctx.fillText(text, textX, textY);
  ctx.filter = 'none';
  const textImgData = ctx.getImageData(0, 0, totalWidthPx, totalHeightPx).data;
  const textMask = new Float32Array(totalWidthPx * totalHeightPx);
  const textValues = new Float32Array(totalWidthPx * totalHeightPx);
  
  for (let i = 0; i < textMask.length; i++) {
    const alpha = textImgData[i*4 + 3] / 255.0;
    textMask[i] = alpha;
    textValues[i] = 1.0 - alpha;
  }
  
  state.imageData = { width: totalWidthPx, height: totalHeightPx, values: textValues };
  state.maskData = baseMask;
  state.baseValuesData = baseValues;
  state.textMaskData = textMask;
  state.textValuesData = textValues;
  state.physicalWidth = totalWidthPx / dpmm;
  state.physicalHeight = totalHeightPx / dpmm;
  
  // Show 2D mask in preview canvas
  const previewCanvas = $('maskPreview');
  previewCanvas.width = totalWidthPx;
  previewCanvas.height = totalHeightPx;
  previewCanvas.getContext('2d').drawImage(canvas, 0, 0);
  
  return { width: totalWidthPx, height: totalHeightPx };
}

function settings() {
  return {
    width: state.physicalWidth, 
    height: state.physicalHeight,
    minThickness: number('baseThickness'), 
    maxThickness: number('baseThickness') + number('textThickness'),
    thicknessGamma: 1.0, 
    resolution: 1 / 10, // Match dpmm
    base: 0,
    shape: 'custom', 
    wireframe: false, 
    backlight: false,
    maskWidth: state.imageData.width,
    maskHeight: state.imageData.height
  };
}

function updateOutputs() {
  $('targetHeightOut').textContent = `${number('targetHeight')} mm`;
  $('baseThicknessOut').textContent = `${number('baseThickness').toFixed(1)} mm`;
  $('textThicknessOut').textContent = `${number('textThickness').toFixed(1)} mm`;
  $('outlineWidthOut').textContent = `${number('outlineWidth').toFixed(1)} mm`;
  $('holeSizeOut').textContent = `${number('holeSize').toFixed(1)} mm`;
  $('dimsOut').textContent = `${state.physicalWidth.toFixed(1)} × ${state.physicalHeight.toFixed(1)} mm`;
}

function buildPreview(data) {
  meshGroup.clear();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setIndex(Array.from(data.triangles)); 
  geometry.computeVertexNormals();
  
  const material = new THREE.MeshStandardMaterial({ 
    color: 0xffffff, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide 
  });
  
  const baseZ = number('baseThickness');
  const colorBase = new THREE.Color(value('baseColor'));
  const colorText = new THREE.Color(value('textColor'));
  
  material.onBeforeCompile = (shader) => {
    shader.uniforms.baseZ = { value: baseZ + 0.1 };
    shader.uniforms.colorBase = { value: colorBase };
    shader.uniforms.colorText = { value: colorText };
    
    shader.vertexShader = `
      varying float vZ;
      ${shader.vertexShader}
    `.replace(
      `#include <begin_vertex>`,
      `#include <begin_vertex>
      vZ = position.z;`
    );
    
    shader.fragmentShader = `
      uniform float baseZ;
      uniform vec3 colorBase;
      uniform vec3 colorText;
      varying float vZ;
      ${shader.fragmentShader}
    `.replace(
      `#include <color_fragment>`,
      `#include <color_fragment>
      diffuseColor.rgb = vZ > baseZ ? colorText : colorBase;`
    );
  };
  
  state.previewMesh = new THREE.Mesh(geometry, material); 
  meshGroup.add(state.previewMesh);
  
  const span = Math.max(state.physicalWidth, state.physicalHeight);
  camera.position.set(0, 0, span * 1.5);
  orbit.target.set(0, 0, 0);
  orbit.update();
}

const worker = new Worker(new URL('./litho-worker.js', import.meta.url), { type: 'module' });
worker.onmessage = ({ data }) => {
  if (data.type === 'progress') { 
    $('renderStatus').textContent = data.message; 
    return; 
  }
  if (data.type === 'error') { 
    alert(data.message); 
    $('generateBtn').disabled = false;
    $('generateBtn').innerHTML = `<span>Download STL</span><b>↓</b>`;
    return; 
  }
  if (data.type === 'complete') {
    if (state.isExporting) {
      const blob = new Blob([data.file], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const ext = data.format === 'amf' ? 'amf' : 'stl';
      link.href = url; link.download = `${$('keychainText').value || 'keychain'}.${ext}`;
      link.click();
      URL.revokeObjectURL(url);
      
      $('generateBtn').disabled = false;
      $('generateBtn').innerHTML = `<span>Download File</span><b>↓</b>`;
      $('renderStatus').textContent = 'READY';
      state.isExporting = false;
    } else {
      buildPreview(data);
      $('vertsOut').textContent = (data.positions.length / 3).toLocaleString();
      $('trisOut').textContent = (data.triangles.length / 3).toLocaleString();
      $('renderStatus').textContent = 'READY';
    }
  }
};

let previewTimer;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    drawKeychain();
    updateOutputs();
    worker.postMessage({
      type: 'generate',
      image: state.imageData,
      settings: settings(),
      customMask: state.maskData,
      baseValues: state.baseValuesData,
      textMask: state.textMaskData,
      textValues: state.textValuesData,
      format: 'preview'
    });
  }, 100);
}

ui.forEach(el => el && el.addEventListener('input', schedulePreview));

document.querySelectorAll('.view-switch button').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.view-switch button').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    state.activeView = e.target.dataset.view;
    $('viewer').classList.toggle('hidden', state.activeView !== 'model');
    $('maskPreview').classList.toggle('hidden', state.activeView !== 'image');
  });
});

$('generateBtn').addEventListener('click', () => {
  $('generateBtn').disabled = true;
  $('generateBtn').innerHTML = `<span>Exporting...</span><b>↻</b>`;
  $('renderStatus').textContent = 'EXPORTING...';
  state.isExporting = true;
  worker.postMessage({
    type: 'generate',
    image: state.imageData,
    settings: settings(),
    customMask: state.maskData,
    baseValues: state.baseValuesData,
    textMask: state.textMaskData,
    textValues: state.textValuesData,
    format: $('format').value
  });
});

function animate() {
  requestAnimationFrame(animate);
  orbit.update();
  renderer.render(scene, camera);
}

// Check if fonts are loaded before first render
document.fonts.ready.then(() => {
  schedulePreview();
  animate();
});
