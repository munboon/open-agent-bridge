'use client';

import { useEffect, useRef, useState, type PointerEvent, type CSSProperties } from 'react';
import type { Snapshot } from './OwnerPortal';
import {AgentAvatar} from './AgentAvatar';
import { Icon, Modal, problemText } from './ui';

type BulkInput = { enabled:boolean;agent_id?:string;expected_agent_ids:string[] };
type BulkChoice = {title:string;scope:string;count:number;input:BulkInput};
type Props = Pick<Snapshot, 'agents' | 'environments' | 'pairings'> & { stale: boolean; onToggle: (a:string,b:string,enabled:boolean)=>Promise<void>; onBulk:(input:BulkInput)=>Promise<void> };
export function AgentPairMap({agents,environments,pairings,stale,onToggle,onBulk}: Props) {
  const [selected,setSelected]=useState<string|null>(null);
  const [overview,setOverview]=useState(false);
  const [zoom,setZoom]=useState(1);
  const [overviewFilter,setOverviewFilter]=useState('all');
  const [search,setSearch]=useState(''),[filter,setFilter]=useState('all');
  const [order,setOrder]=useState<string[]>([]),[swapping,setSwapping]=useState(false);
  const swappingRef=useRef(false);
  function snapshotBodies(){return Object.fromEntries(Object.entries(bodies.current).map(([id,body])=>[id,{...body}]));}
  function resetLayout(){
    if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;dragged.current=null;swappingRef.current=false;setSwapping(false);bodies.current={};cables.current={};setWirePositions({});setPositions({});
  }
  function focus(id:string){
    if(overview){resetLayout();setOverview(false);setSelected(id);setSearch('');setFilter('all');return;}
    if(swappingRef.current)return;
    const ids=orderedAgents.map(agent=>agent.id),a=ids.indexOf(focused!),b=ids.indexOf(id);
    if(b<0)return;
    if(a>=0)[ids[a],ids[b]]=[ids[b],ids[a]];
    const nextPeers=ids.filter(peer=>peer!==id).filter(peer=>{
      const agent=byId.get(peer)!;
      const enabled=edges.some(edge=>(edge.agent_a===id&&edge.agent_b===peer)||(edge.agent_b===id&&edge.agent_a===peer));
      return (filter==='all'||enabled===(filter==='enabled'))&&`${agent.name} ${environments.find(e=>e.id===agent.environment_id)?.name??''}`.toLowerCase().includes(search.trim().toLowerCase());
    });
    const right=nextPeers,rows=Math.max(1,Math.ceil(Math.sqrt(right.length))),nextHeight=Math.max(320,rows*150+40);
    const targets=Object.fromEntries([id,...right].map(peer=>[peer,{x:peer===id?140:420+Math.floor(right.indexOf(peer)/rows)*200,y:peer===id?nextHeight/2:80+(right.indexOf(peer)%rows)*150,vx:0,vy:0}]));
    if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;dragged.current=null;cables.current={};setWirePositions({});
    const starts=Object.fromEntries(nodes.map(node=>[node.id,{x:node.x,y:node.y,vx:0,vy:0}]));
    function finish(){setOrder(ids);setSelected(id);bodies.current={};setPositions({});swappingRef.current=false;setSwapping(false);cables.current={};setWirePositions({});frame.current=null;}
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){finish();return;}
    swappingRef.current=true;setSwapping(true);let start:number|undefined;
    function settle(now:number){
      start??=now;const t=Math.min(1,(now-start)/650),ease=t*t*(3-2*t);
      for(const [peer,from] of Object.entries(starts)){
        const to=targets[peer]??from;
        const arc=peer===id&&id!==focused?Math.sin(Math.PI*t)*35:0;
        bodies.current[peer]={x:from.x+(to.x-from.x)*ease,y:from.y+(to.y-from.y)*ease-arc,vx:0,vy:0};
      }
      setPositions(snapshotBodies());if(t===1){finish();return;}frame.current=requestAnimationFrame(settle);
    }
    frame.current=requestAnimationFrame(settle);
  }
  type Body={x:number;y:number;vx:number;vy:number};
  const [positions,setPositions]=useState<Record<string,Body>>({});
  const cables=useRef<Record<string,Body>>({});
  const [wirePositions,setWirePositions]=useState<Record<string,Body>>({});
  const bodies=useRef<Record<string,Body>>({});
  const dragged=useRef<{id:string;clientX:number;clientY:number;x:number;y:number;moved:boolean}|null>(null);
  const suppressClick=useRef(false),frame=useRef<number|null>(null);
  useEffect(()=>()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);},[]);
  function animateBodies(){
    if(frame.current!==null)return;
    let last=0;
    const anchors=layout.map(node=>({...node}));
    const springs=edges.filter(edge=>anchors.some(n=>n.id===edge.agent_a)&&anchors.some(n=>n.id===edge.agent_b));
    function tick(now:number){
      const dt=last?Math.min((now-last)/16.67,2):1;last=now;
      const state=bodies.current;
      const forces=Object.fromEntries(anchors.map(n=>[n.id,{x:0,y:0}]));
      for(const edge of springs){
        const a=state[edge.agent_a],b=state[edge.agent_b],homeA=anchors.find(n=>n.id===edge.agent_a)!,homeB=anchors.find(n=>n.id===edge.agent_b)!;
        const dx=b.x-a.x,dy=b.y-a.y,length=Math.max(1,Math.hypot(dx,dy));
        const force=Math.max(0,length-Math.hypot(homeB.x-homeA.x,homeB.y-homeA.y))*.045;
        forces[edge.agent_a].x+=force*dx/length;forces[edge.agent_a].y+=force*dy/length;
        forces[edge.agent_b].x-=force*dx/length;forces[edge.agent_b].y-=force*dy/length;
      }
      let energy=0;
      for(const home of anchors){
        const body=state[home.id];
        if(dragged.current?.id!==home.id){
          const mass=1+Array.from(home.id).reduce((sum,c)=>sum+c.charCodeAt(0),0)%4*.12;
          body.vx=(body.vx+forces[home.id].x*dt/mass)*Math.pow(.79,dt);
          body.vy=(body.vy+forces[home.id].y*dt/mass)*Math.pow(.79,dt);
          body.x=Math.max(90,Math.min(width-90,body.x+body.vx*dt));body.y=Math.max(70,Math.min(height-90,body.y+body.vy*dt));
        }
        energy+=Math.hypot(body.vx,body.vy);
      }
      collide();
      const wires:Record<string,Body>={};
      for(const peer of anchors.filter(n=>n.id!==focused)){
        const a=state[focused!],b=state[peer.id],targetX=(a.x+b.x)/2,targetY=(a.y+b.y)/2-38-(dragged.current?.id===focused||dragged.current?.id===peer.id?6:0);
        const wire=cables.current[peer.id]??{x:targetX,y:targetY,vx:0,vy:0};
        wire.vx=(wire.vx+(targetX-wire.x)*.07*dt)*Math.pow(.84,dt);wire.vy=(wire.vy+(targetY-wire.y)*.07*dt)*Math.pow(.84,dt);
        wire.x+=wire.vx*dt;wire.y+=wire.vy*dt;cables.current[peer.id]=wire;wires[peer.id]={...wire};
        energy+=Math.hypot(wire.x-targetX,wire.y-targetY)+Math.hypot(wire.vx,wire.vy);
      }
      setWirePositions(wires);
      if(!dragged.current&&energy<.15){for(const body of Object.values(state)){body.vx=0;body.vy=0;}setPositions(snapshotBodies());frame.current=null;return;}
      setPositions(Object.fromEntries(Object.entries(state).map(([id,body])=>[id,{...body}])));
      frame.current=requestAnimationFrame(tick);
    }
    frame.current=requestAnimationFrame(tick);
  }
  function collide(){
    const entries=Object.entries(bodies.current);
    for(let pass=0;pass<3;pass++)for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
      const [idA,a]=entries[i],[idB,b]=entries[j],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy),overlap=72-length;
      if(overlap<=0)continue;
      const nx=length>0?dx/length:1,ny=length>0?dy/length:0,invA=dragged.current?.id===idA?0:1,invB=dragged.current?.id===idB?0:1,total=invA+invB;
      if(!total)continue;
      a.x-=nx*overlap*invA/total;a.y-=ny*overlap*invA/total;b.x+=nx*overlap*invB/total;b.y+=ny*overlap*invB/total;
      const closing=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
      if(closing<0){const impulse=-1.25*closing/total;a.vx-=impulse*nx*invA;a.vy-=impulse*ny*invA;b.vx+=impulse*nx*invB;b.vy+=impulse*ny*invB;}
    }
    for(const body of Object.values(bodies.current)){if(body.x<90||body.x>width-90)body.vx*= -.25;if(body.y<70||body.y>height-90)body.vy*= -.25;body.x=Math.max(90,Math.min(width-90,body.x));body.y=Math.max(70,Math.min(height-90,body.y));}
  }
  function startDrag(event:PointerEvent<HTMLButtonElement>,agent:{id:string;x:number;y:number}){
    if(event.button!==0||dragged.current||swappingRef.current)return;
    suppressClick.current=false;
    for(const node of nodes)if(!bodies.current[node.id])bodies.current[node.id]={x:node.x,y:node.y,vx:0,vy:0};
    dragged.current={id:agent.id,clientX:event.clientX,clientY:event.clientY,x:agent.x,y:agent.y,moved:false};
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event:PointerEvent<HTMLButtonElement>){
    const drag=dragged.current;if(!drag)return;
    const scale=zoom;
    const dx=(event.clientX-drag.clientX)/scale,dy=(event.clientY-drag.clientY)/scale;
    if(!drag.moved&&Math.hypot(dx,dy)<5)return;
    drag.moved=true;suppressClick.current=true;event.preventDefault();
    const body=bodies.current[drag.id];
    const x=Math.max(90,Math.min(width-90,drag.x+dx)),y=Math.max(70,Math.min(height-90,drag.y+dy));
    const oldX=body.x,oldY=body.y,steps=Math.max(1,Math.ceil(Math.hypot(x-oldX,y-oldY)/18));
    body.vx=Math.max(-12,Math.min(12,x-oldX));body.vy=Math.max(-12,Math.min(12,y-oldY));
    for(let step=1;step<=steps;step++){body.x=oldX+(x-oldX)*step/steps;body.y=oldY+(y-oldY)*step/steps;collide();}
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)setPositions(snapshotBodies());
    else animateBodies();
  }
  function endDrag(event:PointerEvent<HTMLButtonElement>){
    const drag=dragged.current;if(!drag)return;dragged.current=null;
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;for(const body of Object.values(bodies.current)){body.vx=0;body.vy=0;}cables.current={};setWirePositions({});setPositions(snapshotBodies());return;}
    if(drag.moved)animateBodies();
  }
  const [saving,setSaving]=useState(false);
  const [feedback,setFeedback]=useState('');
  const [error,setError]=useState('');
  const [bulk,setBulk]=useState<BulkChoice|null>(null);
  const [bulkError,setBulkError]=useState('');
  const pending=useRef(false);
  const viewport=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const element=viewport.current;if(!element)return;
    function wheel(event:WheelEvent){
      if(!event.deltaY)return;
      event.preventDefault();
      const pixels=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?element!.clientHeight:1);
      setZoom(value=>Math.max(.1,Math.min(2,value*Math.exp(-Math.max(-100,Math.min(100,pixels))*.002))));
    }
    element.addEventListener('wheel',wheel,{passive:false});
    return ()=>element.removeEventListener('wheel',wheel);
  },[agents.length>0]);
  useEffect(()=>{
    const element=viewport.current;if(!element)return;
    let pan:{pointer:number;x:number;y:number;left:number;top:number}|null=null;
    function down(event:globalThis.PointerEvent){
      if(event.button!==1)return;
      event.preventDefault();event.stopPropagation();
      pan={pointer:event.pointerId,x:event.clientX,y:event.clientY,left:element!.scrollLeft,top:element!.scrollTop};
      element!.setPointerCapture(event.pointerId);element!.classList.add('is-panning');
    }
    function move(event:globalThis.PointerEvent){
      if(!pan||event.pointerId!==pan.pointer)return;
      event.preventDefault();event.stopPropagation();
      element!.scrollLeft=pan.left+pan.x-event.clientX;element!.scrollTop=pan.top+pan.y-event.clientY;
    }
    function end(event:globalThis.PointerEvent){
      if(!pan||event.pointerId!==pan.pointer)return;
      const pointer=pan.pointer;pan=null;element!.classList.remove('is-panning');
      if(element!.hasPointerCapture(pointer))element!.releasePointerCapture(pointer);
    }
    function auxiliary(event:MouseEvent){if(event.button===1){event.preventDefault();event.stopPropagation();}}
    element.addEventListener('pointerdown',down,true);element.addEventListener('pointermove',move,true);
    element.addEventListener('pointerup',end);element.addEventListener('pointercancel',end);element.addEventListener('lostpointercapture',end);element.addEventListener('auxclick',auxiliary,true);
    return ()=>{element.removeEventListener('pointerdown',down,true);element.removeEventListener('pointermove',move,true);element.removeEventListener('pointerup',end);element.removeEventListener('pointercancel',end);element.removeEventListener('lostpointercapture',end);element.removeEventListener('auxclick',auxiliary,true);element.classList.remove('is-panning');};
  },[agents.length>0]);
  async function toggle(a:string,b:string,enabled:boolean) {
    if(pending.current||stale||swappingRef.current)return;
    pending.current=true;setSaving(true);setError('');setFeedback('');
    try { await onToggle(a,b,enabled);setFeedback(`Saved. ${byId.get(a)?.name} and ${byId.get(b)?.name}: communication ${enabled?'enabled':'disabled'}.`); }
    catch(error) { setError(problemText(error)); }
    finally {pending.current=false;setSaving(false);}
  }
  function prepareBulk(action:'permit'|'mesh'|'disable') {
    const agentId=action==='mesh'?undefined:focused??undefined;
    const scope=agentId?`all links for ${agents.find(agent=>agent.id===agentId)!.name}`:'all links in this project';
    setBulkError('');
    setBulk({title:action==='permit'?'Connect selected agent':action==='mesh'?'Connect all agents':'Disable all communication',scope,count:agentId?agents.length-1:agents.length*(agents.length-1)/2,input:{enabled:action!=='disable',...(agentId?{agent_id:agentId}:{}),expected_agent_ids:agents.map(agent=>agent.id)}});
  }
  async function applyBulk() {
    if(!bulk||pending.current||stale)return;
    pending.current=true;setSaving(true);setBulkError('');setError('');setFeedback('');
    try {await onBulk(bulk.input);setFeedback(`Saved. ${bulk.count} links ${bulk.input.enabled?'enabled':'disabled'}. Changes apply immediately.`);setBulk(null);}
    catch(error) {setBulkError(problemText(error));}
    finally {pending.current=false;setSaving(false);}
  }
  const focused=agents.some(agent=>agent.id===selected)?selected:agents[0]?.id??null;
  const byId=new Map(agents.map(agent=>[agent.id,agent]));
  const edges=pairings.filter(pair=>byId.has(pair.agent_a)&&byId.has(pair.agent_b));
  const enabledPairs=new Set(edges.map(edge=>[edge.agent_a,edge.agent_b].sort().join(':')));
  const isEnabled=(id:string)=>enabledPairs.has([focused!,id].sort().join(':'));
  const orderedAgents=[...agents].sort((a,b)=>{const ai=order.indexOf(a.id),bi=order.indexOf(b.id);return (ai<0?agents.indexOf(a)+order.length:ai)-(bi<0?agents.indexOf(b)+order.length:bi);});
  const ring=orderedAgents.filter(agent=>agent.id!==focused);
  const matching=ring.filter(agent=>(filter==='all'||isEnabled(agent.id)===(filter==='enabled'))&&`${agent.name} ${environments.find(e=>e.id===agent.environment_id)?.name??''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const visible=matching;
  const rows=Math.max(1,Math.ceil(Math.sqrt(visible.length)));
  const width=overview?800:Math.max(800,520+Math.max(0,Math.ceil(visible.length/rows)-1)*200),height=overview?Math.max(640,agents.length*42):Math.max(320,rows*150+40);
  const layout=overview?orderedAgents.map((agent,index)=>{const angle=2*Math.PI*index/agents.length-Math.PI/2;return {...agent,x:400+Math.cos(angle)*290,y:height/2+Math.sin(angle)*(height/2-100)};}):orderedAgents.filter(agent=>agent.id===focused||visible.some(peer=>peer.id===agent.id)).map(agent=>({...agent,x:agent.id===focused?140:420+Math.floor(visible.findIndex(peer=>peer.id===agent.id)/rows)*200,y:agent.id===focused?height/2:80+(visible.findIndex(peer=>peer.id===agent.id)%rows)*150}));
  const nodes=layout.map(node=>({...node,...positions[node.id]}));
  const positioned=new Map(nodes.map(node=>[node.id,node]));
  const displayed=overview?orderedAgents.flatMap((agent,index)=>orderedAgents.slice(index+1).map(peer=>({agent_a:agent.id,agent_b:peer.id,enabled:enabledPairs.has([agent.id,peer.id].sort().join(':'))}))).filter(pair=>overviewFilter==='all'||pair.enabled===(overviewFilter==='enabled')).sort((a,b)=>Number(a.enabled)-Number(b.enabled)):visible.map(agent=>({agent_a:focused!,agent_b:agent.id,enabled:isEnabled(agent.id)}));
  const peers=(id:string)=>edges.filter(pair=>pair.agent_a===id||pair.agent_b===id).map(pair=>byId.get(pair.agent_a===id?pair.agent_b:pair.agent_a)!);
  useEffect(()=>{resetLayout();viewport.current?.scrollTo({left:0,top:0});},[overview,search,filter,layout.map(node=>node.id).sort().join(':')]);
  useEffect(()=>{
    const element=viewport.current;if(!element)return;
    const fit=()=>setZoom(Math.min(1,element.clientWidth/width,Math.max(240,window.innerHeight*.62)/height));
    const observer=new ResizeObserver(fit);observer.observe(element);window.addEventListener('resize',fit);fit();
    return ()=>{observer.disconnect();window.removeEventListener('resize',fit);};
  },[width,height,overview,agents.length]);
  if(!agents.length)return <p className="inline-empty">Add named agents to configure their connections.</p>;
  return <div className="agent-pair-map">
    <p className="supporting">{stale?'Updates unavailable. These are the last received communication settings.':'Enable or disable communication between agents in both directions.'}</p>
    <div className="pair-map-bulk"><div className="button-row"><button className="button button-outline" disabled={!focused||agents.length<2||saving||stale} onClick={()=>prepareBulk('permit')} title="Select an agent to connect it with every other agent">Connect selected agent</button><button className="button button-outline" disabled={agents.length<2||saving||stale} onClick={()=>prepareBulk('mesh')}>Connect all agents</button><button className="button button-outline" disabled={agents.length<2||saving||stale} onClick={()=>prepareBulk('disable')}>{focused?'Disconnect selected agent':'Disconnect all agents'}</button></div><p className="supporting">{focused?`Selected-agent actions affect only ${byId.get(focused)!.name}. Connect all agents affects the whole project.`:'Connect all agents and Disconnect all agents affect every current agent in this project.'} Review the affected links before confirming.</p></div>
    <div className="button-row" aria-label="Network view"><button type="button" className="button button-outline" aria-pressed={!overview} onClick={()=>setOverview(false)}>Focused agent</button><button type="button" className="button button-outline" aria-pressed={overview} onClick={()=>{setOverview(true);setZoom(Math.min(1,(viewport.current?.parentElement?.clientWidth??800)/800,(window.innerHeight*.7)/Math.max(640,agents.length*42)));}}>All connections</button>{overview&&<><label>Show links<select value={overviewFilter} onChange={event=>setOverviewFilter(event.target.value)}><option value="all">All links</option><option value="enabled">Enabled only</option><option value="disabled">Disabled only</option></select></label><button type="button" className="button button-text" aria-label="Zoom out" onClick={()=>setZoom(value=>Math.max(.1,value-.25))}>−</button><span>{Math.round(zoom*100)}%</span><button type="button" className="button button-text" aria-label="Zoom in" onClick={()=>setZoom(value=>Math.min(2,value+.25))}>+</button></>}</div>
    {!overview&&<div className="pair-focus-controls"><label>Show connections for<select value={focused??''} onChange={event=>focus(event.target.value)}>{agents.map(agent=><option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><label>Find a peer<input type="search" value={search} placeholder="Agent or environment" onChange={event=>{setSearch(event.target.value);}}/></label><label>Connections<select value={filter} onChange={event=>{setFilter(event.target.value);}}><option value="all">All connections</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></label></div>}
    {focused&&<div className="pair-map-focus-heading"><p><strong>{byId.get(focused)!.name}</strong><span>{peers(focused).length} enabled · {ring.length-peers(focused).length} disabled links</span></p><button type="button" className="button button-outline" onClick={()=>overview?resetLayout():focus(focused)}>Reset layout</button></div>}
    <div className="pair-mobile-list">
      {displayed.length?<ul className="pair-mobile-rows" aria-label="Agent communication settings">{displayed.map(pair=>{
        const a=byId.get(pair.agent_a)!,b=byId.get(pair.agent_b)!;
        return <li className="pair-mobile-row" key={`${a.id}-${b.id}`}><div className="pair-mobile-names">{[b].map(agent=><div key={agent.id}><button type="button" className="pair-peer-focus" aria-label={`Focus ${agent.name}`} onClick={()=>focus(agent.id)}>{agent.name}</button><span>{environments.find(environment=>environment.id===agent.environment_id)?.name??'Unknown environment'}{!agent.active?' · Agent disabled':''}</span></div>)}</div><button type="button" className={`button button-outline pair-mobile-switch ${pair.enabled?'is-enabled':'is-disabled'}`} role="switch" aria-checked={pair.enabled} aria-label={`Communication between ${a.name} and ${b.name}`} disabled={saving||stale||swapping} onClick={()=>void toggle(a.id,b.id,!pair.enabled)}><Icon name="link"/>{pair.enabled?'Enabled':'Disabled'}</button></li>;
      })}</ul>:<p className="inline-empty">{ring.length?'No peers match these filters.':'Add another agent to configure communication.'}</p>}
    </div>
    <p className="supporting pair-map-desktop-help">{overview?'Green solid lines are enabled; red dashed lines are disabled. Select an agent to manage its links in the focused view. Scroll the wheel to zoom in or out. Hold the middle mouse button and drag to pan.':'Click any agent to restore the layout with it on the left and its peers on the right. Drag to push nearby agents and pull connected peers. Release to let them settle. Scroll the wheel to zoom; middle-drag to pan. Click a wire to change communication.'}</p>
    <div ref={viewport} className={`pair-map-scroll ${overview?'is-overview':''}`} tabIndex={0} role="region" aria-label="Permitted agent connections">
      <div className="pair-map-layout" style={{width,height,zoom}}><div className={`pair-map-canvas ${Object.keys(positions).length?'is-moving':''}`} style={{width,height}}>
        <svg width={width} height={height} role="group" aria-label="Communication links">
          {displayed.map(pair=>{
            const a=positioned.get(pair.agent_a)!,b=positioned.get(pair.agent_b)!;
            const control=(!overview?wirePositions[b.id]:undefined)??{x:(a.x+b.x)/2,y:(a.y+b.y)/2-38-(dragged.current?.id===a.id||dragged.current?.id===b.id?6:0)};
            const liftA=dragged.current?.id===a.id?12:0,liftB=dragged.current?.id===b.id?12:0;
            const cable=`M ${a.x+27} ${a.y-38-liftA} Q ${control.x} ${control.y} ${b.x-27} ${b.y-38-liftB}`;
            return <g key={`${a.id}-${b.id}`} className={`pair-map-link ${pair.enabled?'is-enabled':'is-off'}`} role="switch" aria-checked={pair.enabled} aria-label={`Communication between ${a.name} and ${b.name}`} aria-disabled={saving||stale||swapping} tabIndex={!saving&&!stale&&!swapping?0:-1} onClick={()=>void toggle(a.id,b.id,!pair.enabled)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();void toggle(a.id,b.id,!pair.enabled);}}}>
              <title>{a.name} ↔ {b.name}: {pair.enabled?'enabled':'disabled'}. Click to {pair.enabled?'disable':'enable'}.</title>
              <path d={cable} className="pair-wire-sheath"/>
              <path d={cable} className="pair-map-edge"/>
              <path d={cable} className="pair-wire-highlight"/>
              <circle cx={a.x+27} cy={a.y-38-liftA} r={5} className="pair-wire-plug"/>
              <circle cx={b.x-27} cy={b.y-38-liftB} r={5} className="pair-wire-plug"/>
              <path d={cable} className="pair-map-hit"/>
            </g>;
          })}
        </svg>

        {nodes.map(agent=>{
          const paired=peers(agent.id);

          return <button key={agent.id} className={`pair-map-node ${positions[agent.id]?'is-moving':''}`} style={{left:agent.x,top:agent.y,'--node-tilt-x':`${Math.max(-16,Math.min(16,-(positions[agent.id]?.vy??0)*1.5))}deg`,'--node-tilt-y':`${Math.max(-16,Math.min(16,(positions[agent.id]?.vx??0)*1.5))}deg`,'--node-lift':dragged.current?.id===agent.id?'12px':'0px'} as CSSProperties} onPointerDown={event=>startDrag(event,agent)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} aria-pressed={focused===agent.id} onClick={event=>{if(event.detail>0&&suppressClick.current){suppressClick.current=false;return;}suppressClick.current=false;focus(agent.id);}} aria-label={`${agent.name}. ${!agent.active?'Disabled. ':''}${paired.length} enabled connections. Select to focus.`}>
            <AgentAvatar appearance={agent.appearance} className={`pair-map-avatar ${agent.active?'':'is-disabled'}`}/>
            <strong>{agent.name}</strong>
            <span>{environments.find(environment=>environment.id===agent.environment_id)?.name??'Unknown environment'}</span>
            <small>{!agent.active?'Agent disabled':agent.id===focused?`${paired.length} enabled connections`:isEnabled(agent.id)?'Communication enabled':'Communication disabled'}</small>
          </button>;
        })}
      </div></div>
    </div>
    {!overview&&<p className="supporting" role="status">{matching.length} of {ring.length} peers shown{search||filter!=='all'?' · Filters applied':''}</p>}
    {error&&<p className="notice notice-error" role="alert">{error}</p>}<p className="supporting" role="status">{saving?'Saving communication setting…':feedback||'Changes save automatically after each action.'}</p>
    <p className="supporting" aria-live="polite">Both agents still need valid access. Links you disable stay disabled after sign-in.</p>
    {bulk&&<Modal title={bulk.title} onClose={()=>{if(!saving)setBulk(null);}} busy={saving}><div className="form-stack">{bulkError&&<p className="notice notice-error" role="alert">{bulkError}</p>}<p>This will {bulk.input.enabled?'enable':'disable'} <strong>{bulk.count} links</strong>: {bulk.scope}.</p><p>Changes apply immediately after confirmation. Agent credentials and local commands are unchanged.{!bulk.input.enabled&&' These links stay disabled after sign-in. New agents added later are not included.'}</p><div className="modal-actions"><button className="button button-text" disabled={saving} onClick={()=>setBulk(null)}>Cancel</button><button className={`button ${bulk.input.enabled?'button-primary':'button-danger'}`} disabled={saving||stale||swapping} onClick={()=>void applyBulk()}>{saving?'Saving…':bulk.input.enabled?'Enable links':'Disable links'}</button></div></div></Modal>}
  </div>;
}
