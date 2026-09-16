#!/usr/bin/env python3
"""Own one loopback PostgreSQL cluster for this checkout; never replace data."""
import base64, json, os, pathlib, secrets, socket, subprocess, sys
root = pathlib.Path(__file__).resolve().parent.parent
cluster = root / '.local/postgres'
data = cluster / 'data'
pg = pathlib.Path('/usr/lib/postgresql/18/bin')
action = sys.argv[1] if len(sys.argv) == 2 else 'status'
if action not in ('init', 'start', 'stop', 'status'): raise SystemExit('Use init|start|stop|status')
if any(p.is_symlink() for p in (root, cluster, data)): raise SystemExit('Refusing redirected cluster')
os.umask(0o077)
env = {k:v for k,v in os.environ.items() if not k.startswith('PG')}
env['PGPASSFILE'] = str(cluster/'pgpass')
def run(name, *args, input=None):
    result = subprocess.run([str(pg/name), *args], input=input, text=True, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
    if result.returncode: raise SystemExit(f'{name} failed ({result.returncode}); inspect protected local logs')
if action == 'init':
    with socket.socket() as probe: probe.bind(('127.0.0.1',55442))
    cluster.mkdir(parents=True, exist_ok=False, mode=0o700)
    credentials = {k:secrets.token_hex(32) for k in ('admin','dev','test')}
    (cluster/'credentials.json').write_text(json.dumps(credentials))
    (cluster/'pgpass').write_text('127.0.0.1:55442:*:oab_local_admin:'+credentials['admin']+'\n')
    password = cluster/'init-password'
    password.write_text(credentials['admin']+'\n')
    run('initdb','-D',str(data),'-U','oab_local_admin','--pwfile',str(password),'--auth-host=scram-sha-256','--auth-local=scram-sha-256','--encoding=UTF8','--locale=C')
    password.write_text('')
    with (data/'postgresql.conf').open('a') as config:
        config.write("\nlisten_addresses='127.0.0.1'\nport=55442\nunix_socket_directories=''\nmax_connections=30\nshared_buffers='64MB'\nlog_statement='none'\nlog_min_error_statement='panic'\n")
    (cluster/'development.env').write_text('DATABASE_URL=postgresql://oab_dev:'+credentials['dev']+'@127.0.0.1:55442/oab_dev\nTEST_DATABASE_URL=postgresql://oab_test:'+credentials['test']+'@127.0.0.1:55442/oab_test\n')
    (cluster/'app.env').write_text('BETTER_AUTH_URL=http://127.0.0.1:3220\nBETTER_AUTH_SECRET='+secrets.token_hex(48)+'\nBRIDGE_ENVELOPE_KEY='+base64.b64encode(secrets.token_bytes(32)).decode()+'\n')
    (cluster/'ownership.json').write_text(json.dumps({'root':str(root),'uid':os.getuid(),'port':55442}))
    print('Initialized isolated PostgreSQL18 cluster; stopped.'); sys.exit()
if not cluster.exists() and action == 'status': print('Not initialized'); sys.exit()
marker = json.loads((cluster/'ownership.json').read_text())
assert marker == {'root':str(root),'uid':os.getuid(),'port':55442}, 'Cluster ownership mismatch'
assert (data/'PG_VERSION').read_text().strip() == '18'
if action == 'status':
    result = subprocess.run([str(pg/'pg_ctl'),'status','-D',str(data)], env=env)
    sys.exit(result.returncode)
if action == 'stop':
    run('pg_ctl','stop','-D',str(data),'-m','fast','-w'); print('Owned cluster stopped'); sys.exit()
if not (data/'postmaster.pid').exists():
    with socket.socket() as probe: probe.bind(('127.0.0.1',55442))
    run('pg_ctl','start','-D',str(data),'-l',str(cluster/'server.log'),'-w')
credentials = json.loads((cluster/'credentials.json').read_text())
for role in ('dev','test'):
    password = credentials[role]
    assert len(password)==64 and all(c in '0123456789abcdef' for c in password)
    sql = f"SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', 'oab_{role}', '{password}') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='oab_{role}');\n\\gexec\nSELECT 'CREATE DATABASE oab_{role} OWNER oab_{role}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='oab_{role}');\n\\gexec\nREVOKE ALL ON DATABASE oab_{role} FROM PUBLIC;\nGRANT CONNECT,TEMPORARY ON DATABASE oab_{role} TO oab_{role};\n"
    run('psql','-X','-w','-h','127.0.0.1','-p','55442','-U','oab_local_admin','-d','postgres','-v','ON_ERROR_STOP=1',input=sql)
print('Separate development/test databases ready on 127.0.0.1:55442')
