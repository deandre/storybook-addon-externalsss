import React, { useEffect, useState } from 'react';

export function BenchmarkCard({ kind }: { kind: number }) {
  const [status, setStatus] = useState('Loading');
  useEffect(() => {
    if (kind === 2) void fetch('/fixture.json').then(() => setStatus('Fetched'));
    if (kind === 3) {
      const xhr = new XMLHttpRequest(); xhr.open('GET', '/fixture.json');
      xhr.onload = () => setStatus('XHR loaded'); xhr.send();
    }
    if (kind === 4 || kind === 5) {
      const face = new FontFace(`Benchmark ${kind}`, 'url(/demo-nunito.woff2)');
      document.fonts.add(face);
      const timer = setTimeout(() => { void face.load().then(() => setStatus('Font loaded')); }, kind === 5 ? 250 : 0);
      return () => { clearTimeout(timer); document.fonts.delete(face); };
    }
    if (kind === 6) {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/benchmark-delayed.css';
      document.head.append(link); return () => link.remove();
    }
  }, [kind]);
  if (kind === 7) throw new Error('Known benchmark render error');
  return <div style={{ fontFamily: `"Benchmark ${kind}", sans-serif` }}>
    <h2>Benchmark fixture {kind}</h2><p>{status}</p>
    {kind === 0 && <img src="/clean.svg" alt="Local" />}
    {kind === 1 && <img src="/benchmark-missing.svg" alt="Known missing" />}
    {kind === 8 && <img src="/benchmark-delayed.svg" alt="Delayed" />}
    {kind === 9 && <img src="http://localhost:6162/clean.svg" alt="Other origin" />}
  </div>;
}
