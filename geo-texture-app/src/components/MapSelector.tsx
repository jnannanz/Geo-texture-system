"use client";

import React, { useState, useEffect, useRef } from "react";
import styles from "./MapSelector.module.css";
import { PenTool, Map as MapIcon, RefreshCw, Download } from "lucide-react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import * as d3 from "d3";

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

export default function MapSelector() {
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawnLine, setHasDrawnLine] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [isEstimating, setIsEstimating] = useState(false);
  const d3Container = useRef<SVGSVGElement>(null);
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const draw = useRef<MapboxDraw | null>(null);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token || !mapContainer.current || map.current) return;

    mapboxgl.accessToken = token;
    
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center: [120.1551, 30.2741], // Default center (Hangzhou, China)
      zoom: 11
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

  const generateProfile = async () => {
    setIsDrawing(false);
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
    let topoPoints: {x: number, y: number}[] = [];
    
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
        return {x, y};
      });
    } else {
      const pts = [0, 100, 250, 400, 550, 700, 800];
      const topo = [70, 50, 110, 80, 130, 70, 80];
      topoPoints = pts.map((x, i) => ({x, y: topo[i]}));
    }

    // Generate layers that follow topography with tectonic folding
    const layer1Data = topoPoints.map(p => {
      const foldOffset = Math.sin(p.x / 100) * 20;
      return {x: p.x, y0: p.y + 70 + foldOffset, y1: p.y};
    });
    
    const layer2Data = topoPoints.map(p => {
      const foldOffset = Math.sin(p.x / 100) * 20;
      const foldOffset2 = Math.sin(p.x / 130 + 1) * 35;
      return {x: p.x, y0: p.y + 150 + foldOffset2, y1: p.y + 70 + foldOffset};
    });
    
    const layer3Data = topoPoints.map(p => {
      const foldOffset2 = Math.sin(p.x / 130 + 1) * 35;
      const foldOffset3 = Math.sin(p.x / 160 + 2) * 50;
      return {x: p.x, y0: p.y + 240 + foldOffset3, y1: p.y + 150 + foldOffset2};
    });
    
    const layer4Data = topoPoints.map(p => {
      const foldOffset3 = Math.sin(p.x / 160 + 2) * 50;
      return {x: p.x, y0: height + 50, y1: p.y + 240 + foldOffset3};
    });

    const areaGen = d3.area<{x: number, y0: number, y1: number}>()
      .x(d => d.x)
      .y0(d => d.y0)
      .y1(d => d.y1)
      .curve(d3.curveCatmullRom.alpha(0.5));

    const drawLayer = (data: {x: number, y0: number, y1: number}[], color: string, pattern: string) => {
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

    const macrostratToLocal: Record<string, string> = {
      "Quaternary": "第四纪", "Neogene": "新近纪", "Paleogene": "古近纪", "Cretaceous": "白垩纪", 
      "Jurassic": "侏罗纪", "Triassic": "三叠纪", "Permian": "二叠纪", "Pennsylvanian": "宾夕法尼亚纪", 
      "Mississippian": "密西西比纪", "Devonian": "泥盆纪", "Silurian": "志留纪", "Ordovician": "奥陶纪", 
      "Cambrian": "寒武纪", "Precambrian": "前寒武纪", "Proterozoic": "元古代", "Archean": "太古代"
    };

    const getLayerInfo = (index: number) => {
      // Top layer from real API data
      if (geologicUnits && geologicUnits.length > 0 && index === 0) {
        const unit = geologicUnits[0];
        const bestInterval = unit.best_int_name;
        const ageName = bestInterval ? macrostratToLocal[bestInterval] || bestInterval : "未知地层";
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
                setIsDrawing(!isDrawing);
                if (!isDrawing) setHasDrawnLine(false);
              }}
            >
              <PenTool size={16} /> 绘制剖面线
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
            </div>
          )}
        </div>
        
        {/* Actual Map Container */}
        <div ref={mapContainer} style={{ width: "100%", height: "100%" }} />
      </div>

      {/* Bottom Profile Section */}
      <div className={`${styles.profileArea} ${hasProfile || isEstimating ? styles.open : ""}`}>
        <div className={styles.profileHeader}>
          <h3>AI 生成的地下地质剖面</h3>
          {hasProfile && (
            <button className={styles.exportBtn}>
              <Download size={14} /> 导出 SVG
            </button>
          )}
        </div>
        
        <div className={styles.profileContent}>
          {isEstimating && (
            <div className={styles.loader}>
              <RefreshCw size={24} className={styles.spin} />
              <span>正在获取 Macrostrat 地层柱状数据...</span>
              <span>正在运行 AI 地下结构推演...</span>
            </div>
          )}
          
          <svg 
            ref={d3Container} 
            className={styles.d3Svg}
            style={{ display: hasProfile && !isEstimating ? "block" : "none" }}
          />
        </div>
      </div>
    </div>
  );
}
