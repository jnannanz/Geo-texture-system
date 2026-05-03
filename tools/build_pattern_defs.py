import json
import os
import re

manifest_path = "rock_legend_vectors/manifest.json"
with open(manifest_path, 'r') as f:
    manifest = json.load(f)

# Grouping into categories based on standard geology (simple heuristic for now)
categories = {
    "Sedimentary (Clastic)": ["soil", "sand", "gravel", "drift", "till", "moraines", "loess", "conglomerate", "sandstone", "shale", "clay", "silt", "alluvium"],
    "Sedimentary (Chemical/Organic)": ["limestone", "dolomite", "chalk", "chert", "flint", "coal", "gypsum", "salt", "phosphate", "peat", "oil shale"],
    "Metamorphic": ["slate", "quartzite", "marble", "schist", "gneiss", "metamorphism"],
    "Igneous (Volcanic/Plutonic)": ["tuff", "breccia", "agglomerate", "basaltic", "andesitic", "granite", "porphyritic", "igneous", "lava"]
}

def categorize(label):
    lbl = label.lower()
    for cat, keywords in categories.items():
        if any(kw in lbl for kw in keywords):
            return cat
    return "Other"

lithology_patterns = []
patterns_jsx = []

for item in manifest:
    # Build lithology metadata
    cat = categorize(item['label'])
    pattern_id = f"pattern-{item['number']}"
    lithology_patterns.append({
        "id": pattern_id,
        "name": item['label'],
        "category": cat
    })
    
    # Read SVG file
    svg_path = item['svg']
    if not os.path.exists(svg_path):
        continue
    with open(svg_path, 'r') as f:
        svg_content = f.read()
    
    # Extract viewBox
    vb_match = re.search(r'viewBox="([^"]+)"', svg_content)
    if not vb_match:
        vb_match = re.search(r'width="([^"]+)" height="([^"]+)"', svg_content)
        if vb_match:
            viewBox = f"0 0 {vb_match.group(1)} {vb_match.group(2)}"
            width, height = vb_match.group(1), vb_match.group(2)
        else:
            viewBox = "0 0 100 100"
            width, height = 100, 100
    else:
        viewBox = vb_match.group(1)
        _, _, width, height = viewBox.split(" ")
        
    # Extract inner content
    inner_content = re.sub(r'<\?xml[^>]+\?>', '', svg_content)
    inner_content = re.sub(r'<svg[^>]+>', '', inner_content)
    inner_content = re.sub(r'</svg>', '', inner_content)
    # convert fill-rule to fillRule etc for React
    inner_content = inner_content.replace('fill-rule', 'fillRule')
    
    # Create pattern element
    # Use patternUnits="userSpaceOnUse" so the pattern tiles correctly at its native size
    pattern_tag = f'''      <pattern id="{pattern_id}" patternUnits="userSpaceOnUse" width="{width}" height="{height}" viewBox="{viewBox}">
        <g stroke="none" strokeWidth="1" fill="none" fillRule="evenodd">
          {{/* User can optionally style the path fill by overriding the currentColor, but we keep the raw paths */}}
          {inner_content.strip()}
        </g>
      </pattern>'''
    patterns_jsx.append(pattern_tag)

# Write PatternDefs.tsx
os.makedirs('geo-texture-app/src/components', exist_ok=True)
with open('geo-texture-app/src/components/PatternDefs.tsx', 'w') as f:
    f.write('import React from "react";\n\n')
    f.write('export default function PatternDefs() {\n')
    f.write('  return (\n')
    f.write('    <svg style={{ width: 0, height: 0, position: "absolute" }} aria-hidden="true">\n')
    f.write('      <defs>\n')
    f.write('\n'.join(patterns_jsx))
    f.write('\n      </defs>\n')
    f.write('    </svg>\n')
    f.write('  );\n')
    f.write('}\n')

# Write lithology-patterns.json
os.makedirs('geo-texture-app/src/config', exist_ok=True)
with open('geo-texture-app/src/config/lithology-patterns.json', 'w') as f:
    json.dump(lithology_patterns, f, indent=2, ensure_ascii=False)

print("Generated PatternDefs.tsx and lithology-patterns.json")
