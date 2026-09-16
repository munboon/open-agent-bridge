export const agentIcons = ['agents','server','shield','messages','tasks','bolt','archive','search'] as const;
export const agentColors = {blue:'#dce8ff',teal:'#d7f2ec',purple:'#e9defa',amber:'#fff0ce',rose:'#fbe0e7',slate:'#e2e8f0'} as const;
export type AgentAppearance = {icon:typeof agentIcons[number];color:keyof typeof agentColors;image:string|null};
export const defaultAppearance:AgentAppearance={icon:'agents',color:'blue',image:null};
