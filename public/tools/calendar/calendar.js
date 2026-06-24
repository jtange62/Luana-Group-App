(function () {
  "use strict";

  if (!LuanaAuth.requireLogin()) return;

  var PROGRAMS = [
    { id: "Preschool",     color: "#0F6E56", soft: "#E1F5EE", dark: "#085041" },
    { id: "Kinder",        color: "#E8714A", soft: "#FAECE7", dark: "#993C1D" },
    { id: "After School",  color: "#D4A24C", soft: "#FAEEDA", dark: "#854F0B" },
    { id: "Summer School", color: "#2A6F97", soft: "#E2EEF5", dark: "#1D4E6B" },
    { id: "General",       color: "#5F5E5A", soft: "#F1EFE8", dark: "#444441" }
  ];
  var STAFF_COLORS = ["#0F6E56", "#E8714A", "#D4A24C", "#2A6F97", "#7A4F9E", "#B5485D", "#3C8C6E", "#C57B2C"];
  var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  var me = LuanaAuth.name();
  var $ = function (id) { return document.getElementById(id); };
  var now = new Date();
  var state = {
    year: now.getFullYear(), month: now.getMonth(), selected: fmtYMD(now),
    view: "month", calendar: "students",
    events: [], lessons: [], lessonMap: {}, editingId: null
  };

  function prog(id) { return PROGRAMS.filter(function (p) { return p.id === id; })[0] || PROGRAMS[4]; }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function fmtYMD(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseYMD(s) { var p = String(s).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function startOfWeek(d) { return addDays(d, -d.getDay()); }
  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function prettyDate(ymd) { var d = parseYMD(ymd); return WEEKDAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate(); }

  function colorForName(name) {
    var s = String(name || "").trim().toLowerCase();
    if (!s) return STAFF_COLORS[0];
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return STAFF_COLORS[h % STAFF_COLORS.length];
  }

  // Color + chip for an event, depending on which calendar it's on.
  function eventColor(ev) {
    return (ev.calendar === "staff") ? colorForName(ev.staff_name) : prog(ev.program).color;
  }
  function eventChip(ev) {
    if (ev.calendar === "staff") {
      var c = colorForName(ev.staff_name);
      return { label: ev.staff_name || "Staff", bg: c, fg: "#fff" };
    }
    var p = prog(ev.program);
    return { label: ev.program || "General", bg: p.soft, fg: p.dark };
  }

  // ---------- Recurrence ----------
  function occursOn(ev, d) {
    var start = parseYMD(ev.start_date);
    if (d < start) return false;
    if (ev.recur_until && d > parseYMD(ev.recur_until)) return false;
    var r = ev.recur || "none";
    if (r === "none") return d.getTime() === start.getTime();
    if (r === "daily") return true;
    if (r === "weekly") return d.getDay() === start.getDay();
    if (r === "monthly") return d.getDate() === start.getDate();
    return false;
  }

  function eventsOn(ymd) {
    var d = parseYMD(ymd);
    return sortEvents(state.events.filter(function (ev) {
      return (ev.calendar || "students") === state.calendar && occursOn(ev, d);
    }));
  }

  function sortEvents(list) {
    return list.slice().sort(function (a, b) {
      var ta = a.start_time || "", tb = b.start_time || "";
      if (!ta && tb) return -1;
      if (ta && !tb) return 1;
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
  }

  // ---------- Shared event row ----------
  function eventRow(ev) {
    var chip = eventChip(ev);
    var time = ev.start_time ? esc(ev.start_time) + (ev.end_time ? "–" + esc(ev.end_time) : "") : "All day";
    var repeat = ev.recur && ev.recur !== "none" ? '<span class="ev-repeat">↻ ' + esc(ev.recur) + "</span>" : "";

    var lessonHtml = "";
    if (ev.calendar !== "staff" && ev.lesson_id && state.lessonMap[ev.lesson_id]) {
      lessonHtml = '<button class="ev-lesson" data-lesson="' + esc(ev.lesson_id) + '">📚 ' +
        esc(state.lessonMap[ev.lesson_id].title) + "</button>";
    }

    var row = document.createElement("div");
    row.className = "ev-row";
    row.style.borderLeftColor = eventColor(ev);
    row.innerHTML =
      '<div class="ev-main">' +
        '<div class="ev-top"><span class="ev-time">' + time + "</span>" + repeat + "</div>" +
        '<div class="ev-title">' + esc(ev.title) + "</div>" +
        '<div class="ev-chip" style="color:' + chip.fg + ";background:" + chip.bg + '">' + esc(chip.label) + "</div>" +
        (ev.notes ? '<div class="ev-notes">' + esc(ev.notes) + "</div>" : "") +
        lessonHtml +
      "</div>" +
      (ev.author === me ? '<button class="ev-edit" title="Edit">✎</button>' : "");

    var editBtn = row.querySelector(".ev-edit");
    if (editBtn) editBtn.onclick = function () { openEdit(ev); };
    var lessonBtn = row.querySelector(".ev-lesson");
    if (lessonBtn) lessonBtn.onclick = function () {
      location.href = "/tools/library/?lesson=" + encodeURIComponent(ev.lesson_id);
    };
    return row;
  }

  // ---------- Render ----------
  function setActive(container, attr, value) {
    Array.prototype.forEach.call($(container).children, function (b) {
      b.classList.toggle("active", b.getAttribute(attr) === value);
    });
  }

  function render() {
    setActive("calToggle", "data-cal", state.calendar);
    setActive("viewToggle", "data-view", state.view);
    $("weekdays").hidden = state.view !== "month";
    $("dayPanel").hidden = state.view !== "month";

    if (state.view === "month") renderMonth();
    else if (state.view === "week") renderWeek();
    else renderAgenda();
  }

  function renderMonth() {
    $("periodLabel").textContent = MONTHS[state.month] + " " + state.year;
    var view = $("view");
    view.className = "cal-grid";
    view.innerHTML = "";

    var firstDow = new Date(state.year, state.month, 1).getDay();
    var lastDom = new Date(state.year, state.month + 1, 0).getDate();
    var today = fmtYMD(new Date());

    for (var i = 0; i < firstDow; i++) {
      var blank = document.createElement("div");
      blank.className = "day-cell is-blank";
      view.appendChild(blank);
    }
    for (var day = 1; day <= lastDom; day++) {
      var ymd = state.year + "-" + pad(state.month + 1) + "-" + pad(day);
      var evs = eventsOn(ymd);
      var cell = document.createElement("button");
      cell.className = "day-cell" + (ymd === today ? " is-today" : "") + (ymd === state.selected ? " is-selected" : "");

      var dots = "";
      if (evs.length) {
        var seen = {}, colors = [];
        evs.forEach(function (ev) { var c = eventColor(ev); if (!seen[c]) { seen[c] = 1; colors.push(c); } });
        dots = '<span class="dots">' + colors.slice(0, 4).map(function (c) {
          return '<span class="dot" style="background:' + c + '"></span>';
        }).join("") + "</span>";
      }
      cell.innerHTML = '<span class="daynum">' + day + "</span>" + dots;
      (function (d) { cell.onclick = function () { state.selected = d; render(); }; })(ymd);
      view.appendChild(cell);
    }

    // selected day panel
    $("dayLabel").textContent = prettyDate(state.selected);
    var wrap = $("dayEvents"); wrap.innerHTML = "";
    var dayEvs = eventsOn(state.selected);
    $("dayEmpty").hidden = dayEvs.length > 0;
    dayEvs.forEach(function (ev) { wrap.appendChild(eventRow(ev)); });
  }

  function renderWeek() {
    var ws = startOfWeek(parseYMD(state.selected));
    var we = addDays(ws, 6);
    $("periodLabel").textContent = MONTHS[ws.getMonth()] + " " + ws.getDate() +
      " – " + (ws.getMonth() !== we.getMonth() ? MONTHS[we.getMonth()] + " " : "") + we.getDate();

    var view = $("view");
    view.className = "week-view";
    view.innerHTML = "";
    var today = fmtYMD(new Date());

    for (var i = 0; i < 7; i++) {
      var d = addDays(ws, i);
      var ymd = fmtYMD(d);
      var evs = eventsOn(ymd);
      var block = document.createElement("div");
      block.className = "week-day" + (ymd === today ? " is-today" : "");

      var head = document.createElement("div");
      head.className = "week-day-head";
      head.innerHTML = "<b>" + WEEKDAYS[d.getDay()] + "</b> " + d.getDate();
      (function (s) { head.onclick = function () { state.selected = s; state.view = "month"; render(); }; })(ymd);
      block.appendChild(head);

      if (evs.length) evs.forEach(function (ev) { block.appendChild(eventRow(ev)); });
      else { var none = document.createElement("p"); none.className = "week-none"; none.textContent = "—"; block.appendChild(none); }
      view.appendChild(block);
    }
  }

  function renderAgenda() {
    $("periodLabel").textContent = "Agenda";
    var view = $("view");
    view.className = "agenda-view";
    view.innerHTML = "";

    var from = parseYMD(state.selected);
    var any = false;
    for (var i = 0; i < 90; i++) {
      var d = addDays(from, i);
      var ymd = fmtYMD(d);
      var evs = eventsOn(ymd);
      if (!evs.length) continue;
      any = true;
      var group = document.createElement("div");
      group.className = "agenda-group";
      var h = document.createElement("div");
      h.className = "agenda-date";
      h.textContent = prettyDate(ymd);
      group.appendChild(h);
      evs.forEach(function (ev) { group.appendChild(eventRow(ev)); });
      view.appendChild(group);
    }
    if (!any) {
      var empty = document.createElement("p");
      empty.className = "day-empty";
      empty.textContent = "Nothing scheduled in the next 90 days.";
      view.appendChild(empty);
    }
  }

  // ---------- Form ----------
  function fillProgramSelect() {
    $("fProgram").innerHTML = PROGRAMS.map(function (p) { return '<option value="' + p.id + '">' + p.id + "</option>"; }).join("");
  }
  function fillLessonSelect() {
    var opts = ['<option value="">No linked theme</option>'];
    state.lessons.forEach(function (l) {
      var bits = [l.program, l.month ? monthShort(l.month) : ""].filter(Boolean).join(" · ");
      opts.push('<option value="' + esc(l.id) + '">' + esc(l.title) + (bits ? " — " + esc(bits) : "") + "</option>");
    });
    $("fLesson").innerHTML = opts.join("");
  }
  function monthShort(m) { var n = parseInt(m, 10); return n >= 1 && n <= 12 ? MONTHS[n - 1].slice(0, 3) : ""; }

  function syncFormForCalendar() {
    var staff = state.calendar === "staff";
    $("fStaffWrap").hidden = !staff;
    $("fProgramWrap").hidden = staff;
    $("fLessonWrap").hidden = staff;
    $("titleLabel").textContent = staff ? "Note / role (optional)" : "Title";
    $("fTitle").placeholder = staff ? "e.g. Front desk (optional)" : "Event title";
  }
  function syncTimeRow() { $("timeRow").hidden = $("fAllDay").checked; }
  function syncUntilRow() { $("untilRow").hidden = $("fRecur").value === "none"; }

  function openAdd() {
    state.editingId = null;
    $("formTitle").textContent = state.calendar === "staff" ? "New shift" : "New event";
    $("fStaff").value = ""; $("fTitle").value = "";
    $("fProgram").value = "General"; $("fLesson").value = "";
    $("fDate").value = state.selected;
    $("fAllDay").checked = false; $("fStart").value = ""; $("fEnd").value = "";
    $("fRecur").value = "none"; $("fUntil").value = ""; $("fNotes").value = "";
    $("formMsg").textContent = ""; $("deleteBtn").hidden = true; $("saveBtn").disabled = false;
    syncFormForCalendar(); syncTimeRow(); syncUntilRow();
    $("modal").hidden = false;
    (state.calendar === "staff" ? $("fStaff") : $("fTitle")).focus();
  }

  function openEdit(ev) {
    // Editing happens on the calendar the event belongs to.
    state.calendar = ev.calendar || "students";
    state.editingId = ev.id;
    $("formTitle").textContent = "Edit" + (ev.recur && ev.recur !== "none" ? " (whole series)" : "");
    $("fStaff").value = ev.staff_name || "";
    $("fTitle").value = ev.title || "";
    $("fProgram").value = ev.program || "General";
    $("fLesson").value = ev.lesson_id || "";
    $("fDate").value = ev.start_date || state.selected;
    $("fAllDay").checked = !ev.start_time;
    $("fStart").value = ev.start_time || ""; $("fEnd").value = ev.end_time || "";
    $("fRecur").value = ev.recur || "none"; $("fUntil").value = ev.recur_until || "";
    $("fNotes").value = ev.notes || "";
    $("formMsg").textContent = ""; $("deleteBtn").hidden = false; $("saveBtn").disabled = false;
    syncFormForCalendar(); syncTimeRow(); syncUntilRow();
    $("modal").hidden = false;
    $("fTitle").focus();
  }

  function closeModal() { $("modal").hidden = true; }

  function save() {
    var staff = state.calendar === "staff";
    var staffName = $("fStaff").value.trim();
    var title = $("fTitle").value.trim();
    var date = $("fDate").value;
    var msg = $("formMsg");
    msg.textContent = "";
    if (staff && !staffName) { msg.textContent = "Enter the staff member's name."; return; }
    if (!staff && !title) { msg.textContent = "A title is required."; return; }
    if (!date) { msg.textContent = "Pick a date."; return; }

    var allDay = $("fAllDay").checked;
    var payload = {
      id: state.editingId || undefined,
      author: me,
      calendar: state.calendar,
      title: title,
      staff_name: staff ? staffName : "",
      program: staff ? "" : $("fProgram").value,
      lesson_id: staff ? "" : $("fLesson").value,
      start_date: date,
      start_time: allDay ? "" : $("fStart").value,
      end_time: allDay ? "" : $("fEnd").value,
      recur: $("fRecur").value,
      recur_until: $("fRecur").value === "none" ? "" : $("fUntil").value,
      notes: $("fNotes").value.trim()
    };

    $("saveBtn").disabled = true;
    LuanaAuth.api("event", { method: state.editingId ? "PATCH" : "POST", body: JSON.stringify(payload) })
      .then(function (res) {
        if (res && res.error) { msg.textContent = res.error; $("saveBtn").disabled = false; return; }
        closeModal();
        return loadEvents();
      })
      .catch(function () { msg.textContent = "Couldn't save. Try again."; $("saveBtn").disabled = false; });
  }

  function removeEvent() {
    if (!state.editingId) return;
    if (!confirm("Delete this event? Recurring events are removed entirely.")) return;
    LuanaAuth.api("event", { method: "DELETE", body: JSON.stringify({ id: state.editingId, author: me }) })
      .then(function () { closeModal(); return loadEvents(); });
  }

  // ---------- Data ----------
  function loadEvents() {
    $("loading").style.display = "block";
    return LuanaAuth.api("events").then(function (res) {
      $("loading").style.display = "none";
      state.events = res.events || [];
      render();
    }).catch(function () { $("loading").style.display = "none"; });
  }
  function loadLessons() {
    return LuanaAuth.api("lessons").then(function (res) {
      state.lessons = res.lessons || [];
      state.lessonMap = {};
      state.lessons.forEach(function (l) { state.lessonMap[l.id] = l; });
      fillLessonSelect();
    }).catch(function () {});
  }

  // ---------- Wire up ----------
  $("calToggle").onclick = function (e) {
    var b = e.target.closest(".seg-btn"); if (!b) return;
    state.calendar = b.getAttribute("data-cal"); render();
  };
  $("viewToggle").onclick = function (e) {
    var b = e.target.closest(".seg-btn"); if (!b) return;
    state.view = b.getAttribute("data-view"); render();
  };
  $("prevBtn").onclick = function () { step(-1); };
  $("nextBtn").onclick = function () { step(1); };
  function step(dir) {
    if (state.view === "week") { state.selected = fmtYMD(addDays(parseYMD(state.selected), dir * 7)); }
    else if (state.view === "agenda") { state.selected = fmtYMD(addDays(parseYMD(state.selected), dir * 30)); }
    else { state.month += dir; if (state.month < 0) { state.month = 11; state.year--; } else if (state.month > 11) { state.month = 0; state.year++; } }
    syncMonthToSelected();
    render();
  }
  function syncMonthToSelected() {
    if (state.view !== "month") { var d = parseYMD(state.selected); state.year = d.getFullYear(); state.month = d.getMonth(); }
  }
  $("todayBtn").onclick = function () {
    var t = new Date();
    state.year = t.getFullYear(); state.month = t.getMonth(); state.selected = fmtYMD(t);
    render();
  };
  $("addBtn").onclick = openAdd;
  $("cancelBtn").onclick = closeModal;
  $("saveBtn").onclick = save;
  $("deleteBtn").onclick = removeEvent;
  $("fAllDay").onchange = syncTimeRow;
  $("fRecur").onchange = syncUntilRow;
  $("modal").onclick = function (e) { if (e.target === $("modal")) closeModal(); };
  $("signOut").onclick = function () { LuanaAuth.signOut(); location.href = "/"; };

  fillProgramSelect();
  $("weekdays").innerHTML = WEEKDAYS.map(function (w) { return "<span>" + w + "</span>"; }).join("");
  loadLessons().then(loadEvents);
})();
