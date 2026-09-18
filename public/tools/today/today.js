// Attendance planning and the daily register share the same class rosters.
(function () {
  "use strict";
  if (!LuanaAuth.requireLogin()) return;
  LuanaUtils.ping("today");
  var $ = function(id){return document.getElementById(id);}, esc=LuanaUtils.esc;
  var CLASSES=["Preschool","Kinder","After School","Summer School"];
  var MARKS=[["present","P","Present"],["absent","A","Absent"],["late","L","Late"]];
  var KINDS={makeup:"Makeup",trial:"Trial",other:"Extra visit"};
  var state={date:ymd(new Date()),view:"day",program:"",days:[],request:0,students:[],bookingRequest:0};
  function pad(n){return String(n).padStart(2,"0");}
  function ymd(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());}
  function date(value){var p=value.split("-").map(Number);return new Date(p[0],p[1]-1,p[2]);}
  function shift(value,n){var d=date(value);d.setDate(d.getDate()+n);return ymd(d);}
  function today(){return ymd(new Date());}
  function range(){
    var d=date(state.date);
    if(state.view==="day")return {from:state.date,to:state.date};
    if(state.view==="week"){var first=shift(state.date,-((d.getDay()+6)%7));return {from:first,to:shift(first,6)};}
    return {from:ymd(new Date(d.getFullYear(),d.getMonth(),1)),to:ymd(new Date(d.getFullYear(),d.getMonth()+1,0))};
  }
  function group(day,program){return day.programs.find(function(g){return g.program===program;})||{program:program,expected:[],guests:[],trials:[],counts:{},theme:null};}
  function rows(g){return g.expected.concat(g.guests).concat(g.trials.map(function(t){return Object.assign({},t,{kind:"trial",legacy_trial:true,status:""});}));}
  function planned(g){return rows(g).filter(function(row){return row.status!=="absent";}).length;}
  function classes(){return state.program?[state.program]:CLASSES;}
  function tag(row){return KINDS[row.kind||row.status]||"";}
  function button(text,action,className){var b=document.createElement("button");b.type="button";b.textContent=text;b.className=className||"btn-ghost";b.onclick=action;return b;}
  function go(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return;state.date=value;load();}
  function openDay(value,program){state.view="day";if(program){state.program=program;$("classFilter").value=program;}go(value);}
  function render(){
    var r=range();$("selectedDate").value=state.date;
    $("dayLabel").textContent="Attendance & planning";
    $("dayToday").hidden=state.date===today();
    $("dayPrev").setAttribute("aria-label","Previous "+state.view);$("dayNext").setAttribute("aria-label","Next "+state.view);
    document.querySelectorAll("[data-view]").forEach(function(b){b.setAttribute("aria-pressed",String(b.dataset.view===state.view));});
    $("periodLabel").textContent=state.view==="month"?date(state.date).toLocaleDateString("en",{month:"long",year:"numeric"}):r.from===r.to?date(state.date).toLocaleDateString("en",{weekday:"long",day:"numeric",month:"long",year:"numeric"}):r.from+" — "+r.to;
    $("register").hidden=state.view!=="day";$("planner").hidden=state.view==="day";
    $("markLegend").hidden=false;$("markLegend").textContent=state.view==="day"?"P = Present · A = Absent · L = Late. Tap a selected mark to clear it.":"Expected students exclude known absences. Tap a day to see names and update attendance.";$("digestBtn").hidden=state.view!=="day";
    $("empty").hidden=true;$("alerts").hidden=true;$("onToday").hidden=true;
    if(state.view==="day")renderDay(state.days[0]);else renderPeriod();
  }
  function renderDay(day){
    if(!day)return;
    var total=classes().reduce(function(n,p){return n+planned(group(day,p));},0);
    $("dayCount").textContent=total+" expected · "+(state.date===today()?"Today":"Selected day");
    var wrap=$("register");wrap.innerHTML="";
    var allergyRows=[];
    classes().forEach(function(program){
      var g=group(day,program),card=document.createElement("section");card.className="class-card";
      var head=document.createElement("div");head.className="class-head";head.innerHTML='<h2 class="class-name">'+esc(program)+'</h2><span class="class-tally">'+planned(g)+(state.view==="month"?'':' expected')+'</span>';card.appendChild(head);
      if(g.theme){var theme=document.createElement("p");theme.className="class-theme";theme.textContent=g.theme.title;card.appendChild(theme);}
      var roster=document.createElement("div");roster.className="roster";
      var list=rows(g);
      if(!list.length){var empty=document.createElement("p");empty.className="class-theme";empty.textContent="No students scheduled.";roster.appendChild(empty);}
      list.forEach(function(student){roster.appendChild(studentRow(student));if(student.allergies&&student.status!=="absent")allergyRows.push(student);});
      card.appendChild(roster);card.appendChild(button("Add makeup / trial",function(){openVisit(program);},"btn-ghost add-class-visit"));wrap.appendChild(card);
    });
    $("alerts").hidden=!allergyRows.length;
    $("alertsList").innerHTML=allergyRows.map(function(s){return '<li><strong>'+esc(s.name)+'</strong> — '+esc(s.allergies)+'</li>';}).join("");
    $("onToday").hidden=!day.events.length;
    $("onTodayList").innerHTML=day.events.map(function(e){return '<li><span class="event-time">'+esc(e.start_time||"All day")+'</span><span>'+esc(e.title)+'</span></li>';}).join("");
  }
  function studentRow(student){
    var row=document.createElement("div");row.className="student";
    var label=document.createElement("div");label.className="student-name";label.textContent=student.name;
    if(tag(student)){var badge=document.createElement("span");badge.className="guest-tag";badge.textContent=tag(student);label.appendChild(badge);}
    if(student.notes){var notes=document.createElement("small");notes.className="visit-notes";notes.textContent=student.notes;label.appendChild(notes);}
    if(student.allergies){var alert=document.createElement("small");alert.className="visit-notes";alert.textContent="Allergy: "+student.allergies;label.appendChild(alert);}
    row.appendChild(label);
    if(!student.legacy_trial){
      var marks=document.createElement("div");marks.className="marks";
      MARKS.forEach(function(mark){var b=button(mark[1],function(){setMark(student,student.status===mark[0]?"":mark[0],row);},"mark"+(student.status===mark[0]?" on-"+mark[0]:""));b.setAttribute("aria-label",mark[2]+" — "+student.name);b.setAttribute("aria-pressed",String(student.status===mark[0]));marks.appendChild(b);});row.appendChild(marks);
    }
    if(student.visit_id||student.legacy_trial){var remove=button("Cancel visit",function(){cancelVisit(student);},"cancel-visit");row.appendChild(remove);}
    return row;
  }
  function renderPeriod(){
    $("dayCount").textContent=state.view==="week"?"Week at a glance":"Month at a glance";
    var wrap=$("planner");wrap.innerHTML="";
    classes().forEach(function(program){
      var section=document.createElement("section");section.className="planner-class";
      var heading=document.createElement("h2");heading.className="class-name";heading.textContent=program;section.appendChild(heading);
      section.appendChild(button("Add makeup / trial",function(){openVisit(program);},"btn-ghost add-class-visit"));
      var grid=document.createElement("div");grid.className=state.view==="month"?"month-grid":"week-grid";
      if(state.view==="month"){
        ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].forEach(function(name){var label=document.createElement("span");label.className="weekday-label";label.textContent=name;grid.appendChild(label);});
        for(var i=0;i<(date(state.days[0].date).getDay()+6)%7;i++)grid.appendChild(document.createElement("span"));
      }
      state.days.forEach(function(day){
        var g=group(day,program),list=rows(g),visitors=list.filter(function(s){return tag(s);});
        var cell=button("",function(){openDay(day.date,program);},"plan-day"+(day.date===today()?" is-today":""));
        var label=state.view==="month"?String(date(day.date).getDate()):date(day.date).toLocaleDateString("en",{weekday:"short",month:"short",day:"numeric"});
        cell.innerHTML='<strong>'+esc(label)+'</strong><span class="plan-count">'+planned(g)+' expected</span>';
        cell.setAttribute("aria-label",program+", "+day.pretty+", "+planned(g)+" expected. Open day");
        if(state.view==="week"){
          cell.innerHTML+=list.map(function(s){return '<span class="plan-name'+(s.status==="absent"?' is-absent':'')+'">'+esc(s.name)+(tag(s)?' · '+esc(tag(s)):'')+(s.status==="absent"?' · Absent':'')+'</span>';}).join("");
          if(!list.length)cell.innerHTML+='<span class="plan-name">No students</span>';
        }else if(visitors.length){cell.innerHTML+='<span class="plan-extra">+'+visitors.length+' visits</span>';}
        grid.appendChild(cell);
      });section.appendChild(grid);wrap.appendChild(section);
    });
  }
  function setMark(student,status,row){
    var selected=state.date;
    row.querySelectorAll("button").forEach(function(b){b.disabled=true;});
    var path=student.visit_id?"visits":"attendance";
    var payload=student.visit_id?{id:student.visit_id,status:status}:{student_id:student.id,date:selected,status:status,marked_by:LuanaAuth.name()};
    LuanaAuth.api(path,{method:student.visit_id?"PATCH":"POST",body:JSON.stringify(payload)})
      .then(function(){if(state.date===selected)return load();})
      .catch(function(e){LuanaUtils.reportError(e,"Could not save attendance.");row.querySelectorAll("button").forEach(function(b){b.disabled=false;});});
  }
  function cancelVisit(student){
    if(!confirm("Cancel this visit for "+student.name+"? Their regular weekly schedule will stay the same."))return;
    LuanaAuth.api(student.legacy_trial?"trials":"visits",{method:"DELETE",body:JSON.stringify({id:student.visit_id||student.id})}).then(load).catch(function(e){LuanaUtils.reportError(e,"Could not cancel the visit.");});
  }
  function load(){
    var request=++state.request,r=range();state.days=[];
    $("selectedDate").value=state.date;$("loading").style.display="block";$("digestBtn").disabled=true;
    $("register").innerHTML="";$("planner").innerHTML="";$("alerts").hidden=true;$("onToday").hidden=true;
    var path=state.view==="day"?"today?date="+state.date:"planner?from="+r.from+"&to="+r.to;
    return LuanaAuth.api(path).then(function(data){if(request!==state.request)return;state.days=data.days||[data];render();})
      .catch(function(e){if(request===state.request){state.days=[];LuanaUtils.reportError(e,"Could not load the schedule.");}})
      .finally(function(){if(request===state.request){$("loading").style.display="none";$("digestBtn").disabled=!state.days.length;}});
  }
  function openVisit(program){
    var request=++state.bookingRequest;
    $("visitDate").value=state.date;$("visitClass").value=program||state.program||CLASSES[0];$("visitKind").value="makeup";$("visitName").value="";$("visitNotes").value="";$("visitMessage").textContent="Loading students…";$("visitSave").disabled=true;$("visitModal").hidden=false;syncVisit();
    LuanaAuth.api("students").then(function(data){if(request!==state.bookingRequest)return;state.students=data.students;$("visitStudent").innerHTML='<option value="">Choose a student</option>'+state.students.map(function(s){return '<option value="'+esc(s.id)+'">'+esc(s.name+" · "+s.program)+'</option>';}).join("");$("visitMessage").textContent="";$("visitSave").disabled=false;}).catch(function(e){$("visitMessage").textContent=e.message;});
  }
  function syncVisit(){var trial=$("visitKind").value==="trial";$("visitStudentField").hidden=trial;$("visitNameField").hidden=!trial;}
  function closeVisit(){state.bookingRequest++;$("visitModal").hidden=true;}
  function saveVisit(){
    var trial=$("visitKind").value==="trial",selected=$("visitDate").value;
    if(!selected||(!trial&&!$("visitStudent").value)||(trial&&!$("visitName").value.trim())){$("visitMessage").textContent="Choose a date and student, or enter the trial visitor’s name.";return;}
    $("visitSave").disabled=true;
    LuanaAuth.api("visits",{method:"POST",body:JSON.stringify({date:selected,program:$("visitClass").value,kind:$("visitKind").value,student_id:trial?null:$("visitStudent").value,name:$("visitName").value,notes:$("visitNotes").value})})
      .then(function(){closeVisit();state.date=selected;LuanaUtils.reportSuccess("Visit booked.");return load();})
      .catch(function(e){$("visitMessage").textContent=e.message;$("visitSave").disabled=false;});
  }
  function step(direction){
    if(state.view==="month"){var d=date(state.date);go(ymd(new Date(d.getFullYear(),d.getMonth()+direction,1)));}
    else go(shift(state.date,direction*(state.view==="week"?7:1)));
  }
  $("signOut").onclick=function(){LuanaAuth.signOut();location.href="/";};
  $("selectedDate").onchange=function(){if(this.value)go(this.value);};
  $("classFilter").onchange=function(){state.program=this.value;if(state.days.length)render();};
  $("viewModes").onclick=function(e){var b=e.target.closest("[data-view]");if(b){state.view=b.dataset.view;load();}};
  $("dayPrev").onclick=function(){step(-1);};$("dayNext").onclick=function(){step(1);};$("dayToday").onclick=function(){go(today());};
  $("addVisit").onclick=function(){openVisit();};$("visitKind").onchange=syncVisit;$("visitCancel").onclick=closeVisit;$("visitSave").onclick=saveVisit;
  $("visitModal").onclick=function(e){if(e.target===$("visitModal"))closeVisit();};
  $("digestBtn").onclick=function(){LuanaAuth.api("summary?date="+state.date).then(function(data){$("digestText").textContent=data.text;$("digest").hidden=false;}).catch(function(e){LuanaUtils.reportError(e);});};
  $("digestClose").onclick=function(){$("digest").hidden=true;};$("digest").onclick=function(e){if(e.target===$("digest"))$("digest").hidden=true;};
  $("digestCopy").onclick=function(){if(!navigator.clipboard){LuanaUtils.reportError(null,"Select the summary and copy it manually.");return;}navigator.clipboard.writeText($("digestText").textContent).then(function(){LuanaUtils.reportSuccess("Summary copied.");}).catch(function(e){LuanaUtils.reportError(e,"Could not copy.");});};
  load();
})();
