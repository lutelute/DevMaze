import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { select } from 'd3-selection'
import { zoom as d3zoom, zoomIdentity, zoomTransform, type ZoomBehavior, type D3ZoomEvent } from 'd3-zoom'
import 'd3-transition'
import s from './maze.module.css'
import MazeScene from './MazeScene'
import Minimap from './Minimap'
import Legend from './Legend'
import NodeTooltip from './NodeTooltip'
import { IconButton } from '@/components/ui'
import { useStore } from '@/store'
import { useResult, useHighlightIds, useStruggleIds, useSeverityByHash } from '@/store/selectors'
import {
  buildMazeItems, buildMazeLayout, mapHighlightToItems, mapStruggleToItems, fitTransform,
  DISPLAY_LIMITS, type MazeItem, type MazeLayout,
} from '@shared/maze'

const SIZE_EPS = 24

/** 倍率を3段に畳む。文字の出し分けは CSS がこの属性を見る */
const zoomLevel = (k: number) => (k > 0.9 ? 'close' : k > 0.42 ? 'mid' : 'far')

export default function MazeView() {
  const result = useResult()!
  const filterTypes = useStore(st => st.filterTypes)
  const unitPref = useStore(st => st.unit)
  const displayLimit = useStore(st => st.displayLimit)
  const selectedHash = useStore(st => st.selectedHash)
  const focus = useStore(st => st.focus)
  const highlightIds = useHighlightIds()
  const struggleIds = useStruggleIds()
  const severity = useSeverityByHash()
  const { selectHash, drillDown, setUnit, setDisplayLimit, registerCamera, takePendingCamera } = useStore.getState()

  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const layerRef = useRef<SVGGElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const genRef = useRef('')
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState({ k: 1, x: 0, y: 0 })
  const [hover, setHover] = useState<{ item: MazeItem; x: number; y: number } | null>(null)

  // キャンバスの大きさ。サイドバーの開閉や詳細パネルで変わる。小さな揺れでは作り直さない
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const apply = () => {
      const r = el.getBoundingClientRect()
      setSize(p => (Math.abs(p.w - r.width) > SIZE_EPS || Math.abs(p.h - r.height) > SIZE_EPS ? { w: r.width, h: r.height } : p))
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const built = useMemo(() => buildMazeItems({
    nodes: result.graph.nodes, edges: result.graph.edges, filterTypes, unit: unitPref, displayLimit, highlightHashes: highlightIds,
  }), [result, filterTypes, unitPref, displayLimit, highlightIds])

  const W = Math.round(size.w) || 900, H = Math.round(size.h) || 600
  const layout: MazeLayout = useMemo(
    () => buildMazeLayout({ items: built.items, struggles: result.struggles, unit: built.unit }, { viewportW: W, viewportH: H }),
    [built, result.struggles, W, H],
  )

  // 表示対象が入れ替わったら、カーソルの下にあった印はもう無い
  useEffect(() => { setHover(null) }, [built])

  const highlight = useMemo(() => mapHighlightToItems(built.items, highlightIds), [built.items, highlightIds])
  // 帯を出しているときは節点の輪を重ねない（同じことを二重に言わない）
  const struggleMarks = useMemo(
    () => (result.struggles.length > 0 ? new Map<string, number>() : mapStruggleToItems(built.items, struggleIds, severity)),
    [result.struggles.length, built.items, struggleIds, severity],
  )
  const minimapMarks = useMemo(() => mapStruggleToItems(built.items, struggleIds, severity), [built.items, struggleIds, severity])

  // 選択中のコミットに対応する印（まとまり表示ではそれを含むまとまり）
  const selectedId = useMemo(() => {
    if (!selectedHash) return undefined
    if (layout.byId.has(selectedHash)) return selectedHash
    return built.items.find(it => it.memberHashes?.includes(selectedHash))?.id
  }, [selectedHash, layout, built.items])

  // ── ズーム ────────────────────────────────────────────
  useEffect(() => {
    const svgEl = svgRef.current, layer = layerRef.current
    if (!svgEl || !layer) return
    const svg = select(svgEl)
    let raf = 0
    const zoom = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.12, 6])
      // ホイールは拡大縮小。Shift 併用は横移動に回す
      .filter((e: MouseEvent | WheelEvent) => !(e.type === 'wheel' && e.shiftKey) && !(e as MouseEvent).button)
      .on('zoom', (e: D3ZoomEvent<SVGSVGElement, unknown>) => {
        const t = e.transform
        layer.setAttribute('transform', t.toString())
        svgEl.dataset.zoom = zoomLevel(t.k)
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(() => setView({ k: t.k, x: t.x, y: t.y }))
      })
    svg.call(zoom)
    svg.on('wheel.pan', (e: WheelEvent) => {
      if (!e.shiftKey) return
      e.preventDefault()
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      zoom.translateBy(svg, -d / zoomTransform(svgEl).k, 0)
    })
    zoomRef.current = zoom
    registerCamera(() => { const t = zoomTransform(svgEl); return { x: t.x, y: t.y, k: t.k } })
    return () => { svg.on('.zoom', null).on('wheel.pan', null); registerCamera(null); cancelAnimationFrame(raf) }
  }, [registerCamera])

  const applyTransform = useCallback((t: { x: number; y: number; k: number }, animate: boolean) => {
    const svgEl = svgRef.current, zoom = zoomRef.current
    if (!svgEl || !zoom) return
    const tr = zoomIdentity.translate(t.x, t.y).scale(t.k)
    if (animate) select(svgEl).transition().duration(400).call(zoom.transform, tr)
    else select(svgEl).call(zoom.transform, tr)
  }, [])

  const fit = useCallback((animate = true) => applyTransform(fitTransform(layout, W, H), animate), [applyTransform, layout, W, H])

  // 「地図」が同じなら拡大位置はユーザーのもの。形が変わったときだけ全体表示へ
  useEffect(() => {
    const svgEl = svgRef.current
    if (!svgEl) return
    const gen = [built.unit, displayLimit, [...filterTypes].sort().join(','), W, H, result.graph.nodes.length, result.repoPath].join('|')
    const same = gen === genRef.current
    genRef.current = gen
    const restore = takePendingCamera()
    const kept = zoomTransform(svgEl)
    if (restore) applyTransform(restore, true)
    else if (same && kept.k !== 1) applyTransform({ x: kept.x, y: kept.y, k: kept.k }, false)
    else fit(same)
  }, [layout, built.unit, displayLimit, filterTypes, W, H, result, applyTransform, fit, takePendingCamera])

  // 選ばれた印が画面外なら、倍率を変えずにそこまで運ぶ
  useEffect(() => {
    const svgEl = svgRef.current
    if (!selectedId || !svgEl) return
    const p = layout.byId.get(selectedId)
    if (!p) return
    const t = zoomTransform(svgEl)
    const sx = t.applyX(p.x), sy = t.applyY(p.y), m = 80
    if (sx > m && sx < W - m && sy > m && sy < H - m) return
    applyTransform({ x: W / 2 - t.k * p.x, y: H / 2 - t.k * p.y, k: t.k }, true)
  }, [selectedId, layout, W, H, applyTransform])

  const zoomBy = (f: number) => {
    const svgEl = svgRef.current, zoom = zoomRef.current
    if (svgEl && zoom) select(svgEl).transition().duration(220).call(zoom.scaleBy, f)
  }

  const onClick = useCallback((it: MazeItem) => {
    if (it.memberHashes && it.memberHashes.length > 0) drillDown(it.memberHashes)
    else selectHash(it.id)
  }, [drillDown, selectHash])

  const onHover = useCallback((it: MazeItem | null, e?: React.MouseEvent) => {
    setHover(it && e ? { item: it, x: e.clientX, y: e.clientY } : null)
  }, [])

  const fitK = fitTransform(layout, W, H).k
  const activeStruggleId = focus?.kind === 'struggle' ? focus.episode.id : undefined

  return (
    <div ref={wrapRef} className={s.wrap}>
      <svg ref={svgRef} className={s.svg} data-zoom="far">
        <g ref={layerRef}>
          <MazeScene layout={layout} items={built.items} links={built.links} zones={result.graph.zones} struggles={result.struggles}
            activeStruggleId={activeStruggleId} highlight={highlight} struggleMarks={struggleMarks} selectedId={selectedId}
            onClick={onClick} onHover={onHover} />
        </g>
      </svg>

      <Legend />

      <div className={`${s.float} ${s.zoomBar}`}>
        <IconButton size="sm" variant="outline" onClick={() => zoomBy(1 / 1.4)} title="縮小">−</IconButton>
        <span className={s.zoomPct}>{Math.round(view.k * 100)}%</span>
        <IconButton size="sm" variant="outline" onClick={() => zoomBy(1.4)} title="拡大">＋</IconButton>
        <div className={s.vsep} />
        <IconButton size="sm" variant="outline" onClick={() => fit(true)} title="全体を表示">⤢</IconButton>
      </div>

      <div className={`${s.float} ${s.unitBar}`}>
        {(['session', 'commit'] as const).map(u => (
          <button key={u} className={s.chip} data-active={built.unit === u ? 'true' : undefined} onClick={() => setUnit(u)}>
            {u === 'session' ? `まとまり ${built.sessionCount}` : 'コミット'}
          </button>
        ))}
        <div className={s.vsep} />
        {built.unit === 'commit' ? (
          <>
            <span className={s.dim}>表示</span>
            {DISPLAY_LIMITS.map(n => (
              <button key={n} className={s.chip} data-active={displayLimit === n ? 'true' : undefined} onClick={() => setDisplayLimit(n)}>
                {n >= 1000 ? '全件' : n}
              </button>
            ))}
            <span className={s.dim}>/ {built.totalCount}</span>
          </>
        ) : (
          <span className={s.hint}>{built.totalCount} コミットを {built.sessionCount} のまとまりに · クリックで中へ</span>
        )}
      </div>

      <Minimap layout={layout} items={built.items} marks={minimapMarks} view={view} viewportW={W} viewportH={H}
        hidden={view.k <= fitK * 1.12}
        onJump={(gx, gy) => applyTransform({ x: W / 2 - view.k * gx, y: H / 2 - view.k * gy, k: view.k }, true)} />

      {hover && <NodeTooltip item={hover.item} x={hover.x} y={hover.y} />}
    </div>
  )
}
