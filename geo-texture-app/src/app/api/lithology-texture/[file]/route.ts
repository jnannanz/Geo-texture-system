import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const textureDir = path.resolve(process.cwd(), "..", "rock_legend_vectors", "png_crops");
const allowedFileName = /^legend_\d{2}_[a-z0-9_]+\.png$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;

  if (!allowedFileName.test(file)) {
    return new NextResponse("Invalid texture file", { status: 400 });
  }

  const filePath = path.join(textureDir, file);

  if (!filePath.startsWith(textureDir + path.sep)) {
    return new NextResponse("Invalid texture path", { status: 400 });
  }

  try {
    const image = await readFile(filePath);
    return new NextResponse(image, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Texture not found", { status: 404 });
  }
}
