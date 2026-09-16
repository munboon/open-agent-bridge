import {z} from 'zod';
import {promptTemplateIds} from './agent-instructions';
export const promptTemplateSchema=z.enum(promptTemplateIds);
export const workInstructionsSchema=z.string().trim().min(1).max(16000);
export function requireCustomInstructions(input:{prompt_template?:string;work_instructions?:string|null},ctx:z.RefinementCtx){
 if(input.prompt_template==='custom'&&!input.work_instructions?.trim())ctx.addIssue({code:'custom',path:['work_instructions'],message:'Describe what this custom agent should do.'});
}
