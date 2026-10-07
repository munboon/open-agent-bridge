import {describe,it,expect} from 'vitest';
import {accessDays,accessExpiry} from '../src/lib/access-duration';
import {readAccessDays} from '../src/components/AccessDurationFields';
import {agentValidity,matchesAgentFilter} from '../src/lib/agent-dashboard';
import {openapi} from '../src/lib/openapi';

describe('explicit access duration',()=>{
  it('accepts only null or integer days within the finite range',()=>{
    for(const value of [null,1,60,90])expect(accessDays.parse(value)).toBe(value);
    for(const value of [undefined,'60','unlimited',0,91,1.5,NaN])expect(accessDays.safeParse(value).success).toBe(false);
    expect(accessExpiry(null)).toBeNull();
    expect(accessDays.default(60).parse(undefined)).toBe(60);
    expect(accessExpiry(60)!.getTime()).toBeGreaterThan(Date.now()+59*86400000);
  });
  it('never serializes malformed finite form input as unlimited',()=>{
    const form=new FormData();form.set('access_mode','limited');form.set('days','27');
    expect(readAccessDays(form,'days')).toBe(27);
    for(const value of ['', 'abc','0','91','1.5']){form.set('days',value);expect(()=>readAccessDays(form,'days')).toThrow('Choose 1 to 90');}
    form.delete('days');expect(()=>readAccessDays(form,'days')).toThrow();
    form.set('access_mode','unlimited');expect(readAccessDays(form,'days')).toBeNull();
    form.set('access_mode','invalid');expect(()=>readAccessDays(form,'days')).toThrow();
  });
  it('counts unlimited as valid without a fabricated date and excludes revoked access',()=>{
    const now=Date.now();const unlimited={agent_id:'a',expires_at:null,revoked_at:null};
    const validity=agentValidity('a',[unlimited,{...unlimited,expires_at:new Date(now+86400000).toISOString()}],now);
    expect(validity).toEqual({state:'unlimited',days:null,expiry:null,count:2});
    expect(matchesAgentFilter({connection:'connected',work:'idle'} as any,'attention',validity)).toBe(false);
    expect(agentValidity('a',[{...unlimited,revoked_at:new Date(now).toISOString()}],now).state).toBe('missing');
    expect(agentValidity('b',[unlimited],now).state).toBe('missing');
  });
  it('publishes nullable input and response contracts with separate enrollment deadlines',()=>{
    const schemas=openapi.components.schemas as any;
    for(const [name,field] of [['EnrollmentInput','expires_days'],['KitInput','expires_days'],['CredentialInput','expires_days'],['ExtendValidityInput','days']]){
      const types=schemas[name].properties[field].anyOf;expect(types).toContainEqual({type:'null'});
      expect(types).toContainEqual(expect.objectContaining({type:'integer',minimum:1,maximum:90}));
    }
    for(const schema of [schemas.CredentialIssued.properties.expires_at,schemas.ProjectSnapshot.properties.credentials.items.properties.expires_at,schemas.EnrollmentIssued.properties.access_expires_at])expect(schema.anyOf).toContainEqual({type:'null'});
    expect(schemas.EnrollmentIssued.properties.expires_at.type).toBe('string');
    expect((openapi.paths['/api/admin/projects/{id}/agents/{agent_id}/enrollment'].post.responses as any)['200'].content['application/json'].schema.$ref).toBe('#/components/schemas/EnrollmentIssued');
  });
});
