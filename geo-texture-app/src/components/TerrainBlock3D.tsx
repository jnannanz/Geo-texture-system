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

function normalizedElevation(elevation: number, minElevation: number, maxElevation: number) {
  const range = Math.max(maxElevation - minElevation, 1);
  return ((elevation - minElevation) / range) * 3.4;
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
  const indices: number[] = [];

  const pushEdgePoint = (row: number, col: number) => {
    const x = (col / (cols - 1) - 0.5) * terrainWidth;
    const z = (row / (rows - 1) - 0.5) * terrainDepth;
    const terrainY = normalizedElevation(data.elevations[row][col], data.minElevation, data.maxElevation);
    const fold = Math.sin(col * 0.45 + layerIndex) * 0.12 + Math.cos(row * 0.35) * 0.08;
    const topY = terrainY - layerIndex * layerDepth - fold;
    const bottomY = terrainY - (layerIndex + 1) * layerDepth - fold * 1.4;
    positions.push(x, topY, z, x, bottomY, z);
  };

  const addStrip = (points: Array<[number, number]>) => {
    const base = positions.length / 3;
    points.forEach(([row, col]) => pushEdgePoint(row, col));
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
      const material = new THREE.MeshStandardMaterial({
        color: layer.color,
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
