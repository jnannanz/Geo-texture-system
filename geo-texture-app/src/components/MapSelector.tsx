"use client";

import React, { useState, useRef } from "react";
import styles from "./MapSelector.module.css";
import { PenTool, Map as MapIcon, RefreshCw, Download } from "lucide-react";
import * as d3 from "d3";
import geologicAgesData from "../config/geologic_ages.json";

export default function MapSelector() {
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [isEstimating, setIsEstimating] = useState(false);
  const d3Container = useRef<SVGSVGElement>(null);

  // Mock function to simulate AI subsurface estimation
  const generateMockProfile = () => {
    setIsDrawing(false);
    setIsEstimating(true);
    
    setTimeout(() => {
      setIsEstimating(false);
      setHasProfile(true);
      renderD3Profile();
    }, 1500);
  };

  const renderD3Profile = () => {
    if (!d3Container.current) return;
    
    const svg = d3.select(d3Container.current);
    svg.selectAll("*").remove();

    const width = 800;
    const height = 300;
    
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    // Mock topography
    const topCurve = [
      [0, 50], [100, 40], [200, 80], [300, 100], [400, 60], 
      [500, 40], [600, 30], [700, 70], [800, 50]
    ];

    // Surface layer (Q - Quaternary, pattern-1)
    const layer1 = [...topCurve, [800, 120], [0, 120]];
    
    // Middle layer (K - Cretaceous, pattern-15)
    const layer2 = [[0, 120], [800, 120], [800, 200], [0, 180]];
    
    // Bottom layer (J - Jurassic, pattern-25)
    const layer3 = [[0, 180], [800, 200], [800, 300], [0, 300]];

    const drawPolygon = (data: number[][], color: string, pattern: string) => {
      // Base color layer
      svg.append("polygon")
         .attr("points", data.map(d => d.join(",")).join(" "))
         .attr("fill", color)
         .attr("stroke", "#111")
         .attr("stroke-width", 1);
         
      // Pattern overlay layer
      svg.append("polygon")
         .attr("points", data.map(d => d.join(",")).join(" "))
         .attr("fill", `url(#${pattern})`)
         .style("mix-blend-mode", "multiply")
         .style("opacity", 0.6)
         .attr("stroke", "none");
    };

    // Get colors from config
    const qColor = geologicAgesData.find(e => e.symbol === "Q")?.hex || "#FFFF4D";
    const kColor = geologicAgesData.find(e => e.symbol === "K")?.hex || "#80FF4D";
    const jColor = geologicAgesData.find(e => e.symbol === "J")?.hex || "#66FF99";

    // Draw layers
    drawPolygon(layer1, qColor, "pattern-1"); // Alluvium
    drawPolygon(layer2, kColor, "pattern-15"); // Limestone
    drawPolygon(layer3, jColor, "pattern-25"); // Shale
    
    // Add Labels
    svg.append("text").attr("x", 400).attr("y", 90).text("Quaternary (Alluvium)").attr("font-size", 12).attr("text-anchor", "middle");
    svg.append("text").attr("x", 400).attr("y", 160).text("Cretaceous (Limestone)").attr("font-size", 12).attr("text-anchor", "middle");
    svg.append("text").attr("x", 400).attr("y", 250).text("Jurassic (Shale)").attr("font-size", 12).attr("text-anchor", "middle");
  };

  return (
    <div className={styles.container}>
      {/* Top Map Section */}
      <div className={styles.mapArea}>
        <div className={styles.mapOverlay}>
          <div className={styles.mapControls}>
            <button 
              className={`${styles.controlBtn} ${isDrawing ? styles.active : ""}`}
              onClick={() => setIsDrawing(!isDrawing)}
            >
              <PenTool size={16} /> Draw Profile Line
            </button>
            {isDrawing && (
              <button className={styles.actionBtn} onClick={generateMockProfile}>
                Generate Cross-Section
              </button>
            )}
          </div>
          
          <div className={styles.mapPlaceholder}>
            <MapIcon size={48} className={styles.mapIcon} />
            <h3>Mapbox GL JS Integration</h3>
            <p>Please configure MAPBOX_ACCESS_TOKEN in .env</p>
            {isDrawing && <div className={styles.drawingHint}>Click on the map to draw A-B line...</div>}
          </div>
        </div>
      </div>

      {/* Bottom Profile Section */}
      <div className={`${styles.profileArea} ${hasProfile || isEstimating ? styles.open : ""}`}>
        <div className={styles.profileHeader}>
          <h3>Generated AI Subsurface Profile</h3>
          {hasProfile && (
            <button className={styles.exportBtn}>
              <Download size={14} /> Export SVG
            </button>
          )}
        </div>
        
        <div className={styles.profileContent}>
          {isEstimating && (
            <div className={styles.loader}>
              <RefreshCw size={24} className={styles.spin} />
              <span>Fetching Macrostrat Stratigraphic Columns...</span>
              <span>Running AI Subsurface Estimation...</span>
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
