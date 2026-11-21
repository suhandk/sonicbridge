import { useLayoutEffect, useRef, useState } from 'react';
import type { ContentKind } from '../content';
import { ReceivedFile, type TransferAttachment } from '../file-preview';
import { duration } from '../session-monitor';

export interface TransferReceipt {
  direction: 'sent' | 'received';
  channel: 'acoustic' | 'simulation';
  kind: ContentKind | 'rescue';
  name: string;
  bytes: number;
  text?: string;
  time: Date;
  elapsed?: number;
  attachment?: TransferAttachment;
}

const kindLabels = { text: 'Text message', file: 'File', image: 'Image', rescue: 'Rescue report' };
const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

export function TransferConfirmation({ receipt, pending, onDismiss }: {
  receipt: TransferReceipt | undefined;
  pending: number;
  onDismiss: () => void;
}) {
  const [previewedReceipt, setPreviewedReceipt] = useState<TransferReceipt>();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (receipt) {
      if (!element.open) element.showModal();
      heading.current?.focus({ preventScroll: true });
      heading.current?.parentElement?.scrollTo(0, 0);
    } else if (element.open) {
      element.close();
    }
  }, [receipt]);

  const simulated = receipt?.channel === 'simulation';
  const title = simulated ? 'Simulation complete' : receipt?.direction === 'sent' ? 'Transfer delivered' : 'Transfer received';

  return (
    <dialog ref={dialog} className="transfer-confirmation" aria-labelledby="transfer-confirmation-title"
      aria-describedby="transfer-confirmation-description"
      onCancel={event => { event.preventDefault(); setPreviewedReceipt(undefined); onDismiss(); }}>
      {receipt && (
        <div className="transfer-confirmation-panel" data-lenis-prevent>
          <span className="transfer-confirmation-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12 4 4L19 6" />
            </svg>
          </span>
          <h2 ref={heading} tabIndex={-1} id="transfer-confirmation-title">{title}</h2>
          <p id="transfer-confirmation-description">{simulated
            ? 'The local PCM receiver verified the transfer and returned its acknowledgement.'
            : receipt.direction === 'sent'
              ? 'The receiving device verified the data and acknowledged delivery.'
              : 'This device verified the incoming data.'}</p>
          <dl className="transfer-confirmation-details">
            <div><dt>{receipt.direction === 'sent' ? 'Sent' : 'Received'}</dt><dd>{kindLabels[receipt.kind]}</dd></div>
            <div><dt>{receipt.kind === 'rescue' ? 'Report' : 'Name'}</dt><dd>{receipt.name}</dd></div>
            <div><dt>Size</dt><dd>{receipt.bytes.toLocaleString()} bytes</dd></div>
            <div><dt>Connection</dt><dd>{simulated ? 'Local PCM simulation' : 'Speaker and microphone'}</dd></div>
            {receipt.elapsed !== undefined && (
              <div><dt>{simulated ? 'Run time' : 'Elapsed time'}</dt><dd>{duration(receipt.elapsed)}</dd></div>
            )}
            <div><dt>Completed at</dt><dd><time dateTime={receipt.time.toISOString()}>{timeFormat.format(receipt.time)}</time></dd></div>
          </dl>
          {receipt.text !== undefined && <pre className="transfer-confirmation-message">{receipt.text}</pre>}
          {receipt.attachment && (
            <div className="transfer-confirmation-attachment">
              <ReceivedFile item={receipt.attachment} showSummary={false} preview={previewedReceipt === receipt}
                select={() => setPreviewedReceipt(previewedReceipt === receipt ? undefined : receipt)} />
            </div>
          )}
          <button type="button" className="primary" onClick={() => { setPreviewedReceipt(undefined); onDismiss(); }}>
            {pending > 1 ? `Next confirmation (${pending - 1})` : 'Done'}
          </button>
        </div>
      )}
    </dialog>
  );
}
