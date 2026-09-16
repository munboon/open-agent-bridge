import { describe,expect,it } from 'vitest';
import { openapi } from '../src/lib/openapi';

// These form the supported owner contract; additions to the service must be documented here.
const ownerRoutes:[string,string][]=[
  ['post','/api/admin/projects/{id}/delete'],['get','/api/admin'],['post','/api/admin/projects'],['get','/api/admin/projects/{id}'],
  ...['state','environments','agents','pairings','messages'].map(name=>['post',`/api/admin/projects/{id}/${name}`] as [string,string]),
  ['get','/api/admin/projects/{id}/conversations/{conversation_id}/messages'],
  ['post','/api/admin/projects/{id}/tasks/{task_id}/cancel'],
  ...['credentials','takeover','recipient-key','state'].map(name=>['post',`/api/admin/projects/{id}/agents/{agent_id}/${name}`] as [string,string]),
  ['post','/api/admin/projects/{id}/credentials/{credential_id}/revoke'],
  ['get','/api/admin/projects/{id}/agents/{agent_id}/kit'],
];
describe('published owner OpenAPI contract',()=>{
  it.each(ownerRoutes)('%s %s is documented with owner session security and concrete response', (method,path)=>{
    const operation=openapi.paths[path]?.[method] as any;
    expect(operation).toBeDefined();expect(operation.security).toEqual([{OwnerSession:[]}]);
    expect(operation.parameters.some((p:any)=>p.name==='X-Bridge-Session')).toBe(false);
    expect(operation.responses['200'].headers['Cache-Control'].schema.const).toBe('no-store');
    if(method==='post'){
      expect(operation.parameters).toContainEqual(expect.objectContaining({name:'Origin',in:'header',required:true}));
      expect(operation.requestBody.content['application/json'].schema.$ref).toMatch(/^#\/components\/schemas\//);
    }
    if(!path.endsWith('/kit') && !path.endsWith('/provision'))expect(operation.responses['200'].content['application/json'].schema.$ref).toMatch(/^#\/components\/schemas\//);
  });
  it('describes password-based owner sessions without an authenticator prerequisite',()=>{
    const security=openapi.components.securitySchemes.OwnerSession;
    expect(security).toMatchObject({type:'apiKey',in:'cookie',name:'oab.session_token'});
    expect(security.description).toMatch(/password/i);
    expect(security.description).not.toMatch(/MFA|two.factor|authenticator/i);
  });
  it('requires durable idempotency for owner messages and cancellation, and documents bounded history',()=>{
    for(const path of ['/api/admin/projects/{id}/messages','/api/admin/projects/{id}/tasks/{task_id}/cancel'])expect((openapi.paths[path].post.parameters as any[])).toContainEqual(expect.objectContaining({name:'Idempotency-Key',required:true}));
    const history=openapi.paths['/api/admin/projects/{id}/conversations/{conversation_id}/messages'].get as any;
    expect(history.parameters).toContainEqual(expect.objectContaining({name:'after_sequence',in:'query'}));
    expect(history.parameters.some((p:any)=>p.name==='limit')).toBe(false);
    const page=(openapi.components.schemas as any).MessagePage;
    expect(page.required).toEqual(expect.arrayContaining(['messages','has_more','next_sequence','retention_gap']));
    expect(page.properties.messages.maxItems).toBe(100);
  });
  it('documents secret-free snapshots and one-time secret responses separately',()=>{
    const schemas=openapi.components.schemas as any;
    const snapshot=schemas.ProjectSnapshot.properties;
    expect(snapshot.credentials.items.properties.token).toBeUndefined();
    expect(snapshot.credentials.items.properties.digest).toBeUndefined();
    expect(snapshot.transfers.items.properties.offers.items.properties.envelope).toBeUndefined();
    expect(snapshot.transfers.items.properties.offers.items.properties.token).toBeUndefined();
    expect(schemas.CredentialIssued.required).toContain('token');
    expect(schemas.TakeoverIssued.required).toContain('takeover_token');
    expect(schemas.TakeoverInput.properties.confirm.const).toBe(true);
  });
  it('serves role kits as Markdown attachments and resolves every local schema reference',()=>{
    const kit=openapi.paths['/api/admin/projects/{id}/agents/{agent_id}/kit'].get as any;
    expect(kit.responses['200'].content['text/markdown'].schema.type).toBe('string');
    expect(kit.responses['200'].headers['Content-Disposition']).toBeDefined();
    function visit(value:unknown){if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){if(key==='$ref'&&typeof item==='string'&&item.startsWith('#/components/schemas/'))expect(openapi.components.schemas).toHaveProperty(item.slice('#/components/schemas/'.length));else visit(item);}}
    visit(openapi);
  });
});
