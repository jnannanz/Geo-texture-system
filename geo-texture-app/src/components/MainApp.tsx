"use client";

import React, { useState } from "react";
import Sidebar from "./Sidebar";
import TopNav from "./TopNav";
import ProfileViewer from "./ProfileViewer";
import MapSelector from "./MapSelector";
import styles from "./MainApp.module.css";

export default function MainApp() {
  const [activeMode, setActiveMode] = useState<"cloud" | "local">("local");
  const [selectedEra, setSelectedEra] = useState<string | null>(null);
  const [selectedLithology, setSelectedLithology] = useState<string | null>(null);

  return (
    <div className={styles.appContainer}>
      <TopNav activeMode={activeMode} onModeChange={setActiveMode} />
      
      <div className={styles.contentArea}>
        <Sidebar 
          selectedEra={selectedEra} 
          onSelectEra={setSelectedEra} 
          selectedLithology={selectedLithology}
          onSelectLithology={setSelectedLithology}
        />
        
        <main className={styles.mainViewer}>
          {activeMode === "local" ? (
            <ProfileViewer 
              selectedEra={selectedEra} 
              selectedLithology={selectedLithology} 
            />
          ) : (
            <MapSelector />
          )}
        </main>
      </div>
    </div>
  );
}
