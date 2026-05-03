#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps


SOURCE = Path(
    "/Users/amos/Library/CloudStorage/Dropbox/+格记项目+/～何以江南/地质肌理系统可视化设计/图例-美国地质调查局报告插图准备指南1920.jpg"
)
OUT_DIR = Path("rock_legend_vectors")
SVG_DIR = OUT_DIR / "svg"
PNG_DIR = OUT_DIR / "png_crops"
THRESHOLD = 165


LABELS = [
    "Soil, silt, or alluvium",
    "Sand",
    "Gravel and stratified drift",
    "Glacial till and moraines a",
    "Glacial till and moraines b",
    "Loess",
    "Conglomerate",
    "Massive sandstone",
    "Bedded sandstone",
    "Cross-bedded sandstone",
    "Quartzite",
    "Thin-bedded or shaly sandstone",
    "Calcareous sandstone",
    "Sandy limestone",
    "Massively bedded limestone",
    "Thin-bedded limestone",
    "Limestone containing nodules of chert or flint",
    "Bedded chert",
    "Dolomite",
    "Marble",
    "Crystalline limestone",
    "Chalk",
    "Clayey or argillaceous limestone",
    "Calcareous shale or shaly limestone",
    "Shale",
    "Sandy shale",
    "Slate",
    "Clay",
    "Sandy clay",
    "Fire clay or flint clay",
    "Coal",
    "Bony coal or impure coal",
    "Bone",
    "Cannel coal",
    "Cannel shale",
    "Carbonaceous shale",
    "Gypsum",
    "Salt",
    "Phosphate rock",
    "Breccia",
    "Peat",
    "Oil shale",
    "Metamorphism",
    "Schistose or gneissoid granite",
    "Gneiss",
    "Contorted gneiss",
    "Gneiss and schist",
    "Schist",
    "Contorted schist",
    "Volcanic breccia and tuff",
    "Volcanic breccia or agglomerate",
    "Basaltic flows",
    "Bedded lava andesitic",
    "Bedded lava and tuff",
    "Granite",
    "Soapstone talc and serpentine",
    "Massive igneous rock 57",
    "Massive igneous rock 58",
    "Massive igneous rock 59",
    "Massive igneous rock 60",
    "Massive igneous rock 61",
    "Porphyritic rock 62",
    "Porphyritic rock 63",
    "Porphyritic rock 64",
    "Massive igneous rock 65",
    "Massive igneous rock 66",
    "Massive igneous rock 67",
    "Massive igneous rock 68",
    "Brecciated rock",
    "Quartz",
    "Ore solid black in thin areas",
    "Ore",
    "Lean ore",
    "Bedrock kind not indicated",
    "Blank",
]


def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return text.strip("_")[:54]


def connected_component_boxes(mask: np.ndarray) -> list[tuple[int, int, int, int]]:
    parent: list[int] = []
    bbox: list[list[int]] = []
    area: list[int] = []

    def new_label(x0: int, x1: int, y: int) -> int:
        i = len(parent)
        parent.append(i)
        bbox.append([x0, y, x1, y])
        area.append(x1 - x0 + 1)
        return i

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a: int, b: int) -> int:
        ra, rb = find(a), find(b)
        if ra == rb:
            return ra
        if area[ra] < area[rb]:
            ra, rb = rb, ra
        parent[rb] = ra
        bbox[ra][0] = min(bbox[ra][0], bbox[rb][0])
        bbox[ra][1] = min(bbox[ra][1], bbox[rb][1])
        bbox[ra][2] = max(bbox[ra][2], bbox[rb][2])
        bbox[ra][3] = max(bbox[ra][3], bbox[rb][3])
        area[ra] += area[rb]
        return ra

    previous_runs: list[tuple[int, int, int]] = []
    for y, row in enumerate(mask):
        xs = np.flatnonzero(row)
        current_runs: list[tuple[int, int, int]] = []
        if xs.size:
            gap_positions = np.flatnonzero(np.diff(xs) > 1)
            starts = [int(xs[0])]
            ends: list[int] = []
            for gap in gap_positions:
                ends.append(int(xs[gap]))
                starts.append(int(xs[gap + 1]))
            ends.append(int(xs[-1]))

            previous_index = 0
            for x0, x1 in zip(starts, ends):
                label = new_label(x0, x1, y)
                while (
                    previous_index < len(previous_runs)
                    and previous_runs[previous_index][1] < x0 - 1
                ):
                    previous_index += 1
                overlap_index = previous_index
                while (
                    overlap_index < len(previous_runs)
                    and previous_runs[overlap_index][0] <= x1 + 1
                ):
                    label = union(label, previous_runs[overlap_index][2])
                    overlap_index += 1
                root = find(label)
                bbox[root][0] = min(bbox[root][0], x0)
                bbox[root][1] = min(bbox[root][1], y)
                bbox[root][2] = max(bbox[root][2], x1)
                bbox[root][3] = max(bbox[root][3], y)
                area[root] += x1 - x0 + 1
                current_runs.append((x0, x1, root))
        previous_runs = current_runs

    roots = {find(i) for i in range(len(parent))}
    return [tuple(bbox[root]) for root in roots]


def detect_symbol_boxes(image: Image.Image) -> list[tuple[int, int, int, int]]:
    gray = image.convert("L")
    dark = np.array(gray) < THRESHOLD
    dilated = Image.fromarray(dark.astype("uint8") * 255).filter(ImageFilter.MaxFilter(3))
    boxes = connected_component_boxes(np.array(dilated) > 0)
    symbol_boxes = []
    for x0, y0, x1, y1 in boxes:
        w = x1 - x0 + 1
        h = y1 - y0 + 1
        if 170 <= w <= 380 and 70 <= h <= 190:
            symbol_boxes.append((x0, y0, x1, y1))
    return order_boxes(symbol_boxes)


def order_boxes(boxes: list[tuple[int, int, int, int]]) -> list[tuple[int, int, int, int]]:
    rows: list[list[tuple[int, int, int, int]]] = []
    for box in sorted(boxes, key=lambda b: (b[1] + b[3]) / 2):
        cy = (box[1] + box[3]) / 2
        for row in rows:
            row_cy = sum((b[1] + b[3]) / 2 for b in row) / len(row)
            if abs(cy - row_cy) < 70:
                row.append(box)
                break
        else:
            rows.append([box])
    ordered: list[tuple[int, int, int, int]] = []
    for row in rows:
        ordered.extend(sorted(row, key=lambda b: b[0]))
    return ordered


def path_from_mask(mask: np.ndarray) -> str:
    rects: list[tuple[int, int, int, int]] = []
    active: dict[tuple[int, int], tuple[int, int, int]] = {}
    for y, row in enumerate(mask):
        xs = np.flatnonzero(row)
        runs: list[tuple[int, int]] = []
        if xs.size:
            gaps = np.flatnonzero(np.diff(xs) > 1)
            starts = [int(xs[0])]
            ends: list[int] = []
            for gap in gaps:
                ends.append(int(xs[gap]) + 1)
                starts.append(int(xs[gap + 1]))
            ends.append(int(xs[-1]) + 1)
            runs = list(zip(starts, ends))

        next_active: dict[tuple[int, int], tuple[int, int, int]] = {}
        for x0, x1 in runs:
            key = (x0, x1)
            if key in active:
                start_y, _, _ = active.pop(key)
                next_active[key] = (start_y, y + 1, x1 - x0)
            else:
                next_active[key] = (y, y + 1, x1 - x0)
        for (x0, _), (start_y, end_y, width) in active.items():
            rects.append((x0, start_y, width, end_y - start_y))
        active = next_active

    for (x0, _), (start_y, end_y, width) in active.items():
        rects.append((x0, start_y, width, end_y - start_y))

    return " ".join(f"M{x},{y}h{w}v{h}h{-w}z" for x, y, w, h in rects)


def write_svg(path: Path, crop: Image.Image, title: str) -> None:
    gray = ImageOps.autocontrast(crop.convert("L"), cutoff=1)
    mask = np.array(gray) < 182
    d = path_from_mask(mask)
    width, height = crop.size
    path.write_text(
        "\n".join(
            [
                '<?xml version="1.0" encoding="UTF-8"?>',
                f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">',
                f"  <title>{title}</title>",
                '  <path fill="#111111" fill-rule="nonzero" d="',
                f"    {d}",
                '  "/>',
                "</svg>",
            ]
        ),
        encoding="utf-8",
    )


def make_preview(image: Image.Image, boxes: list[tuple[int, int, int, int]]) -> None:
    preview = image.copy().convert("RGB")
    draw = ImageDraw.Draw(preview)
    for index, (x0, y0, x1, y1) in enumerate(boxes, start=1):
        draw.rectangle((x0, y0, x1, y1), outline=(220, 0, 0), width=5)
        draw.text((x0 + 6, y0 + 6), str(index), fill=(220, 0, 0))
    preview.save(OUT_DIR / "detected_boxes_preview.jpg", quality=92)


def make_contact_sheet(items: list[tuple[int, str, Image.Image]]) -> None:
    cell_w, cell_h = 340, 220
    cols = 5
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), "white")
    draw = ImageDraw.Draw(sheet)
    for offset, (number, label, crop) in enumerate(items):
        col = offset % cols
        row = offset // cols
        x = col * cell_w
        y = row * cell_h
        resized = crop.convert("RGB")
        resized.thumbnail((290, 145), Image.Resampling.LANCZOS)
        px = x + (cell_w - resized.width) // 2
        py = y + 24
        sheet.paste(resized, (px, py))
        draw.text((x + 18, y + 176), f"{number:02d} {label[:36]}", fill=(20, 20, 20))
    sheet.save(OUT_DIR / "contact_sheet.jpg", quality=92)


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    SVG_DIR.mkdir(exist_ok=True)
    PNG_DIR.mkdir(exist_ok=True)

    image = Image.open(SOURCE)
    boxes = detect_symbol_boxes(image)
    if len(boxes) != 75:
        raise RuntimeError(f"Expected 75 symbol boxes, found {len(boxes)}")

    manifest = []
    crops = []
    for index, box in enumerate(boxes, start=1):
        label = LABELS[index - 1]
        slug = slugify(label)
        stem = f"legend_{index:02d}_{slug}"
        crop = image.crop((box[0], box[1], box[2] + 1, box[3] + 1))
        png_path = PNG_DIR / f"{stem}.png"
        svg_path = SVG_DIR / f"{stem}.svg"
        crop.save(png_path)
        write_svg(svg_path, crop, f"{index:02d} {label}")
        manifest.append(
            {
                "number": index,
                "label": label,
                "bbox": list(box),
                "svg": str(svg_path),
                "png": str(png_path),
            }
        )
        crops.append((index, label, crop))

    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    make_preview(image, boxes)
    make_contact_sheet(crops)
    print(f"Wrote {len(boxes)} SVG files to {SVG_DIR}")


if __name__ == "__main__":
    main()
