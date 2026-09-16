import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){return new Response(await readFile(resolve('scripts/bridge-client.mjs'),'utf8'),{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'attachment; filename="bridge-client.mjs"'}});}
