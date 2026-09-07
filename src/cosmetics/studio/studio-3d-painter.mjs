'use strict';

import * as THREE from '../../../node_modules/three/build/three.module.js';

window.attachStudio3DPainter = function attachStudio3DPainter(viewer, kind, onPixel, onPaintEnd) {
  const canvas = viewer.canvas;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let painting = false;
  let orbiting = false;
  let orbitStart = null;
  let lastKey = '';
  let gridLines = [];
  const pixelGridGeometry = geometry => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return null;
    const vertices = [];
    const line = (a, b) => vertices.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const x0 = box.min.x, x1 = box.max.x;
    const y0 = box.min.y, y1 = box.max.y;
    const z0 = box.min.z, z1 = box.max.z;
    const inset = 0.012;
    for (let x = Math.ceil(x0); x <= x1; x += 1) {
      line(new THREE.Vector3(x, y0, z0 - inset), new THREE.Vector3(x, y1, z0 - inset));
      line(new THREE.Vector3(x, y0, z1 + inset), new THREE.Vector3(x, y1, z1 + inset));
    }
    for (let y = Math.ceil(y0); y <= y1; y += 1) {
      line(new THREE.Vector3(x0, y, z0 - inset), new THREE.Vector3(x1, y, z0 - inset));
      line(new THREE.Vector3(x0, y, z1 + inset), new THREE.Vector3(x1, y, z1 + inset));
    }
    for (let y = Math.ceil(y0); y <= y1; y += 1) {
      line(new THREE.Vector3(x0 - inset, y, z0), new THREE.Vector3(x0 - inset, y, z1));
      line(new THREE.Vector3(x1 + inset, y, z0), new THREE.Vector3(x1 + inset, y, z1));
    }
    for (let z = Math.ceil(z0); z <= z1; z += 1) {
      line(new THREE.Vector3(x0 - inset, y0, z), new THREE.Vector3(x0 - inset, y1, z));
      line(new THREE.Vector3(x1 + inset, y0, z), new THREE.Vector3(x1 + inset, y1, z));
    }
    for (let x = Math.ceil(x0); x <= x1; x += 1) {
      line(new THREE.Vector3(x, y0 - inset, z0), new THREE.Vector3(x, y0 - inset, z1));
      line(new THREE.Vector3(x, y1 + inset, z0), new THREE.Vector3(x, y1 + inset, z1));
    }
    for (let z = Math.ceil(z0); z <= z1; z += 1) {
      line(new THREE.Vector3(x0, y0 - inset, z), new THREE.Vector3(x1, y0 - inset, z));
      line(new THREE.Vector3(x0, y1 + inset, z), new THREE.Vector3(x1, y1 + inset, z));
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
      if (node.isMesh && node.geometry?.attributes?.position && !node.userData?.studioGrid
        && node.material !== viewer.playerObject.skin.layer2Material
        && node.material !== viewer.playerObject.skin.layer2MaterialBiased) meshes.push(node);
    });
    meshes.forEach(node => {
      const grid = pixelGridGeometry(node.geometry);
      if (!grid) return;
      const overlay = new THREE.LineSegments(
        grid,
        new THREE.LineBasicMaterial({ color: 0x72e64b, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false })
      );
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
    const intersections = raycaster.intersectObject(viewer.playerObject, true);
    return intersections.find(item => item.uv && item.object.visible);
  };
  const paint = event => {
    const intersection = hit(event);
    if (!intersection?.uv) return;
    const x = Math.max(0, Math.min(63, Math.floor(intersection.uv.x * 64)));
    const textureHeight = kind === 'cape' ? 32 : 64;
    const y = Math.max(0, Math.min(textureHeight - 1, Math.floor((1 - intersection.uv.y) * textureHeight)));
    const key = `${x}:${y}`;
    if (key === lastKey && event.type === 'pointermove') return;
    lastKey = key;
    onPixel(x, y, event);
  };
  const down = event => {
    if (event.button === 2) {
      event.preventDefault();
      orbiting = true;
      orbitStart = { x: event.clientX, y: event.clientY, rotation: viewer.playerWrapper.rotation.clone() };
      viewer.controls.enabled = false;
      canvas.setPointerCapture?.(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    painting = true;
    viewer.controls.enabled = false;
    lastKey = '';
    canvas.setPointerCapture?.(event.pointerId);
    paint(event);
  };
  const move = event => {
    if (painting) paint(event);
    if (orbiting && orbitStart) {
      viewer.playerWrapper.rotation.y = orbitStart.rotation.y + (event.clientX - orbitStart.x) * 0.012;
      viewer.playerWrapper.rotation.x = Math.max(-1.35, Math.min(1.35, orbitStart.rotation.x + (event.clientY - orbitStart.y) * 0.008));
    }
  };
  const up = () => {
    if (painting) { painting = false; lastKey = ''; onPaintEnd?.(); }
    if (orbiting) { orbiting = false; orbitStart = null; }
    viewer.controls.enabled = true;
  };
  const context = event => event.preventDefault();
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('contextmenu', context);
  const refreshGridSoon = () => {
    setGrid(true);
    [80, 220, 500].forEach(delay => window.setTimeout(() => {
      if (viewer.playerObject) setGrid(true);
    }, delay));
  };
  return {
    setGrid,
    refreshGrid: refreshGridSoon,
    dispose: () => {
      setGrid(false);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('contextmenu', context);
      viewer.controls.enabled = true;
    }
  };
};
