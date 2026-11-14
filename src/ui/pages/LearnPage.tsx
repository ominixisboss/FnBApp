import { useState } from 'react';
import { GLOSSARY, LESSONS } from '../../learn/lessons';
import PlayPage from './PlayPage';
import { SymText } from '../symbols';

export default function LearnPage({ lesson }: { lesson?: string }) {
  const [practice, setPractice] = useState(false);
  if (practice || lesson === 'practice') return <PlayPage tutorial />;
  const idx = Math.max(0, LESSONS.findIndex((l) => l.id === lesson));
  const cur = lesson === 'glossary' ? null : LESSONS[idx];
  return (
    <div className="learn-layout">
      <div className="panel lesson-list">
        <h3 style={{ marginTop: 0 }}>Lessons</h3>
        {LESSONS.map((l) => (
          <a key={l.id} href={`#learn/${l.id}`} className={cur?.id === l.id ? 'active' : ''}>{l.title}</a>
        ))}
        <a href="#learn/glossary" className={lesson === 'glossary' ? 'active' : ''}>Keyword glossary</a>
        <hr style={{ borderColor: 'var(--line)' }} />
        <button className="primary" style={{ width: '100%' }} onClick={() => setPractice(true)}>▶ Guided practice game</button>
        <a href="#campaign" className="learn-extra">🗺 Campaigns</a>
        <a href="#guides" className="learn-extra">📚 Hero guides</a>
        <a href="#puzzles" className="learn-extra">🧩 Lethal puzzles</a>
        <a href="#drills" className="learn-extra">🎯 Mistake trainer</a>
        <a href="#gauntlet" className="learn-extra">🏟 Gauntlet</a>
      </div>
      <div className="lesson">
        {cur ? (
          <>
            <h1>{cur.title}</h1>
            {cur.body}
            <div className="row" style={{ marginTop: '2rem' }}>
              {idx > 0 && <a href={`#learn/${LESSONS[idx - 1].id}`}><button>← {LESSONS[idx - 1].title}</button></a>}
              <div className="grow" />
              {idx < LESSONS.length - 1 ? (
                <a href={`#learn/${LESSONS[idx + 1].id}`}><button className="primary">{LESSONS[idx + 1].title} →</button></a>
              ) : (
                <button className="primary" onClick={() => setPractice(true)}>Start a guided practice game →</button>
              )}
            </div>
          </>
        ) : (
          <>
            <h1>Keyword glossary</h1>
            {GLOSSARY.map(([k, v]) => (
              <p key={k}><b><SymText text={k} /></b>: <SymText text={v} /></p>
            ))}
            <p className="muted small">Search the <a href="#cards">card database</a> for any keyword to see every card that uses it.</p>
          </>
        )}
      </div>
    </div>
  );
}
