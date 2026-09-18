import {Server} from 'node:http';
import {EventEmitter} from 'node:events';
import next from 'next';
import {attachMessageSockets} from './websocket-transport.mjs';
process.env.NODE_ENV='production';
process.env.BRIDGE_WEBSOCKET_ENABLED='1';
const {pool}=await import('../src/lib/db.ts');
const {handleAgentRequest}=await import('../src/lib/agent-api.ts');
const hostname=process.env.BRIDGE_HOST??'127.0.0.1';
const port=Number(process.env.PORT??3220);
// Next registers its own upgrade handler after the first HTTP request. Route our
// exact endpoint separately so Next cannot close an authenticated bridge socket.
const upgrades=new EventEmitter();
class BridgeServer extends Server {
 emit(event,...args){if(event==='upgrade'&&args[0].url==='/api/v1/socket')return upgrades.emit(event,...args);return super.emit(event,...args);}
}
const server=new BridgeServer();
const app=next({dev:false,hostname,port,httpServer:server});
await app.prepare();
const handler=app.getRequestHandler();
server.on('request',(request,response)=>{void handler(request,response);});
const sockets=attachMessageSockets(upgrades,request=>handleAgentRequest(request,pool),{origin:process.env.BETTER_AUTH_URL});
server.listen(port,hostname,()=>console.log(`Bridge listening on ${hostname}:${port}`));
let closing=false;
async function close(){if(closing)return;closing=true;for(const socket of sockets.clients)socket.terminate();server.close();await app.close();await pool.end();}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close());
