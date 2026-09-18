(function (root) {
  function currentDate() { return new Date().toLocaleDateString('sv-SE', {timeZone:'Asia/Tokyo'}); }
  function yearOf(date) { date = date || currentDate(); return Number(date.slice(0,4)) - (Number(date.slice(5,7)) < 4 ? 1 : 0); }
  function label(year) { return year + '–' + (year + 1); }
  function mount(container, year, change, copyKind) {
    var wrap = document.createElement('div'); wrap.className = 'school-year-bar';
    var caption = document.createElement('label'); caption.textContent = 'School year';
    var select = document.createElement('select'); select.setAttribute('aria-label','School year');
    caption.appendChild(select); wrap.appendChild(caption);
    var range = document.createElement('span'); range.className='school-year-range'; wrap.appendChild(range);
    function set(value) {
      select.innerHTML='';
      for(var y=Math.min(2025,value-2);y<=Math.max(yearOf()+3,value+2);y++) {
        var option=document.createElement('option');option.value=y;option.textContent=label(y);select.appendChild(option);
      }
      select.value=value;range.textContent='Apr '+value+' – Mar '+(value+1);
    }
    select.onchange=function(){set(Number(select.value));change(Number(select.value));};
    if(copyKind){
      var copy=document.createElement('button');copy.className='btn-ghost';copy.textContent=copyKind==='plans'?'Copy plans to next year':'Copy roster to next year';wrap.appendChild(copy);
      copy.onclick=function(){
        var from=Number(select.value),to=from+1;
        var details=copyKind==='plans'?'Themes, weekly plans and files will be copied. Dated activities move to the same calendar dates next year; check weekdays afterward.':'Active students and their class details will be copied. Attendance stays in its original year. Review class placements and Summer School dates afterward.';
        if(!confirm('Copy '+copyKind+' from '+label(from)+' to '+label(to)+'? '+details+' The destination must be empty.'))return;
        copy.disabled=true;select.disabled=true;
        LuanaAuth.api('school-years',{method:'POST',body:JSON.stringify({from:from,to:to,kind:copyKind})}).then(function(result){set(to);change(to);LuanaUtils.reportSuccess('Copied '+result.count+' '+copyKind+'. Review the new year before use.');}).catch(function(e){LuanaUtils.reportError(e,'Could not copy the school year.');}).finally(function(){copy.disabled=false;select.disabled=false;});
      };
    }
    set(year);container.appendChild(wrap);return {set:set};
  }
  root.LuanaYear={current:yearOf, label:label, mount:mount};
})(window);
