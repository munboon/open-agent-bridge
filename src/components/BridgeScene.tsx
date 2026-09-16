import Image from 'next/image';

/** Decorative brand artwork, never live connection telemetry. */
export function BridgeScene({compact = false}: {compact?: boolean}) {
  return <figure className={`bridge-scene${compact ? ' bridge-scene-compact' : ''}`}><Image src="/art/titanium/bridge.png" alt="" width={1536} height={1024} priority={!compact} sizes="(max-width: 839px) 100vw, 40vw"/></figure>;
}
