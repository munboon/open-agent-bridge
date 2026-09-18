import {createServer} from 'node:http';
import {once} from 'node:events';
import {describe,it,expect} from 'vitest';
import {attachMessageSockets} from '../scripts/websocket-transport.mjs';
import {connectionModes} from '../scripts/bridge-client.mjs';
async function setup(handle:any,options={}){
 const server=createServer();const sockets=attachMessageSockets(server,handle,options);
 server.listen(0,'127.0.0.1');await once(server,'listening');
 return {url:`ws://127.0.0.1:${(server.address() as any).port}/api/v1/socket`,close:async()=>{for(const s of sockets.clients)s.terminate();sockets.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
describe('message transport compatibility',()=>{
 it('negotiates existing native capabilities and legacy fallback',()=>{
  expect(connectionModes({message_transports:['websocket','sse','long_poll']},'auto',true)).toEqual(['websocket','sse','poll']);
  expect(connectionModes({message_transports:['websocket','sse']},'auto',false)).toEqual(['sse','poll']);
  expect(connectionModes(undefined,'auto',false)).toEqual(['poll']);
  expect(connectionModes({},'poll',true)).toEqual(['poll']);
 });
 it('delivers events over native WebSocket without credentials in URL',async()=>{
  let seen:Request|undefined;
  const app=await setup(async(request:Request)=>{seen=request;return new Response('event: messages\ndata: {"messages":[{"id":"example"}]}\n\n',{headers:{'Content-Type':'text/event-stream'}});});
  try{const socket=new WebSocket(app.url);const result=new Promise<any>((resolve,reject)=>{socket.onmessage=e=>resolve(JSON.parse(e.data));socket.onerror=reject;});socket.onopen=()=>socket.send(JSON.stringify({type:'authenticate',headers:{Authorization:'Bearer synthetic'}}));expect((await result).messages[0].id).toBe('example');expect(seen?.url).toBe('http://localhost/api/v1/events');expect(seen?.headers.get('authorization')).toBe('Bearer synthetic');socket.close();}finally{await app.close();}
 });
 it('propagates rejected access and closes unauthenticated sockets',async()=>{
  const app=await setup(async()=>new Response('{}',{status:401}),{authTimeout:30});
  try{const socket=new WebSocket(app.url);const result=new Promise<any>(resolve=>{socket.onmessage=e=>resolve(JSON.parse(e.data));});socket.onopen=()=>socket.send(JSON.stringify({type:'authenticate',headers:{}}));expect((await result).status).toBe(401);socket.close();const idle=new WebSocket(app.url);const code=await new Promise<number>(resolve=>{idle.onclose=e=>resolve(e.code);});expect(code).toBe(1008);}finally{await app.close();}
 });
});
