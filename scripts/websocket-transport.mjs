// Bridge-side adapter. Agents use native WebSocket; no agent dependencies.
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {WebSocketServer}=require('next/dist/compiled/ws');
export function attachMessageSockets(server,handleEvents,{origin,capacity=100,authTimeout=5000}={}){
 const wss=new WebSocketServer({noServer:true,maxPayload:8192,perMessageDeflate:false});
 server.on('upgrade',(request,socket,head)=>{
  if(request.url!=='/api/v1/socket'){socket.destroy();return;}
  if(wss.clients.size>=capacity){socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');return;}
  if(request.headers.origin&&request.headers.origin!==origin){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  wss.handleUpgrade(request,socket,head,ws=>wss.emit('connection',ws));
 });
 wss.on('connection',ws=>{
  let authenticated=false,reader;
  const abort=new AbortController();
  const timer=setTimeout(()=>ws.close(1008,'Authentication required'),authTimeout);
  const lifetime=setTimeout(()=>ws.terminate(),30000);
  ws.on('error',()=>abort.abort());
  ws.on('close',()=>{clearTimeout(timer);clearTimeout(lifetime);abort.abort();void reader?.cancel().catch(()=>{});});
  ws.on('message',async(raw,binary)=>{
   if(authenticated){ws.close(1008,'Unexpected client message');return;}
   authenticated=true;clearTimeout(timer);
   try{
    if(binary)throw Error('Expected authentication');
    const input=JSON.parse(raw.toString());
    if(input.type!=='authenticate'||!input.headers||typeof input.headers!=='object')throw Error('Expected authentication');
    const headers=new Headers();
    for(const name of ['authorization','x-bridge-session','x-bridge-time','x-bridge-nonce','x-bridge-proof','x-bridge-device']){
     const value=Object.entries(input.headers).find(([key])=>key.toLowerCase()===name)?.[1];
     if(typeof value==='string')headers.set(name,value);
    }
    // Reuse the signed events endpoint and its transactional authorization fences.
    const response=await handleEvents(new Request('http://localhost/api/v1/events',{headers,signal:abort.signal}));
    if(!response.ok){if(ws.readyState===1)ws.send(JSON.stringify({type:'error',status:response.status}));ws.close(1008,'Authentication or capacity failure');return;}
    reader=response.body.getReader();let buffer='';const decoder=new TextDecoder();
    while(ws.readyState===1){
     const part=await reader.read();if(part.done)break;
     buffer+=decoder.decode(part.value,{stream:true});let end;
     while((end=buffer.indexOf('\n\n'))>=0){
      const event=buffer.slice(0,end);buffer=buffer.slice(end+2);
      if(ws.bufferedAmount>8388608){ws.close(1013,'Slow consumer');return;}
      if(event.startsWith('event: messages\n'))ws.send(JSON.stringify({type:'messages',...JSON.parse(event.split('\n').find(line=>line.startsWith('data: ')).slice(6))}));
      else ws.send(JSON.stringify({type:event.startsWith('event: reconnect')?'reconnect':'heartbeat'}));
     }
    }
    ws.close(1000,'Renew connection');
   }catch{if(ws.readyState===1)ws.close(1008,'Invalid stream request');}
   finally{await reader?.cancel().catch(()=>{});}
  });
 });
 return wss;
}
