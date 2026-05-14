---
title: "地图可视化性能优化：从 DOM 渲染到 WebGL"
description: "结合高德地图 JS API v2 + Loca 2.0，梳理 GeoJSON、坐标系偏移、瓦片缩放等基础概念，逐场景分析散点、热力图、聚合、区域着色的性能瓶颈，对比 DOM / Canvas / WebGL 三种技术路径的适用边界"
publishDate: "2026-05-15T00:00:00.000Z"
updatedDate: ""
tags: ["地图", "性能优化", "WebGL", "Loca", "高德地图", "可视化"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# 地图可视化性能优化：从 DOM 渲染到 WebGL

地图可视化项目最常见的性能问题不是"写法不对"，而是**渲染技术路径选错了**。用 DOM Marker 渲染 1 万个点，无论怎么优化代码逻辑都救不回来；换成 Canvas 或 WebGL 批量绘制，同样的数据量帧率可以相差 10 倍以上。

本文以高德地图 JS API v2 + Loca 2.0 为例，按场景逐一拆解瓶颈和对应方案。

---

## 为什么 DOM 渲染在地图场景会成为瓶颈

浏览器渲染管线的核心开销在 **Layout → Paint → Composite** 三步。DOM 元素数量和层叠复杂度直接决定这三步的耗时。

地图场景有两个特殊性：

1. **数据量大**：散点、区域数据动辄几千到几十万条记录，每条对应一个 DOM 节点会直接压垮主线程
2. **频繁重绘**：地图拖拽、缩放时所有覆盖物需要跟随重新定位，触发大量 reflow

三种技术路径的本质差别：

| 技术 | 渲染线程 | 单帧开销 | 适用量级 |
|------|----------|----------|----------|
| DOM Marker | 主线程 | 高（每个元素独立布局） | < 500 |
| Canvas（MassMarks / HeatMap） | 主线程（GPU 合成） | 低（批量绘制指令） | < 10 万 |
| WebGL（Loca） | GPU | 极低（顶点着色器批处理） | 100 万+ |

---

## 地图开发基础概念

### GeoJSON

GeoJSON 是地理数据的标准交换格式，Loca 的所有图层都以它作为数据输入。核心结构：

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [116.397, 39.909]
      },
      "properties": {
        "name": "天安门",
        "value": 0.85
      }
    }
  ]
}
```

`geometry.type` 决定图形类型，`properties` 存业务字段，Loca `setStyle` 里的回调函数通过 `feature.properties` 读取这些字段来映射颜色、大小等样式。

常用几何类型：

| 类型 | 坐标格式 | 用途 |
|------|----------|------|
| `Point` | `[lng, lat]` | 散点、标注 |
| `LineString` | `[[lng,lat], ...]` | 轨迹、路径 |
| `Polygon` | `[[[lng,lat], ...]]` | 区域、围栏（注意多一层数组，最后一个点需闭合回第一个点） |
| `MultiPolygon` | 再多一层数组 | 不连续区域（如省份含飞地） |

:::note[坐标顺序]
GeoJSON 规范坐标顺序是 **[经度, 纬度]**（longitude first），即先 X 后 Y，和直觉上的"纬经"顺序相反。高德 `AMap.LngLat` 的参数顺序也是 `(lng, lat)`，与 GeoJSON 一致。
:::

### 坐标系偏移

国内地图开发最常见的坑。三套坐标系并存：

| 坐标系 | 别名 | 使用方 |
|--------|------|--------|
| WGS-84 | 地球坐标 | GPS 设备、国际标准、OpenStreetMap |
| GCJ-02 | 火星坐标 | 高德、腾讯、国内所有地图（法定加密） |
| BD-09 | 百度坐标 | 百度地图 |

GCJ-02 在 WGS-84 基础上做了非线性偏移（偏移量因地区而异，北京附近约 500 米），**GPS 原始坐标直接丢到高德地图上会出现漂移**。

转换方案：

```ts
// 高德 API 提供官方转换
AMap.convertFrom(
  [116.397, 39.909],  // 待转换的 WGS-84 坐标
  'gps',              // 来源坐标系：'gps' | 'baidu' | 'mapbar'
  (status, result) => {
    if (status === 'complete') {
      const { lng, lat } = result.locations[0]
      console.log(lng, lat) // 转换后的 GCJ-02 坐标
    }
  },
)
```

批量数据建议在后端统一转换后入库，前端只消费 GCJ-02 坐标，避免每次渲染时做大量转换计算。

:::caution[境外数据]
GCJ-02 偏移只作用于中国大陆境内，港澳台及海外坐标不需要转换（直接用 WGS-84）。如果数据跨境，需要按经纬度范围判断是否转换，高德 API 会自动处理这个边界。
:::

### 瓦片地图与缩放级别

地图底图由大量 **256×256 像素的瓦片**拼接而成。缩放级别（Zoom Level）决定瓦片精度：

- `zoom = 1`：整个地球用 4 张瓦片覆盖
- `zoom = N`：地球被切成 `4^N` 张瓦片，每级精度翻倍
- 高德地图的 zoom 范围通常是 3 ~ 20，城市级别约 10 ~ 13，街道级别约 15 ~ 17

这对性能优化的意义在于：**不同缩放级别下合理的数据密度不同**。zoom 10 的视野下渲染 10 万个点毫无意义（点全部重叠），应该在低缩放时聚合或降采样，高缩放时才展示明细。这正是点聚合分级渲染策略的理论依据。

```ts
// 监听缩放变化，动态调整渲染策略
map.on('zoomend', () => {
  const zoom = map.getZoom()
  if (zoom >= 15) {
    // 街道级别：展示完整散点
  } else if (zoom >= 10) {
    // 城市级别：聚合显示
  } else {
    // 全国视野：只展示热力图或密度图
  }
})
```

### 视口裁剪与数据分片

当数据量极大（百万级）时，即使 WebGL 渲染性能够，传输和解析数据本身也是瓶颈。两个常用策略：

**视口裁剪**：只渲染当前可见区域内的数据，地图移动时动态更新：

```ts
// 获取当前视口范围
const bounds = map.getBounds()
const visiblePoints = allPoints.filter((point) => bounds.contains(point.lnglat))
```

**瓦片化分片（矢量瓦片）**：按缩放级别和地理格网把数据切成小块，按需加载。适合后端数据量超过百万的场景，通常结合 MVT（Mapbox Vector Tiles）格式和服务端瓦片接口实现。

---

## 散点标注

### 基础方案：DOM Marker

最直接的写法——每个数据点 `new AMap.Marker()`，加到地图上：

```ts title="scatter/marker.ts"
const markers = points.map(
  (point) =>
    new AMap.Marker({
      position: new AMap.LngLat(point.lnglat[0], point.lnglat[1]),
    }),
)
map.add(markers)
```

**问题**：5000 个点就会产生 5000 个独立 DOM 节点，初始化时主线程被同步阻塞，地图拖动时每帧都要重新计算所有节点位置。实测 3000 点以上页面开始明显掉帧。

### 优化一：MassMarks（Canvas 批量渲染）

高德的 `AMap.MassMarks` 把所有点画在一张 Canvas 上，绕开了 DOM 树：

```ts title="scatter/massmarks.ts"
const massLayer = new AMap.MassMarks(
  points.map((point) => ({ lnglat: point.lnglat })),
  {
    opacity: 0.9,
    zIndex: 120,
    style: [
      {
        url: `data:image/svg+xml;charset=UTF-8,${encodedSvgIcon}`,
        anchor: new AMap.Pixel(6, 6),
        size: new AMap.Size(12, 12),
      },
    ],
  },
)
massLayer.setMap(map)
```

:::caution[清除注意]
`MassMarks` 不能用 `map.remove()` 清除，必须调用 `massLayer.setMap(null)`，否则图层会残留在地图上。
:::

10 万个点以内基本流畅。图标样式固定，不支持逐点差异化样式（如按值变色）。

### 优化二：Loca ScatterLayer（WebGL 渲染）

当点位需要按数值映射颜色，或数量超过 10 万时，切换到 Loca 的 `ScatterLayer`：

```ts title="scatter/loca.ts"
const locaContainer = new Loca.Container({ map })
const layer = new Loca.ScatterLayer({ loca: locaContainer, zIndex: 120 })

layer.setSource(
  new Loca.GeoJSONSource({
    data: {
      type: 'FeatureCollection',
      features: points.map((point) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: point.lnglat },
        properties: { value: point.value },
      })),
    },
  }),
)

layer.setStyle({
  size: () => [7, 7],
  color: (_: unknown, feature: any) => valueToColor(feature.properties.value),
  borderWidth: 0,
  blurWidth: 3,
})

locaContainer.animate.start()
```

`setStyle` 的属性支持传函数，每个点可以读取自身的 `feature.properties` 来决定颜色、大小等样式，完全在 GPU 侧处理，主线程不参与。

---

## 热力图

### 基础方案：AMap.HeatMap 插件

高德内置的热力图插件基于 Canvas 实现，是热力图需求最直接的起点：

```ts title="heatmap/amapheat.ts"
await new Promise<void>((resolve) => {
  AMap.plugin('AMap.HeatMap', () => {
    const heatmapLayer = new AMap.HeatMap(map, {
      radius: 25,
      opacity: [0, 0.85],
    })
    heatmapLayer.setDataSet({
      data: points.map((point) => ({
        lng: point.lnglat[0],
        lat: point.lnglat[1],
        count: Math.round(point.value * 100),
      })),
      max: 100,
    })
    resolve()
  })
})
```

:::note[插件异步加载]
`AMap.HeatMap` 是按需插件，需要用 `AMap.plugin()` 异步加载后才能实例化，不能直接 `new`。同样需要用 `heatmapLayer.setMap(null)` 而非 `map.remove()` 来清除。
:::

Canvas 渲染，颜色渐变自然，5 万点以内基本流畅。色阶固定（蓝→绿→黄→红），无法自定义。

### 优化：Loca HeatMapLayer（WebGL 热力）

Loca 2.0 的热力图层走 WebGL 管线，支持自定义渐变色、半径单位（像素或米），更适合数据密集型场景：

```ts title="heatmap/locaheat.ts"
const locaContainer = new Loca.Container({ map })
const layer = new Loca.HeatMapLayer({
  loca: locaContainer,
  zIndex: 120,
  depth: false,
})

layer.setSource(new Loca.GeoJSONSource({ data: pointGeoJSON }))
layer.setStyle({
  unit: 'meter',   // 半径单位：米（随地图缩放自动缩放）
  radius: 2200,
  min: 0,
  max: 100,
  opacity: [0, 0.95],
  value: (_: unknown, feature: any) =>
    Math.round(feature.properties.value * 100),
  gradient: {
    0: 'rgba(34,211,238,0)',
    0.35: 'rgba(34,211,238,0.55)',
    0.6: 'rgba(250,204,21,0.8)',
    1: 'rgba(239,68,68,0.95)',
  },
})
locaContainer.animate.start()
```

:::caution[类名确认]
Loca 2.0 的热力图类名是 `Loca.HeatMapLayer`，不同版本也可能叫 `Loca.HeatLayer`，实例化前先检查 API 对象是否存在，避免静默失败。
:::

---

## 点聚合

数据点密集时，全量展示既影响性能，也让用户无法判断哪些区域有数据分布。点聚合是这类场景的标准解法。

### 基础方案：全量 Marker

同散点基础方案，不再赘述。主要问题是密集区域大量点重叠，交互体验差。

### 优化一：MarkerCluster 动态聚合

`AMap.MarkerCluster` 在低缩放级别把相邻点合并成聚合圆，高缩放时自动展开：

```ts title="cluster/marker-cluster.ts"
const clusterData = points.map((point) => ({
  lnglat: point.lnglat,
  weight: Math.round(point.value * 100),
}))

const clusterLayer = new AMap.MarkerCluster(map, clusterData, {
  gridSize: 60,
  maxZoom: 20,
  averageCenter: true,
  clusterByZoomChange: true,
  renderClusterMarker: (ctx: any) => {
    const size = ctx.count > 100 ? 48 : ctx.count > 20 ? 40 : 32
    const color = ctx.count > 100 ? '#ef4444' : ctx.count > 20 ? '#f97316' : '#3b82f6'
    const node = document.createElement('div')
    node.style.cssText = `
      width:${size}px; height:${size}px; border-radius:50%; background:${color};
      display:flex; align-items:center; justify-content:center;
      color:#fff; font-size:12px; font-weight:700;
    `
    node.textContent = ctx.count > 999 ? '999+' : String(ctx.count)
    ctx.marker.setOffset(new AMap.Pixel(-size / 2, -size / 2))
    ctx.marker.setContent(node)
  },
})
```

`renderClusterMarker` 回调让每个聚合泡泡可以按数量差异化渲染，直观展示各区域数据密度。

### 优化二：分级渲染（聚合 + MassMarks 切换）

聚合插件在极高缩放时仍然走 DOM Marker 展开，点数多时也会掉帧。分级渲染策略：**低缩放用聚合概览，高缩放切到 MassMarks 展示明细**。

```ts title="cluster/adaptive.ts"
// 初始化聚合层
const clusterLayer = new AMap.MarkerCluster(map, clusterData, { gridSize: 60 })
let massLayer: any = null

const switchLayer = () => {
  const zoom = map.getZoom()

  if (zoom > 14) {
    // 高缩放：隐藏聚合，展示 Canvas 散点
    clusterLayer.setMap?.(null)
    if (!massLayer) {
      massLayer = new AMap.MassMarks(
        points.map((p) => ({ lnglat: p.lnglat })),
        { opacity: 0.9, style: massMarksStyle },
      )
    }
    massLayer.setMap(map)
  } else {
    // 低缩放：隐藏散点，展示聚合
    massLayer?.setMap?.(null)
    clusterLayer.setMap?.(map)
  }
}

map.on('zoomend', switchLayer)
switchLayer() // 初始执行一次
```

这个策略的关键在于 **懒创建 MassMarks**（只在第一次切到高缩放时初始化），同时在 `clearAll` 时要确保 `zoomListener` 被正确移除，避免内存泄漏。

---

## 区域着色（Choropleth）

行政区划或网格数据按数值映射填充色，是 GIS 报表中的常见需求。

### 基础方案：DOM Polygon

逐个区域实例化 `AMap.Polygon`：

```ts title="choropleth/polygon.ts"
const polygons = cells.map(
  (cell) =>
    new AMap.Polygon({
      path: [cell.ring],
      fillColor: valueToColor(cell.value),
      fillOpacity: 0.72,
      strokeWeight: 0.5,
      strokeColor: 'rgba(255,255,255,0.15)',
    }),
)
map.add(polygons)
```

区域数量超过 500 时初始化明显变慢，地图交互时重绘开销大。

### 优化：Loca PolygonLayer（WebGL 面渲染）

Loca 的 `PolygonLayer` 把所有多边形合批到一次 WebGL Draw Call：

```ts title="choropleth/loca-polygon.ts"
const locaContainer = new Loca.Container({ map })
const layer = new Loca.PolygonLayer({
  loca: locaContainer,
  zIndex: 120,
  depth: false,
  hasSide: false,  // 不渲染侧面（2D 平面模式）
})

layer.setSource(
  new Loca.GeoJSONSource({
    data: {
      type: 'FeatureCollection',
      features: cells.map((cell) => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [cell.ring] },
        properties: { value: cell.value },
      })),
    },
  }),
)

layer.setStyle({
  topColor: (_: unknown, feature: any) => valueToColor(feature.properties.value),
  height: 0,
  altitude: 0,
})

locaContainer.animate.start()
```

2500 个区域的渲染耗时通常在 50ms 以内，明显优于 DOM 方案。

---

## 工程实践要点

### 1. Loca 容器的生命周期管理

`Loca.Container` 与地图实例绑定，持有 WebGL Context。销毁时必须调用 `locaContainer.destroy()`，否则 WebGL Context 泄漏会在长时间运行后导致渲染异常。

```ts
// clearAll 时的清理顺序很重要
function clearAll(map: any) {
  cancelAnimationFrame(animRafId)

  // 先移除 zoomend 监听，避免切换期间触发残留回调
  if (zoomListener) {
    map.off('zoomend', zoomListener)
    zoomListener = null
  }

  // DOM 覆盖物
  if (overlays.length) {
    map.remove(overlays)
    overlays = []
  }

  // Loca 容器：必须 destroy，不能只是隐藏图层
  if (locaContainer) {
    locaContainer.destroy()
    locaContainer = null
  }

  // HeatMap 插件：用 setMap(null) 而非 map.remove()
  if (heatmapLayer) {
    heatmapLayer.setMap(null)
    heatmapLayer = null
  }

  // MassMarks：同样用 setMap(null)
  if (massMarksLayer) {
    massMarksLayer.setMap(null)
    massMarksLayer = null
  }
}
```

:::caution[MassMarks 不能用 map.remove()]
`AMap.MassMarks` 不是标准 Overlay，`map.remove()` 对它无效。必须调用 `massLayer.setMap(null)` 才能从地图上移除。同理，`AMap.HeatMap` 也需要 `heatmapLayer.setMap(null)`。
:::

### 2. 数据集缓存

渲染方案切换时，相同参数（模式 + 数量）的数据集应该复用，避免重复生成随机数据：

```ts
const datasetCache = new Map<string, DataPoint[]>()

function getDataset(mode: string, count: number) {
  const key = `${mode}:${count}`
  if (datasetCache.has(key)) return datasetCache.get(key)!

  const dataset = generateData(mode, count)
  datasetCache.set(key, dataset)
  return dataset
}
```

实际项目中对应的是接口请求缓存：同一查询参数不重复发请求，切换视图时直接用缓存数据重新渲染。

### 3. 按需加载插件

高德 JS API 的部分能力（HeatMap、MarkerCluster）需要异步加载插件，在 `initMap` 阶段统一预加载，避免渲染时的异步等待：

```ts title="composables/useAmap.ts"
AMapLoader.load({
  key: import.meta.env.VITE_AMAP_KEY,
  version: '2.0',
  plugins: [
    'AMap.MassMarks',
    'AMap.MarkerCluster',
    'AMap.HeatMap',
  ],
})
```

Loca 2.0 通过独立脚本加载，挂载在 `window.Loca`，使用前需检查：

```ts
const Loca = (window as any).Loca
if (!Loca?.Container) {
  throw new Error('Loca 未加载成功')
}
```

### 4. Web Worker 处理大数据

坐标批量转换、大体积 GeoJSON 解析、数据聚合计算等操作如果放主线程，会在数据量较大时阻塞 UI，导致地图短暂冻结。这类纯计算任务适合移到 Worker 里：

```ts title="workers/geo.worker.ts"
// Worker 内部：接收原始数据，返回处理结果
self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data

  if (type === 'transform') {
    // 批量 WGS-84 → GCJ-02 坐标转换（纯数学运算，不依赖 DOM）
    const result = payload.map(gcj02Transform)
    self.postMessage({ type: 'transform:done', result })
  }

  if (type === 'buildGeoJSON') {
    // 把原始数组组装成 GeoJSON FeatureCollection
    const result = {
      type: 'FeatureCollection',
      features: payload.map((item: any) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [item.lng, item.lat] },
        properties: { value: item.value },
      })),
    }
    self.postMessage({ type: 'buildGeoJSON:done', result })
  }
}
```

```ts title="composables/useGeoWorker.ts"
// 主线程：封装 Worker 调用为 Promise
const worker = new Worker(new URL('../workers/geo.worker.ts', import.meta.url), {
  type: 'module',
})

function buildGeoJSON(rawData: RawPoint[]): Promise<GeoJSON> {
  return new Promise((resolve) => {
    worker.postMessage({ type: 'buildGeoJSON', payload: rawData })
    worker.onmessage = (e) => {
      if (e.data.type === 'buildGeoJSON:done') resolve(e.data.result)
    }
  })
}
```

:::note[适用边界]
Worker 适合**纯计算**任务（坐标转换、数组聚合、JSON 序列化）。AMap API、Loca API 都依赖 `window` 和 DOM，无法在 Worker 内使用，渲染调用仍需在主线程发起。
:::

### 5. 地图交互事件节流

`moveend`、`zoomend` 等事件会在地图操作结束后触发，如果回调里有数据请求或重新渲染逻辑，用户连续操作时会产生大量无效调用。视口裁剪场景尤为明显：

```ts
// 错误写法：每次 moveend 都触发数据请求
map.on('moveend', () => {
  const bounds = map.getBounds()
  fetchAndRender(bounds) // 用户快速拖动时会发出几十个请求
})
```

用防抖控制请求频率：

```ts
function debounce<T extends (...args: any[]) => void>(fn: T, delay: number) {
  let timer = 0
  return (...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = window.setTimeout(() => fn(...args), delay)
  }
}

const onViewChange = debounce(() => {
  const bounds = map.getBounds()
  const zoom = map.getZoom()
  fetchAndRender(bounds, zoom)
}, 300)

map.on('moveend', onViewChange)
map.on('zoomend', onViewChange)
```

如果渲染本身耗时较长（如重建 Loca 图层），还需要配合一个 **进行中标志位** 防止并发执行：

```ts
let isPending = false

const onViewChange = debounce(async () => {
  if (isPending) return
  isPending = true
  try {
    await fetchAndRender(map.getBounds(), map.getZoom())
  } finally {
    isPending = false
  }
}, 300)
```

### 6. 渲染技术路径选型参考

| 场景 | 数量 | 推荐方案 |
|------|------|----------|
| 散点，无差异化样式 | < 5 万 | MassMarks |
| 散点，按值映射颜色 | 任意 | Loca ScatterLayer |
| 热力图，常规展示 | < 5 万 | AMap.HeatMap（Canvas） |
| 热力图，自定义色阶或大数据量 | > 5 万 | Loca HeatMapLayer（WebGL） |
| 散点聚合 | < 5 万 | MarkerCluster |
| 散点聚合 + 明细 | > 5 万 | 分级（Cluster + MassMarks） |
| 区域着色 | < 200 | AMap.Polygon |
| 区域着色 | > 200 | Loca PolygonLayer |

---

## 小结

地图可视化的性能瓶颈几乎都出现在**渲染管线的选择**上，而不是业务逻辑本身。核心原则：

- **能用 Canvas 就不用 DOM**：MassMarks、HeatMap 插件都是 Canvas 实现，比同等数量的 DOM 元素开销小一到两个数量级
- **能用 WebGL 就不用 Canvas**：Loca 图层把计算搬到 GPU，适合 10 万级以上的数据量
- **生命周期管理不能省**：Loca 容器、MassMarks、HeatMap 都有独立的销毁接口，清理逻辑写错会导致内存泄漏和图层残留
- **数据和渲染分离**：数据生成和缓存独立于渲染层，切换方案时复用数据而不是重新生成
- **大数据计算放 Worker**：坐标批量转换、GeoJSON 组装等纯计算任务移到 Web Worker，主线程只负责渲染调用
- **交互事件要节流**：`moveend`/`zoomend` 回调里有请求或重渲染时，务必加防抖，配合进行中标志位防止并发

不同 SDK 版本的 API 细节（如 `HeatMapLayer` vs `HeatLayer` 类名）可能有差异，建议在 `initLoca` 阶段做防御性检查，提前暴露版本兼容问题。
