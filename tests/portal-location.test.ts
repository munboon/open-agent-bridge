import {describe,it,expect} from 'vitest';
import {parsePortalLocation,portalPath} from '../src/lib/portal-location';
describe('portal locations',()=>{
 it('round trips projects, sections and conversation addresses',()=>{for(const section of ['overview','agents','conversations','tasks','transfers','audit'] as const){const location={project:'a123456789',section};expect(parsePortalLocation(portalPath(location))).toEqual({...location,thread:undefined});}expect(parsePortalLocation('/projects/a123456789/conversations/c0123456789')).toEqual({project:'a123456789',section:'conversations',thread:'c0123456789'});});
 it('rejects malformed and incompatible paths',()=>{for(const path of ['/projects/nope','/projects/a123456789/tasks/c0123456789','/projects/a123456789/unknown','/projects/a123456789/conversations/c0123456789/extra'])expect(parsePortalLocation(path).invalid).toBe(true);});
 it('accepts the directory and project default',()=>{expect(parsePortalLocation('/').project).toBeNull();expect(parsePortalLocation('/projects/a123456789').section).toBe('overview');});
});
