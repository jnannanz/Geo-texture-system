"use client";

import React, { useState, useEffect } from "react";
import styles from "./Sidebar.module.css";
import geologicAgesData from "../config/geologic_ages.json";
import lithologyData from "../config/lithology-patterns.json";
import { ChevronDown, ChevronRight, Layers, Palette } from "lucide-react";

interface SidebarProps {
  selectedEra: string | null;
  onSelectEra: (era: string) => void;
  selectedLithology: string | null;
  onSelectLithology: (lithology: string) => void;
}

export default function Sidebar({
  selectedEra,
  onSelectEra,
  selectedLithology,
  onSelectLithology,
}: SidebarProps) {
  const [activeTab, setActiveTab] = useState<"era" | "lithology">("era");
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  // Group lithology by category
  const lithologyByCategory = lithologyData.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, typeof lithologyData>);

  return (
    <aside className={styles.sidebar}>
      <div className={styles.tabs}>
        <button 
          className={`${styles.tabBtn} ${activeTab === "era" ? styles.active : ""}`}
          onClick={() => setActiveTab("era")}
        >
          <Palette size={16} /> Era Colors
        </button>
        <button 
          className={`${styles.tabBtn} ${activeTab === "lithology" ? styles.active : ""}`}
          onClick={() => setActiveTab("lithology")}
        >
          <Layers size={16} /> Lithology
        </button>
      </div>

      <div className={styles.scrollArea}>
        {activeTab === "era" && (
          <div className={styles.colorGrid}>
            {geologicAgesData.map((era) => (
              <div 
                key={era.symbol}
                className={`${styles.eraCard} ${selectedEra === era.hex ? styles.selected : ""}`}
                onClick={() => onSelectEra(era.hex)}
              >
                <div className={styles.colorSwatch} style={{ backgroundColor: era.hex }}>
                  <span>{era.symbol}</span>
                </div>
                <div className={styles.eraInfo}>
                  <div className={styles.eraName}>{era.name}</div>
                  <div className={styles.eraCode}>CMYK: {era.cmyk}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "lithology" && (
          <div className={styles.lithologyList}>
            {Object.entries(lithologyByCategory).map(([category, items]) => (
              <div key={category} className={styles.categoryGroup}>
                <div 
                  className={styles.categoryHeader} 
                  onClick={() => toggleCategory(category)}
                >
                  {expandedCategories[category] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span>{category}</span>
                  <span className={styles.badge}>{items.length}</span>
                </div>
                
                {expandedCategories[category] && (
                  <div className={styles.itemsGrid}>
                    {items.map(item => (
                      <div 
                        key={item.id}
                        className={`${styles.lithologyCard} ${selectedLithology === item.id ? styles.selected : ""}`}
                        onClick={() => onSelectLithology(item.id)}
                        title={item.name}
                      >
                        <div className={styles.patternPreview}>
                          <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
                            <rect width="100" height="100" fill="#2a3346" />
                            <rect width="100" height="100" fill={`url(#${item.id})`} />
                          </svg>
                        </div>
                        <div className={styles.itemName}>{item.name}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
