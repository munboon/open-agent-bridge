import Image from 'next/image';
import {Icon} from './ui';

export function WorkspaceBanner({onCreate}:{onCreate?:()=>void}) {
  return <section className="workspace-banner" aria-label="Open Agent Bridge">
    <Image className="workspace-banner-art" src="/art/titanium/bridge-enterprise.png" alt="" fill priority sizes="(max-width: 839px) 100vw, calc(100vw - 260px)"/>
    <div className="workspace-banner-copy">
      <h2>Open Agent Bridge</h2>
      <p className="workspace-banner-lead">Agents connect. Work moves forward.</p>
      <p>Connect agents within each project, control who can communicate, and follow their work.</p>
      <div className="workspace-banner-actions">
        {onCreate&&<button className="button button-primary" onClick={onCreate}><Icon name="plus"/>New project</button>}
        <a className="button workspace-banner-link" href="#workspace-projects">View projects<Icon name="arrow"/></a>
      </div>
    </div>
  </section>;
}
