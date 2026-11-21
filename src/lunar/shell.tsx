import type { PropsWithChildren } from 'react';
import { CRC_BYTES, Kind, MAX_PAYLOAD, MAX_TRANSFER_BYTES } from '../protocol';

export function Action({ children, href, primary, onClick }: PropsWithChildren<{href:string;primary?:boolean;onClick?:()=>void}>) {
  return <a className={'lunar-action'+(primary?' solid':'')} href={href} onClick={onClick}>{children}</a>;
}
export function Navbar({open}:{open:()=>void}) {
  return <nav className="lunar-nav" aria-label="Main navigation"><div className="lunar-wrap">
    <a href="#top" className="lunar-brand"><i aria-hidden="true"><b/><b/><b/><b/><b/></i>SONICBRIDGE <small>SW-41</small></a>
    <div className="nav-links"><a href="#how">How it works</a></div>
    <Action href="#workspace" primary onClick={open}>Open console</Action>
  </div></nav>;
}
export function Hero({open,listening,ready,physical,children}: PropsWithChildren<{open:()=>void;listening:boolean;ready:boolean;physical:boolean}>) {
  return (
    <section className="relay-hero" aria-labelledby="hero-title">
      <div className="lunar-wrap hero-inner">
        <div className="hero-copy">
          <h1 id="hero-title">Data, carried <span>by sound.</span></h1>
          <p>Send text, images, and small files between nearby devices using a speaker and microphone. No network required for the transfer.</p>
          <div className="hero-actions">
            <Action href="#workspace" primary onClick={open}>Open the console</Action>
            <Action href="#how">How it works</Action>
          </div>
          <div className="hero-state" aria-label="Current link status">
            <span>{listening?'Microphone open':ready?'Audio ready':'Audio off'}</span>
            <span>{physical?'Physical audio':'Local PCM simulation'}</span>
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}
export function Guide() {
  const specs=[[MAX_PAYLOAD+' B','Maximum DATA payload'],[MAX_TRANSFER_BYTES.toLocaleString('en-US')+' B','Transfer limit, including manifest and filename'],['CRC'+CRC_BYTES*8,'Integrity check on every packet'],[Kind[Kind.FIN_ACK],'Required for sender confirmation']];
  return <div className="guide-surface">
    <div className="lunar-wrap">
      <section id="how" className="relay-steps">
        <div className="guide-intro">
          <h2>How a transfer works</h2>
          <p>On one device, try local simulation from the console. For a physical transfer, use two nearby devices.</p>
        </div>
        <ol>
          {[
            ['Listen','Start audio on both devices. On the receiver, open the microphone and keep the page visible.'],
            ['Send','Choose a message or file on the sender. Its speaker plays each packet and listens for the reply.'],
            ['Verify','The receiver checks the reassembled data. The sender confirms delivery after the receiver replies.'],
          ].map(([title,copy],i)=><li key={title}><span aria-hidden="true">0{i+1}</span><div><h3>{title}</h3><p>{copy}</p></div></li>)}
        </ol>
      </section>
      <dl className="relay-specs">{specs.map(([value,label])=><div key={value}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </div>
  </div>;
}
export function Footer() {
  const groups = [
    {title:'Protocol',links:[['Wire format','PROTOCOL'],['Audio path','AUDIO'],['Benchmarks','BENCHMARKS']]},
    {title:'Platform',links:[['Project','PROJECT'],['Contributions','CONTRIBUTIONS'],['Third-party notices','THIRD_PARTY_NOTICES']]},
    {title:'Status',links:[['Project status','STATUS'],['Device matrix','DEVICE_TEST_MATRIX'],['Physical test sheet','PHYSICAL_TEST_SHEET']]}
  ];
  return <footer className="lunar-footer"><div className="lunar-wrap"><div><strong>SW-41</strong><p>SONICBRIDGE acoustic data link</p><p>Physical-device validation pending.</p></div>{groups.map(g=><div key={g.title}><strong>{g.title}</strong>{g.links.map(([label,path])=><a key={path} href={'./docs/'+path+'.txt'}>{label}</a>)}</div>)}</div></footer>;
}
