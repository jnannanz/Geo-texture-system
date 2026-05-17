"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Download } from "lucide-react";
import type { Geometry } from "geojson";
import styles from "./MapSelector.module.css";

export interface TerrainLayer {
  name: string;
  color: string;
  textureFile?: string;
}

export interface SurfaceTextureOption {
  id: string;
  label: string;
  url: string;
  attribution?: string;
  provider?: "esri" | "mapbox";
}

export interface TerrainWaterFeature {
  geometry: Geometry;
  source?: "osm";
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
  surfaceTextureUrl?: string;
  surfaceTextureLabel?: string;
  surfaceAttribution?: string;
  surfaceTextures?: SurfaceTextureOption[];
  gridBaseTexture?: SurfaceTextureOption;
  waterFeatures?: TerrainWaterFeature[];
}

interface TerrainBlock3DProps {
  data: TerrainBlockData;
}

interface TerrainDimensions {
  width: number;
  depth: number;
  elevationScale: number;
  reliefHeight: number;
}

interface SurfaceTextureSettings {
  contrast: number;
  saturation: number;
  renderMode: SurfaceRenderMode;
  gridLineColor: string;
  gridFillColor: string;
  gridPatchColor: string;
  waterColor: string;
  waterOpacity: number;
  facetSize: number;
  verticalExaggeration: number;
}

type SunPreset = "dawn" | "morning" | "day" | "evening";
type ExportQuality = "normal" | "publication";
type SurfaceRenderMode = "photo" | "grid" | "hybrid";

const maxPlanSize = 16;
const minPlanSize = 3.5;
const layerDepth = 1.25;
const defaultTerrainVerticalExaggeration = 2.2;
const maxTerrainReliefHeight = 14;
const minVisibleTerrainReliefHeight = 0.18;
const bottomPlateThickness = 0.18;
const mantleDepthToLayerStackRatio = 1.55;
const mantleDominancePadding = 0.8;
const mantleMagmaTextureUrl = "/textures/mantle-magma-strip-seamless.png";
const mantleMagmaTextureAspect = 4;
const normalExportWidth = 3600;
const publicationExportWidth = 6000;
const normalExportTextureMaxSize = 2048;
const normalExportTextureMinSize = 1024;
const exportTextureMaxSize = 4096;
const exportTextureMinSize = 1536;
const mapboxStaticImageMaxSize = 1280;
const esriImageryTileUrl = "https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const maxEsriTextureZoom = 17;
const minEsriTextureZoom = 8;
const esriTileSize = 256;
const defaultSatelliteTextureContrast = 1.2;
const defaultSatelliteTextureSaturation = 1.38;
const satelliteTextureBrightness = 1.04;
const defaultSurfaceRenderMode: SurfaceRenderMode = "photo";
const defaultGridLineColor = "#7fbe73";
const defaultGridFillColor = "#f5fbef";
const defaultGridPatchColor = "#70b967";
const defaultWaterColor = "#60b96b";
const defaultWaterOpacity = 0.72;
const defaultFacetSize = 18;
const defaultSunPreset: SunPreset = "day";
const defaultSunIntensity = 3.2;

const sunPresets: Array<{ value: SunPreset; label: string; localHour: number; color: string }> = [
  { value: "dawn", label: "朝霞", localHour: 6.3, color: "#ff9a64" },
  { value: "morning", label: "清晨", localHour: 7.4, color: "#ffd4a3" },
  { value: "day", label: "白天", localHour: 12.2, color: "#fff7ea" },
  { value: "evening", label: "黄昏", localHour: 17.4, color: "#ffb07a" },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function degToRad(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function getDayOfYear(date: Date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((current - start) / 86_400_000);
}

function getSunLightPosition(data: TerrainBlockData, preset: SunPreset, planExtent: number, blockHeight: number) {
  const latitude = (data.bounds.north + data.bounds.south) / 2;
  const longitude = (data.bounds.east + data.bounds.west) / 2;
  const presetConfig = sunPresets.find((option) => option.value === preset) ?? sunPresets[1];
  const date = new Date();
  const dayOfYear = getDayOfYear(date);
  const localHour = presetConfig.localHour;
  const fractionalYear = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (localHour - 12) / 24);
  const equationOfTime = 229.18 * (
    0.000075 +
    0.001868 * Math.cos(fractionalYear) -
    0.032077 * Math.sin(fractionalYear) -
    0.014615 * Math.cos(2 * fractionalYear) -
    0.040849 * Math.sin(2 * fractionalYear)
  );
  const declination =
    0.006918 -
    0.399912 * Math.cos(fractionalYear) +
    0.070257 * Math.sin(fractionalYear) -
    0.006758 * Math.cos(2 * fractionalYear) +
    0.000907 * Math.sin(2 * fractionalYear) -
    0.002697 * Math.cos(3 * fractionalYear) +
    0.00148 * Math.sin(3 * fractionalYear);
  const estimatedTimezone = Math.round(longitude / 15);
  const solarTimeOffset = equationOfTime + 4 * longitude - 60 * estimatedTimezone;
  const trueSolarMinutes = (localHour * 60 + solarTimeOffset + 1440) % 1440;
  let hourAngle = degToRad(trueSolarMinutes / 4 - 180);
  if (hourAngle < -Math.PI) hourAngle += Math.PI * 2;

  const latitudeRad = degToRad(latitude);
  const sinElevation =
    Math.sin(latitudeRad) * Math.sin(declination) +
    Math.cos(latitudeRad) * Math.cos(declination) * Math.cos(hourAngle);
  const minElevation = preset === "day" ? degToRad(26) : preset === "dawn" ? degToRad(5) : degToRad(8);
  const elevation = clamp(Math.asin(clamp(sinElevation, -1, 1)), minElevation, degToRad(82));
  const azimuth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latitudeRad) - Math.tan(declination) * Math.cos(latitudeRad),
  ) + Math.PI;
  const horizontal = Math.cos(elevation);
  const distance = Math.max(planExtent * 2.8, blockHeight * 1.6, 16);

  return new THREE.Vector3(
    Math.sin(azimuth) * horizontal * distance,
    Math.sin(elevation) * distance,
    -Math.cos(azimuth) * horizontal * distance,
  );
}

function getSunLightColor(preset: SunPreset) {
  return sunPresets.find((option) => option.value === preset)?.color ?? "#fff7ea";
}

function getTerrainDimensions(data: TerrainBlockData, verticalExaggeration: number): TerrainDimensions {
  const midLat = (data.bounds.north + data.bounds.south) / 2;
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = Math.max(Math.cos((midLat * Math.PI) / 180), 0.05) * 111_320;
  const widthMeters = Math.max((data.bounds.east - data.bounds.west) * metersPerDegreeLng, 1);
  const depthMeters = Math.max((data.bounds.north - data.bounds.south) * metersPerDegreeLat, 1);
  const scale = maxPlanSize / Math.max(widthMeters, depthMeters);
  const elevationRange = Math.max(data.maxElevation - data.minElevation, 0);
  const proportionalRelief = elevationRange * scale * verticalExaggeration;
  const reliefLimit = Math.min(maxTerrainReliefHeight, Math.max(1.4, verticalExaggeration * 2.4));
  const reliefHeight = elevationRange > 0
    ? clamp(proportionalRelief, minVisibleTerrainReliefHeight, reliefLimit)
    : 0;

  return {
    width: clamp(widthMeters * scale, minPlanSize, maxPlanSize),
    depth: clamp(depthMeters * scale, minPlanSize, maxPlanSize),
    elevationScale: elevationRange > 0 ? reliefHeight / elevationRange : 0,
    reliefHeight,
  };
}

function normalizedElevation(data: TerrainBlockData, dimensions: TerrainDimensions, elevation: number) {
  return (elevation - data.minElevation) * dimensions.elevationScale;
}

function elevationRatio(data: TerrainBlockData, elevation: number) {
  const range = Math.max(data.maxElevation - data.minElevation, 1);
  return (elevation - data.minElevation) / range;
}

function layerBoundaryY(data: TerrainBlockData, dimensions: TerrainDimensions, row: number, col: number, boundaryIndex: number) {
  const terrainY = normalizedElevation(data, dimensions, data.elevations[row][col]);
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

function configureSurfaceTexture(texture: THREE.Texture, maxAnisotropy: number) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = Math.min(maxAnisotropy, 8);
}

function normalizedMercatorX(lng: number) {
  return (lng + 180) / 360;
}

function normalizedMercatorYForTexture(lat: number) {
  const clampedLat = Math.min(Math.max(lat, -85.05112878), 85.05112878);
  return (1 - Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360)) / Math.PI) / 2;
}

function getSurfaceTextureSize(bounds: TerrainBlockData["bounds"], maxSize: number) {
  const xSpan = Math.max(Math.abs(((bounds.east - bounds.west) * Math.PI) / 180), 0.000001);
  const ySpan = Math.max(
    Math.abs(normalizedMercatorYForTexture(bounds.south) - normalizedMercatorYForTexture(bounds.north)) * Math.PI * 2,
    0.000001,
  );
  const aspect = xSpan / ySpan;

  if (aspect >= 1) {
    return {
      width: maxSize,
      height: Math.round(clamp(maxSize / aspect, 256, maxSize)),
    };
  }

  return {
    width: Math.round(clamp(maxSize * aspect, 256, maxSize)),
    height: maxSize,
  };
}

function chooseEsriTextureZoom(bounds: TerrainBlockData["bounds"], targetWidth: number, targetHeight: number) {
  const westX = normalizedMercatorX(bounds.west);
  const eastX = normalizedMercatorX(bounds.east);
  const northY = normalizedMercatorYForTexture(bounds.north);
  const southY = normalizedMercatorYForTexture(bounds.south);
  const xSpan = Math.max(eastX - westX, 0.000001);
  const ySpan = Math.max(southY - northY, 0.000001);
  const requiredScale = Math.max(targetWidth / xSpan, targetHeight / ySpan);
  return clamp(Math.ceil(Math.log2(requiredScale / 256)), minEsriTextureZoom, maxEsriTextureZoom);
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

async function buildEsriImageryTextureDataUrl(bounds: TerrainBlockData["bounds"], maxTextureSize: number) {
  const { width, height } = getSurfaceTextureSize(bounds, maxTextureSize);
  const zoom = chooseEsriTextureZoom(bounds, width, height);
  const tileCount = 2 ** zoom;
  const westWorld = normalizedMercatorX(bounds.west) * tileCount;
  const eastWorld = normalizedMercatorX(bounds.east) * tileCount;
  const northWorld = normalizedMercatorYForTexture(bounds.north) * tileCount;
  const southWorld = normalizedMercatorYForTexture(bounds.south) * tileCount;
  const minTileX = Math.floor(westWorld);
  const maxTileX = Math.ceil(eastWorld) - 1;
  const minTileY = Math.floor(northWorld);
  const maxTileY = Math.ceil(southWorld) - 1;
  const mosaicWidth = Math.max((maxTileX - minTileX + 1) * esriTileSize, esriTileSize);
  const mosaicHeight = Math.max((maxTileY - minTileY + 1) * esriTileSize, esriTileSize);
  const mosaicCanvas = document.createElement("canvas");
  mosaicCanvas.width = mosaicWidth;
  mosaicCanvas.height = mosaicHeight;
  const mosaicContext = mosaicCanvas.getContext("2d");
  if (!mosaicContext) return undefined;

  mosaicContext.fillStyle = "#d8e0d2";
  mosaicContext.fillRect(0, 0, mosaicWidth, mosaicHeight);
  mosaicContext.imageSmoothingEnabled = false;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return undefined;

  context.fillStyle = "#d8e0d2";
  context.fillRect(0, 0, width, height);

  const tileJobs: Promise<void>[] = [];

  for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
    for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
      const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
      if (tileY < 0 || tileY >= tileCount) continue;

      const url = esriImageryTileUrl
        .replace("{z}", String(zoom))
        .replace("{y}", String(tileY))
        .replace("{x}", String(wrappedX));

      tileJobs.push(loadImage(url).then((image) => {
        const left = (tileX - minTileX) * esriTileSize;
        const top = (tileY - minTileY) * esriTileSize;
        mosaicContext.drawImage(image, left, top, esriTileSize, esriTileSize);
      }).catch(() => undefined));
    }
  }

  await Promise.all(tileJobs);

  const sourceX = (westWorld - minTileX) * esriTileSize;
  const sourceY = (northWorld - minTileY) * esriTileSize;
  const sourceWidth = Math.min(Math.max((eastWorld - westWorld) * esriTileSize, 1), mosaicWidth - sourceX);
  const sourceHeight = Math.min(Math.max((southWorld - northWorld) * esriTileSize, 1), mosaicHeight - sourceY);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    mosaicCanvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    width,
    height,
  );

  try {
    return canvas.toDataURL("image/png");
  } catch {
    return undefined;
  }
}

function buildMapboxExportTextureUrl(option: SurfaceTextureOption, bounds: TerrainBlockData["bounds"], maxTextureSize: number) {
  const url = new URL(option.url);
  const styleMatch = url.pathname.match(/\/styles\/v1\/([^/]+\/[^/]+)\/static\//);
  const stylePath = styleMatch?.[1];
  const token = url.searchParams.get("access_token");
  if (!stylePath || !token) return option.url;

  const { width, height } = getSurfaceTextureSize(bounds, Math.min(Math.ceil(maxTextureSize / 2), mapboxStaticImageMaxSize));
  const bbox = `[${bounds.west},${bounds.south},${bounds.east},${bounds.north}]`;
  const params = new URLSearchParams({
    access_token: token,
    attribution: "false",
    logo: "false",
  });

  return `https://api.mapbox.com/styles/v1/${stylePath}/static/${bbox}/${width}x${height}@2x?${params.toString()}`;
}

async function buildExportSurfaceTextureUrl(
  option: SurfaceTextureOption,
  bounds: TerrainBlockData["bounds"],
  exportWidth: number,
  exportHeight: number,
  textureMinSize: number,
  textureMaxSize: number,
) {
  const requestedMaxSize = clamp(
    Math.ceil(Math.max(exportWidth, exportHeight) * 0.75),
    textureMinSize,
    textureMaxSize,
  );

  if (option.provider === "esri" || option.id === "esri") {
    return await buildEsriImageryTextureDataUrl(bounds, requestedMaxSize) ?? option.url;
  }

  if (option.provider === "mapbox" || option.id === "mapbox") {
    return buildMapboxExportTextureUrl(option, bounds, requestedMaxSize);
  }

  return option.url;
}

function loadThreeTexture(url: string) {
  return new Promise<THREE.Texture>((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(url, resolve, undefined, reject);
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

function composeExportCanvas(sourceCanvas: HTMLCanvasElement, data: TerrainBlockData, activeSurfaceTexture?: SurfaceTextureOption) {
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = sourceCanvas.width;
  outputCanvas.height = sourceCanvas.height;
  const context = outputCanvas.getContext("2d");
  if (!context) return sourceCanvas;

  context.drawImage(sourceCanvas, 0, 0);
  drawExportLegend(outputCanvas, data, activeSurfaceTexture);
  return outputCanvas;
}

function getExportLegendItems(data: TerrainBlockData, activeSurfaceTexture?: SurfaceTextureOption) {
  return [
    ...(activeSurfaceTexture ? [{
      color: "#69784a",
      label: `地表卫星贴图 · ${activeSurfaceTexture.label}`,
    }] : []),
    ...data.layers.map((layer) => ({
      color: layer.color,
      label: layer.name,
    })),
  ];
}

function drawRoundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function drawExportLegend(canvas: HTMLCanvasElement, data: TerrainBlockData, activeSurfaceTexture?: SurfaceTextureOption) {
  const context = canvas.getContext("2d");
  if (!context) return;

  const items = getExportLegendItems(data, activeSurfaceTexture);
  if (!items.length) return;

  const scale = Math.max(canvas.width / 1600, 1);
  const paddingX = 18 * scale;
  const paddingY = 13 * scale;
  const gap = 15 * scale;
  const swatchSize = 18 * scale;
  const radius = 10 * scale;
  const margin = 30 * scale;
  const fontSize = 22 * scale;
  const borderWidth = Math.max(1, 1.2 * scale);

  context.save();
  context.font = `700 ${fontSize}px Arial, sans-serif`;
  const itemWidths = items.map((item) => swatchSize + 8 * scale + context.measureText(item.label).width);
  const contentWidth = itemWidths.reduce((sum, width) => sum + width, 0) + gap * Math.max(items.length - 1, 0);
  const boxWidth = contentWidth + paddingX * 2;
  const boxHeight = Math.max(swatchSize, fontSize) + paddingY * 2;
  const x = margin;
  const y = canvas.height - margin - boxHeight;

  context.fillStyle = "rgba(255, 255, 255, 0.86)";
  context.strokeStyle = "rgba(15, 23, 42, 0.16)";
  context.lineWidth = borderWidth;
  drawRoundedRect(context, x, y, boxWidth, boxHeight, radius);
  context.fill();
  context.stroke();

  let cursorX = x + paddingX;
  const centerY = y + boxHeight / 2;
  items.forEach((item, index) => {
    const swatchY = centerY - swatchSize / 2;
    context.fillStyle = item.color;
    drawRoundedRect(context, cursorX, swatchY, swatchSize, swatchSize, 3 * scale);
    context.fill();
    context.strokeStyle = "rgba(15, 23, 42, 0.22)";
    context.lineWidth = borderWidth;
    context.stroke();

    context.fillStyle = "#17202a";
    context.textBaseline = "middle";
    context.fillText(item.label, cursorX + swatchSize + 8 * scale, centerY + 0.5 * scale);
    cursorX += itemWidths[index] + gap;
  });

  context.restore();
}

function parseHexColor(hex: string) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized.padEnd(6, "0").slice(0, 6);

  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ] as const;
}

function mixChannel(a: number, b: number, amount: number) {
  return a + (b - a) * amount;
}

function getLuma(pixels: Uint8ClampedArray, index: number) {
  return pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
}

function blendPixel(pixels: Uint8ClampedArray, index: number, color: readonly number[], opacity: number) {
  pixels[index] = clamp(mixChannel(pixels[index], color[0], opacity), 0, 255);
  pixels[index + 1] = clamp(mixChannel(pixels[index + 1], color[1], opacity), 0, 255);
  pixels[index + 2] = clamp(mixChannel(pixels[index + 2], color[2], opacity), 0, 255);
}

function getElevationAtGrid(data: TerrainBlockData, row: number, col: number) {
  const rows = data.elevations.length;
  const cols = data.elevations[0]?.length ?? 0;
  const safeRow = clamp(Math.round(row), 0, rows - 1);
  const safeCol = clamp(Math.round(col), 0, cols - 1);
  return data.elevations[safeRow]?.[safeCol] ?? data.minElevation;
}

function getTerrainGridField(data: TerrainBlockData, xRatio: number, yRatio: number) {
  const rows = data.elevations.length;
  const cols = data.elevations[0]?.length ?? 0;
  if (rows < 2 || cols < 2) return { angle: 0, slope: 0 };

  const row = yRatio * (rows - 1);
  const col = xRatio * (cols - 1);
  const left = getElevationAtGrid(data, row, col - 1);
  const right = getElevationAtGrid(data, row, col + 1);
  const up = getElevationAtGrid(data, row - 1, col);
  const down = getElevationAtGrid(data, row + 1, col);
  const range = Math.max(data.maxElevation - data.minElevation, 1);
  const dx = (right - left) / range;
  const dy = (down - up) / range;
  const slope = clamp(Math.hypot(dx, dy) * 3.6, 0, 1);
  const angle = Math.atan2(dy, dx) + Math.PI / 2;

  return { angle, slope };
}

function getElevationRatioAt(data: TerrainBlockData, xRatio: number, yRatio: number) {
  const rows = data.elevations.length;
  const cols = data.elevations[0]?.length ?? 0;
  if (rows < 1 || cols < 1) return 0;

  const elevation = getElevationAtGrid(data, yRatio * (rows - 1), xRatio * (cols - 1));
  return clamp((elevation - data.minElevation) / Math.max(data.maxElevation - data.minElevation, 1), 0, 1);
}

function getWaterScore(red: number, green: number, blue: number, luma: number) {
  const cyanRiver = clamp((blue * 0.72 + green * 0.92 - red * 1.28 - 44) / 116, 0, 1);
  const brightMapWater = clamp((green + blue - red * 1.52 - 126) / 118, 0, 1);
  const blueWater = clamp((blue * 1.12 - red * 1.16 + green * 0.24 - 32) / 108, 0, 1);
  const darkWater = clamp((128 - luma) / 92, 0, 1) * clamp((blue + green - red * 1.68 - 18) / 116, 0, 1);
  return clamp(Math.max(cyanRiver, brightMapWater, blueWater, darkWater), 0, 1);
}

function isLngLatPosition(value: unknown): value is [number, number, ...number[]] {
  return Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number";
}

function projectLngLatToTexture(
  position: [number, number, ...number[]],
  bounds: TerrainBlockData["bounds"],
  width: number,
  height: number,
) {
  const westX = normalizedMercatorX(bounds.west);
  const eastX = normalizedMercatorX(bounds.east);
  const northY = normalizedMercatorYForTexture(bounds.north);
  const southY = normalizedMercatorYForTexture(bounds.south);
  const xRatio = (normalizedMercatorX(position[0]) - westX) / Math.max(eastX - westX, 0.000001);
  const yRatio = (normalizedMercatorYForTexture(position[1]) - northY) / Math.max(southY - northY, 0.000001);

  return {
    x: xRatio * width,
    y: yRatio * height,
  };
}

function drawLineStringToTexture(
  context: CanvasRenderingContext2D,
  coordinates: unknown,
  data: TerrainBlockData,
  width: number,
  height: number,
) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return;

  coordinates.forEach((position, index) => {
    if (!isLngLatPosition(position)) return;
    const point = projectLngLatToTexture(position, data.bounds, width, height);
    if (index === 0) {
      context.moveTo(point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
  });
}

function drawPolygonToTexture(
  context: CanvasRenderingContext2D,
  coordinates: unknown,
  data: TerrainBlockData,
  width: number,
  height: number,
) {
  if (!Array.isArray(coordinates)) return;

  coordinates.forEach((ring) => {
    if (!Array.isArray(ring) || ring.length < 3) return;
    ring.forEach((position, index) => {
      if (!isLngLatPosition(position)) return;
      const point = projectLngLatToTexture(position, data.bounds, width, height);
      if (index === 0) {
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    });
    context.closePath();
  });
}

function drawWaterFeatures(
  context: CanvasRenderingContext2D,
  data: TerrainBlockData,
  width: number,
  height: number,
  color: string,
  opacity: number,
) {
  if (!data.waterFeatures?.length) return;

  context.save();
  context.globalAlpha = opacity;
  context.fillStyle = color;
  context.strokeStyle = color;
  context.lineWidth = clamp(Math.min(width, height) * 0.0038, 1.2, 6);
  context.lineCap = "round";
  context.lineJoin = "round";

  data.waterFeatures.forEach((feature) => {
    const { geometry } = feature;
    context.beginPath();

    if (geometry.type === "Polygon") {
      drawPolygonToTexture(context, geometry.coordinates, data, width, height);
      context.fill("evenodd");
      return;
    }

    if (geometry.type === "MultiPolygon") {
      geometry.coordinates.forEach((polygon) => drawPolygonToTexture(context, polygon, data, width, height));
      context.fill("evenodd");
      return;
    }

    if (geometry.type === "LineString") {
      drawLineStringToTexture(context, geometry.coordinates, data, width, height);
      context.stroke();
      return;
    }

    if (geometry.type === "MultiLineString") {
      geometry.coordinates.forEach((line) => drawLineStringToTexture(context, line, data, width, height));
      context.stroke();
    }
  });

  context.restore();
}

function drawDetectedWaterOverlay(
  context: CanvasRenderingContext2D,
  sourcePixels: Uint8ClampedArray,
  width: number,
  height: number,
  color: string,
  opacity: number,
) {
  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const waterColor = parseHexColor(color);

  for (let index = 0; index < pixels.length; index += 4) {
    const red = sourcePixels[index];
    const green = sourcePixels[index + 1];
    const blue = sourcePixels[index + 2];
    const luma = getLuma(sourcePixels, index);
    const waterScore = getWaterScore(red, green, blue, luma);
    if (waterScore <= 0.2) continue;

    const waterOpacity = clamp((waterScore - 0.2) / 0.8, 0, 1) * opacity * 0.45;
    blendPixel(pixels, index, waterColor, waterOpacity);
  }

  context.putImageData(imageData, 0, 0);
}

function drawTerrainFacets(
  context: CanvasRenderingContext2D,
  data: TerrainBlockData,
  width: number,
  height: number,
  settings: SurfaceTextureSettings,
) {
  const lineColor = settings.gridLineColor;
  const fillColor = settings.gridFillColor;
  const patchColor = settings.gridPatchColor;
  const exaggerationRatio = clamp(settings.verticalExaggeration / defaultTerrainVerticalExaggeration, 0.45, 2.2);
  const step = clamp(settings.facetSize * (1.08 - exaggerationRatio * 0.08), 8, 42);
  const cols = Math.ceil(width / step) + 2;
  const rows = Math.ceil(height / step) + 2;
  const originX = -step;
  const originY = -step;
  const fillOpacity = settings.renderMode === "grid" ? 0.34 : 0.08;
  const patchOpacityBase = settings.renderMode === "grid" ? 0.24 : 0.1;
  const strokeOpacityBase = settings.renderMode === "grid" ? 0.62 : 0.36;

  const pointAt = (row: number, col: number) => {
    const baseX = originX + col * step;
    const baseY = originY + row * step;
    const xRatio = clamp(baseX / Math.max(width, 1), 0, 1);
    const yRatio = clamp(baseY / Math.max(height, 1), 0, 1);
    const terrainField = getTerrainGridField(data, xRatio, yRatio);
    const elevationRatio = getElevationRatioAt(data, xRatio, yRatio);
    const contourAngle = terrainField.angle;
    const slopeAngle = contourAngle - Math.PI / 2;
    const band = Math.sin(elevationRatio * Math.PI * (7.5 + exaggerationRatio * 3.2) + col * 0.18);
    const terrace = Math.sin((baseX * Math.cos(contourAngle) + baseY * Math.sin(contourAngle)) / Math.max(step * 2.15, 1));
    const terrainCompression = terrainField.slope * step * (0.45 + exaggerationRatio * 0.48);
    const contourShift = (band * 0.42 + terrace * 0.3) * terrainCompression;
    const slopeShift = Math.sin(elevationRatio * Math.PI * 5.5 + row * 0.22) * terrainField.slope * step * 0.32 * exaggerationRatio;
    const microJitter = (
      Math.sin(row * 12.9898 + col * 78.233) +
      Math.cos(row * 37.719 + col * 19.17)
    ) * step * 0.025 * (1 + terrainField.slope);

    return {
      x:
        baseX +
        Math.cos(contourAngle) * contourShift +
        Math.cos(slopeAngle) * slopeShift +
        microJitter,
      y:
        baseY +
        Math.sin(contourAngle) * contourShift +
        Math.sin(slopeAngle) * slopeShift +
        microJitter * 0.45,
    };
  };

  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";

  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const p00 = pointAt(row, col);
      const p10 = pointAt(row, col + 1);
      const p11 = pointAt(row + 1, col + 1);
      const p01 = pointAt(row + 1, col);
      const centerXRatio = clamp((p00.x + p10.x + p11.x + p01.x) / 4 / Math.max(width, 1), 0, 1);
      const centerYRatio = clamp((p00.y + p10.y + p11.y + p01.y) / 4 / Math.max(height, 1), 0, 1);
      const terrainField = getTerrainGridField(data, centerXRatio, centerYRatio);
      const elevationRatio = getElevationRatioAt(data, centerXRatio, centerYRatio);
      const bandStrength = Math.abs(Math.sin(elevationRatio * Math.PI * (8 + exaggerationRatio * 3)));
      const patchOpacity = patchOpacityBase * (0.22 + elevationRatio * 0.24 + terrainField.slope * 0.72 + bandStrength * 0.28) * exaggerationRatio;
      const strokeOpacity = clamp(strokeOpacityBase * (0.58 + terrainField.slope * 1.05 + bandStrength * 0.32) * exaggerationRatio, 0.16, 0.9);

      context.beginPath();
      context.moveTo(p00.x, p00.y);
      context.lineTo(p10.x, p10.y);
      context.lineTo(p11.x, p11.y);
      context.lineTo(p01.x, p01.y);
      context.closePath();

      if (fillOpacity > 0) {
        context.globalAlpha = fillOpacity;
        context.fillStyle = fillColor;
        context.fill();
      }

      context.globalAlpha = clamp(patchOpacity, 0, 0.42);
      context.fillStyle = patchColor;
      context.fill();

      context.globalAlpha = strokeOpacity;
      context.strokeStyle = lineColor;
      context.lineWidth = clamp(0.55 + (terrainField.slope * 0.92 + bandStrength * 0.24) * exaggerationRatio, 0.55, 1.9);
      context.stroke();
    }
  }

  context.restore();
}

function renderSurfaceTexture(
  sourceTexture: THREE.Texture,
  maxAnisotropy: number,
  settings: SurfaceTextureSettings,
  data: TerrainBlockData,
) {
  const image = sourceTexture.image as CanvasImageSource & {
    width?: number;
    height?: number;
    naturalWidth?: number;
    naturalHeight?: number;
  };
  const width = image.naturalWidth ?? image.width ?? 0;
  const height = image.naturalHeight ?? image.height ?? 0;
  if (!width || !height) return sourceTexture;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return sourceTexture;

  try {
    context.drawImage(image, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    const sourcePixels = new Uint8ClampedArray(pixels);
    const fillColor = parseHexColor(settings.gridFillColor);
    const patchColor = parseHexColor(settings.gridPatchColor);

    for (let index = 0; index < pixels.length; index += 4) {
      let red = pixels[index] * satelliteTextureBrightness;
      let green = pixels[index + 1] * satelliteTextureBrightness;
      let blue = pixels[index + 2] * satelliteTextureBrightness;
      const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;

      red = luma + (red - luma) * settings.saturation;
      green = luma + (green - luma) * settings.saturation;
      blue = luma + (blue - luma) * settings.saturation;

      pixels[index] = clamp((red - 128) * settings.contrast + 128, 0, 255);
      pixels[index + 1] = clamp((green - 128) * settings.contrast + 128, 0, 255);
      pixels[index + 2] = clamp((blue - 128) * settings.contrast + 128, 0, 255);
    }

    if (settings.renderMode !== "photo") {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const index = (y * width + x) * 4;
          const red = sourcePixels[index];
          const green = sourcePixels[index + 1];
          const blue = sourcePixels[index + 2];
          const luma = getLuma(sourcePixels, index);
          const xRatio = x / Math.max(width - 1, 1);
          const yRatio = y / Math.max(height - 1, 1);
          const terrainField = getTerrainGridField(data, xRatio, yRatio);
          const elevationRatio = getElevationRatioAt(data, xRatio, yRatio);
          const greenScore = clamp((green - red * 0.42 - blue * 0.28 + 34) / 118, 0, 1);
          const waterScore = getWaterScore(red, green, blue, luma);
          const patchAmount = clamp(
            greenScore * 0.28 + elevationRatio * 0.22 + terrainField.slope * 0.34 - waterScore * 0.45,
            0,
            0.72,
          );

          if (settings.renderMode === "grid") {
            blendPixel(pixels, index, fillColor, 0.68);
            blendPixel(pixels, index, patchColor, patchAmount * 0.32);
          } else {
            blendPixel(pixels, index, patchColor, patchAmount * 0.16);
          }
        }
      }
    }

    context.putImageData(imageData, 0, 0);
    if (settings.renderMode !== "photo") {
      drawTerrainFacets(context, data, width, height, settings);
      drawDetectedWaterOverlay(context, sourcePixels, width, height, settings.waterColor, settings.waterOpacity);
      drawWaterFeatures(context, data, width, height, settings.waterColor, settings.waterOpacity);
    }
    const enhancedTexture = new THREE.CanvasTexture(canvas);
    configureSurfaceTexture(enhancedTexture, maxAnisotropy);
    return enhancedTexture;
  } catch {
    return sourceTexture;
  }
}

function configureMantleTexture(texture: THREE.Texture, maxAnisotropy: number) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.min(maxAnisotropy, 8);
}

function buildTerrainGeometry(data: TerrainBlockData, dimensions: TerrainDimensions) {
  const rows = data.elevations.length;
  const cols = data.elevations[0]?.length ?? 0;
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const low = new THREE.Color("#526a35");
  const mid = new THREE.Color("#8fb752");
  const high = new THREE.Color("#3d4650");

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = (col / (cols - 1) - 0.5) * dimensions.width;
      const z = (row / (rows - 1) - 0.5) * dimensions.depth;
      const y = normalizedElevation(data, dimensions, data.elevations[row][col]);
      const t = elevationRatio(data, data.elevations[row][col]);
      const color = t < 0.58
        ? low.clone().lerp(mid, t / 0.58)
        : mid.clone().lerp(high, (t - 0.58) / 0.42);

      positions.push(x, y, z);
      colors.push(color.r, color.g, color.b);
      uvs.push(col / (cols - 1), 1 - row / (rows - 1));
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
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
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
    const topY = layerBoundaryY(data, dimensions, row, col, layerIndex);
    const bottomY = layerBoundaryY(data, dimensions, row, col, layerIndex + 1);
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

function buildMantleMagmaSideGeometry(data: TerrainBlockData, dimensions: TerrainDimensions, bottomY: number) {
  const rows = data.elevations.length;
  const cols = data.elevations[0]?.length ?? 0;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const edgePoints: Array<[number, number]> = [
    ...Array.from({ length: cols }, (_, col): [number, number] => [0, col]),
    ...Array.from({ length: rows - 1 }, (_, index): [number, number] => [index + 1, cols - 1]),
    ...Array.from({ length: cols - 1 }, (_, index): [number, number] => [rows - 1, cols - 2 - index]),
    ...Array.from({ length: rows - 2 }, (_, index): [number, number] => [rows - 2 - index, 0]),
  ];

  const pointToPosition = ([row, col]: [number, number]) => new THREE.Vector3(
    (col / (cols - 1) - 0.5) * dimensions.width,
    layerBoundaryY(data, dimensions, row, col, data.layers.length),
    (row / (rows - 1) - 0.5) * dimensions.depth,
  );

  const topPositions = edgePoints.map(pointToPosition);
  const cumulativeDistances = [0];
  for (let i = 1; i <= topPositions.length; i++) {
    const previous = topPositions[i - 1];
    const current = topPositions[i % topPositions.length];
    cumulativeDistances.push(cumulativeDistances[i - 1] + previous.distanceTo(current));
  }

  const perimeter = Math.max(cumulativeDistances[cumulativeDistances.length - 1], 1);
  const averageMantleHeight = topPositions.reduce((sum, position) => sum + Math.max(position.y - bottomY, 0), 0) / Math.max(topPositions.length, 1);
  const horizontalRepeats = Math.max(1, Math.round(perimeter / Math.max(averageMantleHeight * mantleMagmaTextureAspect, 1)));
  const verticalRepeats = 1;
  const closedPositions = [...topPositions, topPositions[0]];

  closedPositions.forEach((position, index) => {
    const u = (cumulativeDistances[index] / perimeter) * horizontalRepeats;
    positions.push(position.x, position.y, position.z, position.x, bottomY, position.z);
    uvs.push(u, 0, u, verticalRepeats);
  });

  for (let i = 0; i < closedPositions.length - 1; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, b, c, c, b, d);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export default function TerrainBlock3D({ data }: TerrainBlock3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const surfaceMaterialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const surfaceSourceTextureRef = useRef<THREE.Texture | null>(null);
  const enhancedSurfaceTextureRef = useRef<THREE.Texture | null>(null);
  const maxAnisotropyRef = useRef(1);
  const viewStateRef = useRef<{
    data: TerrainBlockData;
    position: THREE.Vector3;
    target: THREE.Vector3;
  } | null>(null);
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
  const sunContextRef = useRef({ planExtent: maxPlanSize, blockHeight: maxPlanSize });
  const sunPresetRef = useRef<SunPreset>(defaultSunPreset);
  const sunIntensityRef = useRef(defaultSunIntensity);
  const surfaceContrastRef = useRef(defaultSatelliteTextureContrast);
  const surfaceSaturationRef = useRef(defaultSatelliteTextureSaturation);
  const surfaceRenderModeRef = useRef<SurfaceRenderMode>(defaultSurfaceRenderMode);
  const gridLineColorRef = useRef(defaultGridLineColor);
  const gridFillColorRef = useRef(defaultGridFillColor);
  const gridPatchColorRef = useRef(defaultGridPatchColor);
  const waterColorRef = useRef(defaultWaterColor);
  const waterOpacityRef = useRef(defaultWaterOpacity);
  const facetSizeRef = useRef(defaultFacetSize);
  const [verticalExaggeration, setVerticalExaggeration] = useState(defaultTerrainVerticalExaggeration);
  const [surfaceContrast, setSurfaceContrast] = useState(defaultSatelliteTextureContrast);
  const [surfaceSaturation, setSurfaceSaturation] = useState(defaultSatelliteTextureSaturation);
  const [surfaceRenderMode, setSurfaceRenderMode] = useState<SurfaceRenderMode>(defaultSurfaceRenderMode);
  const [gridLineColor, setGridLineColor] = useState(defaultGridLineColor);
  const [gridFillColor, setGridFillColor] = useState(defaultGridFillColor);
  const [gridPatchColor, setGridPatchColor] = useState(defaultGridPatchColor);
  const [waterColor, setWaterColor] = useState(defaultWaterColor);
  const [waterOpacity, setWaterOpacity] = useState(defaultWaterOpacity);
  const [facetSize, setFacetSize] = useState(defaultFacetSize);
  const [sunPreset, setSunPreset] = useState<SunPreset>(defaultSunPreset);
  const [sunIntensity, setSunIntensity] = useState(defaultSunIntensity);
  const [exportQuality, setExportQuality] = useState<ExportQuality | null>(null);
  const surfaceTextureOptions = useMemo(() => (
    data.surfaceTextures?.length
      ? data.surfaceTextures
      : data.surfaceTextureUrl
        ? [{
            id: "surface",
            label: data.surfaceTextureLabel ?? "地表卫星贴图",
            url: data.surfaceTextureUrl,
            attribution: data.surfaceAttribution,
          }]
        : []
  ), [data.surfaceAttribution, data.surfaceTextureLabel, data.surfaceTextureUrl, data.surfaceTextures]);
  const [activeSurfaceTextureId, setActiveSurfaceTextureId] = useState(surfaceTextureOptions[0]?.id ?? "");
  const activeSurfaceTexture = surfaceTextureOptions.find((option) => option.id === activeSurfaceTextureId) ?? surfaceTextureOptions[0];
  const renderSurfaceTextureOption =
    surfaceRenderMode === "grid" && data.gridBaseTexture
      ? data.gridBaseTexture
      : activeSurfaceTexture;

  const applySurfaceTextureSettings = useCallback((settings: SurfaceTextureSettings) => {
    const surfaceMaterial = surfaceMaterialRef.current;
    const sourceTexture = surfaceSourceTextureRef.current;
    if (!surfaceMaterial || !sourceTexture) return;

    const previousTexture = enhancedSurfaceTextureRef.current;
    const nextTexture = renderSurfaceTexture(sourceTexture, maxAnisotropyRef.current, settings, data);
    if (nextTexture === sourceTexture) {
      configureSurfaceTexture(sourceTexture, maxAnisotropyRef.current);
    }

    enhancedSurfaceTextureRef.current = nextTexture;
    surfaceMaterial.map = nextTexture;
    surfaceMaterial.vertexColors = false;
    surfaceMaterial.color.set("#ffffff");
    surfaceMaterial.needsUpdate = true;

    if (previousTexture && previousTexture !== sourceTexture && previousTexture !== nextTexture) {
      previousTexture.dispose();
    }
  }, [data]);

  const updateSunPreset = (preset: SunPreset) => {
    sunPresetRef.current = preset;
    setSunPreset(preset);
  };

  const updateSunIntensity = (intensity: number) => {
    sunIntensityRef.current = intensity;
    setSunIntensity(intensity);
  };

  const exportImage = async (quality: ExportQuality) => {
    const mount = mountRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const surfaceMaterial = surfaceMaterialRef.current;
    if (!mount || !renderer || !scene || !camera || exportQuality) return;

    const screenWidth = Math.max(mount.clientWidth, 1);
    const screenHeight = Math.max(mount.clientHeight, 1);
    const exportWidth = quality === "publication" ? publicationExportWidth : normalExportWidth;
    const exportHeight = Math.round((exportWidth * screenHeight) / screenWidth);
    const textureMinSize = quality === "publication" ? exportTextureMinSize : normalExportTextureMinSize;
    const textureMaxSize = quality === "publication" ? exportTextureMaxSize : normalExportTextureMaxSize;
    const previousPixelRatio = renderer.getPixelRatio();
    const previousAspect = camera.aspect;
    const previousSurfaceMap = surfaceMaterial?.map ?? null;
    const previousSurfaceVertexColors = surfaceMaterial?.vertexColors ?? true;
    const previousSurfaceColor = surfaceMaterial?.color.clone();
    let exportSourceTexture: THREE.Texture | null = null;
    let exportEnhancedTexture: THREE.Texture | null = null;

    const restoreViewport = (shouldRender = true) => {
      if (surfaceMaterial) {
        surfaceMaterial.map = previousSurfaceMap;
        surfaceMaterial.vertexColors = previousSurfaceVertexColors;
        if (previousSurfaceColor) surfaceMaterial.color.copy(previousSurfaceColor);
        surfaceMaterial.needsUpdate = true;
      }
      renderer.setPixelRatio(previousPixelRatio);
      renderer.setSize(screenWidth, screenHeight, false);
      camera.aspect = previousAspect;
      camera.updateProjectionMatrix();
      controls?.update();
      if (shouldRender) renderer.render(scene, camera);
    };

    setExportQuality(quality);

    try {
      if (surfaceMaterial && renderSurfaceTextureOption) {
        const exportTextureUrl = await buildExportSurfaceTextureUrl(
          renderSurfaceTextureOption,
          data.bounds,
          exportWidth,
          exportHeight,
          textureMinSize,
          textureMaxSize,
        );
        exportSourceTexture = await loadThreeTexture(exportTextureUrl);
        configureSurfaceTexture(exportSourceTexture, maxAnisotropyRef.current);
        exportEnhancedTexture = renderSurfaceTexture(
          exportSourceTexture,
          maxAnisotropyRef.current,
          {
            contrast: surfaceContrastRef.current,
            saturation: surfaceSaturationRef.current,
            renderMode: surfaceRenderModeRef.current,
            gridLineColor: gridLineColorRef.current,
            gridFillColor: gridFillColorRef.current,
            gridPatchColor: gridPatchColorRef.current,
            waterColor: waterColorRef.current,
            waterOpacity: waterOpacityRef.current,
            facetSize: facetSizeRef.current,
            verticalExaggeration,
          },
          data,
        );
        surfaceMaterial.map = exportEnhancedTexture;
        surfaceMaterial.vertexColors = false;
        surfaceMaterial.color.set("#ffffff");
        surfaceMaterial.needsUpdate = true;
      }

      renderer.setPixelRatio(1);
      renderer.setSize(exportWidth, exportHeight, false);
      camera.aspect = exportWidth / exportHeight;
      camera.updateProjectionMatrix();
      controls?.update();
      renderer.render(scene, camera);

      const outputCanvas = composeExportCanvas(renderer.domElement, data, renderSurfaceTextureOption);
      const blob = await canvasToPngBlob(outputCanvas);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      link.href = url;
      link.download = `geotexture-3d-block-${quality}-${exportWidth}px-${timestamp}.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // Keep export failures non-disruptive; the interactive viewport is restored below.
    } finally {
      restoreViewport();
      if (exportEnhancedTexture && exportEnhancedTexture !== exportSourceTexture) exportEnhancedTexture.dispose();
      exportSourceTexture?.dispose();
      setExportQuality(null);
    }
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || data.elevations.length < 2 || (data.elevations[0]?.length ?? 0) < 2) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor("#edf3f4");
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const dimensions = getTerrainDimensions(data, verticalExaggeration);
    const planExtent = Math.max(dimensions.width, dimensions.depth);
    const layerStackDepth = data.layers.length * layerDepth;
    const mantleMagmaDepth = Math.max(
      layerStackDepth * mantleDepthToLayerStackRatio,
      layerStackDepth + dimensions.reliefHeight + bottomPlateThickness + mantleDominancePadding,
    );
    const bottomPlateY = -layerStackDepth - mantleMagmaDepth - bottomPlateThickness * 0.5;
    const bottomTopY = bottomPlateY + bottomPlateThickness * 0.5;
    const blockBottomY = bottomPlateY - bottomPlateThickness * 0.5;
    const blockHeight = dimensions.reliefHeight - blockBottomY;
    const blockCenterY = (dimensions.reliefHeight + blockBottomY) * 0.5;
    sunContextRef.current = { planExtent, blockHeight };

    const camera = new THREE.PerspectiveCamera(42, mount.clientWidth / mount.clientHeight, 0.1, 100);
    camera.position.set(dimensions.width * 0.75 + 4, Math.max(8, blockHeight * 0.72), dimensions.depth * 0.95 + 4);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, blockCenterY, 0);
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = Math.max(planExtent * 0.55, 7);
    controls.maxDistance = Math.max(planExtent * 2.1, 24);
    const previousViewState = viewStateRef.current;
    if (previousViewState?.data === data) {
      camera.position.copy(previousViewState.position);
      controls.target.copy(previousViewState.target);
    }
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight("#ffffff", "#64748b", 2.3));

    const sun = new THREE.DirectionalLight(getSunLightColor(sunPresetRef.current), sunIntensityRef.current);
    sun.position.copy(getSunLightPosition(data, sunPresetRef.current, planExtent, blockHeight));
    sun.castShadow = true;
    sunLightRef.current = sun;
    scene.add(sun);

    const textureLoader = new THREE.TextureLoader();
    textureLoader.setCrossOrigin("anonymous");
    maxAnisotropyRef.current = renderer.capabilities.getMaxAnisotropy();
    const surfaceMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.02,
    });
    surfaceMaterialRef.current = surfaceMaterial;

    const terrain = new THREE.Mesh(
      buildTerrainGeometry(data, dimensions),
      surfaceMaterial,
    );
    terrain.castShadow = true;
    terrain.receiveShadow = true;
    scene.add(terrain);

    const lithologyTextures: THREE.Texture[] = [];
    const mantleTextures: THREE.Texture[] = [];

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

    const mantleTexture = textureLoader.load(mantleMagmaTextureUrl);
    configureMantleTexture(mantleTexture, renderer.capabilities.getMaxAnisotropy());
    mantleTextures.push(mantleTexture);
    const mantleMagma = new THREE.Mesh(
      buildMantleMagmaSideGeometry(data, dimensions, bottomTopY),
      new THREE.MeshStandardMaterial({
        color: "#ffffff",
        map: mantleTexture,
        emissive: "#421006",
        emissiveIntensity: 0.28,
        roughness: 0.76,
        metalness: 0.04,
        side: THREE.DoubleSide,
      }),
    );
    mantleMagma.receiveShadow = true;
    scene.add(mantleMagma);

    const bottom = new THREE.Mesh(
      new THREE.BoxGeometry(dimensions.width, bottomPlateThickness, dimensions.depth),
      new THREE.MeshStandardMaterial({ color: "#4b3b32", roughness: 1 }),
    );
    bottom.position.y = bottomPlateY;
    bottom.receiveShadow = true;
    scene.add(bottom);

    const edgeTopY = dimensions.reliefHeight;
    const edgeBottomY = blockBottomY;
    const edgeHeight = edgeTopY - edgeBottomY;
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(dimensions.width, edgeHeight, dimensions.depth));
    const edgeLines = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: "#17202a", transparent: true, opacity: 0.18 }),
    );
    edgeLines.position.y = (edgeTopY + edgeBottomY) * 0.5;
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
      viewStateRef.current = {
        data,
        position: camera.position.clone(),
        target: controls.target.clone(),
      };
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
      const sourceTexture = surfaceSourceTextureRef.current;
      const enhancedTexture = enhancedSurfaceTextureRef.current;
      if (enhancedTexture && enhancedTexture !== sourceTexture) enhancedTexture.dispose();
      sourceTexture?.dispose();
      surfaceMaterialRef.current = null;
      surfaceSourceTextureRef.current = null;
      enhancedSurfaceTextureRef.current = null;
      lithologyTextures.forEach((texture) => texture.dispose());
      mantleTextures.forEach((texture) => texture.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      sunLightRef.current = null;
    };
  }, [applySurfaceTextureSettings, data, verticalExaggeration]);

  useEffect(() => {
    surfaceContrastRef.current = surfaceContrast;
    surfaceSaturationRef.current = surfaceSaturation;
    surfaceRenderModeRef.current = surfaceRenderMode;
    gridLineColorRef.current = gridLineColor;
    gridFillColorRef.current = gridFillColor;
    gridPatchColorRef.current = gridPatchColor;
    waterColorRef.current = waterColor;
    waterOpacityRef.current = waterOpacity;
    facetSizeRef.current = facetSize;
    applySurfaceTextureSettings({
      contrast: surfaceContrast,
      saturation: surfaceSaturation,
      renderMode: surfaceRenderMode,
      gridLineColor,
      gridFillColor,
      gridPatchColor,
      waterColor,
      waterOpacity,
      facetSize,
      verticalExaggeration,
    });
  }, [
    applySurfaceTextureSettings,
    facetSize,
    gridFillColor,
    gridLineColor,
    gridPatchColor,
    surfaceContrast,
    surfaceRenderMode,
    surfaceSaturation,
    verticalExaggeration,
    waterColor,
    waterOpacity,
  ]);

  useEffect(() => {
    const surfaceMaterial = surfaceMaterialRef.current;
    if (!surfaceMaterial) return;

    if (!renderSurfaceTextureOption) {
      const sourceTexture = surfaceSourceTextureRef.current;
      const enhancedTexture = enhancedSurfaceTextureRef.current;
      if (enhancedTexture && enhancedTexture !== sourceTexture) enhancedTexture.dispose();
      sourceTexture?.dispose();
      surfaceSourceTextureRef.current = null;
      enhancedSurfaceTextureRef.current = null;
      surfaceMaterial.map = null;
      surfaceMaterial.vertexColors = true;
      surfaceMaterial.needsUpdate = true;
      return;
    }

    let isCancelled = false;
    const textureLoader = new THREE.TextureLoader();
    textureLoader.setCrossOrigin("anonymous");
    textureLoader.load(
      renderSurfaceTextureOption.url,
      (texture) => {
        if (isCancelled) {
          texture.dispose();
          return;
        }

        const previousSourceTexture = surfaceSourceTextureRef.current;
        const previousEnhancedTexture = enhancedSurfaceTextureRef.current;
        surfaceSourceTextureRef.current = texture;
        enhancedSurfaceTextureRef.current = null;
        configureSurfaceTexture(texture, maxAnisotropyRef.current);
        applySurfaceTextureSettings({
          contrast: surfaceContrastRef.current,
          saturation: surfaceSaturationRef.current,
          renderMode: surfaceRenderModeRef.current,
          gridLineColor: gridLineColorRef.current,
          gridFillColor: gridFillColorRef.current,
          gridPatchColor: gridPatchColorRef.current,
          waterColor: waterColorRef.current,
          waterOpacity: waterOpacityRef.current,
          facetSize: facetSizeRef.current,
          verticalExaggeration,
        });

        if (previousEnhancedTexture && previousEnhancedTexture !== previousSourceTexture) {
          previousEnhancedTexture.dispose();
        }
        previousSourceTexture?.dispose();
      },
      undefined,
      () => {
        if (isCancelled || surfaceSourceTextureRef.current) return;
        surfaceMaterial.map = null;
        surfaceMaterial.vertexColors = true;
        surfaceMaterial.needsUpdate = true;
      },
    );

    return () => {
      isCancelled = true;
    };
  }, [applySurfaceTextureSettings, renderSurfaceTextureOption, verticalExaggeration]);

  useEffect(() => {
    sunPresetRef.current = sunPreset;
    sunIntensityRef.current = sunIntensity;
    const sun = sunLightRef.current;
    if (!sun) return;

    const { planExtent, blockHeight } = sunContextRef.current;
    sun.position.copy(getSunLightPosition(data, sunPreset, planExtent, blockHeight));
    sun.color.set(getSunLightColor(sunPreset));
    sun.intensity = sunIntensity;
  }, [data, sunIntensity, sunPreset]);

  return (
    <div className={styles.terrainViewer}>
      <div ref={mountRef} className={styles.threeCanvas} />
      {renderSurfaceTextureOption?.attribution && (
        <div className={styles.surfaceAttribution}>{renderSurfaceTextureOption.attribution}</div>
      )}
      {surfaceTextureOptions.length > 0 && (
        <div className={styles.surfaceTextureControl}>
          <span>卫星贴图</span>
          <div className={styles.surfaceTextureModes} role="group" aria-label="顶面贴图来源">
            {surfaceTextureOptions.map((option) => (
              <button
                key={option.id}
                className={option.id === activeSurfaceTexture?.id ? styles.activeSurfaceTextureMode : ""}
                type="button"
                onClick={() => setActiveSurfaceTextureId(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className={styles.surfaceRenderModes} role="group" aria-label="顶面贴图样式">
            {[
              { value: "photo", label: "卫星" },
              { value: "grid", label: "网格" },
              { value: "hybrid", label: "混合" },
            ].map((option) => (
              <button
                key={option.value}
                className={surfaceRenderMode === option.value ? styles.activeSurfaceRenderMode : ""}
                type="button"
                onClick={() => setSurfaceRenderMode(option.value as SurfaceRenderMode)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label>
            <span>对比度 {surfaceContrast.toFixed(2)}x</span>
            <input
              aria-label="卫星贴图对比度"
              type="range"
              min="0.8"
              max="1.8"
              step="0.05"
              value={surfaceContrast}
              onChange={(event) => setSurfaceContrast(Number(event.target.value))}
            />
          </label>
          <label>
            <span>饱和度 {surfaceSaturation.toFixed(2)}x</span>
            <input
              aria-label="卫星贴图饱和度"
              type="range"
              min="0.6"
              max="2.2"
              step="0.05"
              value={surfaceSaturation}
              onChange={(event) => setSurfaceSaturation(Number(event.target.value))}
            />
          </label>
          {surfaceRenderMode !== "photo" && (
            <div className={styles.surfaceColorControls}>
              <label>
                <span>线色</span>
                <input
                  aria-label="网格线色"
                  type="color"
                  value={gridLineColor}
                  onChange={(event) => setGridLineColor(event.target.value)}
                />
              </label>
              <label>
                <span>底色</span>
                <input
                  aria-label="网格底色"
                  type="color"
                  value={gridFillColor}
                  onChange={(event) => setGridFillColor(event.target.value)}
                />
              </label>
              <label>
                <span>块面</span>
                <input
                  aria-label="网格块面色"
                  type="color"
                  value={gridPatchColor}
                  onChange={(event) => setGridPatchColor(event.target.value)}
                />
              </label>
              <label>
                <span>水体</span>
                <input
                  aria-label="水体颜色"
                  type="color"
                  value={waterColor}
                  onChange={(event) => setWaterColor(event.target.value)}
                />
              </label>
              <label className={styles.surfaceWaterStrength}>
                <span>水体强度 {waterOpacity.toFixed(2)}x</span>
                <input
                  aria-label="水体设色强度"
                  type="range"
                  min="0.2"
                  max="1"
                  step="0.05"
                  value={waterOpacity}
                  onChange={(event) => setWaterOpacity(Number(event.target.value))}
                />
              </label>
              <label className={styles.surfaceFacetSize}>
                <span>面片大小 {facetSize.toFixed(0)}px</span>
                <input
                  aria-label="地形面片大小"
                  type="range"
                  min="8"
                  max="42"
                  step="1"
                  value={facetSize}
                  onChange={(event) => setFacetSize(Number(event.target.value))}
                />
              </label>
            </div>
          )}
        </div>
      )}
      <div className={styles.demControl}>
        <span>DEM 强化 {verticalExaggeration.toFixed(1)}x</span>
        <input
          aria-label="DEM 强化"
          type="range"
          min="0.8"
          max="4"
          step="0.1"
          value={verticalExaggeration}
          onChange={(event) => setVerticalExaggeration(Number(event.target.value))}
        />
        <div className={styles.exportRenderGroup}>
          <button className={styles.exportRenderBtn} type="button" onClick={() => exportImage("publication")} disabled={exportQuality !== null}>
            <Download size={15} />
            <span>{exportQuality === "publication" ? "准备中..." : "出版级"}</span>
          </button>
          <button className={styles.exportRenderBtn} type="button" onClick={() => exportImage("normal")} disabled={exportQuality !== null}>
            <Download size={15} />
            <span>{exportQuality === "normal" ? "导出中..." : "普通级"}</span>
          </button>
        </div>
      </div>
      <div className={styles.sunControl}>
        <span>阳光</span>
        <div className={styles.sunModeGroup} role="group" aria-label="太阳时段">
          {sunPresets.map((option) => (
            <button
              key={option.value}
              className={sunPreset === option.value ? styles.activeSunMode : ""}
              type="button"
              onClick={() => updateSunPreset(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label>
          <span>强度 {sunIntensity.toFixed(1)}x</span>
          <input
            aria-label="阳光强度"
            type="range"
            min="0.8"
            max="6"
            step="0.1"
            value={sunIntensity}
            onChange={(event) => updateSunIntensity(Number(event.target.value))}
          />
        </label>
      </div>
      <div className={styles.terrainLegend}>
        {activeSurfaceTexture && (
          <span>
            <i className={styles.satelliteSwatch} />
            地表卫星贴图 · {activeSurfaceTexture.label}
          </span>
        )}
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
