const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));

function shapeAt(u, v, s, customMask) {
  const minDim = Math.min(s.width, s.height);
  let x = (u * 2 - 1) * s.width / minDim;
  let y = (v * 2 - 1) * s.height / minDim;
  const a = -s.moonRotation * Math.PI / 180;
  const rx = x * Math.cos(a) - y * Math.sin(a);
  const ry = x * Math.sin(a) + y * Math.cos(a);
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
    if (!customMask) return false;
    const w = s.maskWidth || Math.round(Math.sqrt(customMask.length));
    const h = s.maskHeight || Math.round(Math.sqrt(customMask.length));
    return customMask[clamp(Math.round(v * (h - 1)), 0, h - 1) * w + clamp(Math.round(u * (w - 1)), 0, w - 1)] > 0.05;
  }
  const innerX = s.moonOffsetX + (s.crescent - .4);
  return x * x + y * y <= s.outerRadius * s.outerRadius &&
    (x - innerX) * (x - innerX) + (y - s.moonOffsetY) * (y - s.moonOffsetY) > s.innerRadius * s.innerRadius;
}

function makeSphereMesh(image, s) {
  const columns = image.width - 1, rows = image.height - 1;
  const positions = [], triangles = [];
  const innerRadius = s.sphereDiameter / 2;
  const topAngle = 0;
  const bottomAngle = Math.PI - s.sphereOpening * Math.PI / 180;
  const point = (radius, theta, phi) => [
    radius * Math.sin(phi) * Math.sin(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.cos(theta)
  ];
  const sample = (u, v) => {
    let px = Math.round(u * (image.width - 1)), py = Math.round(v * (image.height - 1));
    px = Math.max(0, Math.min(image.width - 1, px)); py = Math.max(0, Math.min(image.height - 1, py));
    return image.values[py * image.width + px];
  };
  const getThickness = (u, v) => {
    return s.minThickness + (1 - Math.pow(sample(u, v), s.thicknessGamma)) * (s.maxThickness - s.minThickness);
  };
  for (let y = 0; y <= rows; y++) {
    const v = y / rows, phi = topAngle + (bottomAngle - topAngle) * v;
    for (let x = 0; x < columns; x++) positions.push(...point(innerRadius + getThickness(x / columns, v), (x / columns) * Math.PI * 2, phi));
  }
  const outerOffset = 0, innerOffset = (rows + 1) * columns;
  for (let y = 0; y <= rows; y++) {
    const v = y / rows, phi = topAngle + (bottomAngle - topAngle) * v;
    for (let x = 0; x < columns; x++) positions.push(...point(innerRadius, (x / columns) * Math.PI * 2, phi));
  }
  const vertexOuter = (x, y) => outerOffset + y * columns + (x % columns);
  const vertexInner = (x, y) => innerOffset + y * columns + (x % columns);
  const quad = (a, b, c, d) => triangles.push(a, b, c, c, b, d);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const o00 = vertexOuter(x, y), o10 = vertexOuter(x + 1, y), o01 = vertexOuter(x, y + 1), o11 = vertexOuter(x + 1, y + 1);
      const i00 = vertexInner(x, y), i10 = vertexInner(x + 1, y), i01 = vertexInner(x, y + 1), i11 = vertexInner(x + 1, y + 1);
      quad(o00, o01, o10, o11);
      quad(i00, i10, i01, i11);
      if (y === 0 && topAngle > 0) quad(i00, o00, i10, o10);
      if (y === rows - 1) quad(o01, i01, o11, i11);
    }
  }
  return { positions: new Float32Array(positions), triangles: new Uint32Array(triangles), activeCells: rows * columns };
}

function makeMesh(image, s, customMask) {
  if (s.shape === 'sphere') return makeSphereMesh(image, s);
  const cols = image.width - 1, rows = image.height - 1;
  const top = new Int32Array(image.width * image.height); top.fill(-1);
  const bottom = new Int32Array(image.width * image.height); bottom.fill(-1);
  const cells = new Uint8Array(cols * rows);
  const positions = [], triangles = [];
  const pointIndex = (x, y) => y * image.width + x;
  const sample = (x, y) => image.values[Math.min(image.height - 1, y) * image.width + Math.min(image.width - 1, x)];
  const addPoint = (x, y, isBottom) => {
    const store = isBottom ? bottom : top, p = pointIndex(x, y);
    if (store[p] !== -1) return store[p];
    const lum = sample(x, y);
    const thickness = s.minThickness + (1 - Math.pow(lum, s.thicknessGamma)) * (s.maxThickness - s.minThickness);
    positions.push((x / cols - .5) * s.width, (.5 - y / rows) * s.height, isBottom ? 0 : s.base + thickness);
    store[p] = positions.length / 3 - 1;
    return store[p];
  };
  const valid = (x, y) => cells[y * cols + x] === 1;
  const quad = (a, b, c, d) => triangles.push(a, b, c, c, b, d);
  let activeCells = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (shapeAt((x + .5) / cols, (y + .5) / rows, s, customMask)) cells[y * cols + x] = 1;
    }
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!valid(x, y)) continue;
      activeCells++;
      const t00 = addPoint(x, y, false), t10 = addPoint(x + 1, y, false), t01 = addPoint(x, y + 1, false), t11 = addPoint(x + 1, y + 1, false);
      const b00 = addPoint(x, y, true), b10 = addPoint(x + 1, y, true), b01 = addPoint(x, y + 1, true), b11 = addPoint(x + 1, y + 1, true);
      // Top face (points up)
      triangles.push(t00, t01, t10, t01, t11, t10);
      // Bottom face (points down)
      triangles.push(b00, b10, b01, b01, b10, b11);
      if (x === 0 || !valid(x - 1, y)) quad(t00, b00, t01, b01);
      if (x === cols - 1 || !valid(x + 1, y)) quad(t10, t11, b10, b11);
      if (y === 0 || !valid(x, y - 1)) quad(t00, t10, b00, b10);
      if (y === rows - 1 || !valid(x, y + 1)) quad(t01, b01, t11, b11);
    }
  }
  if (!activeCells) throw new Error('The selected shape has no printable area. Adjust the mask or moon controls.');
  return { positions: new Float32Array(positions), triangles: new Uint32Array(triangles), activeCells };
}

function normal(positions, a, b, c) {
  const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
  const abx = positions[b * 3] - ax, aby = positions[b * 3 + 1] - ay, abz = positions[b * 3 + 2] - az;
  const acx = positions[c * 3] - ax, acy = positions[c * 3 + 1] - ay, acz = positions[c * 3 + 2] - az;
  let x = aby * acz - abz * acy, y = abz * acx - abx * acz, z = abx * acy - aby * acx;
  const l = Math.hypot(x, y, z);
  return l ? [x / l, y / l, z / l] : [0, 0, 0];
}

function writeBinary(mesh) {
  const faces = mesh.triangles.length / 3;
  const out = new ArrayBuffer(84 + faces * 50), view = new DataView(out);
  const header = new TextEncoder().encode('LUNA LITHO · LOCAL WATERTIGHT MESH');
  new Uint8Array(out, 0, Math.min(80, header.length)).set(header);
  view.setUint32(80, faces, true);
  let offset = 84;
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const [nx, ny, nz] = normal(mesh.positions, mesh.triangles[i], mesh.triangles[i + 1], mesh.triangles[i + 2]);
    view.setFloat32(offset, nx, true); view.setFloat32(offset + 4, ny, true); view.setFloat32(offset + 8, nz, true); offset += 12;
    for (let j = 0; j < 3; j++) {
      const p = mesh.triangles[i + j] * 3;
      view.setFloat32(offset, mesh.positions[p], true); view.setFloat32(offset + 4, mesh.positions[p + 1], true); view.setFloat32(offset + 8, mesh.positions[p + 2], true); offset += 12;
    }
    view.setUint16(offset, 0, true); offset += 2;
  }
  return out;
}

function writeAscii(mesh) {
  const chunks = ['solid luna_litho\n'];
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const [nx, ny, nz] = normal(mesh.positions, mesh.triangles[i], mesh.triangles[i + 1], mesh.triangles[i + 2]);
    let face = `facet normal ${nx} ${ny} ${nz}\n outer loop\n`;
    for (let j = 0; j < 3; j++) {
      const p = mesh.triangles[i + j] * 3;
      face += `  vertex ${mesh.positions[p]} ${mesh.positions[p + 1]} ${mesh.positions[p + 2]}\n`;
    }
    chunks.push(`${face} endloop\nendfacet\n`);
  }
  chunks.push('endsolid luna_litho\n');
  return new TextEncoder().encode(chunks.join('')).buffer;
}

function writeAmf(baseMesh, textMesh) {
  const chunks = [];
  chunks.push(`<?xml version="1.0" encoding="utf-8"?>\n<amf unit="millimeter" version="1.1">\n`);
  chunks.push(`  <material id="1"><color><r>0.2</r><g>0.2</g><b>0.2</b></color></material>\n`);
  chunks.push(`  <material id="2"><color><r>1.0</r><g>0.5</g><b>0.0</b></color></material>\n`);
  chunks.push(`  <object id="1">\n    <mesh>\n      <vertices>\n`);
  
  for (let i = 0; i < baseMesh.positions.length; i += 3) {
    chunks.push(`        <vertex><coordinates><x>${baseMesh.positions[i]}</x><y>${baseMesh.positions[i+1]}</y><z>${baseMesh.positions[i+2]}</z></coordinates></vertex>\n`);
  }
  const textVertexStart = baseMesh.positions.length / 3;
  if (textMesh) {
    for (let i = 0; i < textMesh.positions.length; i += 3) {
      chunks.push(`        <vertex><coordinates><x>${textMesh.positions[i]}</x><y>${textMesh.positions[i+1]}</y><z>${textMesh.positions[i+2]}</z></coordinates></vertex>\n`);
    }
  }
  chunks.push(`      </vertices>\n`);
  
  chunks.push(`      <volume materialid="1">\n`);
  for (let i = 0; i < baseMesh.triangles.length; i += 3) {
    chunks.push(`        <triangle><v1>${baseMesh.triangles[i]}</v1><v2>${baseMesh.triangles[i+1]}</v2><v3>${baseMesh.triangles[i+2]}</v3></triangle>\n`);
  }
  chunks.push(`      </volume>\n`);
  
  if (textMesh) {
    chunks.push(`      <volume materialid="2">\n`);
    for (let i = 0; i < textMesh.triangles.length; i += 3) {
      chunks.push(`        <triangle><v1>${textMesh.triangles[i] + textVertexStart}</v1><v2>${textMesh.triangles[i+1] + textVertexStart}</v2><v3>${textMesh.triangles[i+2] + textVertexStart}</v3></triangle>\n`);
    }
    chunks.push(`      </volume>\n`);
  }
  chunks.push(`    </mesh>\n  </object>\n</amf>`);
  
  return new Blob(chunks, { type: 'application/octet-stream' });
}

self.onmessage = ({ data }) => {
  if (data.type !== 'generate') return;
  try {
    self.postMessage({ type: 'progress', message: 'BUILDING CLOSED HEIGHT FIELD' });
    
    if (data.format === 'amf') {
      // Create Base Mesh
      const baseMask = data.customMask ? new Float32Array(data.customMask) : null;
      const baseValues = data.baseValues ? new Float32Array(data.baseValues) : new Float32Array(data.image.values);
      const baseSettings = { 
        ...data.settings, 
        minThickness: 0.1, // Slight elephant foot compensation and smooth bottom slope
        maxThickness: data.settings.minThickness 
      };
      const baseImage = { width: data.image.width, height: data.image.height, values: baseValues };
      const baseMesh = makeMesh(baseImage, baseSettings, baseMask);
      
      // Create Text Mesh
      const textMask = data.textMask ? new Float32Array(data.textMask) : null;
      const textValues = data.textValues ? new Float32Array(data.textValues) : null;
      const textSettings = { 
        ...data.settings, 
        base: 0,
        minThickness: 0.0, // Smooth slope down to the base!
        maxThickness: data.settings.maxThickness - data.settings.minThickness
      };
      const textImage = { width: data.image.width, height: data.image.height, values: textValues || baseValues };
      
      let textMesh;
      try {
        textMesh = textMask ? makeMesh(textImage, textSettings, textMask) : null;
        if (textMesh) {
          const zOffset = data.settings.minThickness;
          for (let i = 2; i < textMesh.positions.length; i += 3) {
            textMesh.positions[i] += zOffset;
          }
        }
      } catch (e) {
        textMesh = null; // No text printable area
      }
      
      self.postMessage({ type: 'progress', message: 'WRITING FILE' });
      const file = writeAmf(baseMesh, textMesh); // Returns a Blob
      self.postMessage({ type: 'complete', file, format: data.format, triangles: baseMesh.triangles.length / 3, validation: true });
      return;
    }

    const image = { width: data.image.width, height: data.image.height, values: new Float32Array(data.image.values) };
    const customMask = data.customMask ? new Float32Array(data.customMask) : null;
    const mesh = makeMesh(image, data.settings, customMask);
    const validation = mesh.activeCells > 0 && mesh.triangles.length > 0;
    
    if (data.format === 'preview') {
      self.postMessage({ type: 'complete', format: 'preview', positions: mesh.positions, triangles: mesh.triangles, validation }, [mesh.positions.buffer, mesh.triangles.buffer]);
      return;
    }
    
    self.postMessage({ type: 'progress', message: 'WRITING FILE' });
    const file = data.format === 'ascii' ? writeAscii(mesh) : writeBinary(mesh);
    self.postMessage({ type: 'complete', file, format: data.format, triangles: mesh.triangles.length / 3, validation }, [file]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || 'The STL could not be generated.' });
  }
};
