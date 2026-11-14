// Music and sound effects: on/off and volume for each. Used in the in-game menu and on the Profile page.
import { useState } from 'react';
import { musicEnabled, musicVolume, setMusicEnabled, setMusicVolume } from '../music';
import { setSfxVolume, setSoundEnabled, sfx, sfxVolume, soundEnabled } from '../sound';

export default function AudioSettings({ compact = false }: { compact?: boolean }) {
  const [music, setMusic] = useState(musicEnabled());
  const [mVol, setMVol] = useState(musicVolume());
  const [sound, setSound] = useState(soundEnabled());
  const [sVol, setSVol] = useState(sfxVolume());
  return (
    <div className={`audio-settings ${compact ? 'compact' : ''}`}>
      <div className="audio-row">
        <button className={`audio-toggle ${music ? 'on' : ''}`} onClick={() => { setMusicEnabled(!music); setMusic(!music); }} aria-pressed={music}>{music ? '🎵' : '🔈'} Music</button>
        <input type="range" min={0} max={1} step={0.05} value={mVol} disabled={!music} aria-label="Music volume"
          onChange={(e) => { const v = Number(e.target.value); setMVol(v); setMusicVolume(v); }} />
        <span className="audio-val">{Math.round(mVol * 100)}%</span>
      </div>
      <div className="audio-row">
        <button className={`audio-toggle ${sound ? 'on' : ''}`} onClick={() => { setSoundEnabled(!sound); setSound(!sound); }} aria-pressed={sound}>{sound ? '🔊' : '🔇'} Effects</button>
        <input type="range" min={0} max={1} step={0.05} value={sVol} disabled={!sound} aria-label="Sound effects volume"
          onChange={(e) => { const v = Number(e.target.value); setSVol(v); setSfxVolume(v); }}
          onPointerUp={() => sfx('play')} onKeyUp={() => sfx('click')} />
        <span className="audio-val">{Math.round(sVol * 100)}%</span>
      </div>
      {!compact && <div className="small muted">The music changes with the game: calm in the menus, a battle theme in games, and a darker, faster theme when someone is close to dying.</div>}
    </div>
  );
}
