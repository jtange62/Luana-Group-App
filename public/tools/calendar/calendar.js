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
  var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  var me = LuanaAuth.name();
  var $ = function (id) { return document.getElementById(id); };
  var now = new Date();
  var state = { year: now.getFullYear(), month: now.getMonth(), selected: fmtYMD(now), events: [], editingId: null };

  function prog(id) { return PROGRAMS.filter(function (p) { return p.id === id; })[0] || PROGRAMS[4]; }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function fmtYMD(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseYMD(s) { var p = String(s).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }

  function prettyDate(ymd) {
    var d = parseYMD(ymd);
    return WEEKDAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate();
  }

  // ---------- Recurrence expansion ----------
  // Return the YMD strings on which `ev` occurs within the given month.
  function occurrencesInMonth(ev, year, month) {
    var start = parseYMD(ev.start_date);
    var until = ev.recur_until ? parseYMD(ev.recur_until) : null;
    var lastDom = new Date(year, month + 1, 0).getDate();
    var recur = ev.recur || "none";
    var out = [];

    function ok(d) { return d >= start && (!until || d <= until); }
    function push(d) { out.push(fmtYMD(d)); }

    if (recur === "none") {
      if (start.getFullYear() === year && start.getMonth() === month) push(start);
      return out;
    }
    if (recur === "monthly") {
      var dom = start.getDate();
      if (dom <= lastDom) { var d = new Date(year, month, dom); if (ok(d)) push(d); }
      return out;
    }
    // daily + weekly: walk the month's days
    var wd = start.getDay();
    for (var day = 1; day <= lastDom; day++) {
      var dd = new Date(year, month, day);
      if (!ok(dd)) continue;
      if (recur === "daily") push(dd);
      else if (recur === "weekly" && dd.getDay() === wd) push(dd);
    }
    return out;
  }

  // Map of date -> [events] for the current month.
  function buildMonthMap() {
    var map = {};
    state.events.forEach(function (ev) {
      occurrencesInMonth(ev, state.year, state.month).forEach(function (ymd) {
        (map[ymd] = map[ymd] || []).push(ev);
      });
    });
    return map;
  }

  function sortEvents(list) {
    return list.slice().sort(function (a, b) {
      var ta = a.start_time || "", tb = b.start_time || "";
      if (!ta && tb) return -1;   // all-day first
      if (ta && !tb) return 1;
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
  }

  // ---------- Render ----------
  function renderWeekdays() {
    $("weekdays").innerHTML = WEEKDAYS.map(function (w) { return "<span>" + w + "</span>"; }).join("");
  }

  function render() {
    $("monthLabel").textContent = MONTHS[state.month] + " " + state.year;
    var map = buildMonthMap();
    var grid = $("grid");
    grid.innerHTML = "";

    var firstDow = new Date(state.year, state.month, 1).getDay();
    var lastDom = new Date(state.year, state.month + 1, 0).getDate();
    var today = fmtYMD(new Date());

    for (var i = 0; i < firstDow; i++) {
      var blank = document.createElement("div");
      blank.className = "day-cell is-blank";
      grid.appendChild(blank);
    }

    for (var day = 1; day <= lastDom; day++) {
      var ymd = state.year + "-" + pad(state.month + 1) + "-" + pad(day);
      var cell = document.createElement("button");
      cell.className = "day-cell";
      if (ymd === today) cell.className += " is-today";
      if (ymd === state.selected) cell.className += " is-selected";

      var dotsHtml = "";
      var evs = map[ymd];
      if (evs && evs.length) {
        var seen = {};
        var colors = [];
        sortEvents(evs).forEach(function (ev) {
          var p = prog(ev.program);
          if (!seen[p.id]) { seen[p.id] = true; colors.push(p.color); }
        });
        dotsHtml = '<span class="dots">' +
          colors.slice(0, 4).map(function (c) { return '<span class="dot" style="background:' + c + '"></span>'; }).join("") +
          "</span>";
      }

      cell.innerHTML = '<span class="daynum">' + day + "</span>" + dotsHtml;
      (function (d) { cell.onclick = function () { state.selected = d; render(); }; })(ymd);
      grid.appendChild(cell);
    }

    renderDay(map);
  }

  function renderDay(map) {
    $("dayLabel").textContent = prettyDate(state.selected);
    var wrap = $("dayEvents");
    wrap.innerHTML = "";
    var evs = sortEvents((map || buildMonthMap())[state.selected] || []);
    $("dayEmpty").hidden = evs.length > 0;

    evs.forEach(function (ev) {
      var p = prog(ev.program);
      var time = ev.start_time
        ? esc(ev.start_time) + (ev.end_time ? "–" + esc(ev.end_time) : "")
        : "All day";
      var repeat = ev.recur && ev.recur !== "none" ? '<span class="ev-repeat">↻ ' + esc(ev.recur) + "</span>" : "";

      var row = document.createElement("div");
      row.className = "ev-row";
      row.style.borderLeftColor = p.color;
      row.innerHTML =
        '<div class="ev-main">' +
          '<div class="ev-top"><span class="ev-time">' + time + "</span>" + repeat + "</div>" +
          '<div class="ev-title">' + esc(ev.title) + "</div>" +
          '<div class="ev-prog" style="color:' + p.dark + ";background:" + p.soft + '">' + esc(ev.program || "General") + "</div>" +
          (ev.notes ? '<div class="ev-notes">' + esc(ev.notes) + "</div>" : "") +
        "</div>" +
        (ev.author === me ? '<button class="ev-edit" title="Edit">✎</button>' : "");

      var editBtn = row.querySelector(".ev-edit");
      if (editBtn) editBtn.onclick = function () { openEdit(ev); };
      wrap.appendChild(row);
    });
  }

  // ---------- Form ----------
  function fillProgramSelect() {
    $("fProgram").innerHTML = PROGRAMS.map(function (p) {
      return '<option value="' + p.id + '">' + p.id + "</option>";
    }).join("");
  }

  function syncTimeRow() { $("timeRow").hidden = $("fAllDay").checked; }
  function syncUntilRow() { $("untilRow").hidden = $("fRecur").value === "none"; }

  function openAdd() {
    state.editingId = null;
    $("formTitle").textContent = "New event";
    $("fTitle").value = "";
    $("fProgram").value = "General";
    $("fDate").value = state.selected;
    $("fAllDay").checked = false;
    $("fStart").value = ""; $("fEnd").value = "";
    $("fRecur").value = "none"; $("fUntil").value = "";
    $("fNotes").value = "";
    $("formMsg").textContent = "";
    $("deleteBtn").hidden = true;
    $("saveBtn").disabled = false;
    syncTimeRow(); syncUntilRow();
    $("modal").hidden = false;
    $("fTitle").focus();
  }

  function openEdit(ev) {
    state.editingId = ev.id;
    $("formTitle").textContent = "Edit event" + (ev.recur && ev.recur !== "none" ? " (whole series)" : "");
    $("fTitle").value = ev.title || "";
    $("fProgram").value = ev.program || "General";
    $("fDate").value = ev.start_date || state.selected;
    $("fAllDay").checked = !ev.start_time;
    $("fStart").value = ev.start_time || "";
    $("fEnd").value = ev.end_time || "";
    $("fRecur").value = ev.recur || "none";
    $("fUntil").value = ev.recur_until || "";
    $("fNotes").value = ev.notes || "";
    $("formMsg").textContent = "";
    $("deleteBtn").hidden = false;
    $("saveBtn").disabled = false;
    syncTimeRow(); syncUntilRow();
    $("modal").hidden = false;
    $("fTitle").focus();
  }

  function closeModal() { $("modal").hidden = true; }

  function save() {
    var title = $("fTitle").value.trim();
    var date = $("fDate").value;
    var msg = $("formMsg");
    msg.textContent = "";
    if (!title) { msg.textContent = "A title is required."; return; }
    if (!date) { msg.textContent = "Pick a date."; return; }

    var allDay = $("fAllDay").checked;
    var payload = {
      id: state.editingId || undefined,
      author: me,
      title: title,
      program: $("fProgram").value,
      start_date: date,
      start_time: allDay ? "" : $("fStart").value,
      end_time: allDay ? "" : $("fEnd").value,
      recur: $("fRecur").value,
      recur_until: $("fRecur").value === "none" ? "" : $("fUntil").value,
      notes: $("fNotes").value.trim()
    };

    $("saveBtn").disabled = true;
    var method = state.editingId ? "PATCH" : "POST";
    LuanaAuth.api("event", { method: method, body: JSON.stringify(payload) })
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

  function loadEvents() {
    $("loading").style.display = "block";
    return LuanaAuth.api("events").then(function (res) {
      $("loading").style.display = "none";
      state.events = res.events || [];
      render();
    }).catch(function () { $("loading").style.display = "none"; });
  }

  // ---------- Wire up ----------
  $("prevBtn").onclick = function () {
    state.month--; if (state.month < 0) { state.month = 11; state.year--; }
    render();
  };
  $("nextBtn").onclick = function () {
    state.month++; if (state.month > 11) { state.month = 0; state.year++; }
    render();
  };
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
  renderWeekdays();
  loadEvents();
})();
