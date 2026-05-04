"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import styles from "./MapSelector.module.css";
import { PenTool, Map as MapIcon, RefreshCw, Download, Square } from "lucide-react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import * as d3 from "d3";
import type { Feature, Polygon } from "geojson";
import TerrainBlock3D, { type TerrainBlockData, type TerrainLayer } from "./TerrainBlock3D";

interface MacrostratUnit {
  best_int_name?: string;
  lith?: string;
  color?: string;
}

const fallbackAgeColors = {
  quaternary: "#FFFF4D",
  cretaceous: "#80FF4D",
  jurassic: "#66FF99",
  triassic: "#66FFCC",
};

const selectionSourceId = "terrain-block-selection-source";
const selectionFillLayerId = "terrain-block-selection-fill";
const selectionOutlineLayerId = "terrain-block-selection-outline";
const maxSatelliteTextureSize = 768;
const minSatelliteTextureSize = 320;
const defaultSurfaceTextureStyle = "bag326/cluwjr06f002o01pphuck9mrm";
const chinaStartCenters: Array<[number, number]> = [
  [116.4074, 39.9042],
  [121.4737, 31.2304],
  [113.2644, 23.1291],
  [104.0665, 30.5728],
  [108.9398, 34.3416],
  [114.3055, 30.5928],
  [120.1551, 30.2741],
  [118.7969, 32.0603],
  [106.5516, 29.563],
  [102.8329, 24.8801],
  [87.6168, 43.8256],
  [91.1322, 29.6604],
  [126.6424, 45.7567],
  [111.751, 40.8415],
  [117.1201, 36.6512],
  [112.9388, 28.2282],
  [119.2965, 26.0745],
  [101.7782, 36.6171],
];

const defaultTerrainLayers: TerrainLayer[] = [
  { name: "第四纪覆盖层", color: "#d8c074", textureFile: "legend_01_soil_silt_or_alluvium.png" },
  { name: "砂岩层", color: "#b87943", textureFile: "legend_08_massive_sandstone.png" },
  { name: "灰岩层", color: "#8ca7a0", textureFile: "legend_15_massively_bedded_limestone.png" },
  { name: "结晶基底", color: "#6f5f7f", textureFile: "legend_45_gneiss.png" },
];

const geologicAgeNames: Record<string, string> = {
  "holocene": "全新世",
  "pleistocene": "更新世",
  "pliocene": "上新世",
  "miocene": "中新世",
  "oligocene": "渐新世",
  "eocene": "始新世",
  "paleocene": "古新世",
  "quaternary": "第四纪",
  "neogene": "新近纪",
  "paleogene": "古近纪",
  "tertiary": "第三纪",
  "cretaceous": "白垩纪",
  "jurassic": "侏罗纪",
  "triassic": "三叠纪",
  "permian": "二叠纪",
  "carboniferous": "石炭纪",
  "pennsylvanian": "宾夕法尼亚亚纪",
  "mississippian": "密西西比亚纪",
  "devonian": "泥盆纪",
  "silurian": "志留纪",
  "ordovician": "奥陶纪",
  "cambrian": "寒武纪",
  "proterozoic": "元古宙",
  "archean": "太古宙",
  "hadean": "冥古宙",
  "precambrian": "前寒武纪",
  "cenozoic": "新生代",
  "mesozoic": "中生代",
  "paleozoic": "古生代",
};

const geologicAgeModifiers: Record<string, string> = {
  "early": "早",
  "middle": "中",
  "late": "晚",
  "lower": "下",
  "upper": "上",
};

function asStageName(name: string, modifier: string) {
  if (modifier === "lower" || modifier === "middle" || modifier === "upper") {
    if (name.endsWith("纪")) return `${name.slice(0, -1)}统`;
    if (name.endsWith("世")) return `${name.slice(0, -1)}统`;
  }

  if (name.endsWith("纪")) return `${name.slice(0, -1)}世`;
  return name;
}

function localizeGeologicPart(part: string) {
  const trimmed = part.trim();
  const lower = trimmed.toLowerCase();
  if (geologicAgeNames[lower]) return geologicAgeNames[lower];

  const modifierMatch = lower.match(/^(early|middle|late|lower|upper)\s+(.+)$/);
  if (modifierMatch) {
    const [, modifier, baseName] = modifierMatch;
    const localizedBase = geologicAgeNames[baseName];
    if (localizedBase) return `${geologicAgeModifiers[modifier]}${asStageName(localizedBase, modifier)}`;
  }

  return trimmed;
}

function localizeGeologicName(name?: string) {
  if (!name) return "地表单元";

  return name
    .split(/\s*[/,;]\s*|\s+-\s+/)
    .map(localizeGeologicPart)
    .filter(Boolean)
    .join(" / ");
}

const createSelectionFeature = (start: mapboxgl.LngLat, end: mapboxgl.LngLat): Feature<Polygon> => {
  const west = Math.min(start.lng, end.lng);
  const east = Math.max(start.lng, end.lng);
  const south = Math.min(start.lat, end.lat);
  const north = Math.max(start.lat, end.lat);

  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [[
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ]],
    },
  };
};

function mercatorY(lat: number) {
  const clampedLat = Math.min(Math.max(lat, -85.05112878), 85.05112878);
  return Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360));
}

function getSatelliteTextureSize(bounds: TerrainBlockData["bounds"]) {
  const xSpan = Math.max(Math.abs(((bounds.east - bounds.west) * Math.PI) / 180), 0.000001);
  const ySpan = Math.max(Math.abs(mercatorY(bounds.north) - mercatorY(bounds.south)), 0.000001);
  const aspect = xSpan / ySpan;

  if (aspect >= 1) {
    return {
      width: maxSatelliteTextureSize,
      height: Math.round(Math.min(Math.max(maxSatelliteTextureSize / aspect, minSatelliteTextureSize), maxSatelliteTextureSize)),
    };
  }

  return {
    width: Math.round(Math.min(Math.max(maxSatelliteTextureSize * aspect, minSatelliteTextureSize), maxSatelliteTextureSize)),
    height: maxSatelliteTextureSize,
  };
}

function buildMapboxSatelliteTextureUrl(bounds: TerrainBlockData["bounds"], token?: string, stylePath = defaultSurfaceTextureStyle) {
  if (!token) return undefined;

  const { width, height } = getSatelliteTextureSize(bounds);
  const bbox = `[${bounds.west},${bounds.south},${bounds.east},${bounds.north}]`;
  const normalizedStylePath = stylePath.replace(/^mapbox:\/\/styles\//, "").replace(/^\/+|\/+$/g, "");
  const params = new URLSearchParams({
    access_token: token,
    attribution: "false",
    logo: "false",
  });

  return `https://api.mapbox.com/styles/v1/${normalizedStylePath}/static/${bbox}/${width}x${height}@2x?${params.toString()}`;
}

function getRandomChinaStartView() {
  const [lng, lat] = chinaStartCenters[Math.floor(Math.random() * chinaStartCenters.length)];
  const lngJitter = (Math.random() - 0.5) * 0.7;
  const latJitter = (Math.random() - 0.5) * 0.5;

  return {
    center: [lng + lngJitter, lat + latJitter] as [number, number],
    zoom: 8.8 + Math.random() * 2.2,
  };
}

export default function MapSelector() {
  const [isDrawing, setIsDrawing] = useState(false);
  const [isSelectingBlock, setIsSelectingBlock] = useState(false);
  const [hasDrawnLine, setHasDrawnLine] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [isEstimating, setIsEstimating] = useState(false);
  const [isRenderingBlock, setIsRenderingBlock] = useState(false);
  const [terrainBlock, setTerrainBlock] = useState<TerrainBlockData | null>(null);
  const d3Container = useRef<SVGSVGElement>(null);
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const draw = useRef<MapboxDraw | null>(null);
  const rectangleStart = useRef<mapboxgl.LngLat | null>(null);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token || !mapContainer.current || map.current) return;

    mapboxgl.accessToken = token;
    const startView = getRandomChinaStartView();

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center: startView.center,
      zoom: startView.zoom,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), "top-right");

    draw.current = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        line_string: true,
        trash: true
      },
      defaultMode: 'simple_select',
      styles: [
        {
          id: 'gl-draw-line',
          type: 'line',
          filter: ['all', ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#003153', 'line-dasharray': [0.2, 2], 'line-width': 4 }
        },
        {
          id: 'gl-draw-line-static',
          type: 'line',
          filter: ['all', ['==', '$type', 'LineString'], ['==', 'mode', 'static']],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#003153', 'line-width': 4 }
        },
        {
          id: 'gl-draw-point',
          type: 'circle',
          filter: ['all', ['==', '$type', 'Point'], ['!=', 'meta', 'midpoint']],
          paint: { 'circle-radius': 6, 'circle-color': '#003153', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }
        },
        {
          id: 'gl-draw-polygon-and-line-vertex-halo-active',
          type: 'circle',
          filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
          paint: { 'circle-radius': 8, 'circle-color': '#FFF' }
        },
        {
          id: 'gl-draw-polygon-and-line-vertex-active',
          type: 'circle',
          filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
          paint: { 'circle-radius': 6, 'circle-color': '#003153' }
        }
      ]
    });

    map.current.addControl(draw.current);

    map.current.on('load', () => {
      map.current!.addSource('mapbox-dem', {
        'type': 'raster-dem',
        'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
        'tileSize': 512,
        'maxzoom': 14
      });
      map.current!.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1 });
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!draw.current || !map.current) return;

    if (isDrawing) {
      draw.current.deleteAll(); // Clear previous line
      draw.current.changeMode("draw_line_string");
    } else {
      draw.current.changeMode("simple_select");
    }

    const handleMapClick = () => {
      if (!isDrawing || !draw.current) return;
      const features = draw.current.getAll().features;
      if (features.length > 0) {
        const activeFeature = features[0];
        if (activeFeature.geometry.type === 'LineString') {
          // In draw_line_string mode, the array contains clicked points + cursor position.
          // When user clicks the 2nd point, the array has [start, end, cursor].
          if (activeFeature.geometry.coordinates.length >= 3) {
            const coords = activeFeature.geometry.coordinates.slice(0, 2);
            activeFeature.geometry.coordinates = coords;
            draw.current.add(activeFeature);
            draw.current.changeMode('simple_select');
            setIsDrawing(false);
            setHasDrawnLine(true);
          }
        }
      }
    };

    map.current.on('click', handleMapClick);

    return () => {
      if (map.current) {
        map.current.off('click', handleMapClick);
      }
    };
  }, [isDrawing]);

  const ensureSelectionLayers = useCallback(() => {
    if (!map.current || !map.current.isStyleLoaded()) return false;

    if (!map.current.getSource(selectionSourceId)) {
      map.current.addSource(selectionSourceId, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });
    }

    if (!map.current.getLayer(selectionFillLayerId)) {
      map.current.addLayer({
        id: selectionFillLayerId,
        type: "fill",
        source: selectionSourceId,
        paint: {
          "fill-color": "#38bdf8",
          "fill-opacity": 0.22,
        },
      });
    }

    if (!map.current.getLayer(selectionOutlineLayerId)) {
      map.current.addLayer({
        id: selectionOutlineLayerId,
        type: "line",
        source: selectionSourceId,
        paint: {
          "line-color": "#0f172a",
          "line-width": 2,
          "line-dasharray": [1.5, 1],
        },
      });
    }

    return true;
  }, []);

  const updateSelectionRectangle = useCallback((feature: Feature<Polygon>) => {
    if (!map.current) return;
    const source = map.current.getSource(selectionSourceId) as mapboxgl.GeoJSONSource | undefined;
    source?.setData(feature);
  }, []);

  const inferTerrainLayers = useCallback(async (lat: number, lng: number): Promise<TerrainLayer[]> => {
    try {
      const response = await fetch(`https://macrostrat.org/api/v2/geologic_units/map?lat=${lat}&lng=${lng}`);
      const data = await response.json();
      const units = data?.success?.data as MacrostratUnit[] | undefined;
      const unit = units?.[0];
      if (!unit) return defaultTerrainLayers;

      const lith = (unit.lith || "").toLowerCase();
      if (lith.includes("limestone") || lith.includes("carbonate")) {
        return [
          { name: "碳酸盐盖层", color: unit.color || "#a9c2b8", textureFile: "legend_23_clayey_or_argillaceous_limestone.png" },
          { name: "厚层灰岩", color: "#8ca7a0", textureFile: "legend_15_massively_bedded_limestone.png" },
          { name: "泥质夹层", color: "#7c6f62", textureFile: "legend_24_calcareous_shale_or_shaly_limestone.png" },
          { name: "结晶基底", color: "#6f5f7f", textureFile: "legend_45_gneiss.png" },
        ];
      }
      if (lith.includes("granite") || lith.includes("intrusive") || lith.includes("plutonic")) {
        return [
          { name: "风化壳", color: "#c7a76f", textureFile: "legend_01_soil_silt_or_alluvium.png" },
          { name: "花岗质侵入体", color: unit.color || "#c77878", textureFile: "legend_55_granite.png" },
          { name: "接触变质带", color: "#815f75", textureFile: "legend_43_metamorphism.png" },
          { name: "深部基底", color: "#51475f", textureFile: "legend_45_gneiss.png" },
        ];
      }
      if (lith.includes("shale")) {
        return [
          { name: "松散覆盖层", color: "#d8c074", textureFile: "legend_01_soil_silt_or_alluvium.png" },
          { name: "页岩层", color: unit.color || "#6f756c", textureFile: "legend_25_shale.png" },
          { name: "砂岩夹层", color: "#b87943", textureFile: "legend_12_thin_bedded_or_shaly_sandstone.png" },
          { name: "老地层基底", color: "#6f5f7f", textureFile: "legend_45_gneiss.png" },
        ];
      }
      return [
        { name: localizeGeologicName(unit.best_int_name), color: unit.color || "#d8c074", textureFile: "legend_01_soil_silt_or_alluvium.png" },
        ...defaultTerrainLayers.slice(1),
      ];
    } catch {
      return defaultTerrainLayers;
    }
  }, []);

  const buildTerrainBlock = useCallback(async (start: mapboxgl.LngLat, end: mapboxgl.LngLat) => {
    if (!map.current) return;

    setIsRenderingBlock(true);
    setHasProfile(false);
    setTerrainBlock(null);

    const west = Math.min(start.lng, end.lng);
    const east = Math.max(start.lng, end.lng);
    const south = Math.min(start.lat, end.lat);
    const north = Math.max(start.lat, end.lat);
    const bounds = { west, south, east, north };
    const rows = 34;
    const cols = 34;
    const elevations: number[][] = [];
    let minElevation = Number.POSITIVE_INFINITY;
    let maxElevation = Number.NEGATIVE_INFINITY;

    for (let row = 0; row < rows; row++) {
      const lat = north - ((north - south) * row) / (rows - 1);
      const line: number[] = [];
      for (let col = 0; col < cols; col++) {
        const lng = west + ((east - west) * col) / (cols - 1);
        const queriedElevation = map.current.queryTerrainElevation([lng, lat]);
        const fallbackRelief = Math.sin(row * 0.35) * 60 + Math.cos(col * 0.27) * 45;
        const elevation = typeof queriedElevation === "number" ? queriedElevation : fallbackRelief;
        line.push(elevation);
        minElevation = Math.min(minElevation, elevation);
        maxElevation = Math.max(maxElevation, elevation);
      }
      elevations.push(line);
    }

    if (maxElevation - minElevation < 1) {
      elevations.forEach((line, row) => {
        line.forEach((_, col) => {
          const relief = Math.sin(row * 0.35) * 60 + Math.cos(col * 0.27) * 45;
          elevations[row][col] = relief;
          minElevation = Math.min(minElevation, relief);
          maxElevation = Math.max(maxElevation, relief);
        });
      });
    }

    const midLat = (south + north) / 2;
    const midLng = (west + east) / 2;
    const layers = await inferTerrainLayers(midLat, midLng);
    const surfaceTextureUrl = buildMapboxSatelliteTextureUrl(
      bounds,
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
      process.env.NEXT_PUBLIC_MAPBOX_SURFACE_STYLE,
    );

    setTerrainBlock({
      elevations,
      bounds,
      minElevation,
      maxElevation,
      layers,
      surfaceTextureUrl,
      surfaceTextureLabel: surfaceTextureUrl ? "地表卫星贴图" : undefined,
      surfaceAttribution: surfaceTextureUrl ? "© Mapbox © OpenStreetMap © Maxar" : undefined,
    });
    setIsRenderingBlock(false);
  }, [inferTerrainLayers]);

  useEffect(() => {
    if (!map.current) return;
    const currentMap = map.current;

    if (!isSelectingBlock) {
      currentMap.getCanvas().style.cursor = "";
      return;
    }

    draw.current?.changeMode("simple_select");
    currentMap.getCanvas().style.cursor = "crosshair";

    const handleMouseDown = (event: mapboxgl.MapMouseEvent) => {
      if (!ensureSelectionLayers()) return;
      rectangleStart.current = event.lngLat;
      currentMap.dragPan.disable();
      updateSelectionRectangle(createSelectionFeature(event.lngLat, event.lngLat));
    };

    const handleMouseMove = (event: mapboxgl.MapMouseEvent) => {
      if (!rectangleStart.current) return;
      updateSelectionRectangle(createSelectionFeature(rectangleStart.current, event.lngLat));
    };

    const handleMouseUp = (event: mapboxgl.MapMouseEvent) => {
      if (!rectangleStart.current) return;
      const start = rectangleStart.current;
      rectangleStart.current = null;
      currentMap.dragPan.enable();
      currentMap.getCanvas().style.cursor = "";
      setIsSelectingBlock(false);
      updateSelectionRectangle(createSelectionFeature(start, event.lngLat));
      void buildTerrainBlock(start, event.lngLat);
    };

    currentMap.on("mousedown", handleMouseDown);
    currentMap.on("mousemove", handleMouseMove);
    currentMap.on("mouseup", handleMouseUp);

    return () => {
      currentMap.off("mousedown", handleMouseDown);
      currentMap.off("mousemove", handleMouseMove);
      currentMap.off("mouseup", handleMouseUp);
      currentMap.dragPan.enable();
      currentMap.getCanvas().style.cursor = "";
    };
  }, [buildTerrainBlock, ensureSelectionLayers, isSelectingBlock, updateSelectionRectangle]);

  const generateProfile = async () => {
    setIsDrawing(false);
    setTerrainBlock(null);
    setIsEstimating(true);

    const elevationData: number[] = [];
    let geologicUnits: MacrostratUnit[] = [];

    if (draw.current && map.current) {
      const features = draw.current.getAll().features;
      if (features.length > 0 && features[0].geometry.type === 'LineString') {
        const coords = features[0].geometry.coordinates;
        const start = coords[0];
        const end = coords[coords.length - 1];

        const numPoints = 60;
        for (let i = 0; i <= numPoints; i++) {
          const t = i / numPoints;
          const lng = start[0] + (end[0] - start[0]) * t;
          const lat = start[1] + (end[1] - start[1]) * t;
          const elevation = map.current.queryTerrainElevation([lng, lat]) || 0;
          elevationData.push(elevation);
        }

        try {
          const midLng = (start[0] + end[0]) / 2;
          const midLat = (start[1] + end[1]) / 2;
          const response = await fetch(`https://macrostrat.org/api/v2/geologic_units/map?lat=${midLat}&lng=${midLng}`);
          const data = await response.json();
          if (data && data.success && data.success.data) {
            geologicUnits = data.success.data;
          }
        } catch (e) {
          console.error("Failed to fetch macrostrat data", e);
        }
      }
    }

    setTimeout(() => {
      setIsEstimating(false);
      setHasProfile(true);
      renderD3Profile(elevationData, geologicUnits);
    }, 500); // Shorter timeout since fetch already took time
  };

  const renderD3Profile = (elevations: number[] = [], geologicUnits: MacrostratUnit[] = []) => {
    if (!d3Container.current) return;

    const svg = d3.select(d3Container.current);
    svg.selectAll("*").remove();

    const width = 800;
    const height = 350;

    svg.attr("viewBox", `0 0 ${width} ${height}`);

    // Create a beautiful border/background
    svg.append("rect")
      .attr("width", width)
      .attr("height", height)
      .attr("fill", "#f8f9fa")
      .attr("stroke", "#333")
      .attr("stroke-width", 2);

    // Dynamic Geological structural data points
    let topoPoints: { x: number, y: number }[] = [];

    if (elevations && elevations.length > 0) {
      const validElevs = elevations.filter(e => e > 0);
      const minElev = validElevs.length > 0 ? Math.min(...validElevs) : 0;
      const maxElev = validElevs.length > 0 ? Math.max(...validElevs) : 100;
      const elevRange = Math.max(maxElev - minElev, 1);

      topoPoints = elevations.map((elev, i) => {
        const x = (i / (elevations.length - 1)) * width;
        // Project elevation to Y coordinates (SVG y goes down, so max elev is smaller y)
        // Ensure minimum elevation maps to y=140, maximum to y=40
        const y = elev > 0 ? 140 - ((elev - minElev) / elevRange) * 100 : 100;
        return { x, y };
      });
    } else {
      const pts = [0, 100, 250, 400, 550, 700, 800];
      const topo = [70, 50, 110, 80, 130, 70, 80];
      topoPoints = pts.map((x, i) => ({ x, y: topo[i] }));
    }

    // Generate layers that follow topography with tectonic folding
    const layer1Data = topoPoints.map(p => {
      const foldOffset = Math.sin(p.x / 100) * 20;
      return { x: p.x, y0: p.y + 70 + foldOffset, y1: p.y };
    });

    const layer2Data = topoPoints.map(p => {
      const foldOffset = Math.sin(p.x / 100) * 20;
      const foldOffset2 = Math.sin(p.x / 130 + 1) * 35;
      return { x: p.x, y0: p.y + 150 + foldOffset2, y1: p.y + 70 + foldOffset };
    });

    const layer3Data = topoPoints.map(p => {
      const foldOffset2 = Math.sin(p.x / 130 + 1) * 35;
      const foldOffset3 = Math.sin(p.x / 160 + 2) * 50;
      return { x: p.x, y0: p.y + 240 + foldOffset3, y1: p.y + 150 + foldOffset2 };
    });

    const layer4Data = topoPoints.map(p => {
      const foldOffset3 = Math.sin(p.x / 160 + 2) * 50;
      return { x: p.x, y0: height + 50, y1: p.y + 240 + foldOffset3 };
    });

    const areaGen = d3.area<{ x: number, y0: number, y1: number }>()
      .x(d => d.x)
      .y0(d => d.y0)
      .y1(d => d.y1)
      .curve(d3.curveCatmullRom.alpha(0.5));

    const drawLayer = (data: { x: number, y0: number, y1: number }[], color: string, pattern: string) => {
      const g = svg.append("g");

      // Color fill
      g.append("path")
        .datum(data)
        .attr("d", areaGen)
        .attr("fill", color)
        .attr("stroke", "#222")
        .attr("stroke-width", 1.5);

      // Pattern overlay
      g.append("path")
        .datum(data)
        .attr("d", areaGen)
        .attr("fill", `url(#${pattern})`)
        .style("mix-blend-mode", "multiply")
        .style("opacity", 0.7);
    };

    const getLayerInfo = (index: number) => {
      // Top layer from real API data
      if (geologicUnits && geologicUnits.length > 0 && index === 0) {
        const unit = geologicUnits[0];
        const ageName = localizeGeologicName(unit.best_int_name);
        const lith = (unit.lith || "").toLowerCase();
        let lithName = "岩层";
        let pattern = "pattern-1";

        if (lith.includes("metamorphic") || lith.includes("gneiss") || lith.includes("schist")) {
          lithName = "变质岩/片麻岩"; pattern = "pattern-73"; // Metamorphic
        } else if (lith.includes("granite") || lith.includes("intrusive") || lith.includes("plutonic")) {
          lithName = "侵入花岗岩"; pattern = "pattern-61";
        } else if (lith.includes("limestone") || lith.includes("carbonate")) {
          lithName = "灰岩"; pattern = "pattern-15";
        } else if (lith.includes("sandstone")) {
          lithName = "砂岩"; pattern = "pattern-8";
        } else if (lith.includes("shale")) {
          lithName = "页岩"; pattern = "pattern-25";
        } else if (lith.includes("volcanic") || lith.includes("basalt")) {
          lithName = "火山岩"; pattern = "pattern-63";
        }

        return { name: `${ageName} (${lithName})`, color: unit.color || "#999966", pattern };
      }

      // If we used the API for layer 0, generate logical older layers below it
      if (geologicUnits && geologicUnits.length > 0) {
        if (index === 1) return { name: "太古代 (混合岩带)", color: "#FF8099", pattern: "pattern-71" };
        if (index === 2) return { name: "前寒武纪 (结晶基底)", color: "#999966", pattern: "pattern-73" };
        if (index === 3) return { name: "深部侵入岩体", color: "#FF6666", pattern: "pattern-61" };
      }

      // Fallback mock data
      const defaults = [
        { name: "第四纪 (土壤、粉砂或冲积物)", color: fallbackAgeColors.quaternary, pattern: "pattern-1" },
        { name: "白垩纪 (厚层灰岩)", color: fallbackAgeColors.cretaceous, pattern: "pattern-15" },
        { name: "侏罗纪 (页岩)", color: fallbackAgeColors.jurassic, pattern: "pattern-25" },
        { name: "三叠纪 (块状砂岩)", color: fallbackAgeColors.triassic, pattern: "pattern-8" }
      ];
      return defaults[index] || defaults[0];
    };

    const l1Info = getLayerInfo(0);
    const l2Info = getLayerInfo(1);
    const l3Info = getLayerInfo(2);
    const l4Info = getLayerInfo(3);

    // Draw layers
    drawLayer(layer1Data, l1Info.color, l1Info.pattern);
    drawLayer(layer2Data, l2Info.color, l2Info.pattern);
    drawLayer(layer3Data, l3Info.color, l3Info.pattern);
    drawLayer(layer4Data, l4Info.color, l4Info.pattern);


    // Helper for labels with backgrounds
    const addLabel = (x: number, y: number, text: string) => {
      const g = svg.append("g").attr("transform", `translate(${x}, ${y})`);
      const estWidth = text.length * 13 * 0.8 + 16;

      g.append("rect")
        .attr("x", -estWidth / 2)
        .attr("y", -14)
        .attr("width", estWidth)
        .attr("height", 28)
        .attr("fill", "rgba(255, 255, 255, 0.85)")
        .attr("rx", 14)
        .attr("ry", 14)
        .attr("stroke", "rgba(0,0,0,0.15)")
        .attr("stroke-width", 1);

      g.append("text")
        .text(text)
        .attr("fill", "#111")
        .attr("font-size", 13)
        .attr("font-weight", 600)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("y", 1);
    };

    // Add Labels using dynamic names
    addLabel(500, 90, l1Info.name);
    addLabel(500, 180, l2Info.name);
    addLabel(500, 260, l3Info.name);
    addLabel(500, 320, l4Info.name);
  };

  return (
    <div className={styles.container}>
      {/* Top Map Section */}
      <div className={styles.mapArea}>
        <div className={styles.mapOverlay}>
          <div className={styles.mapControls}>
            <button
              className={`${styles.controlBtn} ${isDrawing ? styles.active : ""}`}
              onClick={() => {
                setIsSelectingBlock(false);
                setIsDrawing(!isDrawing);
                if (!isDrawing) setHasDrawnLine(false);
              }}
            >
              <PenTool size={16} /> 绘制剖面线
            </button>
            <button
              className={`${styles.controlBtn} ${isSelectingBlock ? styles.active : ""}`}
              onClick={() => {
                setIsDrawing(false);
                setIsSelectingBlock(!isSelectingBlock);
              }}
            >
              <Square size={16} /> 框选 3D 地块
            </button>
            {(isDrawing || hasDrawnLine) && (
              <button className={styles.actionBtn} onClick={generateProfile}>
                生成地质剖面
              </button>
            )}
          </div>

          {!process.env.NEXT_PUBLIC_MAPBOX_TOKEN && (
            <div className={styles.mapPlaceholder}>
              <MapIcon size={48} className={styles.mapIcon} />
              <h3>Mapbox GL JS 模块</h3>
              <p>请在 .env.local 中配置 NEXT_PUBLIC_MAPBOX_TOKEN</p>
              {isDrawing && <div className={styles.drawingHint}>在地图上点击绘制 A-B 剖面线...</div>}
              {isSelectingBlock && <div className={styles.drawingHint}>按住鼠标拖出 3D 地块范围...</div>}
            </div>
          )}
        </div>

        {/* Actual Map Container */}
        <div ref={mapContainer} style={{ width: "100%", height: "100%" }} />
      </div>

      {/* Bottom Profile Section */}
      <div className={`${styles.profileArea} ${hasProfile || isEstimating || terrainBlock || isRenderingBlock ? styles.open : ""}`}>
        <div className={styles.profileHeader}>
          <h3>{terrainBlock || isRenderingBlock ? "DEM + 地下岩层 3D 地块" : "AI 生成的地下地质剖面"}</h3>
          {hasProfile && (
            <button className={styles.exportBtn}>
              <Download size={14} /> 导出 SVG
            </button>
          )}
        </div>

        <div className={styles.profileContent}>
          {(isEstimating || isRenderingBlock) && (
            <div className={styles.loader}>
              <RefreshCw size={24} className={styles.spin} />
              {isRenderingBlock ? (
                <>
                  <span>正在采样 Mapbox DEM...</span>
                  <span>正在构建 3D 地形块和地下岩层...</span>
                </>
              ) : (
                <>
                  <span>正在获取 Macrostrat 地层柱状数据...</span>
                  <span>正在运行 AI 地下结构推演...</span>
                </>
              )}
            </div>
          )}

          {terrainBlock && !isRenderingBlock && (
            <TerrainBlock3D data={terrainBlock} />
          )}

          <svg
            ref={d3Container}
            className={styles.d3Svg}
            style={{ display: hasProfile && !isEstimating && !terrainBlock ? "block" : "none" }}
          />
        </div>
      </div>
    </div>
  );
}
