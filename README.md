# FPV Log Viewer

基于 `React + TypeScript + Vite` 的 FPV 飞行日志可视化工具。  
可直接在浏览器上传 EdgeTX 导出的 CSV，进行 2D/3D 轨迹查看、点位详情分析和回放。
在线构建版本（可直接使用）：https://www.tuep.cn/fpv-log-viewer/
## 功能

- 本地上传 CSV（无后端）
- 2D 地图轨迹（OpenStreetMap 街道图 / 卫星图）
- 2D 地图来源可选（OpenStreetMap / 高德）
- 轨迹点点击查看详情（起点/中间点/终点/当前播放点/选中点）
- 平滑轨迹曲线显示
- 3D 空间轨迹（可拖动旋转、缩放）
- 高度坐标系切换（`Alt(m)#1` / `Alt(m)#2`）
- 3D Z 轴缩放（高度可视化增强）
- 回放控制（播放/暂停/快进倍速/上一帧/下一帧/拖拽时间轴）
- 全屏模式
- 中/英/日语言切换
- 明亮/暗黑主题切换

## 环境要求

- Node.js 18+
- npm 9+

## 安装与启动

```bash
npm install
npm run dev
```

构建生产版本：

```bash
npm run build
npm run preview
```

运行测试：

```bash
npm run test
npm run test:e2e
```

## CSV 要求

推荐使用 EdgeTX 导出的原始 CSV。当前解析逻辑重点依赖：

- `Date`
- `Time`
- `GPS`（格式应为 `lat lon`）
- `Alt(m)`（若出现重复列，会自动识别为 `Alt(m)#1` 和 `Alt(m)#2`）
- `GSpd(kmh)`（速度）
- `RxBt(V)` / `TxBat(V)`（电压）
- `Curr(A)`（电流）

说明：

- 文件支持 UTF-8，并尝试回退 `gb18030/gbk` 解码。
- 无效 GPS 或时间行会跳过并计入解析警告。

## 使用方式

1. 点击顶部 `Upload CSV` 上传日志文件。
2. 在顶部切换 `2D / 3D`。
3. 2D 模式下可切换街道图或卫星图，点击轨迹点查看右侧详情。
4. 可在顶部 `Map Source` 中切换 `OpenStreetMap` 或 `Amap(高德)`。
5. 3D 模式下可拖动旋转、滚轮缩放；使用 `Z Scale` 调整高度夸张程度。
6. 底部使用回放控制进行逐帧或连续播放。
7. 可切换语言、主题、全屏模式。

## 常见问题

- 卫星图加载失败：可能是网络受限，可切换回街道图。
- 轨迹未显示：请确认 CSV 包含有效 `GPS` 列且坐标合法。
- 中文列名乱码：请检查 CSV 编码，工具会自动尝试 UTF-8 与 gb18030/gbk。

## Example Log (example_log)

A sample CSV log is included in this repository for quick testing.

- Directory: `example_log/`
- File: `FPV --2026-02-13-142406.csv`
- Quick start:
  1. Run the app (`npm run dev`) or use the released build package.
  2. Click `Upload CSV` in the UI.
  3. Select `example_log/FPV --2026-02-13-142406.csv`.
