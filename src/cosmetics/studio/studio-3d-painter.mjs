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
      const overlay = new THREE.Mesh(node.geometry, new THREE.ShaderMaterial({
        uniforms: {
          gridColor: { value: new THREE.Color(0x72e64b) },
          textureSize: { value: kind === 'cape' ? new THREE.Vector2(64, 32) : new THREE.Vector2(64, 64) },
          lineWidth: { value: 0.14 }
        },
        vertexShader: `
          varying vec2 vGridUv;
          void main() {
            vGridUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 gridColor;
          uniform vec2 textureSize;
          uniform float lineWidth;
          varying vec2 vGridUv;
          void main() {
            vec2 cell = fract(vGridUv * textureSize);
            vec2 distanceToEdge = min(cell, 1.0 - cell);
            float line = 1.0 - smoothstep(lineWidth * 0.35, lineWidth, min(distanceToEdge.x, distanceToEdge.y));
            if (line < 0.02) discard;
            gl_FragColor = vec4(gridColor, 1.0);
          }
        `,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
      }));
      overlay.userData.studioGrid = true;
      overlay.visible = true;
      overlay.renderOrder = 100;
      overlay.frustumCulled = false;
      overlay.scale.setScalar(1.002);
      node.add(overlay);
      gridLines.push(overlay);

      const edgeOverlay = new THREE.LineSegments(
        new THREE.EdgesGeometry(node.geometry),
        new THREE.LineBasicMaterial({ color: 0x72e64b, transparent: true, opacity: 1, depthTest: false, depthWrite: false })
      );
      edgeOverlay.userData.studioGrid = true;
      edgeOverlay.renderOrder = 101;
      edgeOverlay.frustumCulled = false;
      edgeOverlay.scale.setScalar(1.004);
      node.add(edgeOverlay);
      gridLines.push(edgeOverlay);
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
