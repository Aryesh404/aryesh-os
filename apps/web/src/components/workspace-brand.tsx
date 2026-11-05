export function WorkspaceBrand({ compact = false }: { compact?: boolean }) {
  return <a href="#/home" className={`workspace-brand${compact ? ' workspace-brand-compact' : ''}`} aria-label="Aryesh OS — Today">
    <img src="/aryesh-logo.png" alt="AS — Your Vision, Our Innovation" width="256" height="205" />
    <span>Aryesh <span className="workspace-brand-os">OS</span></span>
  </a>;
}
