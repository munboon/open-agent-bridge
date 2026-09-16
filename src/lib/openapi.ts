import {promptTemplateSchema,workInstructionsSchema} from './agent-template-schema';
import {projectSetupSchema} from './project-kit';
import { hostMetricsSchema } from './host-metrics';
import { z } from 'zod';
import { label, messageBody, plainMessage, taskAction, taskCreate, uuid } from './protocol';
import { eventInput, manifestSchema, offerInput, receiptInput, transferInput } from './transfers';
const schemas:Record<string,z.ZodType>={Confirm:z.strictObject({confirm:z.literal(true)}),HostMetrics:hostMetricsSchema,MessageInput:plainMessage,TaskInput:taskCreate,TaskAction:taskAction,
  Manifest:manifestSchema,TransferInput:transferInput,OfferInput:offerInput,ReceiptInput:receiptInput,TransferEvent:eventInput,
  SessionInput:z.strictObject({takeover_token:z.string().optional()}),ConversationInput:z.strictObject({recipient_agent_id:uuid}),
  Acknowledgements:z.strictObject({message_ids:z.array(uuid).min(1).max(100)}),Empty:z.strictObject({}),
  ProjectSetup:projectSetupSchema,ProjectInput:z.strictObject({name:label,client_label:label}),EnvironmentInput:z.strictObject({name:label.max(114),create_agent:z.boolean().optional(),role:z.enum(['development','deployment']).optional(),prompt_template:promptTemplateSchema.optional(),work_instructions:workInstructionsSchema.nullable().optional()}),
  AgentInput:z.strictObject({name:z.string().trim().max(120).optional(),role:z.enum(['development','deployment']).optional(),prompt_template:promptTemplateSchema.optional(),work_instructions:workInstructionsSchema.nullable().optional(),environment_id:uuid}),
  BulkPairingInput:z.strictObject({enabled:z.boolean(),agent_id:uuid.optional(),expected_agent_ids:z.array(uuid).max(1000)}),
  PairingInput:z.strictObject({agent_a:uuid,agent_b:uuid,enabled:z.boolean().optional()}),
  EnrollmentInput:z.strictObject({expires_days:z.number().int().min(1).max(90).optional(),replace:z.boolean().optional()}),
  EnrollmentClaim:z.strictObject({public_key:z.string().max(512)}),
  PackageInput:z.strictObject({conversation_id:uuid,filename:z.string().max(120),size:z.number().int().min(0).max(1073741824),sha256:z.string().regex(/^[a-f0-9]{64}$/),sensitivity:z.enum(['synthetic','internal','sensitive']),encryption:z.object({scheme:z.literal('age'),recipient_fingerprint:z.string()}).optional()}),
  PackagePart:z.strictObject({data:z.string().max(349528),sha256:z.string().regex(/^[a-f0-9]{64}$/)}),
  PackageReceipt:z.strictObject({size:z.number().int().min(0),sha256:z.string().regex(/^[a-f0-9]{64}$/)}),
  KitInput:z.strictObject({hide_messages:z.boolean().optional(),format:z.enum(["codex","third-party"]).default("codex"),expires_days:z.number().int().min(1).max(90).optional(),rotate:z.boolean().optional()}),
  CredentialInput:z.strictObject({expires_days:z.number().int().min(1).max(90).optional(),rotate:z.boolean().optional(),overlap_seconds:z.number().int().min(0).max(3600).optional()}),
  ProjectStateInput:z.strictObject({state:z.enum(['active','paused','archived'])}),
  ExtendValidityInput:z.strictObject({days:z.number().int().min(1).max(90)}),
  AgentInstructionPreview:z.object({name:z.string(),chat_visible:z.boolean(),prompt_template:promptTemplateSchema,templates:z.array(z.object({id:z.string(),name:z.string(),instructions:z.string()})),instructions:z.string(),work_instructions:z.string(),default_instructions:z.string(),customized:z.boolean(),revision:z.number().int(),runtime:z.string(),startup:z.string()}),
  AgentInstructionInput:z.object({name:label.optional(),chat_visible:z.boolean().optional(),prompt_template:promptTemplateSchema,work_instructions:z.string().min(1).max(16000).nullable(),expected_revision:z.number().int().nonnegative()}),
  AgentNameInput:z.strictObject({name:label}),
  AgentStateInput:z.strictObject({active:z.boolean()}),
  TakeoverInput:z.strictObject({confirm:z.literal(true)}),
  RecipientKeyInput:z.strictObject({scheme:z.literal('age'),public_key:z.string().regex(/^age1[0-9a-z]{58}$/)}),
  OwnerMessageInput:z.strictObject({conversation_id:uuid.optional(),recipient_agent_id:uuid,body:messageBody}),
  OwnerCancelInput:z.strictObject({evidence:messageBody}),
};
const timestamp=z.iso.datetime({offset:true});
const sequence=z.union([z.number().int().nonnegative(),z.string().regex(/^\d+$/)]);
const project=z.object({id:uuid,owner_id:z.string(),name:z.string(),client_label:z.string(),state:z.enum(['active','paused','archived']),created_at:timestamp});
const environment=z.object({id:uuid,project_id:uuid,name:z.string()});
const agentCreated=z.object({id:uuid,prompt_template:promptTemplateSchema.optional(),chat_visible:z.boolean().optional(),name:z.string(),role:z.enum(['development','deployment']),environment_id:uuid});
const agentStatusSchema=z.object({connection:z.enum(['connected','disconnected','not_connected','setup_needed','blocked']),work:z.enum(['working','idle','waiting','attention','unknown']),provisioned:z.boolean(),reason:z.string(),task_title:z.string().nullable(),last_seen_at:timestamp.nullable(),sampled_at:timestamp});
const recipientKey=z.object({scheme:z.literal('age'),public_key:z.string(),fingerprint:z.string()});
const message=z.object({id:uuid,project_id:uuid,environment_id:uuid,conversation_id:uuid,sequence,sender_id:uuid.nullable(),author_type:z.enum(['owner','agent','system']),recipient_agent_id:uuid,type:z.string(),body:z.string(),task_id:uuid.nullable(),resource_id:uuid.nullable(),created_at:timestamp,acknowledged_at:timestamp.nullable(),retrieved_at:timestamp.nullable().optional(),owner_id:z.string().optional()});
const conversation=z.object({kind:z.enum(['peer','owner']),id:uuid,project_id:uuid,environment_id:uuid,agent_a:uuid,agent_b:uuid,next_sequence:sequence,retained_after:sequence,created_at:timestamp});
const task=z.object({id:uuid,project_id:uuid,environment_id:uuid,conversation_id:uuid,requester_id:uuid,assignee_id:uuid,title:z.string(),instructions:z.string(),state:z.enum(['pending','claimed','awaiting_reply','completed','failed','cancel_requested','cancelled','needs_reconciliation']),claim_generation:z.number().int(),session_generation:z.number().int().nullable(),lease_until:timestamp.nullable(),result:z.unknown().nullable(),cancellation_requested:z.boolean(),created_at:timestamp,updated_at:timestamp});
const offer=z.object({id:uuid,origin:z.string().url(),expires_at:timestamp,revoked_at:timestamp.nullable(),cleanup_state:z.enum(['pending','confirmed','unknown'])});
const receipt=z.object({id:uuid,transfer_id:uuid,offer_id:uuid,reporter_id:uuid,kind:z.enum(['uploaded','verified','failed']),measured_size:sequence,measured_sha256:z.string(),evidence:z.string(),created_at:timestamp});
Object.assign(schemas,{
  ProjectDeleteInput:z.strictObject({confirm_name:z.string().describe("Exact project name required for permanent deletion")}),ProjectDeleted:z.object({deleted:z.literal(true),id:uuid}),
  Project:project,ProjectList:z.object({projects:z.array(project.extend({agents:z.array(z.object({id:uuid,name:z.string(),role:z.enum(['development','deployment']),active:z.boolean(),environment_id:uuid,environment_name:z.string(),status:agentStatusSchema}))}))}),Environment:environment,AgentCreated:agentCreated,
  RecipientKey:recipientKey,Message:message,Conversation:conversation,Task:task,
  PairingResult:z.object({paired:z.boolean()}),RevokeResult:z.object({revoked:z.literal(true)}),
  CredentialIssued:z.object({id:uuid,token:z.string().describe('Plaintext credential returned only by this issue operation. Store privately; never log.'),expires_at:timestamp,shown_once:z.literal(true)}),
  TakeoverIssued:z.object({authorized:z.literal(true),takeover_token:z.string().describe('Single-use replacement session grant; provision privately to the replacement agent.'),shown_once:z.literal(true),instruction:z.string()}),
  OwnerCancelResult:z.object({cancel_requested:z.literal(true),notifications:z.array(message)}),
  MessagePage:z.object({messages:z.array(message).max(100),has_more:z.boolean(),next_sequence:z.number().int().nonnegative(),retention_gap:z.object({removed_through_sequence:z.number().int().nonnegative()}).nullable()}),
  ProjectSnapshot:z.object({project,environments:z.array(environment),agents:z.array(agentCreated.extend({active:z.boolean(),generation:z.number().int(),last_seen_at:timestamp.nullable(),has_session:z.boolean(),host_metrics:hostMetricsSchema.nullable(),host_metrics_at:timestamp.nullable(),status:agentStatusSchema,recipient_key:recipientKey.nullable()})),
    credentials:z.array(z.object({id:uuid,agent_id:uuid,expires_at:timestamp,revoked_at:timestamp.nullable(),created_at:timestamp,download_pending:z.boolean()})),
    conversations:z.array(conversation).max(100),tasks:z.array(task).max(100),messages:z.array(message).max(100),
    audit:z.array(z.object({id:sequence,actor_id:z.string(),action:z.string(),resource_id:z.string().nullable(),created_at:timestamp})).max(100),
    pairings:z.array(z.object({agent_a:uuid,agent_b:uuid,environment_id:uuid})),
    transfers:z.array(z.object({id:uuid,project_id:uuid,environment_id:uuid,conversation_id:uuid,source_id:uuid,destination_id:uuid,host_id:uuid,task_id:uuid.nullable(),direction:z.enum(['download','upload']),manifest:manifestSchema,state:z.enum(['requested','offered','in_progress','awaiting_verification','verified','failed','expired','cancelled']),cleanup_state:z.enum(['pending','confirmed','unknown']),current_offer_id:uuid.nullable(),created_at:timestamp,offers:z.array(offer),receipts:z.array(receipt)})).max(100),
  }).describe('Latest 100 conversations, tasks, messages, audit entries and transfers. This is not exhaustive search. Conversation history has a separate cursor endpoint. Credentials and offers omit all secret material.'),
});
type Operation=Record<string,unknown>;
const paths:Record<string,Record<string,Operation>>={};
function route(method:string,path:string,summary:string,schema?:string,settings:{session?:boolean;idempotent?:boolean;owner?:boolean;query?:string[];response?:string;markdown?:boolean}={}) {
  const parameters:unknown[]=[...path.matchAll(/\{([^}]+)\}/g)].map(match=>({name:match[1],in:'path',required:true,schema:match[1]==='part'?{type:'integer',minimum:0,maximum:4095}:{type:'string',format:'uuid'}}));
  if(!settings.owner)for(const name of ['X-Bridge-Time','X-Bridge-Nonce','X-Bridge-Proof'])parameters.push({name,in:'header',required:false,schema:{type:'string'},description:'Required for key-bound identities. See docs/PORTABLE-AGENTS.md for the signed request format.'});
  if(!settings.owner&&settings.session!==false)parameters.push({name:'X-Bridge-Session',in:'header',required:true,schema:{type:'string',format:'uuid'}});
  if(settings.idempotent)parameters.push({name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:8,maxLength:128,pattern:'^[A-Za-z0-9_.:-]+$'}});
  if(settings.owner&&method==='post')parameters.push({name:'Origin',in:'header',required:true,schema:{type:'string',format:'uri'},description:'Must exactly match the configured owner portal origin.'});
  for(const query of settings.query??[])parameters.push({name:query,in:'query',required:false,schema:query==='format'?{type:'string',enum:['agents','claude'],default:'agents'}:query==='after'?{type:'string',format:'uuid'}:{type:'integer',minimum:query==='limit'?1:0,maximum:query==='wait_seconds'?20:query==='limit'?100:9007199254740991}});
  const responses:Record<string,unknown>={'200':{description:settings.markdown?'Secret-free instruction file.':'Operation committed or authorized read returned. Resource timestamps are ISO 8601; sequence values may be decimal strings.',headers:{'Cache-Control':{schema:{type:'string',const:'no-store'}},...(settings.markdown?{'Content-Disposition':{schema:{type:'string'},description:'Attachment named AGENTS.md or CLAUDE.md.'}}:{})},content:settings.markdown?{'text/markdown':{schema:{type:'string'}}}:{'application/json':{schema:settings.response?{$ref:`#/components/schemas/${settings.response}`}:{type:'object'}}}}};
  for(const [status,description] of Object.entries({401:'Missing, invalid, expired or revoked identity',403:'Insufficient role, origin or local policy',404:'Unknown or inaccessible resource',405:'Unsupported method',409:'State, generation or idempotency conflict',410:'Expired offer or retired resource',413:'Request body too large',422:'Invalid request schema or manifest',429:'Rate or wait concurrency limit',503:'Dependency unavailable or capacity reached'})) responses[status]={description,content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}};
  (paths[path]??={})[method]={summary,operationId:method+'_'+path.replace(/[^a-z0-9]/gi,'_'),tags:[settings.owner?'Owner':'Agents'],
    security:settings.owner?[{OwnerSession:[]}]:[{AgentKey:[]}],parameters,responses,
    ...(schema?{requestBody:{required:true,content:{'application/json':{schema:{$ref:`#/components/schemas/${schema}`}}}}}:{})};
}
route('get','/api/v1/bootstrap','Read assigned identity and session policy; null idle_seconds and empty_polls mean no idle cutoff',undefined,{session:false});
for(const topic of ['messaging','tasks','transfers','packages'])route('get',`/api/v1/guides/${topic}`,`Read the ${topic} guide only when needed; response includes version, topic and instructions`);
route('post','/api/v1/recipient-key','Register your own age encryption public key; matching retries succeed, replacement requires administrator recovery','RecipientKeyInput');
route('get','/api/v1/conversations/{id}/recipient-key','Read the authenticated conversation recipient encryption key');
route('get','/api/v1/peers','Discover permitted peers with prompt_template, role_name, public description and recipient keys; role remains a legacy compatibility field',undefined,{query:['limit','after']});
route('post','/api/v1/sessions','Start or resume a key-bound session; legacy credentials replace the previous instance. Link enabled project peers except owner-disabled pairs','SessionInput',{session:false});
route('post','/api/v1/sessions/current/close','Close the session and leave uncertain claims for reconciliation','Empty');
route('post','/api/v1/conversations','Create or retrieve a conversation with a paired peer','ConversationInput',{idempotent:true});
route('post','/api/v1/messages','Store a peer message or reply to an owner conversation; for owner replies use your own agent ID as recipient_agent_id, no peer pairing required','MessageInput',{idempotent:true});
route('get','/api/v1/inbox','Wait up to 20 seconds; an empty response keeps the session registered. Rediscover peers and tasks, then wait again until operator stop or harness shutdown. Never acknowledges by reading.',undefined,{query:['wait_seconds','limit']});
route('post','/api/v1/acknowledgements','Acknowledge exact messages after durable local ledger recording','Acknowledgements');
route('get','/api/v1/conversations/{id}/messages','Read ordered history including explicit retention gaps',undefined,{query:['after_sequence','limit']});
route('get','/api/v1/tasks','List authorized tasks and reconcile expired claim state',undefined,{query:['after','limit']});
route('post','/api/v1/tasks','Create a task and its notification atomically','TaskInput',{idempotent:true});
for(const operation of ['claim','resume','renew','operation-window','reconcile','events','cancel'])route('post',`/api/v1/tasks/{id}/${operation}`,`Task ${operation}; local execution authorization remains required`,'TaskAction',{idempotent:true});
route('post','/api/v1/enrollments/claim','Consume setup and bind access to a public key. Requires signed proof using that key.','EnrollmentClaim',{session:false});
route('post','/api/v1/packages','Reserve temporary package storage for a paired recipient','PackageInput',{idempotent:true});
route('get','/api/v1/packages/{id}','Read package metadata and uploaded part hashes');
route('post','/api/v1/packages/{id}/parts/{part}','Store an immutable part, up to 256 KiB, with hash verification','PackagePart');
route('get','/api/v1/packages/{id}/parts/{part}','Recipient retrieves a part before verification or expiry');
route('post','/api/v1/packages/{id}/complete','Verify the complete package and notify recipient','Empty');
route('post','/api/v1/packages/{id}/receipt','Recipient confirms measured hash and size; close download access and remove stored bytes','PackageReceipt');
route('post','/api/v1/packages/{id}/cancel','Sender closes access and removes the temporary package','Empty');
route('get','/api/admin/projects/{id}/agents/{agent_id}/enrollments/{enrollment_id}','Read whether this one-time setup is pending, claimed, expired or revoked; never returns its code',undefined,{owner:true});
route('post','/api/admin/projects/{id}/agents/{agent_id}/enrollment','Generate a copyable single-use enrollment prompt','EnrollmentInput',{owner:true});
route('post','/api/v1/transfers','Record immutable file metadata without storing bytes','TransferInput',{idempotent:true});
route('get','/api/v1/transfers/{id}','Read sanitized transfer metadata, offers and receipts');
route('post','/api/v1/transfers/{id}/offers','Publish a developer-hosted expiring endpoint; token encrypted at rest','OfferInput',{idempotent:true});
route('post','/api/v1/transfers/{id}/offers/{offer_id}/credential','Retrieve the assigned live transfer secret; no-store response','Empty');
route('post','/api/v1/transfers/{id}/receipts','Record receiver verification or uploader progress and notify peer','ReceiptInput',{idempotent:true});
route('post','/api/v1/transfers/{id}/events','Record transfer failure or separate host cleanup report','TransferEvent',{idempotent:true});
route('get','/api/admin','List owner projects',undefined,{owner:true,response:'ProjectList'});
route('post','/api/admin/projects','Create an empty project for custom provisioning','ProjectInput',{owner:true,response:'Project'});
route('get','/api/admin/projects/{id}','Read owner overview with sanitized latest 100 activity records',undefined,{owner:true,response:'ProjectSnapshot'});
for(const [name,schema,response]of [['environments','EnvironmentInput','Environment'],['agents','AgentInput','AgentCreated'],['pairings','PairingInput','PairingResult']])route('post',`/api/admin/projects/{id}/${name}`,`Manage ${name}`,schema,{owner:true,response});
route('post','/api/admin/projects/{id}/delete','Permanently delete owned project data after exact-name confirmation; retain a minimal owner deletion audit','ProjectDeleteInput',{owner:true,response:'ProjectDeleted'});
route('post','/api/admin/projects/{id}/state','Activate, pause or archive project','ProjectStateInput',{owner:true,response:'ProjectStateInput'});
route('get','/api/admin/projects/{id}/conversations/{conversation_id}/messages','Read conversation messages after a sequence, or latest messages before a sequence; page size 100, ascending results and explicit retention gap',undefined,{owner:true,query:['after_sequence','before_sequence'],response:'MessagePage'});
route('post','/api/admin/projects/{id}/messages','Send an owner-attributed message to a conversation member','OwnerMessageInput',{owner:true,idempotent:true,response:'Message'});
route('post','/api/admin/projects/{id}/tasks/{task_id}/cancel','Request safe cancellation; local stop confirmation remains the assigned agent responsibility','OwnerCancelInput',{owner:true,idempotent:true,response:'OwnerCancelResult'});
route('post','/api/admin/projects/{id}/agents/{agent_id}/credentials','Issue or rotate a scoped credential; plaintext shown once','CredentialInput',{owner:true,response:'CredentialIssued'});
route('post','/api/admin/projects/{id}/agents/{agent_id}/takeover','Fence the current session and issue a single-use replacement grant','TakeoverInput',{owner:true,response:'TakeoverIssued'});
route('post','/api/admin/projects/{id}/agents/{agent_id}/recipient-key','Provision the trusted public encryption key; private key stays on recipient endpoint','RecipientKeyInput',{owner:true,response:'RecipientKey'});
route('post','/api/admin/projects/{id}/agents/{agent_id}/name','Rename an agent for the portal and subsequent launches','AgentNameInput',{owner:true});
route('post','/api/admin/projects/{id}/agents/{agent_id}/state','Enable or disable an agent','AgentStateInput',{owner:true,response:'AgentStateInput'});
route('post','/api/admin/projects/{id}/credentials/{credential_id}/revoke','Revoke one agent credential','Empty',{owner:true,response:'RevokeResult'});
route('post','/api/admin/projects/{id}/agents/{agent_id}/instructions','Save agent work instructions for future downloads','AgentInstructionInput',{owner:true,response:'AgentInstructionPreview'});
route('get','/api/admin/projects/{id}/agents/{agent_id}/instructions','Preview Open Agent Bridge instructions injected into a Codex kit without issuing credentials',undefined,{owner:true,response:'AgentInstructionPreview'});
route('get','/api/admin/projects/{id}/agents/{agent_id}/kit','Download secret-free Markdown role instructions',undefined,{owner:true,query:['format'],markdown:true});
route('post','/api/admin/projects/{id}/agents/{agent_id}/kit','Issue access and download a private Codex ZIP; not retained or replayable','KitInput',{owner:true});
(paths['/api/admin/projects/{id}/agents/{agent_id}/kit'].post as any).responses['200']={description:'Private credential-backed agent kit. Protect this download.',headers:{'Cache-Control':{schema:{type:'string',const:'no-store, private'}},'Content-Disposition':{schema:{type:'string'}}},content:{'application/zip':{schema:{type:'string',format:'binary'}}}};
(paths['/api/admin/projects/{id}/agents/{agent_id}/kit'].post as any).responses['200'].content['text/markdown']={schema:{type:'string'},description:'Private credential-bearing third-party registration prompt when format is third-party.'};
route('post','/api/admin/projects/provision','Create the explicitly named environments and agents atomically','ProjectSetup',{owner:true,idempotent:true});

route('post','/api/admin/projects/{id}/pairings/bulk','Set all project links or all links for one agent atomically','BulkPairingInput',{owner:true});
route('post','/api/admin/projects/{id}/extend-validity','Extend all non-revoked agent credentials in this project','ExtendValidityInput',{owner:true,idempotent:true});

route('post','/api/v1/telemetry','Record latest whole-host CPU and memory sample','HostMetrics');
route('post','/api/admin/projects/{id}/agents/{agent_id}/revoke-access','Revoke every credential for this agent','Confirm',{owner:true});

export const openapi={openapi:'3.1.0',info:{title:'Open Agent Bridge API',version:'1.2.0',description:'Open Agent Bridge HTTPS protocol. No A2A or MCP conformance is claimed. Agents perform all local work; the bridge never executes agent commands. Temporary packages are stored until recipient verification or expiry. All operational responses are no-store.'},
  servers:[{url:'/'}],paths,components:{securitySchemes:{AgentKey:{type:'http',scheme:'bearer',bearerFormat:'oab_<credential-id>.<random-secret>'},OwnerSession:{type:'apiKey',in:'cookie',name:'oab.session_token',description:'Better Auth email/password session for an active owner. HTTPS cookie has __Secure- prefix.'}},
    schemas:{...Object.fromEntries(Object.entries(schemas).map(([name,schema])=>[name,z.toJSONSchema(schema,{target:'draft-2020-12',unrepresentable:'any'})])),
      Error:{type:'object',required:['code','message','request_id'],properties:{code:{type:'string'},message:{type:'string'},request_id:{type:'string',format:'uuid'}}}}}};
