import { useEffect, useRef, useState } from 'react';
import type { PacketEvent } from '../transport';
import type { RelayScene, VisualState } from './moon-relay';

type Effects = 'Full'|'Reduced'|'Off';
const storageKey='sonicbridge.visual-effects';
function initialEffects():Effects | null {
  try {const saved=localStorage.getItem(storageKey);if(saved==='Full'||saved==='Reduced'||saved==='Off')return saved;}catch{/* private storage */}
  return null;
}
export function MoonRelay({listening,transferring,failed,packets}:{listening:boolean;transferring:boolean;failed:boolean;packets:PacketEvent[]}) {
  const [preference,setPreference]=useState(initialEffects);
  const [osReduced,setOsReduced]=useState(()=>matchMedia('(prefers-reduced-motion:reduce)').matches);
  const [unavailable,setUnavailable]=useState(false),[progress,setProgress]=useState(0),[skipped,setSkipped]=useState(false);
  const effects=preference ?? (osReduced?'Reduced':'Full');
  const reduced=effects==='Reduced', enabled=effects!=='Off'&&!unavailable;
  const host=useRef<HTMLDivElement>(null), scene=useRef<RelayScene|null>(null);
  const state=useRef<VisualState>({listening,transferring,failed,reduced});
  const last=useRef<PacketEvent|undefined>(undefined);
  useEffect(()=>{
    const m=matchMedia('(prefers-reduced-motion:reduce)');const change=()=>setOsReduced(m.matches);
    m.addEventListener('change',change);return()=>m.removeEventListener('change',change);
  },[]);
  useEffect(()=>{
    state.current={listening,transferring,failed,reduced};
    const index=last.current ? packets.indexOf(last.current) : -1;
    scene.current?.update(state.current,packets.slice(index+1));
    last.current=packets.at(-1);
  },[listening,transferring,failed,reduced,packets]);
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
    <div className="effects-control"><label>Visual effects <select value={effects} onChange={e=>{
      const value=e.target.value as Effects;setPreference(value);setUnavailable(false);
      try{localStorage.setItem(storageKey,value);}catch{/* preferences remain available in this tab */}
    }}><option>Full</option><option>Reduced</option><option>Off</option></select></label>
      {unavailable && <small>Static background · WebGL unavailable</small>}
    </div>
    {enabled&&!reduced&&!skipped&&!bootDone&&<div className={'relay-boot'+(progress===100?' done':'')}>
      <strong>{progress}</strong><span>Loading 3D model</span><button onClick={()=>setSkipped(true)}>Skip</button>
    </div>}
  </>;
}
