"use client";

import React from "react";
import { Map, PenTool } from "lucide-react";
import styles from "./TopNav.module.css";

interface TopNavProps {
  activeMode: "cloud" | "local";
  onModeChange: (mode: "cloud" | "local") => void;
}

export default function TopNav({ activeMode, onModeChange }: TopNavProps) {
  return (
    <header className={styles.topNav}>
      <div className={styles.logo}>
        <span className={styles.logoIcon}>◮</span>
        <h1>GeoTexture</h1>
      </div>
      
      <div className={styles.modeSwitch}>
        <button 
          className={`${styles.modeBtn} ${activeMode === "cloud" ? styles.active : ""}`}
          onClick={() => onModeChange("cloud")}
        >
          <Map size={18} />
          <span>Cloud Cross-Section</span>
        </button>
        <button 
          className={`${styles.modeBtn} ${activeMode === "local" ? styles.active : ""}`}
          onClick={() => onModeChange("local")}
        >
          <PenTool size={18} />
          <span>Local 2D SVG</span>
        </button>
      </div>

      <div className={styles.actions}>
        <button className={styles.exportBtn}>Export</button>
      </div>
    </header>
  );
}
