"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import styles from "./MapSelector.module.css";

export interface TerrainLayer {
  name: string;
  color: string;
  textureFile?: string;
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

interface TerrainDimensions {
  width: number;
  depth: number;
}

const maxPlanSize = 16;
const minPlanSize = 3.5;
const layerDepth = 1.25;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getTerrainDimensions(data: TerrainBlockData): TerrainDimensions {
  const midLat = (data.bounds.north + data.bounds.south) / 2;
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = Math.max(Math.cos((midLat * Math.PI) / 180), 0.05) * 111_320;
  const widthMeters = Math.max((data.bounds.east - data.bounds.west) * metersPerDegreeLng, 1);
  const depthMeters = Math.max((data.bounds.north - data.bounds.south) * metersPerDegreeLat, 1);
  const scale = maxPlanSize / Math.max(widthMeters, depthMeters);

  return {
    width: clamp(widthMeters * scale, minPlanSize, maxPlanSize),
    depth: clamp(depthMeters * scale, minPlanSize, maxPlanSize),
  };
}

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

function loadLithologyTexture(loader: THREE.TextureLoader, textureFile?: string) {
  if (!textureFile) return null;

  const texture = loader.load(`/api/lithology-texture/${textureFile}`);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3.5, 1.4);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildTerrainGeometry(data: TerrainBlockData, dimensions: TerrainDimensions) {
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
      const x = (col / (cols - 1) - 0.5) * dimensions.width;
      const z = (row / (rows - 1) - 0.5) * dimensions.depth;
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

function buildLayerSideGeometry(data: TerrainBlockData, layerIndex: number, dimensions: TerrainDimensions) {
  const rows = data.elevations.length;
  const cols = data.elevations[0]?.length ?? 0;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const pushEdgePoint = (row: number, col: number, u: number) => {
    const x = (col / (cols - 1) - 0.5) * dimensions.width;
    const z = (row / (rows - 1) - 0.5) * dimensions.depth;
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
    const dimensions = getTerrainDimensions(data);
    const planExtent = Math.max(dimensions.width, dimensions.depth);

    const camera = new THREE.PerspectiveCamera(42, mount.clientWidth / mount.clientHeight, 0.1, 100);
    camera.position.set(dimensions.width * 0.75 + 4, 8, dimensions.depth * 0.95 + 4);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, -0.6, 0);
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = Math.max(planExtent * 0.55, 7);
    controls.maxDistance = Math.max(planExtent * 2.1, 24);

    scene.add(new THREE.HemisphereLight("#ffffff", "#64748b", 2.3));

    const sun = new THREE.DirectionalLight("#fff7ea", 3.2);
    sun.position.set(-7, 12, 8);
    sun.castShadow = true;
    scene.add(sun);

    const terrain = new THREE.Mesh(
      buildTerrainGeometry(data, dimensions),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.82,
        metalness: 0.02,
      }),
    );
    terrain.castShadow = true;
    terrain.receiveShadow = true;
    scene.add(terrain);

    const textureLoader = new THREE.TextureLoader();
    const lithologyTextures: THREE.Texture[] = [];

    data.layers.forEach((layer, index) => {
      const texture = loadLithologyTexture(textureLoader, layer.textureFile);
      if (texture) lithologyTextures.push(texture);
      const material = new THREE.MeshStandardMaterial({
        color: layer.color,
        map: texture,
        roughness: 0.9,
        metalness: 0.02,
        side: THREE.DoubleSide,
      });
      const side = new THREE.Mesh(buildLayerSideGeometry(data, index, dimensions), material);
      side.receiveShadow = true;
      scene.add(side);
    });

    const bottom = new THREE.Mesh(
      new THREE.BoxGeometry(dimensions.width, 0.18, dimensions.depth),
      new THREE.MeshStandardMaterial({ color: "#4b3b32", roughness: 1 }),
    );
    bottom.position.y = -data.layers.length * layerDepth - 0.65;
    bottom.receiveShadow = true;
    scene.add(bottom);

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(dimensions.width, data.layers.length * layerDepth + 4.2, dimensions.depth));
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
      lithologyTextures.forEach((texture) => texture.dispose());
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
