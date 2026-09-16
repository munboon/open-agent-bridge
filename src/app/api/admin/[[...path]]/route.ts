import {issueEnrollment} from '@/lib/agent-enrollment';
import { pool } from '@/lib/db';
import { requireOwner, OwnerAuthError } from '@/lib/owner';
import { adminOperation, ownerTransaction } from '@/lib/admin-service';
import { createRoleKit } from '@/lib/role-kits';
import { provisionProject } from '@/lib/project-kit';
import { issueAgentKit } from '@/lib/agent-kit';
import { uuid } from '@/lib/protocol';
import { errorResponse, BridgeError, json, readBody } from '@/lib/protocol';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handle(request:Request):Promise<Response> {
  try {
    const owner=await requireOwner(request);
    const path=new URL(request.url).pathname.replace(/^\/api\/admin\/?/,'').split('/').filter(Boolean);
    if(request.method==='GET'&&path.length===5&&path[0]==='projects'&&path[2]==='agents'&&path[4]==='kit') {
      const content=await ownerTransaction(pool,owner,client=>createRoleKit(client,owner,uuid.parse(path[1]),uuid.parse(path[3])));
      const format=new URL(request.url).searchParams.get('format');
      return new Response(content,{headers:{'Content-Type':'text/markdown; charset=utf-8','Cache-Control':'no-store',
        'Content-Disposition':`attachment; filename="${format==='claude'?'CLAUDE.md':'AGENTS.md'}"`}});
    }
    const body=request.method==='POST'?await readBody(request):null;
    if(request.method==='POST'&&path.length===5&&path[0]==='projects'&&path[2]==='agents'&&path[4]==='enrollment')return json(await ownerTransaction(pool,owner,client=>issueEnrollment(client,owner,uuid.parse(path[1]),uuid.parse(path[3]),body)));
    if(request.method==='POST'&&path.join('/')==='projects/provision') {
      return json(await provisionProject(pool,owner,body,request.headers.get('Idempotency-Key')),201);
    }
    if(request.method==='POST'&&path.length===5&&path[0]==='projects'&&path[2]==='agents'&&path[4]==='kit') {
      const kit=await ownerTransaction(pool,owner,client=>issueAgentKit(client,owner,uuid.parse(path[1]),uuid.parse(path[3]),body));
      return new Response(new Uint8Array(kit.archive),{headers:{'Content-Type':kit.contentType,'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="${kit.filename}"`}});
    }
    return json(await adminOperation(pool,owner,request.method,path,body,{key:request.headers.get('Idempotency-Key'),query:new URL(request.url).searchParams}));
  } catch(error) {
    if(error instanceof OwnerAuthError) return errorResponse(new BridgeError(error.status,error.code,'Owner authorization required.'));
    return errorResponse(error);
  }
}
export const GET=handle;
export const POST=handle;
