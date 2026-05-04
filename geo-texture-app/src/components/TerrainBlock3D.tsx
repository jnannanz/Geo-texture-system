"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import styles from "./MapSelector.module.css";

export interface TerrainLayer {
  name: string;
  color: string;
}

export interface TerrainBlockData {
  elevations: number[][];
  bounds: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
  minElevation: number;
  maxElevation: number;
  layers: TerrainLayer[];
}

interface TerrainBlock3DProps {
  data: TerrainBlockData;
}

const terrainWidth = 16;
const terrainDepth = 12;
const layerDepth = 1.25;
const textureSize = 128;

function normalizedElevation(elevation: number, minElevation: number, maxElevation: number) {
  const range = Math.max(maxElevation - minElevation, 1);
  return ((elevation - minElevation) / range) * 3.4;
}

function layerBoundaryY(data: TerrainBlockData, row: number, col: number, boundaryIndex: number) {
  const terrainY = normalizedElevation(data.elevations[row][col], data.minElevation, data.maxElevation);
  if (boundaryIndex === 0) return terrainY;

  const fold =
    Math.sin(col * 0.42 + boundaryIndex * 0.8) * 0.14 +
    Math.cos(row * 0.31 + boundaryIndex * 0.45) * 0.1;

  return terrainY - boundaryIndex * layerDepth - fold;
}

function createLithologyTexture(layer: TerrainLayer, index: number) {
  const canvas = document.createElement("canvas");
  canvas.width = textureSize;
  canvas.height = textureSize;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const name = layer.name.toLowerCase();
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, textureSize, textureSize);
  context.strokeStyle = "rgba(16, 24, 39, 0.52)";
  context.fillStyle = "rgba(16, 24, 39, 0.42)";
  context.lineWidth = 3;

  if (name.includes("砂") || name.includes("sand")) {
    for (let y = -textureSize; y < textureSize * 2; y += 18) {
      context.beginPath();
      context.moveTo(-8, y);
      context.lineTo(textureSize + 8, y + textureSize * 0.42);
      context.stroke();
    }
    for (let i = 0; i < 90; i++) {
      const x = (i * 37 + index * 19) % textureSize;
      const y = (i * 53 + index * 23) % textureSize;
      context.beginPath();
      context.arc(x, y, 1.5, 0, Math.PI * 2);
      context.fill();
    }
  } else if (name.includes("灰") || name.includes("limestone") || name.includes("carbonate")) {
    for (let y = 12; y < textureSize; y += 24) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(textureSize, y);
      context.stroke();
    }
    for (let y = 0; y < textureSize; y += 24) {
      const offset = (y / 24) % 2 === 0 ? 0 : 32;
      for (let x = -offset; x < textureSize; x += 48) {
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x, y + 24);
        context.stroke();
      }
    }
  } else if (name.includes("页") || name.includes("shale")) {
    context.lineWidth = 2;
    for (let y = 8; y < textureSize; y += 11) {
      context.beginPath();
      context.moveTo(0, y + Math.sin(y) * 2);
      context.lineTo(textureSize, y + Math.cos(y) * 2);
      context.stroke();
    }
  } else if (name.includes("基底") || name.includes("晶") || name.includes("granite") || name.includes("basement")) {
    context.lineWidth = 3;
    for (let x = -textureSize; x < textureSize * 2; x += 20) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x + textureSize, textureSize);
      context.stroke();
      context.beginPath();
      context.moveTo(x + textureSize, 0);
      context.lineTo(x, textureSize);
      context.stroke();
    }
  } else {
    for (let i = 0; i < 140; i++) {
      const x = (i * 29 + index * 17) % textureSize;
      const y = (i * 47 + index * 31) % textureSize;
      context.beginPath();
      context.arc(x, y, 2, 0, Math.PI * 2);
      context.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function buildTerrainGeometry(data: TerrainBlockData) {
  const rows = data.elevations.length;
  const cols = data.elevations[0]?.length ?? 0;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const low = new THREE.Color("#526a35");
  const mid = new THREE.Color("#8fb752");
  const high = new THREE.Color("#3d4650");

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = (col / (cols - 1) - 0.5) * terrainWidth;
      const z = (row / (rows - 1) - 0.5) * terrainDepth;
      const y = normalizedElevation(data.elevations[row][col], data.minElevation, data.maxElevation);
      const t = y / 3.4;
      const color = t < 0.58
        ? low.clone().lerp(mid, t / 0.58)
        : mid.clone().lerp(high, (t - 0.58) / 0.42);

      positions.push(x, y, z);
      colors.push(color.r, color.g, color.b);
    }
  }

  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildLayerSideGeometry(data: TerrainBlockData, layerIndex: number) {
  const rows = data.elevations.length;
  const cols = data.elevations[0]?.length ?? 0;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const pushEdgePoint = (row: number, col: number, u: number) => {
    const x = (col / (cols - 1) - 0.5) * terrainWidth;
    const z = (row / (rows - 1) - 0.5) * terrainDepth;
    const topY = layerBoundaryY(data, row, col, layerIndex);
    const bottomY = layerBoundaryY(data, row, col, layerIndex + 1);
    positions.push(x, topY, z, x, bottomY, z);
    uvs.push(u, 0, u, 1);
  };

  const addStrip = (points: Array<[number, number]>) => {
    const base = positions.length / 3;
    points.forEach(([row, col], pointIndex) => {
      const u = (pointIndex / Math.max(points.length - 1, 1)) * 5;
      pushEdgePoint(row, col, u);
    });
    for (let i = 0; i < points.length - 1; i++) {
      const a = base + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, c, b, d);
    }
  };

  addStrip(Array.from({ length: cols }, (_, col) => [0, col]));
  addStrip(Array.from({ length: rows }, (_, row) => [row, cols - 1]));
  addStrip(Array.from({ length: cols }, (_, col) => [rows - 1, cols - 1 - col]));
  addStrip(Array.from({ length: rows }, (_, row) => [rows - 1 - row, 0]));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export default function TerrainBlock3D({ data }: TerrainBlock3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || data.elevations.length < 2 || (data.elevations[0]?.length ?? 0) < 2) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor("#edf3f4");
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog("#edf3f4", 20, 42);

    const camera = new THREE.PerspectiveCamera(42, mount.clientWidth / mount.clientHeight, 0.1, 100);
    camera.position.set(11, 8, 14);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, -0.6, 0);
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 9;
    controls.maxDistance = 28;

    scene.add(new THREE.HemisphereLight("#ffffff", "#64748b", 2.3));

    const sun = new THREE.DirectionalLight("#fff7ea", 3.2);
    sun.position.set(-7, 12, 8);
    sun.castShadow = true;
    scene.add(sun);

    const terrain = new THREE.Mesh(
      buildTerrainGeometry(data),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.82,
        metalness: 0.02,
      }),
    );
    terrain.castShadow = true;
    terrain.receiveShadow = true;
    scene.add(terrain);

    data.layers.forEach((layer, index) => {
      const texture = createLithologyTexture(layer, index);
      const material = new THREE.MeshStandardMaterial({
        color: layer.color,
        map: texture,
        roughness: 0.9,
        metalness: 0.02,
        side: THREE.DoubleSide,
      });
      const side = new THREE.Mesh(buildLayerSideGeometry(data, index), material);
      side.receiveShadow = true;
      scene.add(side);
    });

    const bottom = new THREE.Mesh(
      new THREE.BoxGeometry(terrainWidth, 0.18, terrainDepth),
      new THREE.MeshStandardMaterial({ color: "#4b3b32", roughness: 1 }),
    );
    bottom.position.y = -data.layers.length * layerDepth - 0.65;
    bottom.receiveShadow = true;
    scene.add(bottom);

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(terrainWidth, data.layers.length * layerDepth + 4.2, terrainDepth));
    const edgeLines = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: "#17202a", transparent: true, opacity: 0.18 }),
    );
    edgeLines.position.y = 1.35 - data.layers.length * layerDepth * 0.5;
    scene.add(edgeLines);

    const resizeObserver = new ResizeObserver(() => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(mount);

    let frameId = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      controls.dispose();
      terrain.geometry.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) {
            object.material.forEach((material) => material.dispose());
          } else {
            object.material.dispose();
          }
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [data]);

  return (
    <div className={styles.terrainViewer}>
      <div ref={mountRef} className={styles.threeCanvas} />
      <div className={styles.terrainLegend}>
        {data.layers.map((layer) => (
          <span key={layer.name}>
            <i style={{ backgroundColor: layer.color }} />
            {layer.name}
          </span>
        ))}
      </div>
    </div>
  );
}
