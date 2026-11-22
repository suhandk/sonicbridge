import { useEffect, useRef, useState } from 'react';
import type { PacketEvent } from '../transport';
import type { RelayScene, VisualState } from './moon-relay';

export function MoonRelay({listening,transferring,failed,packets,preview}:{listening:boolean;transferring:boolean;failed:boolean;packets:PacketEvent[];preview:HTMLDivElement | null}) {
  const [unavailable,setUnavailable]=useState(false),[progress,setProgress]=useState(0),[skipped,setSkipped]=useState(false);
  const enabled = !unavailable;
  const host=useRef<HTMLDivElement>(null), scene=useRef<RelayScene|null>(null);
  const state=useRef<VisualState>({listening,transferring,failed});
  const previewTarget = useRef(preview);
  useEffect(() => {
    previewTarget.current = preview;
    scene.current?.setPreview(preview);
  }, [preview]);
  const last=useRef<PacketEvent|undefined>(undefined);
  useEffect(()=>{
    state.current={listening,transferring,failed};
    const index=last.current ? packets.indexOf(last.current) : -1;
    scene.current?.update(state.current,packets.slice(index+1));
    last.current=packets.at(-1);
  },[listening,transferring,failed,packets]);
  useEffect(()=>{
    if(!enabled||!host.current)return;
    let cancelled=false;
    setProgress(0);
    const load=async()=>{
      try {
        const {createRelay}=await import('./moon-relay');
        if(cancelled||!host.current)return;
        setProgress(30);
        scene.current=createRelay(host.current,state.current,setProgress,()=>{if(!cancelled)setUnavailable(true);});
        scene.current.setPreview(previewTarget.current);
      }catch{if(!cancelled)setUnavailable(true);}
    };
    // Let the actual interface paint before paying the WebGL startup cost.
    const id=window.setTimeout(()=>void load(),120);
    return()=>{cancelled=true;clearTimeout(id);scene.current?.dispose();scene.current=null;};
  },[enabled]);
  const [bootDone,setBootDone]=useState(false);
  useEffect(()=>{
    if(progress!==100){setBootDone(false);return;}
    const id=setTimeout(()=>setBootDone(true),220);return()=>clearTimeout(id);
  },[progress]);
  return <>
    <div className="relay-sky" aria-hidden="true" ref={host}/>
    {enabled&&!skipped&&!bootDone&&<div className={'relay-boot'+(progress===100?' done':'')}>
      <strong>{progress}</strong><span>Loading 3D model</span><button onClick={()=>setSkipped(true)}>Skip</button>
    </div>}
  </>;
}
