export const sections=['overview','agents','conversations','tasks','transfers','audit'] as const;
export type PortalLocation={project:string|null;section:typeof sections[number];thread?:string;invalid?:boolean};
export function parsePortalLocation(path:string):PortalLocation {
 if(path==='/'||path==='/projects'||path==='/projects/')return {project:null,section:'overview'};
 const match=/^\/projects\/([a-f0-9]{10})(?:\/(overview|agents|conversations|tasks|transfers|audit))?(?:\/([ac][a-f0-9]{10}))?\/?$/.exec(path);
 if(!match||match[3]&&match[2]!=='conversations')return {project:null,section:'overview',invalid:true};
 return {project:match[1],section:(match[2]??'overview') as PortalLocation['section'],thread:match[3]};
}
export function portalPath(location:PortalLocation){return location.project?`/projects/${location.project}/${location.section}${location.thread?'/'+location.thread:''}`:'/projects';}
