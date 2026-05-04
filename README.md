# GeoTexture System

GeoTexture System 是一个面向地质图件和剖面图制作的 Web 工具。项目当前包含一个 Next.js 应用、岩性纹理矢量库，以及从图例素材生成 React SVG pattern 的辅助脚本。

## 主要功能

- 本地 SVG 剖面填色：上传 Illustrator 导出的 SVG 线稿，点击地层面后应用地质年代色和岩性纹理。
- 岩性纹理库：内置 75 个岩性图例纹理，支持按沉积岩、变质岩、火成岩等类别浏览。
- 地质年代色卡：维护常用地质年代颜色数据，供剖面着色使用。
- 地图剖面推演：在 Mapbox 地图上绘制 A-B 剖面线，读取地形并尝试结合 Macrostrat 数据生成示意地质剖面。
- 3D 地形块渲染：在 Mapbox 地图上拖拽矩形范围，采样 DEM 并用 Three.js 实时渲染地表和推断式地下岩层。

## 项目结构

```text
Geo-texture-system/
├── geo-texture-app/             # Next.js 前端应用
│   ├── src/app/                 # App Router 页面入口
│   ├── src/components/          # 主界面、侧栏、地图、剖面编辑组件
│   └── src/config/              # 地质年代色卡与岩性纹理元数据
├── rock_legend_vectors/         # 岩性图例的 SVG/PNG 资源与 manifest
└── tools/                       # 图例提取与 PatternDefs 生成脚本
```

## 本地运行

```bash
cd geo-texture-app
npm install
npm run dev
```

然后打开 `http://localhost:3000`。

如需使用地图剖面推演，在 `geo-texture-app/.env.local` 中加入：

```bash
NEXT_PUBLIC_MAPBOX_TOKEN=你的_Mapbox_token
```

## 常用命令

```bash
cd geo-texture-app
npm run lint
npm run build
```

重新生成岩性纹理定义：

```bash
python tools/build_pattern_defs.py
```

## 维护建议

- 岩性纹理资源以 `rock_legend_vectors/manifest.json` 为索引，更新素材后再运行生成脚本。
- `geo-texture-app/src/components/PatternDefs.tsx` 是生成文件，体积较大，修改纹理时优先改源 SVG 或生成脚本。
- 本地上传 SVG 当前直接注入页面，适合个人本地使用；如果部署给外部用户，应先加入 SVG 清洗和文件安全校验。
- 3D 地块中的 DEM 来自 Mapbox 当前可查询地形；地下岩层为基于 Macrostrat 地表单元的示意推断，不等同于钻孔或地震解释成果。
- `.env.local`、`.DS_Store`、压缩包和本地工具目录不应提交到 GitHub。

## GitHub Desktop 后续管理

1. 用 GitHub Desktop 打开本仓库目录 `Geo-texture-system`。
2. 修改代码后先查看左侧 Changed Files，确认只包含本次要提交的文件。
3. 在 Summary 写简短提交说明，例如 `Update texture library`，点击 Commit to main。
4. 点击 Push origin 同步到 GitHub。
5. 如果多人协作，开始修改前先点 Fetch origin / Pull origin，避免和远端改动冲突。
6. 做较大功能时建议新建 branch，完成后用 Pull Request 合并回 `main`。
