import type { CardFilter } from '../search';
import { CLASS_OPTIONS, TYPE_OPTIONS } from '../search';

export default function CardFilters({ f, set, hideFormat, classOptions }: { f: CardFilter; set: (f: CardFilter) => void; hideFormat?: boolean; classOptions?: string[] }) {
  return (
    <div className="filters">
      <input type="search" placeholder="Search name, text, keyword… (e.g. go again dagger)" value={f.q} onChange={(e) => set({ ...f, q: e.target.value })} />
      <select value={f.cls} onChange={(e) => set({ ...f, cls: e.target.value })}>
        <option value="">All classes / talents</option>
        {(classOptions ?? CLASS_OPTIONS).map((c) => <option key={c}>{c}</option>)}
      </select>
      <select value={f.type} onChange={(e) => set({ ...f, type: e.target.value })}>
        <option value="">All types</option>
        {TYPE_OPTIONS.map((c) => <option key={c}>{c}</option>)}
      </select>
      <select value={f.pitch} onChange={(e) => set({ ...f, pitch: e.target.value })}>
        <option value="">Any pitch</option>
        <option value="1">Red (1)</option>
        <option value="2">Yellow (2)</option>
        <option value="3">Blue (3)</option>
      </select>
      {!hideFormat && (
        <select value={f.format} onChange={(e) => set({ ...f, format: e.target.value })}>
          <option value="">Any format</option>
          <option value="blitz">Blitz legal</option>
          <option value="cc">Classic Constructed legal</option>
          <option value="sage">Silver Age legal</option>
          <option value="commoner">Commoner legal</option>
        </select>
      )}
    </div>
  );
}
