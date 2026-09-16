import { openapi } from '@/lib/openapi';
export function GET(){return Response.json(openapi,{headers:{'Cache-Control':'public, max-age=3600'}});}
