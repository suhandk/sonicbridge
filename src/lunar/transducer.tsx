import { useEffect, useRef } from 'react';
import type { TransducerScene } from './transducer-scene';

interface TransducerProps {
  peak: number;
  verified: boolean;
  receiving: boolean;
  engagement: number;
  engaging: boolean;
}

export function Transducer({ peak, verified, receiving, engagement, engaging }: TransducerProps) {
  const stage = useRef<HTMLDivElement>(null);
  const scene = useRef<TransducerScene>(null);
  const signal = useRef({ peak, verified });

  useEffect(() => {
    signal.current = { peak, verified };
    scene.current?.update(peak, verified);
  }, [peak, verified]);

  useEffect(() => {
    const host = stage.current;
    if (!host) return;
    let disposed = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      void import('./transducer-scene').then(({ createTransducer }) => {
        if (disposed) return;
        scene.current = createTransducer(host);
        scene.current.update(signal.current.peak, signal.current.verified);
      }).catch(() => {
        // Leave the CSS speaker visible if WebGL is unavailable.
        scene.current?.dispose();
        scene.current = null;
      });
    });
    observer.observe(host);
    return () => {
      disposed = true;
      observer.disconnect();
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  return <div className="housing transducer" data-receive={receiving} data-verified={verified} aria-hidden="true">
    <div key={engagement} className={'driver' + (engaging ? ' engaging' : '')}>
      <div className="rim"><div className="surround"><div className="diaphragm" style={{ scale: 1 + peak * .035 }}><div className="dustcap"/></div></div></div>
      <i className="screw nw"/><i className="screw ne"/><i className="screw sw"/><i className="screw se"/>
    </div>
    <div className="transducer-stage" ref={stage}/>
  </div>;
}
