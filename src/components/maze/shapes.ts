/** 節点の形。凡例でも同じ関数を使う */
export const diamond = (r: number) => `M0,${-r} L${r * 0.8},0 L0,${r} L${-r * 0.8},0 Z`
export const hexagon = (r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (i * Math.PI) / 3 - Math.PI / 6
    return `${i === 0 ? 'M' : 'L'}${Math.cos(a) * r},${Math.sin(a) * r}`
  }).join(' ') + 'Z'
