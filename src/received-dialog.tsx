import { useEffect, useRef, useState } from 'react';
import type { VerifiedContent } from './content';
import { ReceivedFile } from './file-preview';

export function ReceivedDialog({ text, file, simulated, onDismiss, onViewReceived }: {
  text: string;
  file?: VerifiedContent;
  simulated: boolean;
  onDismiss: () => void;
  onViewReceived: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [title, attachment] = file?.kind === 'image'
    ? ['Image received', file] as const
    : file?.kind === 'file'
      ? ['File received', file] as const
      : ['Message received', undefined] as const;
  const [preview, setPreview] = useState(true);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) {
      element.showModal();
      closeButton.current?.focus();
    }
  }, []);

  return (
    <dialog ref={dialog} className="received-dialog" aria-labelledby="received-dialog-title" onClose={onDismiss}>
      <div className="received-dialog-panel">
        <header className="received-dialog-heading">
          <h2 id="received-dialog-title">{title}</h2>
          <button ref={closeButton} type="button" onClick={() => dialog.current?.close()}>Dismiss</button>
        </header>
        {simulated && <p className="sim-badge">Simulation · local PCM</p>}
        <div className="received-dialog-content">
          {attachment
            ? <ReceivedFile item={attachment} preview={preview} select={() => setPreview(open => !open)} />
            : <p>{text}</p>}
        </div>
        <footer>
          <button className="primary" type="button" onClick={() => {
            dialog.current?.close();
            onViewReceived();
          }}>View in Received</button>
        </footer>
      </div>
    </dialog>
  );
}
