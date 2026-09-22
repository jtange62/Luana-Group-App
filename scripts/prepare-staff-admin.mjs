// Produces ignored local handoff files. Never prints passwords or setup tokens.
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const folder='.wrangler/staff-admin';mkdirSync(folder,{recursive:true});
const requestPath=folder+'/setup-request.json';
if(!existsSync(requestPath)){
 const setup_token=randomBytes(32).toString('hex'),password=randomBytes(24).toString('base64url');
 writeFileSync(requestPath,JSON.stringify({username:'jtange',password,setup_token}),{mode:0o600});
 writeFileSync(folder+'/secrets.json',JSON.stringify({STAFF_SETUP_TOKEN:setup_token}),{mode:0o600});
 writeFileSync(folder+'/admin-login.txt','Luana Group App administrator\n\nSign in: https://luana-group-app.pages.dev/\nUsername: jtange\nTemporary password: '+password+'\n\nChange this password at first sign-in. Then use More > My account & staff access to create staff accounts. Share their temporary passwords privately.\n',{mode:0o600});
}
if(process.argv.includes('--provision')){
 const response=await fetch('https://luana-group-app.pages.dev/api/account-setup',{method:'POST',headers:{'Content-Type':'application/json'},body:readFileSync(requestPath,'utf8')});
 console.log('Administrator provisioning HTTP status:',response.status);
 if(!response.ok)process.exitCode=1;
}else console.log('Administrator setup files prepared in .wrangler/staff-admin (ignored by Git).');
