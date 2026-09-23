import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const $ = (id) => document.getElementById(id);
const fileInput = $('fileInput');
const maskInput = $('maskInput');
const dropzone = $('dropzone');
const generateBtn = $('generateBtn');

const state = {
  image: null,
  imageAspect: 1,
  fileName: 'photo',
  maskImage: null,
  maskValues: null,
  previewData: null,
  previewMesh: null,
  previewTexture: null,
  activeView: 'model',
  previewTimer: 0,
};

const ui = [
  'brightness', 'contrast', 'gamma', 'blur', 'sharpen', 'invert', 'rotation',
  'cropRatio', 'cropScale', 'cropX', 'cropY',
  'imageScale', 'imageX', 'imageY', 'edgeBlend', 'moonBg', 'width', 'height', 'lockRatio',
  'minThickness', 'maxThickness', 'thicknessGamma', 'resolution', 'shape', 'sphereDiameter', 'sphereOpening',
  'crescent', 'outerRadius', 'innerRadius', 'moonOffsetX', 'moonOffsetY',
  'moonRotation', 'base', 'wireframe', 'backlight', 'format'
].map($);

function value(id) { return $(id).type === 'checkbox' ? $(id).checked : $(id).value; }
function number(id) { return Number($(id).value); }
function clamp(n, min = 0, max = 1) { return Math.min(max, Math.max(min, n)); }
function shapeName() { return $('shape').selectedOptions[0].textContent.toUpperCase(); }

function settings() {
  return {
    width: number('width'), height: number('height'),
    brightness: number('brightness'), contrast: number('contrast'), gamma: number('gamma'),
    blur: number('blur'), sharpen: number('sharpen'), invert: value('invert'), rotation: number('rotation'),
    minThickness: number('minThickness'), maxThickness: Math.max(number('maxThickness'), number('minThickness') + 0.1),
    thicknessGamma: number('thicknessGamma'), resolution: number('resolution'), base: number('base'),
    shape: value('shape'), sphereDiameter: number('sphereDiameter'), sphereOpening: number('sphereOpening'),
    crescent: number('crescent'), outerRadius: number('outerRadius'),
    innerRadius: number('innerRadius'), moonOffsetX: number('moonOffsetX'), moonOffsetY: number('moonOffsetY'),
    moonRotation: number('moonRotation'), wireframe: value('wireframe'), backlight: value('backlight'),
    imageScale: number('imageScale'), imageX: number('imageX'), imageY: number('imageY'), edgeBlend: number('edgeBlend'), moonBg: value('moonBg'),
    cropRatio: value('cropRatio'), cropScale: number('cropScale'), cropX: number('cropX'), cropY: number('cropY')
  };
}

function updateOutputs() {
  const text = {
    brightnessOut: `${number('brightness') > 0 ? '+' : ''}${number('brightness')}`,
    contrastOut: number('contrast').toFixed(1), gammaOut: number('gamma').toFixed(1),
    blurOut: `${number('blur')} px`, sharpenOut: `${Math.round(number('sharpen') * 100)}%`,
    rotationOut: `${number('rotation')}°`, imageScaleOut: `${number('imageScale')}%`,
    imageXOut: `${number('imageX')}%`, imageYOut: `${number('imageY')}%`, edgeBlendOut: `${number('edgeBlend')}%`,
    cropScaleOut: `${Math.round(number('cropScale') * 100)}%`, cropXOut: number('cropX').toFixed(2), cropYOut: number('cropY').toFixed(2),
    minThicknessOut: `${number('minThickness').toFixed(1)} mm`, maxThicknessOut: `${number('maxThickness').toFixed(1)} mm`,
    thicknessGammaOut: number('thicknessGamma').toFixed(1), resolutionOut: `${number('resolution').toFixed(2)} mm/px`,
    sphereDiameterOut: `${number('sphereDiameter').toFixed(0)} mm`, sphereOpeningOut: `${number('sphereOpening').toFixed(0)}°`,
    crescentOut: number('crescent').toFixed(2), outerRadiusOut: number('outerRadius').toFixed(2),
    innerRadiusOut: number('innerRadius').toFixed(2), moonOffsetXOut: number('moonOffsetX').toFixed(2),
    moonOffsetYOut: number('moonOffsetY').toFixed(2), moonRotationOut: `${number('moonRotation')}°`,
    baseOut: `${number('base').toFixed(1)} mm`
  };
  Object.entries(text).forEach(([id, output]) => { if ($(id)) $(id).textContent = output; });
  $('shapeLabel').textContent = value('shape') === 'sphere' ? `SPHERICAL GLOBE · Ø ${number('sphereDiameter').toFixed(0)} MM` : `${shapeName()} · ${number('width').toFixed(0)} × ${number('height').toFixed(0)} MM`;
  $('maskBtn').classList.toggle('hidden', value('shape') !== 'custom');
  $('sphereControls').parentElement.parentElement.classList.toggle('shape-sphere', value('shape') === 'sphere');
  $('sphereControls').parentElement.parentElement.classList.toggle('shape-flat', value('shape') !== 'sphere');
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3200);
}

function cropRect(image) {
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const mode = value('cropRatio');
  const ratio = mode === 'original' || mode === 'free' ? sourceRatio : Number(mode);
  let w = image.naturalWidth;
  let h = w / ratio;
  if (h > image.naturalHeight) { h = image.naturalHeight; w = h * ratio; }
  const scale = number('cropScale');
  w *= scale; h *= scale;
  const xGap = Math.max(0, image.naturalWidth - w);
  const yGap = Math.max(0, image.naturalHeight - h);
  return {
    x: xGap / 2 + number('cropX') * xGap / 2,
    y: yGap / 2 + number('cropY') * yGap / 2,
    w, h, ratio
  };
}

const moonTextureCanvas = document.createElement('canvas');
const moonImg = new Image();
moonImg.src = '/moon-texture.jpg';
moonImg.onload = () => {
  moonTextureCanvas.width = moonImg.naturalWidth;
  moonTextureCanvas.height = moonImg.naturalHeight;
  moonTextureCanvas.getContext('2d').drawImage(moonImg, 0, 0);
  if (state.image) schedulePreview();
};

function drawCroppedImage(ctx, width, height, image = state.image) {
  ctx.save();
  if (value('moonBg')) {
    ctx.drawImage(moonTextureCanvas, 0, 0, width, height);
  } else {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
  }
  
  if (!image) { ctx.restore(); return; }
  
  const crop = cropRect(image);
  
  const scale = number('imageScale') / 100;
  const offsetX = (number('imageX') / 100) * width;
  const offsetY = (number('imageY') / 100) * height;
  
  const imgW = width * scale;
  const imgH = (imgW / crop.w) * crop.h;
  
  ctx.translate(width / 2 + offsetX, height / 2 + offsetY);
  ctx.rotate(number('rotation') * Math.PI / 180);
  ctx.filter = number('blur') ? `blur(${number('blur')}px)` : 'none';
  
  if (value('moonBg')) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = imgW;
    tempCanvas.height = imgH;
    const tempCtx = tempCanvas.getContext('2d');
    
    tempCtx.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, imgW, imgH);
    
    tempCtx.globalCompositeOperation = 'destination-in';
    const blendAmt = (number('edgeBlend') / 100) * (Math.min(imgW, imgH) / 2);
    
    if (blendAmt > 0.5) {
      tempCtx.shadowColor = 'black';
      tempCtx.shadowBlur = blendAmt * 2;
      tempCtx.shadowOffsetX = 0;
      tempCtx.shadowOffsetY = 0;
      tempCtx.fillStyle = 'black';
      tempCtx.fillRect(blendAmt, blendAmt, imgW - blendAmt * 2, imgH - blendAmt * 2);
    } else {
      tempCtx.fillStyle = 'black';
      tempCtx.fillRect(0, 0, imgW, imgH);
    }
    
    ctx.drawImage(tempCanvas, -imgW / 2, -imgH / 2, imgW, imgH);
  } else {
    ctx.drawImage(image, crop.x, crop.y, crop.w, crop.h, -imgW / 2, -imgH / 2, imgW, imgH);
  }
  ctx.restore();
}

function shapeAt(u, v, s = settings(), maskValues = state.maskValues) {
  if (s.shape === 'sphere') return true;
  const minDim = Math.min(s.width, s.height);
  let x = (u * 2 - 1) * s.width / minDim;
  let y = (v * 2 - 1) * s.height / minDim;
  const angle = -s.moonRotation * Math.PI / 180;
  const rx = x * Math.cos(angle) - y * Math.sin(angle);
  const ry = x * Math.sin(angle) + y * Math.cos(angle);
  x = rx; y = ry;
  if (s.shape === 'rectangle') return true;
  if (s.shape === 'rounded') {
    const qx = Math.abs(x) - .7, qy = Math.abs(y) - .7;
    return Math.max(qx, qy) <= 0 || Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) <= .3;
  }
  if (s.shape === 'square') return Math.abs(x) <= 1 && Math.abs(y) <= 1;
  if (s.shape === 'circle') return x * x + y * y <= s.outerRadius * s.outerRadius;
  if (s.shape === 'heart') {
    const hx = x, hy = -y + .1;
    return Math.pow(hx * hx + hy * hy - .82, 3) - hx * hx * Math.pow(hy, 3) <= 0;
  }
  if (s.shape === 'custom') {
    if (!maskValues) return false;
    const size = Math.round(Math.sqrt(maskValues.length));
    const mx = clamp(Math.round(u * (size - 1)), 0, size - 1);
    const my = clamp(Math.round(v * (size - 1)), 0, size - 1);
    return maskValues[my * size + mx] > .45;
  }
  const innerX = s.moonOffsetX + (s.crescent - .4);
  return x * x + y * y <= s.outerRadius * s.outerRadius &&
    (x - innerX) * (x - innerX) + (y - s.moonOffsetY) * (y - s.moonOffsetY) > s.innerRadius * s.innerRadius;
}

function makeProcessedData(pixelWidth, pixelHeight, drawPreviews = false) {
  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth; canvas.height = pixelHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  drawCroppedImage(context, pixelWidth, pixelHeight);
  const image = context.getImageData(0, 0, pixelWidth, pixelHeight);
  const values = new Float32Array(pixelWidth * pixelHeight);
  const sharpen = number('sharpen');
  const base = new Float32Array(values.length);

  for (let i = 0; i < values.length; i++) {
    const p = i * 4;
    base[i] = (.2126 * image.data[p] + .7152 * image.data[p + 1] + .0722 * image.data[p + 2]) / 255;
  }
  for (let y = 0; y < pixelHeight; y++) {
    for (let x = 0; x < pixelWidth; x++) {
      const i = y * pixelWidth + x;
      let lum = base[i];
      if (sharpen) {
        const l = base[y * pixelWidth + Math.max(0, x - 1)], r = base[y * pixelWidth + Math.min(pixelWidth - 1, x + 1)];
        const t = base[Math.max(0, y - 1) * pixelWidth + x], b = base[Math.min(pixelHeight - 1, y + 1) * pixelWidth + x];
        lum = clamp(lum + sharpen * (4 * lum - l - r - t - b));
      }
      lum = clamp(((lum + number('brightness') / 100) - .5) * number('contrast') + .5);
      lum = Math.pow(lum, 1 / number('gamma'));
      if (value('invert')) lum = 1 - lum;
      values[i] = lum;
      const visible = shapeAt((x + .5) / pixelWidth, (y + .5) / pixelHeight);
      const shade = Math.round(lum * 255);
      image.data[i * 4] = shade; image.data[i * 4 + 1] = shade; image.data[i * 4 + 2] = shade;
      image.data[i * 4 + 3] = visible ? 255 : 0;
    }
  }
  canvas.getContext('2d').putImageData(image, 0, 0);
  if (drawPreviews) {
    const target = $('imageCanvas');
    target.width = pixelWidth; target.height = pixelHeight;
    target.getContext('2d').putImageData(image, 0, 0);
    drawThumbnail($('grayCanvas'), canvas);
    const original = document.createElement('canvas');
    original.width = pixelWidth; original.height = pixelHeight;
    drawCroppedImage(original.getContext('2d'), pixelWidth, pixelHeight);
    drawThumbnail($('originalCanvas'), original);
  }
  return { width: pixelWidth, height: pixelHeight, values, canvas };
}

function drawThumbnail(target, source) {
  target.width = 160; target.height = 100;
  const context = target.getContext('2d');
  context.clearRect(0, 0, target.width, target.height);
  context.drawImage(source, 0, 0, target.width, target.height);
}

function exportDimensions() {
  const s = settings();
  if (s.shape === 'sphere') {
    const requested = Math.max(180, Math.round(Math.PI * s.sphereDiameter / s.resolution));
    const columns = Math.min(720, requested);
    return { width: columns + 1, height: Math.max(91, Math.round(columns / 2) + 1), capped: columns < requested };
  }
  let width = Math.max(2, Math.round(s.width / s.resolution) + 1);
  let height = Math.max(2, Math.round(s.height / s.resolution) + 1);
  const maximumSide = 720;
  const factor = Math.min(1, maximumSide / Math.max(width, height));
  width = Math.max(2, Math.floor(width * factor));
  height = Math.max(2, Math.floor(height * factor));
  return { width, height, capped: factor < 1 };
}

function updateMetrics() {
  if (!state.image) {
    ['verticesMetric', 'trianglesMetric', 'sizeMetric'].forEach((id) => $(id).textContent = '—');
    return;
  }
  const d = exportDimensions();
  const samples = d.width * d.height;
  let coverage = .58;
  if (value('shape') === 'sphere') coverage = 1;
  if (value('shape') === 'rectangle') coverage = 1;
  if (value('shape') === 'circle' || value('shape') === 'heart') coverage = .75;
  if (value('shape') === 'square' || value('shape') === 'rounded') coverage = .88;
  const cells = Math.round((d.width - 1) * (d.height - 1) * coverage);
  const triangles = value('shape') === 'sphere' ? cells * 4 + d.width * 8 : cells * 4 + Math.round(Math.sqrt(cells) * 8);
  const vertices = value('shape') === 'sphere' ? Math.round(d.width * d.height * 2) : Math.round(cells * 2.1);
  const bytes = triangles * 50 + 84;
  $('verticesMetric').textContent = vertices > 999999 ? `${(vertices / 1e6).toFixed(1)}M` : `${Math.round(vertices / 1000)}k`;
  $('trianglesMetric').textContent = triangles > 999999 ? `${(triangles / 1e6).toFixed(1)}M` : `${Math.round(triangles / 1000)}k`;
  $('sizeMetric').textContent = `${(bytes / 1048576).toFixed(1)} MB`;
  $('renderStatus').textContent = d.capped ? 'EXPORT CAPPED AT 720 PX' : 'PREVIEW READY';
}

let renderer, scene, camera, orbit, meshGroup, backLight;
function setupViewer() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  $('viewer').appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, 1, .1, 2000);
  camera.position.set(120, -145, 115);
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true; orbit.dampingFactor = .08;
  orbit.minDistance = 40; orbit.maxDistance = 600;
  scene.add(new THREE.HemisphereLight(0xd9e7ff, 0x07101e, 2.2));
  const key = new THREE.DirectionalLight(0xfff1c8, 3.2); key.position.set(-90, -110, 180); scene.add(key);
  backLight = new THREE.PointLight(0xbaf36c, 75, 330, 2); backLight.position.set(0, 0, -80); scene.add(backLight);
  meshGroup = new THREE.Group(); scene.add(meshGroup);
  const observer = new ResizeObserver(resizeViewer); observer.observe($('viewer'));
  resizeViewer();
  (function render() { requestAnimationFrame(render); orbit.update(); renderer.render(scene, camera); })();
}

function resizeViewer() {
  if (!renderer) return;
  const rect = $('viewer').getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
  renderer.setSize(rect.width, rect.height, false);
}

function disposeMesh() {
  if (!state.previewMesh) return;
  meshGroup.remove(state.previewMesh);
  state.previewMesh.geometry.dispose();
  state.previewMesh.material.dispose();
  state.previewTexture?.dispose();
  state.previewMesh = null;
}

function buildPreview(data) {
  if (settings().shape === 'sphere') return buildSpherePreview(data);
  disposeMesh();
  const s = settings(), columns = data.width - 1, rows = data.height - 1;
  const positions = [], uvs = [], indices = [];
  const top = new Int32Array((columns + 1) * (rows + 1)); top.fill(-1);
  const bottom = new Int32Array((columns + 1) * (rows + 1)); bottom.fill(-1);
  const indexAt = (x, y) => y * (columns + 1) + x;
  const point = (x, y, base) => {
    const map = base ? bottom : top, pointIndex = indexAt(x, y);
    if (map[pointIndex] !== -1) return map[pointIndex];
    const u = x / columns, v = y / rows;
    const lum = data.values[Math.min(data.height - 1, y) * data.width + Math.min(data.width - 1, x)];
    const thickness = s.minThickness + (1 - Math.pow(lum, s.thicknessGamma)) * (s.maxThickness - s.minThickness);
    positions.push((u - .5) * s.width, (.5 - v) * s.height, base ? 0 : s.base + thickness);
    uvs.push(u, 1 - v);
    map[pointIndex] = positions.length / 3 - 1;
    return map[pointIndex];
  };
  const cells = new Uint8Array(columns * rows);
  const valid = (x, y) => cells[y * columns + x] === 1;
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    if (shapeAt((x + .5) / columns, (y + .5) / rows, s)) cells[y * columns + x] = 1;
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    if (!valid(x, y)) continue;
    const t00 = point(x, y, false), t10 = point(x + 1, y, false), t01 = point(x, y + 1, false), t11 = point(x + 1, y + 1, false);
    const b00 = point(x, y, true), b10 = point(x + 1, y, true), b01 = point(x, y + 1, true), b11 = point(x + 1, y + 1, true);
    indices.push(t00, t10, t01, t01, t10, t11, b00, b01, b10, b01, b11, b10);
    const quad = (a, b, c, d) => indices.push(a, b, c, c, b, d);
    if (x === 0 || !valid(x - 1, y)) quad(t00, b00, t01, b01);
    if (x === columns - 1 || !valid(x + 1, y)) quad(t10, t11, b10, b11);
    if (y === 0 || !valid(x, y - 1)) quad(t00, t10, b00, b10);
    if (y === rows - 1 || !valid(x, y + 1)) quad(t01, b01, t11, b11);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const texture = new THREE.CanvasTexture(data.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  const material = new THREE.MeshStandardMaterial({
    color: 0xe8f6ba, map: texture, roughness: .66, metalness: .02,
    wireframe: s.wireframe, side: THREE.DoubleSide,
    emissive: s.backlight ? new THREE.Color(0x21420b) : new THREE.Color(0x000000),
    emissiveIntensity: s.backlight ? .62 : 0
  });
  state.previewTexture = texture;
  state.previewMesh = new THREE.Mesh(geometry, material);
  meshGroup.add(state.previewMesh);
  backLight.intensity = s.backlight ? 75 : 0;
  setCamera('perspective');
}

function buildSpherePreview(data) {
  disposeMesh();
  const s = settings(), columns = Math.max(72, data.width - 1), rows = Math.max(42, Math.round(columns / 2));
  const positions = [], uvs = [], indices = [];
  const innerRadius = s.sphereDiameter / 2, topAngle = 8 * Math.PI / 180, bottomAngle = Math.PI - s.sphereOpening * Math.PI / 180;
  const point = (radius, theta, phi) => [radius * Math.sin(phi) * Math.sin(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.cos(theta)];
  for (let y = 0; y <= rows; y++) {
    const v = y / rows, phi = topAngle + (bottomAngle - topAngle) * v;
    for (let x = 0; x <= columns; x++) {
      const u = x / columns, lum = data.values[Math.round(v * (data.height - 1)) * data.width + Math.round(u * (data.width - 1))];
      const thickness = s.minThickness + (1 - Math.pow(lum, s.thicknessGamma)) * (s.maxThickness - s.minThickness);
      positions.push(...point(innerRadius + thickness, u * Math.PI * 2, phi)); uvs.push(u, 1 - v);
    }
  }
  const at = (x, y) => y * (columns + 1) + x;
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const a = at(x, y), b = at(x + 1, y), c = at(x, y + 1), d = at(x + 1, y + 1);
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const texture = new THREE.CanvasTexture(data.canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = THREE.RepeatWrapping;
  const material = new THREE.MeshStandardMaterial({ color: 0xf1eab5, map: texture, roughness: .62, metalness: .01, wireframe: s.wireframe, side: THREE.DoubleSide, emissive: s.backlight ? new THREE.Color(0x334e11) : new THREE.Color(0), emissiveIntensity: s.backlight ? .75 : 0 });
  state.previewTexture = texture; state.previewMesh = new THREE.Mesh(geometry, material); meshGroup.add(state.previewMesh); backLight.intensity = s.backlight ? 90 : 0;
  setCamera('perspective');
}

function setCamera(view) {
  if (!state.previewMesh) return;
  const s = settings(), span = s.shape === 'sphere' ? s.sphereDiameter : Math.max(s.width, s.height);
  if (view === 'front') camera.position.set(0, 0, span * 2.2);
  else if (view === 'side') camera.position.set(span * 2.2, 0, span * .6);
  else camera.position.set(span * 1.16, -span * 1.34, span * 1.1);
  orbit.target.set(0, 0, s.maxThickness / 2);
  orbit.update();
}

function showView(view) {
  state.activeView = view;
  $('viewer').classList.toggle('hidden', view !== 'model');
  $('imageCanvas').classList.toggle('hidden', view !== 'image');
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  if (view === 'model') resizeViewer();
}

function renderPreview() {
  if (!state.image) return;
  updateOutputs();
  const s = settings();
  const ratio = s.shape === 'sphere' ? .5 : s.height / s.width;
  const width = 156, height = Math.max(48, Math.round(width * ratio));
  const data = makeProcessedData(width, height, true);
  state.previewData = data;
  buildPreview(data);
  $('emptyState').classList.add('hidden');
  $('viewer').classList.toggle('hidden', state.activeView !== 'model');
  $('imageCanvas').classList.toggle('hidden', state.activeView !== 'image');
  updateMetrics();
}

function schedulePreview() {
  updateOutputs();
  clearTimeout(state.previewTimer);
  state.previewTimer = setTimeout(renderPreview, 55);
}

function handleControl(event) {
  if (event.target.id === 'width' && value('lockRatio')) $('height').value = $('width').value;
  if (event.target.id === 'height' && value('lockRatio')) $('width').value = $('height').value;
  if (event.target.id === 'wireframe' && state.previewMesh) state.previewMesh.material.wireframe = value('wireframe');
  if (event.target.id === 'backlight' && state.previewMesh) { state.previewMesh.material.emissiveIntensity = value('backlight') ? .62 : 0; backLight.intensity = value('backlight') ? 75 : 0; }
  schedulePreview();
}

async function loadImage(file, isMask = false) {
  const allowed = isMask ? ['image/png', 'image/svg+xml'] : ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) throw new Error(isMask ? 'Please choose an SVG or PNG mask.' : 'Use a JPG, PNG, or WebP image.');
  if (file.size > (isMask ? 10 : 20) * 1024 * 1024) throw new Error('That file is larger than the local processing limit.');
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url;
    });
    if (!isMask && (image.naturalWidth > 12000 || image.naturalHeight > 12000)) throw new Error('Please use an image smaller than 12,000 px on either side.');
    return image;
  } finally { URL.revokeObjectURL(url); }
}

async function usePhoto(file) {
  try {
    const image = await loadImage(file);
    state.image = image; state.imageAspect = image.naturalWidth / image.naturalHeight;
    state.fileName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'photo';
    $('height').value = Math.max(20, Math.round(number('width') / state.imageAspect));
    $('imageActions').classList.remove('hidden');
    dropzone.querySelector('strong').textContent = file.name;
    dropzone.querySelector('small').textContent = `${image.naturalWidth} × ${image.naturalHeight} · local only`;
    generateBtn.disabled = false;
    showView('model'); renderPreview();
    toast('Photo loaded locally. Adjust the moon, then export when ready.');
  } catch (error) { toast(error.message || 'Could not read that image.'); }
}

async function useMask(file) {
  try {
    const image = await loadImage(file, true);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, 256, 256);
    const pixels = context.getImageData(0, 0, 256, 256).data;
    state.maskValues = new Float32Array(256 * 256);
    for (let i = 0; i < state.maskValues.length; i++) state.maskValues[i] = pixels[i * 4 + 3] / 255 * (.2126 * pixels[i * 4] + .7152 * pixels[i * 4 + 1] + .0722 * pixels[i * 4 + 2]) / 255;
    state.maskImage = image;
    toast('Custom mask loaded. White areas will become the lithophane.');
    schedulePreview();
  } catch (error) { toast(error.message || 'Could not read that mask.'); }
}

function removePhoto() {
  state.image = null; state.previewData = null; disposeMesh();
  $('emptyState').classList.remove('hidden'); $('imageActions').classList.add('hidden');
  $('viewer').classList.add('hidden'); $('imageCanvas').classList.add('hidden');
  dropzone.querySelector('strong').textContent = 'Drop a photograph';
  dropzone.querySelector('small').textContent = 'or browse files · JPG, PNG, WebP';
  generateBtn.disabled = true; updateMetrics();
}

const worker = new Worker(new URL('./litho-worker.js', import.meta.url), { type: 'module' });
worker.onmessage = ({ data }) => {
  if (data.type === 'progress') { $('renderStatus').textContent = data.message; return; }
  if (data.type === 'error') { finishExport(); toast(data.message); return; }
  if (data.type === 'complete') {
    const blob = new Blob([data.file], { type: data.format === 'ascii' ? 'text/plain' : 'model/stl' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = `${state.fileName}_${value('shape')}_lithophane.stl`;
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 1500);
    finishExport();
    $('renderStatus').textContent = data.validation ? 'WATERTIGHT · EXPORTED' : 'EXPORTED WITH CHECKS';
    toast(`${data.triangles.toLocaleString()} triangles exported as ${data.format.toUpperCase()} STL.`);
  }
};

function finishExport() { generateBtn.disabled = !state.image; generateBtn.innerHTML = '<span>Generate STL</span><b>→</b>'; }
function exportStl() {
  if (!state.image) return;
  const d = exportDimensions();
  const data = makeProcessedData(d.width, d.height, false);
  const s = settings();
  generateBtn.disabled = true; generateBtn.innerHTML = '<span>Building watertight STL…</span><b>↻</b>';
  $('renderStatus').textContent = 'PROCESSING HIGH-RES MESH';
  const customMask = state.maskValues ? state.maskValues.slice().buffer : null;
  worker.postMessage({ type: 'generate', image: { width: data.width, height: data.height, values: data.values.buffer }, settings: s, format: value('format'), customMask }, customMask ? [data.values.buffer, customMask] : [data.values.buffer]);
}

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (event) => { event.preventDefault(); dropzone.style.background = 'rgba(203,243,108,.13)'; });
dropzone.addEventListener('dragleave', () => { dropzone.style.background = ''; });
dropzone.addEventListener('drop', (event) => { event.preventDefault(); dropzone.style.background = ''; if (event.dataTransfer.files[0]) usePhoto(event.dataTransfer.files[0]); });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) usePhoto(fileInput.files[0]); fileInput.value = ''; });
$('replaceBtn').addEventListener('click', () => fileInput.click());
$('removeBtn').addEventListener('click', removePhoto);
$('maskBtn').addEventListener('click', () => maskInput.click());
maskInput.addEventListener('change', () => { if (maskInput.files[0]) useMask(maskInput.files[0]); maskInput.value = ''; });
ui.forEach((el) => el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'number' ? 'change' : 'input', handleControl));
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
document.querySelectorAll('[data-camera]').forEach((button) => button.addEventListener('click', () => setCamera(button.dataset.camera)));
generateBtn.addEventListener('click', exportStl);

// Project Actions (Save, Load, Reset)
$('saveBtn').addEventListener('click', () => {
  const s = settings();
  s.autoLevels = value('autoLevels');
  s.lockRatio = value('lockRatio');
  const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'lithophane_project.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
});

$('loadBtn').addEventListener('click', () => $('loadInput').click());
$('loadInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    Object.keys(data).forEach(key => {
      const el = $(key);
      if (el) {
        if (el.type === 'checkbox') el.checked = data[key];
        else el.value = data[key];
      }
    });
    updateOutputs();
    schedulePreview();
    toast('Project settings loaded.');
  } catch (err) {
    toast('Failed to load JSON settings.');
  }
  e.target.value = '';
});

$('resetBtn').addEventListener('click', () => {
  const defaults = {
    brightness: 0, contrast: 1.0, gamma: 1.0, blur: 0, sharpen: 0,
    invert: false, autoLevels: false, rotation: 0, 
    imageScale: 100, imageX: 0, imageY: 0, edgeBlend: 15, moonBg: true, 
    width: 100, height: 100, lockRatio: true,
    minThickness: 0.8, maxThickness: 3.0, thicknessGamma: 1.0, resolution: 0.15,
    shape: 'sphere', sphereDiameter: 120, sphereOpening: 22, crescent: 0.40,
    outerRadius: 0.90, innerRadius: 0.82, moonOffsetX: 0.36, moonOffsetY: 0.00,
    moonRotation: -12, base: 0.8, wireframe: false, backlight: true, format: 'binary'
  };
  Object.keys(defaults).forEach(key => {
    const el = $(key);
    if (el) {
      if (el.type === 'checkbox') el.checked = defaults[key];
      else el.value = defaults[key];
    }
  });
  if (state.image) removePhoto();
  updateOutputs();
  schedulePreview();
  toast('Reset to default settings.');
});

setupViewer();
updateOutputs();
updateMetrics();
