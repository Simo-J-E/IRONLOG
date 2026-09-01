import type { Muscle } from './types'

const groupMap: Record<string, Muscle[]> = {
  chest:['Chest','Upper chest'], arms:['Biceps','Triceps','Brachialis','Forearms'], shoulders:['Shoulders','Front deltoids','Rear deltoids'], back:['Back','Lats'], legs:['Quads','Hamstrings','Glutes','Calves'], core:['Core']
}

export function MuscleFigure({ primary, secondary, compact=false }: { primary: Muscle[]; secondary: Muscle[]; compact?: boolean }) {
  const state = (group: string) => {
    const muscles = groupMap[group] ?? []
    if (muscles.some(m=>primary.includes(m))) return 'primary'
    if (muscles.some(m=>secondary.includes(m))) return 'secondary'
    return 'idle'
  }
  return <div className={`muscle-figure ${compact ? 'compact':''}`} role="img" aria-label={`Primary muscles: ${primary.join(', ')}. Secondary muscles: ${secondary.join(', ') || 'none'}.`}>
    <svg viewBox="0 0 180 260" aria-hidden="true">
      <circle className="body" cx="90" cy="27" r="18"/>
      <path className="body" d="M62 50 Q90 39 118 50 L128 125 Q118 144 105 153 L108 238 L86 238 L80 160 L74 238 L52 238 L59 153 Q45 141 52 125Z"/>
      <path className={`muscle ${state('shoulders')}`} d="M59 58 Q45 64 40 82 L52 91 L67 70Z"/><path className={`muscle ${state('shoulders')}`} d="M121 58 Q135 64 140 82 L128 91 L113 70Z"/>
      <path className={`muscle ${state('chest')}`} d="M69 62 Q90 53 111 62 L108 91 Q90 102 72 91Z"/>
      <path className={`muscle ${state('arms')}`} d="M48 84 L36 126 L49 132 L62 91Z"/><path className={`muscle ${state('arms')}`} d="M132 84 L144 126 L131 132 L118 91Z"/>
      <path className={`muscle ${state('core')}`} d="M75 96 H105 L108 139 Q90 148 72 139Z"/>
      <path className={`muscle ${state('legs')}`} d="M62 151 L79 155 L76 219 L55 219Z"/><path className={`muscle ${state('legs')}`} d="M101 155 L118 151 L125 219 L104 219Z"/>
      <path className={`muscle back-zone ${state('back')}`} d="M65 72 Q90 88 115 72 L111 123 Q90 136 69 123Z"/>
    </svg>
    {!compact && <div className="muscle-legend"><span><i className="legend-primary"/>Primary</span><span><i className="legend-secondary"/>Secondary</span></div>}
  </div>
}
