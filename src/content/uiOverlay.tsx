import { createRoot, type Root } from 'react-dom/client';
import { useState } from 'react';
import './uiOverlay.css';

export interface OverlayHandle {
  setCount: (n: number) => void;
  setEnabled: (v: boolean) => void;
  unmount: () => void;
}

interface OverlayProps {
  initialCount: number;
  initialEnabled: boolean;
  onToggle: (enabled: boolean) => void;
  registerSetters: (setCount: (n: number) => void, setEnabled: (v: boolean) => void) => void;
}

function Overlay({ initialCount, initialEnabled, onToggle, registerSetters }: OverlayProps) {
  const [count, setCount] = useState(initialCount);
  const [enabled, setEnabled] = useState(initialEnabled);
  registerSetters(setCount, setEnabled);

  return (
    <div className="warden-overlay">
      <span className="warden-overlay-icon" aria-hidden="true">
        🛡️
      </span>
      <span className="warden-overlay-label">{enabled ? `${count} redacted` : 'Warden paused'}</span>
      <button
        type="button"
        className="warden-overlay-toggle"
        onClick={() => {
          const next = !enabled;
          setEnabled(next);
          onToggle(next);
        }}
      >
        {enabled ? 'Pause' : 'Resume'}
      </button>
    </div>
  );
}

/**
 * Mounts the floating "Warden active" badge near the platform's input box.
 * Returns a handle so the content script can push count/enabled updates
 * imperatively without needing a shared store.
 */
export function mountOverlay(
  container: HTMLElement,
  initial: { count: number; enabled: boolean },
  onToggle: (enabled: boolean) => void
): OverlayHandle {
  let setCountFn: ((n: number) => void) | null = null;
  let setEnabledFn: ((v: boolean) => void) | null = null;

  const root: Root = createRoot(container);
  root.render(
    <Overlay
      initialCount={initial.count}
      initialEnabled={initial.enabled}
      onToggle={onToggle}
      registerSetters={(setCount, setEnabled) => {
        setCountFn = setCount;
        setEnabledFn = setEnabled;
      }}
    />
  );

  return {
    setCount: (n) => setCountFn?.(n),
    setEnabled: (v) => setEnabledFn?.(v),
    unmount: () => root.unmount(),
  };
}
