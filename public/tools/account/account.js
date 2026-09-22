(function(){
 "use strict";if(!LuanaAuth.requireLogin())return;
 var $=function(id){return document.getElementById(id);},user,resetId=null;
 function message(text){$("message").textContent=text;}
 $("signOut").onclick=function(){LuanaAuth.signOut();location.href="/";};
 function load(){return LuanaAuth.api("account").then(function(data){
   user=data.user;localStorage.setItem("luana_name",user.name);
   // name and username are often the same for the bootstrap administrator, and
   // "jtange · jtange" reads like a bug — say what each part is instead.
   $("identity").textContent=user.name===user.username
     ?"Signed in as "+user.username+" · "+(user.role==="admin"?"Administrator":"Staff")
     :"Signed in as "+user.name+" ("+user.username+") · "+(user.role==="admin"?"Administrator":"Staff");
   $("admin").hidden=user.role!=="admin"||!!user.must_change;
   if(user.must_change)message("Change your temporary password to open staff tools.");
   if(user.role==="admin"&&!user.must_change)return loadStaff();
 }).catch(function(e){message(e.message);});}
 function loadStaff(){return LuanaAuth.api("staff").then(function(data){
   $("staffList").innerHTML="";
   data.staff.forEach(function(staff){
     var row=document.createElement("article"),name=document.createElement("p");name.textContent=staff.name+" ("+staff.username+") · "+(staff.active?"Active":"Disabled");row.appendChild(name);
     if(staff.role!=="admin"){
       [["reset","Reset password"],[staff.active?"disable":"enable",staff.active?"Disable access":"Enable access"]].forEach(function(action){
         var b=document.createElement("button");b.textContent=action[1];b.onclick=async function(){
           var body={id:staff.id,action:action[0]};
           if(action[0]==="reset"){resetId=staff.id;$("resetHeading").textContent="Reset password for "+staff.username;$("resetStaff").hidden=false;$("resetPassword").value="";$("resetPassword").focus();return;}
           else if(!confirm(action[1]+" for "+staff.username+"? Existing sessions will be revoked."))return;
           b.disabled=true;try{await LuanaAuth.api("staff",{method:"PATCH",body:JSON.stringify(body)});message(action[1]+" completed.");await loadStaff();}catch(e){message(e.message);b.disabled=false;}
         };row.appendChild(b);
       });
     }$("staffList").appendChild(row);
   });
   var areas={account:"password",staff:"staff access",event:"school event",students:"student profile",attendance:"attendance",visits:"student visit",post:"staff message",comment:"reply",lesson:"curriculum"};
   var actions={POST:"Saved",PATCH:"Updated",PUT:"Updated",DELETE:"Removed"};
   $("audit").innerHTML="";
   if(!data.audit.length){var none=document.createElement("li");none.className="empty-note";none.textContent="No changes recorded yet.";$("audit").appendChild(none);}
   data.audit.forEach(function(entry){var li=document.createElement("li"),area=entry.path.replace("/api/","");li.textContent=new Date(entry.created_at).toLocaleString()+" · "+entry.username+" · "+(actions[entry.action]||"Changed")+" "+(areas[area]||area.replaceAll("-"," "));$("audit").appendChild(li);});
 });}
 $("passwordForm").onsubmit=async function(e){
   e.preventDefault();if($("newPassword").value!==$("confirmPassword").value){message("New passwords do not match.");return;}
   var b=this.querySelector("button");b.disabled=true;
   try{var result=await LuanaAuth.api("account",{method:"POST",body:JSON.stringify({current_password:$("currentPassword").value,password:$("newPassword").value})});localStorage.setItem("luana_token",result.token);localStorage.setItem("luana_user",JSON.stringify(result.user));this.reset();message("Password saved. You can now open staff tools.");await load();}
   catch(err){message(err.message);}finally{b.disabled=false;}
 };
 $("addStaff").onsubmit=async function(e){e.preventDefault();var b=this.querySelector("button");b.disabled=true;
   try{await LuanaAuth.api("staff",{method:"POST",body:JSON.stringify({username:$("staffUsername").value,name:$("staffName").value,password:$("staffPassword").value})});this.reset();message("Staff account created. Share the temporary password privately; it must be changed at first sign-in.");await loadStaff();}
   catch(err){message(err.message);}finally{b.disabled=false;}
 };
 $("cancelReset").onclick=function(){$("resetStaff").reset();$("resetStaff").hidden=true;resetId=null;};
 $("resetStaff").onsubmit=async function(e){e.preventDefault();var b=this.querySelector("button");b.disabled=true;
   try{await LuanaAuth.api("staff",{method:"PATCH",body:JSON.stringify({id:resetId,action:"reset",password:$("resetPassword").value})});this.reset();this.hidden=true;resetId=null;message("Temporary password saved. Share it privately with the staff member.");await loadStaff();}
   catch(err){message(err.message);}finally{b.disabled=false;}
 };
 load();
})();
