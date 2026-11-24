import argparse, hashlib, importlib.util, json, shlex, subprocess, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--expect-live', default='2.0.18', choices=['2.0.18', '2.0.19'])
parser.add_argument('--output', default='artifacts/desktop-2.0.19-local/staged-readonly.json')
parser.add_argument('--published-go', action='store_true')
args = parser.parse_args()
assert args.expect_live != '2.0.19' or args.published_go, 'Published19 audit requires explicit GO'
manifest = json.loads((ROOT/'artifacts/desktop-2.0.19-local/installer-manifest.json').read_text())
module = importlib.util.spec_from_file_location('approved_ssh_profile', '/tmp/playtime-guest-deploy/deploy.py')
deploy = importlib.util.module_from_spec(module); module.loader.exec_module(deploy)
code = r'''
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{Pool}=require('pg');
const pool=new Pool({user:process.env.PG_USER,host:process.env.PG_HOST,database:process.env.PG_DATABASE,password:process.env.PG_PASSWORD,port:Number(process.env.PG_PORT||5432)});
(async()=>{const client=await pool.connect();try{await client.query('BEGIN READ ONLY');const rows=(await client.query("SELECT id,version,platform,filename,update_filename,file_size,update_file_size,sha512,update_sha512,is_published,is_latest FROM app_releases WHERE version IN ('2.0.17','2.0.18','2.0.19') ORDER BY version,platform")).rows;await client.query('ROLLBACK');
const files={};for(const row of rows){if(!['darwin','win32'].includes(row.platform))throw Error('platform');for(const name of [row.filename,row.update_filename].filter(Boolean)){if(!/^[A-Za-z0-9_.-]+$/.test(name))throw Error('filename');const p=path.join(process.env.RELEASES_DIR||path.resolve('data/releases'),row.platform,name);const b=fs.readFileSync(p);files[row.platform+'/'+name]={bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex'),sha512:crypto.createHash('sha512').update(b).digest('base64')};}}
console.log(JSON.stringify({rows,files}));}finally{client.release();await pool.end()}})().catch(()=>{console.error('readonly_release_audit_failed');process.exitCode=1});
'''
remote = 'cd /srv/playtime && /opt/playtime/bin/node --env-file=/etc/playtime/runtime.env -e ' + shlex.quote(code)
result = subprocess.run(deploy.connection(ROOT)+[remote], capture_output=True, text=True, timeout=90)
assert result.returncode == 0, 'Read-only SSH release audit failed (credentials omitted)'
audit = json.loads(result.stdout)
for platform in ['darwin','win32']:
    staged = [r for r in audit['rows'] if r['version']=='2.0.19' and r['platform']==platform]
    assert len(staged)==1, 'Both19 staged rows must exist'
    row = staged[0]
    published = args.expect_live=='2.0.19'
    assert row['is_latest'] is published and row['is_published'] is published, '19 publication state mismatch'
    for name, sizekey, hashkey in [(row['filename'],'file_size','sha512'),(row['update_filename'],'update_file_size','update_sha512')]:
        if not name: continue
        actual=audit['files'][platform+'/'+name];expected=manifest['files'][name]
        assert actual['sha256']==expected['sha256'] and actual['bytes']==expected['bytes'], 'Remote full-file19 hash mismatch'
        assert actual['sha512']==row[hashkey] and actual['bytes']==int(row[sizekey]), 'Registry full-file metadata mismatch'
    live=[r for r in audit['rows'] if r['platform']==platform and r['is_latest'] and r['is_published']]
    assert len(live)==1 and live[0]['version']==args.expect_live, 'Live release unexpectedly changed'

origin='https://smeruxa.ru'
public={}
for platform in ['darwin','win32']:
    with urllib.request.urlopen(origin+'/playtime/releases/feed/'+platform,timeout=30) as response:
        body=response.read().decode();assert ('version: '+args.expect_live+'\n') in body
        public[platform]={'status':response.status,'feedSha256':hashlib.sha256(body.encode()).hexdigest(),'version':args.expect_live}
    row=next(r for r in audit['rows'] if r['version']=='2.0.19' and r['platform']==platform)
    for name in [row['filename'],row['update_filename']]:
        if not name: continue
        request=urllib.request.Request(origin+'/playtime/downloads/'+platform+'/'+name,method='HEAD')
        try:
            with urllib.request.urlopen(request,timeout=30) as response: status=response.status
        except urllib.error.HTTPError as error: status=error.code
        assert status==(200 if args.expect_live=='2.0.19' else 404), 'Staged visibility mismatch'
        public[platform].setdefault('artifactHead',{})[name]=status
        if args.expect_live=='2.0.19':
            digest=hashlib.sha256(); transferred=0
            with urllib.request.urlopen(origin+'/playtime/downloads/'+platform+'/'+name,timeout=90) as response:
                while True:
                    chunk=response.read(1024*1024)
                    if not chunk: break
                    digest.update(chunk);transferred+=len(chunk)
            expected=manifest['files'][name]
            assert digest.hexdigest()==expected['sha256'] and transferred==expected['bytes'],'Public full-file19 hash mismatch'
            public[platform].setdefault('fullPublicFiles',{})[name]={'bytes':transferred,'sha256':digest.hexdigest()}

immutable={k:v for k,v in audit['files'].items() if '2.0.17' in k or '2.0.18' in k}
for key, expected in immutable.items():
    local=ROOT/'dist'/key.split('/')[-1]
    if local.is_file(): assert hashlib.sha256(local.read_bytes()).hexdigest()==expected['sha256'],'Local/remote immutable17/18 mismatch'
baseline=ROOT/'artifacts/desktop-2.0.19-local/immutable-17-18-remote.json'
if baseline.exists():assert json.loads(baseline.read_text())==immutable,'Immutable17/18 remote files changed'
else:baseline.write_text(json.dumps(immutable,indent=4)+'\n')
report={'passed':True,'readOnly':True,'expectedLive':args.expect_live,'registry':audit['rows'],'fullRemoteFiles':audit['files'],'public':public,'immutable17and18Unchanged':True}
out=ROOT/args.output;out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=4)+'\n')
print(json.dumps({'passed':True,'readOnly':True,'expectedLive':args.expect_live,'output':str(out),'remoteFileCount':len(audit['files'])}))
