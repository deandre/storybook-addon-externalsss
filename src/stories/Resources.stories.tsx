import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = { title: 'Externalsss demo/Resources' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div style={{ width: 340, padding: 22, border: '1px solid #cbd5e1', borderRadius: 12, fontFamily: 'sans-serif' }}>
    <h2 style={{ marginTop: 0 }}>{title}</h2>{children}
  </div>
);

export const CleanImage: Story = {
  render: () => <Card title="Clean image"><img src="./clean.svg" alt="Local demo asset" width="200" height="100" /></Card>,
};

export const BrokenImage: Story = {
  render: () => <Card title="Broken image"><img src="./missing-image.png" alt="Intentionally missing asset" width="200" height="100" /></Card>,
};

export const ExternalImage: Story = {
  render: () => <Card title="External image"><img src="https://example.invalid/externalsss-image.png" alt="External demo asset" width="200" height="100" /></Card>,
};

function FetchCard({ external = false }: { external?: boolean }) {
  const [status, setStatus] = useState('Loading…');
  useEffect(() => {
    const url = external ? 'https://example.invalid/externalsss-api?token=demo-secret' : './fixture.json';
    void fetch(url).then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
      .then(() => setStatus('Response received'))
      .catch(() => setStatus('Request unavailable'));
  }, [external]);
  return <Card title={external ? 'External fetch' : 'Same-origin fetch'}><p>{status}</p></Card>;
}

export const SameOriginFetch: Story = { render: () => <FetchCard /> };
export const ExternalFetch: Story = { render: () => <FetchCard external /> };

function XhrCard() {
  const [status, setStatus] = useState('Loading…');
  useEffect(() => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', './fixture.json');
    xhr.onload = () => setStatus(xhr.status === 200 ? 'Response received' : `HTTP ${xhr.status}`);
    xhr.onerror = () => setStatus('Request unavailable');
    xhr.send();
  }, []);
  return <Card title="Same-origin XHR"><p>{status}</p></Card>;
}
export const SameOriginXhr: Story = { render: () => <XhrCard /> };

function FontCard({ mode }: { mode: 'success' | 'failure' | 'late' }) {
  const [phase, setPhase] = useState('Rendering…');
  useEffect(() => {
    const url = mode === 'failure' ? './missing-font.woff2' : './demo-nunito.woff2';
    const face = new FontFace(`Externalsss ${mode}`, `url("${url}")`);
    const timer = window.setTimeout(() => {
      document.fonts.add(face);
      void face.load().then(() => setPhase('Font loaded')).catch(() => setPhase('Font failed'));
    }, mode === 'late' ? 250 : 0);
    return () => { clearTimeout(timer); document.fonts.delete(face); };
  }, [mode]);
  return <Card title={`${mode} font`}><p style={{ fontFamily: `"Externalsss ${mode}", sans-serif` }}>A sample headline</p><small>{phase}</small></Card>;
}

export const SuccessfulFont: Story = {
  render: () => <FontCard mode="success" />,
  play: async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await document.fonts.load('16px "Externalsss success"');
  },
};
export const FailedFont: Story = { render: () => <FontCard mode="failure" /> };
export const LateFont: Story = { render: () => <FontCard mode="late" /> };

export const RenderError: Story = { render: () => { throw new Error('Intentional demo render error'); } };
