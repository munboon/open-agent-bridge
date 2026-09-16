'use client';
import {agentColors,defaultAppearance,type AgentAppearance} from '../lib/agent-appearance';
import {Icon} from './ui';
export function AgentAvatar({appearance,className=''}:{appearance?:AgentAppearance|null;className?:string}){
 const value=appearance??defaultAppearance;
 return <span className={`agent-custom-avatar ${className}`} style={{backgroundColor:agentColors[value.color]??agentColors.blue}} aria-hidden="true">{value.image?<img src={value.image} alt="" width={48} height={48}/>:<Icon name={value.icon}/>}</span>;
}
