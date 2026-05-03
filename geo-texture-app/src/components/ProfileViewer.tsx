"use client";

import React, { useState, useRef } from "react";
import styles from "./ProfileViewer.module.css";
import { Upload } from "lucide-react";

interface ProfileViewerProps {
  selectedEra: string | null;
  selectedLithology: string | null;
}

export default function ProfileViewer({ selectedEra, selectedLithology }: ProfileViewerProps) {
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === "image/svg+xml") {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setSvgContent(ev.target?.result as string);
      };
      reader.readAsText(file);
    }
  };

  const handleSvgClick = (e: React.MouseEvent) => {
    const target = e.target as SVGElement;
    if (target.tagName.toLowerCase() === "path" || target.tagName.toLowerCase() === "polygon") {
      if (selectedEra) {
        target.style.fill = selectedEra;
      }
      if (selectedLithology) {
        // We need dual layer to apply texture on top of color.
        // If the path doesn't have a texture layer sibling, we clone it.
        const parent = target.parentNode;
        if (parent) {
          const isTextureLayer = target.getAttribute("data-is-texture") === "true";
          
          if (!isTextureLayer) {
            // Check if it already has a texture layer sibling next to it
            const nextSibling = target.nextElementSibling;
            let textureLayer = null;
            if (nextSibling && nextSibling.getAttribute("data-is-texture") === "true") {
              textureLayer = nextSibling;
            }

            if (!textureLayer) {
              textureLayer = target.cloneNode(true) as SVGElement;
              textureLayer.setAttribute("data-is-texture", "true");
              textureLayer.style.pointerEvents = "none"; // Let clicks pass through to the base layer
              parent.insertBefore(textureLayer, target.nextSibling);
            }
            
            // Apply the pattern to the texture layer
            (textureLayer as SVGElement).style.fill = `url(#${selectedLithology})`;
          }
        }
      }
    }
  };

  return (
    <div className={styles.viewerContainer}>
      {!svgContent ? (
        <div className={styles.uploadState}>
          <Upload size={48} className={styles.uploadIcon} />
          <h2>Upload Profile SVG</h2>
          <p>Export your line art from Illustrator as SVG and drop it here.</p>
          <label className={styles.uploadBtn}>
            Select SVG File
            <input type="file" accept=".svg" onChange={handleFileUpload} hidden />
          </label>
        </div>
      ) : (
        <div 
          className={styles.svgWrapper} 
          ref={containerRef}
          onClick={handleSvgClick}
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      )}
    </div>
  );
}
