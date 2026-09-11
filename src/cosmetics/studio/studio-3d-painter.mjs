'use strict';

import * as THREE from '../../../node_modules/three/build/three.module.js';

window.attachStudio3DPainter = function attachStudio3DPainter(viewer, kind, onPixel, onPaintEnd, getPaintLayer, dimensions = {}) {
  const canvas = viewer.canvas;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const skin = viewer.playerObject?.skin;
  const cape = viewer.playerObject?.cape;
  const capeMesh = cape?.cape;
  const isCape = kind === 'cape';
  let textureWidth = dimensions.width || 64;
  let textureHeight = dimensions.height || (isCape ? 32 : 64);
  const targetTexture = isCape ? cape?.map : skin?.map;
  if (targetTexture) {
    targetTexture.magFilter = THREE.NearestFilter;
    targetTexture.minFilter = THREE.NearestFilter;
    targetTexture.generateMipmaps = false;
    targetTexture.needsUpdate = true;
  }
  [skin?.layer1Material, skin?.layer1MaterialBiased, skin?.layer2Material, skin?.layer2MaterialBiased].forEach(material => {
    if (material) {
      material.side = THREE.DoubleSide;
      material.needsUpdate = true;
    }
  });
  if (isCape && cape?.material) {
    cape.material.side = THREE.DoubleSide;
    cape.material.needsUpdate = true;
  }
  let painting = false;
  let orbiting = false;
  let orbitStart = null;
  let lastKey = '';
  let gridLines = [];
  const pixelGridGeometry = node => {
    const geometry = node.geometry;
    const positions = geometry.attributes.position;
    const uvs = geometry.attributes.uv;
    if (!positions || !uvs) return null;
    const vertices = [];
    const line = (a, b) => vertices.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const groups = geometry.groups?.length ? geometry.groups : [{ start: 0, count: positions.count }];
    const pixelSizeU = 1 / textureWidth;
    const pixelSizeV = 1 / textureHeight;
    const offset = 0.01;
    for (const group of groups) {
        const faceIndices = [];
        for (let index = group.start; index < group.start + group.count; index += 1) {
          faceIndices.push(geometry.index ? geometry.index.getX(index) : index);
        }
        if (faceIndices.length < 6) continue;
        const faceVertices = faceIndices.map(vertexIndex => ({
          position: new THREE.Vector3().fromBufferAttribute(positions, vertexIndex),
          uv: new THREE.Vector2().fromBufferAttribute(uvs, vertexIndex)
        }));
        const uvValues = [];
        faceVertices.forEach(vertex => uvValues.push(vertex.uv.x, vertex.uv.y));
        const u0 = Math.min(...uvValues.filter((_, index) => index % 2 === 0));
        const u1 = Math.max(...uvValues.filter((_, index) => index % 2 === 0));
        const v0 = Math.min(...uvValues.filter((_, index) => index % 2 === 1));
        const v1 = Math.max(...uvValues.filter((_, index) => index % 2 === 1));
        const corner = (u, v) => faceVertices.find(vertex =>
          Math.abs(vertex.uv.x - u) < 1e-6 && Math.abs(vertex.uv.y - v) < 1e-6
        )?.position.clone();
        const cornerA = corner(u0, v0);
        const cornerB = corner(u1, v0);
        const cornerC = corner(u0, v1);
        const cornerD = corner(u1, v1);
        if (!cornerA || !cornerB || !cornerC || !cornerD) continue;
        const sample = (u, v) => {
          const uRatio = (u - u0) / (u1 - u0 || 1);
          const vRatio = (v - v0) / (v1 - v0 || 1);
          return cornerA.clone()
            .lerp(cornerB, uRatio)
            .lerp(cornerC.clone().lerp(cornerD, uRatio), vRatio);
        };
        const faceCenter = cornerA.clone().add(cornerB).add(cornerC).add(cornerD).multiplyScalar(0.25);
        const normal = cornerB.clone().sub(cornerA).cross(cornerC.clone().sub(cornerA)).normalize();
        if (normal.dot(faceCenter) < 0) normal.negate();
        normal.multiplyScalar(offset);
      const columns = Math.max(1, Math.round((u1 - u0) / pixelSizeU));
      const rows = Math.max(1, Math.round((v1 - v0) / pixelSizeV));
      for (let column = 0; column <= columns; column += 1) {
        const u = u0 + ((u1 - u0) * column) / columns;
        const start = sample(u, v0);
        const end = sample(u, v1);
        if (start && end) line(start.add(normal), end.add(normal));
      }
      for (let row = 0; row <= rows; row += 1) {
        const v = v0 + ((v1 - v0) * row) / rows;
        const start = sample(u0, v);
        const end = sample(u1, v);
        if (start && end) line(start.add(normal), end.add(normal));
      }
    }
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    return result;
  };
  const setGrid = enabled => {
    gridLines.forEach(line => {
      line.parent?.remove(line);
      line.geometry?.dispose?.();
      line.material?.dispose?.();
    });
    gridLines = [];
    if (!enabled || !viewer.playerObject) return;
    const meshes = [];
    viewer.playerObject.traverse(node => {
      if (!node.isMesh || !node.geometry?.attributes?.position || node.userData?.studioGrid) return;
      if (isCape) {
        if (node === capeMesh && node.visible) meshes.push(node);
        return;
      }
      const paintLayer = getPaintLayer?.() === 'outer' ? 'outer' : 'inner';
      const layerMaterials = paintLayer === 'outer'
        ? [skin?.layer2Material, skin?.layer2MaterialBiased]
        : [skin?.layer1Material, skin?.layer1MaterialBiased];
      if (layerMaterials.includes(node.material)) meshes.push(node);
    });
    meshes.forEach(node => {
      const grid = pixelGridGeometry(node);
      if (!grid) return;
      const overlay = new THREE.LineSegments(
        grid,
        new THREE.LineBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.35,
          depthTest: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4
        })
      );
      overlay.raycast = () => {};
      overlay.userData.studioGrid = true;
      overlay.renderOrder = 101;
      overlay.frustumCulled = false;
      node.add(overlay);
      gridLines.push(overlay);
    });
  };
  const hit = event => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, viewer.camera);
    const targetMaterial = isCape
      ? [cape?.material].filter(Boolean)
      : (getPaintLayer?.() === 'outer'
        ? [skin?.layer2Material, skin?.layer2MaterialBiased]
        : [skin?.layer1Material, skin?.layer1MaterialBiased]);
    const intersections = raycaster.intersectObject(viewer.playerObject, true);
    const belongsToEnabledPart = item => {
      if (isCape) {
        let node = item.object;
        while (node && node !== viewer.playerObject) {
          if (node === cape) return cape.visible;
          node = node.parent;
        }
        return false;
      }
      let node = item.object;
      while (node && node !== viewer.playerObject) {
        if (node.name && skin?.[node.name] === node) return node.visible;
        node = node.parent;
      }
      return false;
    };
    const matchesTarget = item => {
      if (isCape) return item.object === capeMesh && cape?.visible;
      const materials = Array.isArray(item.object.material) ? item.object.material : [item.object.material];
      return !targetMaterial[0] || materials.some(material => targetMaterial.includes(material));
    };
    return intersections.find(item => item.uv && item.object.visible
      && belongsToEnabledPart(item) && matchesTarget(item));
  };
  const paint = event => {
    const intersection = hit(event);
    if (!intersection?.uv) return;
    const x = Math.max(0, Math.min(textureWidth - 1, Math.floor(intersection.uv.x * textureWidth)));
    const y = Math.max(0, Math.min(textureHeight - 1, Math.floor((1 - intersection.uv.y) * textureHeight)));
    let textureBounds = null;
    const geometry = intersection.object?.geometry;
    const uvAttribute = geometry?.attributes?.uv;
    if (geometry && uvAttribute && Number.isInteger(intersection.faceIndex)) {
      const triangleStart = intersection.faceIndex * 3;
      const index = geometry.index;
      const triangleVertices = [0, 1, 2].map(offset => index ? index.getX(triangleStart + offset) : triangleStart + offset);
      const us = triangleVertices.map(vertex => uvAttribute.getX(vertex));
      const vs = triangleVertices.map(vertex => uvAttribute.getY(vertex));
      const left = Math.max(0, Math.floor(Math.min(...us) * textureWidth));
      const right = Math.min(textureWidth - 1, Math.ceil(Math.max(...us) * textureWidth) - 1);
      const top = Math.max(0, Math.floor((1 - Math.max(...vs)) * textureHeight));
      const bottom = Math.min(textureHeight - 1, Math.ceil((1 - Math.min(...vs)) * textureHeight) - 1);
      textureBounds = [left, top, Math.max(1, right - left + 1), Math.max(1, bottom - top + 1)];
    }
    const key = `${x}:${y}`;
    if (key === lastKey && event.type === 'pointermove') return;
    lastKey = key;
    onPixel(x, y, event, textureBounds);
  };
  const down = event => {
    if (event.button === 2 || event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
      orbiting = true;
      orbitStart = { x: event.clientX, y: event.clientY, rotation: viewer.playerWrapper.rotation.clone() };
      viewer.controls.enabled = false;
      canvas.setPointerCapture?.(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    painting = true;
    viewer.controls.enabled = false;
    lastKey = '';
    canvas.setPointerCapture?.(event.pointerId);
    paint(event);
  };
  const move = event => {
    if (painting) {
      event.preventDefault();
      event.stopPropagation();
      paint(event);
    }
    if (orbiting && orbitStart) {
      event.preventDefault();
      event.stopPropagation();
      viewer.playerWrapper.rotation.y = orbitStart.rotation.y + (event.clientX - orbitStart.x) * 0.012;
      viewer.playerWrapper.rotation.x = Math.max(-1.35, Math.min(1.35, orbitStart.rotation.x + (event.clientY - orbitStart.y) * 0.008));
      viewer.render?.();
    }
  };
  const up = event => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (painting) { painting = false; lastKey = ''; onPaintEnd?.(); }
    if (orbiting) { orbiting = false; orbitStart = null; }
    viewer.controls.enabled = true;
    if (event?.pointerId !== undefined) canvas.releasePointerCapture?.(event.pointerId);
  };
  const context = event => event.preventDefault();
  const listenerOptions = { capture: true };
  canvas.addEventListener('pointerdown', down, listenerOptions);
  canvas.addEventListener('pointermove', move, listenerOptions);
  canvas.addEventListener('pointerup', up, listenerOptions);
  canvas.addEventListener('pointercancel', up, listenerOptions);
  canvas.addEventListener('contextmenu', context);
  const refreshGridSoon = () => {
    setGrid(true);
    [80, 220, 500].forEach(delay => window.setTimeout(() => {
      if (viewer.playerObject) setGrid(true);
    }, delay));
  };
  return {
    setGrid,
    setDimensions: (width, height) => {
      textureWidth = width;
      textureHeight = height;
      setGrid(true);
    },
    refreshGrid: refreshGridSoon,
    dispose: () => {
      setGrid(false);
      canvas.removeEventListener('pointerdown', down, listenerOptions);
      canvas.removeEventListener('pointermove', move, listenerOptions);
      canvas.removeEventListener('pointerup', up, listenerOptions);
      canvas.removeEventListener('pointercancel', up, listenerOptions);
      canvas.removeEventListener('contextmenu', context);
      viewer.controls.enabled = true;
    }
  };
};
