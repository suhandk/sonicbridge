import { useEffect, useState } from 'react';
import type { VerifiedContent } from './content';
import { inspectRaster } from './images';

export function RasterPreview({ bytes, mime }: { bytes: Uint8Array; mime: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mime }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes, mime]);
  return url ? <img className="raster-preview" alt="Image transfer preview" src={url}/> : null;
}

export function ReceivedFile({ item, preview, select }: { item: VerifiedContent; preview: boolean; select: () => void }) {
  let image;
  if (item.kind === 'image') {
    try { image = inspectRaster(item.bytes, 512 * 512); } catch { /* Other types and larger images are download-only. */ }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([Uint8Array.from(item.bytes)], { type: 'application/octet-stream' }));
    const a = document.createElement('a'); a.href = url; a.download = item.name + '.bin'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <><p>{item.name} · {item.bytes.length} bytes · SHA-256 verified</p>
    {image && <button onClick={select}>{preview ? 'Close preview' : 'Preview image'} · {image.width} × {image.height}</button>}
    {preview && image && <RasterPreview bytes={item.bytes} mime={image.mime}/>}
    <button onClick={download}>Download as .bin</button></>;
}
