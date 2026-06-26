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
  var GENERAL_COLOR = "#E8714A";
  var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  var me = LuanaAuth.name();
  var $ = function (id) { return document.getElementById(id); };
  var now = new Date();
  var STUDENT_PROGRAMS = ["Preschool", "Kinder", "After School", "Summer School"];
  // Weekday chips in school order (Mon→Sun); value is JS getDay() index.
  var WEEKDAY_CHIPS = [["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6], ["Sun", 0]];
  var WEEKDAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var state = {
    year: now.getFullYear(), month: now.getMonth(), selected: fmtYMD(now),
    view: "month", calendar: "general",
    events: [], lessons: [], lessonMap: {}, editingId: null,
    students: [], staff: [], attDate: fmtYMD(now), attProgram: "Preschool",
    attMarks: {}, weekMarks: {}, attView: "day", rosterMode: "students", newDays: [],
    trials: [], weekTrials: {}
  };

  function daysArr(d) { return d ? String(d).split(",").map(Number) : []; }
  function renderDayChips(container, selected, onToggle) {
    container.innerHTML = "";
    WEEKDAY_CHIPS.forEach(function (wd) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "day-chip" + (selected.indexOf(wd[1]) !== -1 ? " active" : "");
      b.textContent = wd[0];
      b.onclick = function () { onToggle(wd[1], b); };
      container.appendChild(b);
    });
  }

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
    if (ev.calendar === "staff") return colorForName(ev.staff_name);
    if (ev.calendar === "general") return GENERAL_COLOR;
    return prog(ev.program).color;
  }
  function eventChip(ev) {
    if (ev.calendar === "staff") {
      return { label: ev.staff_name || "Staff", bg: colorForName(ev.staff_name), fg: "#fff" };
    }
    if (ev.calendar === "general") return null; // school-wide, no sub-label
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
    var chipHtml = chip ? '<div class="ev-chip" style="color:' + chip.fg + ";background:" + chip.bg + '">' + esc(chip.label) + "</div>" : "";
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
        chipHtml +
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
    var isStudents = state.calendar === "students";

    // The Students tab is an attendance register, not an event calendar.
    $("calBar").hidden = isStudents;
    $("viewBar").hidden = isStudents;
    $("attendance").hidden = !isStudents;
    if (isStudents) {
      $("weekdays").hidden = true; $("view").hidden = true; $("dayPanel").hidden = true;
      renderAttendance();
      return;
    }

    $("view").hidden = false;
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

  // ---------- Attendance (Students) ----------
  function renderClassToggle() {
    var c = $("attClasses"); c.innerHTML = "";
    STUDENT_PROGRAMS.forEach(function (p) {
      var b = document.createElement("button");
      b.className = "seg-btn" + (p === state.attProgram ? " active" : "");
      b.textContent = p;
      b.onclick = function () { state.attProgram = p; renderAttendance(); };
      c.appendChild(b);
    });
  }

  function attBtn(st, label, current) {
    return '<button class="att-btn att-' + st + (current === st ? " active" : "") + '" data-st="' + st + '">' + label + "</button>";
  }

  function scheduledFor(wd) {
    return state.students.filter(function (s) {
      return s.program === state.attProgram && (!s.days || daysArr(s.days).indexOf(wd) !== -1);
    });
  }

  // One student row with P/A/L buttons that mark against a given date.
  function rosterRowEl(s, status, date) {
    var row = document.createElement("div");
    row.className = "roster-row";
    row.innerHTML = '<span class="roster-name">' + esc(s.name) + "</span>" +
      '<span class="att-btns">' + attBtn("present", "P", status) + attBtn("absent", "A", status) + attBtn("late", "L", status) + "</span>";
    row.querySelectorAll(".att-btn").forEach(function (btn) {
      btn.onclick = function () { var st = btn.getAttribute("data-st"); setMark(s.id, date, status === st ? "" : st); };
    });
    return row;
  }

  function guestRowEl(s, type, date) {
    var row = document.createElement("div");
    row.className = "roster-row";
    var badges = { trial: ["Trial", "guest-badge-trial"], makeup: ["Makeup", "guest-badge-makeup"], other: ["Other", "guest-badge-other"] };
    var b = badges[type] || badges.other;
    row.innerHTML = '<span class="roster-name">' + esc(s.name) +
      ' <span class="guest-badge ' + b[1] + '">' + b[0] + '</span></span>' +
      '<button class="guest-remove" title="Remove">&#x2715;</button>';
    row.querySelector(".guest-remove").onclick = function () { setMark(s.id, date, ""); };
    return row;
  }

  function renderAttendance() {
    $("attDate").value = state.attDate;
    renderClassToggle();
    setActive("attViewToggle", "data-attview", state.attView);

    var ov = state.attView === "overview";
    $("attDatebar").hidden = ov;
    $("attClasses").hidden = ov;
    $("attHead").hidden = ov;

    if (ov) { renderOverview(); return; }
    if (state.attView === "week") { renderWeekAttendance(); return; }
    renderDayRegister();
  }

  // Whole-school weekly schedule: weekday columns × program rows.
  function renderOverview() {
    var roster = $("roster"); roster.innerHTML = "";
    var ws = startOfWeek(parseYMD(state.attDate));

    var dayHas = {};
    state.students.forEach(function (s) {
      (s.days ? daysArr(s.days) : [0, 1, 2, 3, 4, 5, 6]).forEach(function (d) { dayHas[d] = true; });
    });
    var days = WEEKDAY_CHIPS.filter(function (wd) { return dayHas[wd[1]]; });
    if (!days.length) days = WEEKDAY_CHIPS.slice(0, 5);

    function cell(cls, text) { var d = document.createElement("div"); d.className = cls; if (text != null) d.textContent = text; return d; }

    var wrap = document.createElement("div"); wrap.className = "overview";
    var grid = document.createElement("div"); grid.className = "ov-grid";
    grid.style.gridTemplateColumns = "70px repeat(" + days.length + ",minmax(92px,1fr))";

    grid.appendChild(cell("ov-corner", ""));
    days.forEach(function (wd) { grid.appendChild(cell("ov-colhead", wd[0])); });

    var ovPrograms = STUDENT_PROGRAMS.filter(function (p) { return p !== "Summer School"; });
    ovPrograms.forEach(function (p) {
      grid.appendChild(cell("ov-rowhead", p));
      days.forEach(function (wd) {
        var date = fmtYMD(addDays(ws, wd[1]));
        var marks = state.weekMarks[date] || {};
        var dayTrials = (state.weekTrials[date] || []).filter(function (t) { return t.program === p; });

        var scheduled = state.students.filter(function (s) {
          return s.program === p && s.days !== "x" && (!s.days || daysArr(s.days).indexOf(wd[1]) !== -1);
        });
        var scheduledIds = scheduled.map(function (s) { return s.id; });
        var makeups = state.students.filter(function (s) {
          return s.program === p && scheduledIds.indexOf(s.id) === -1 && marks[s.id] === "makeup";
        });

        var total = scheduled.length + makeups.length + dayTrials.length;
        var c = document.createElement("div"); c.className = "ov-cell";
        if (total) {
          var html = '<span class="ov-count">' + total + "</span>";
          scheduled.forEach(function (s) {
            var st = marks[s.id] || "";
            html += '<span class="ov-name' + (st === "absent" ? " ov-absent" : "") + '">' + esc(s.name) + "</span>";
          });
          makeups.forEach(function (s) {
            html += '<span class="ov-name ov-makeup">' + esc(s.name) + "</span>";
          });
          dayTrials.forEach(function (t) {
            html += '<span class="ov-name ov-trial">' + esc(t.name) + "</span>";
          });
          c.innerHTML = html;
        } else {
          c.innerHTML = '<span class="ov-empty">·</span>';
        }
        grid.appendChild(c);
      });
    });

    // Per-day totals.
    grid.appendChild(cell("ov-rowhead ov-total-head", "Total"));
    days.forEach(function (wd) {
      var date = fmtYMD(addDays(ws, wd[1]));
      var dayTrialCount = (state.weekTrials[date] || []).length;
      var n = state.students.filter(function (s) {
        return s.days !== "x" && (!s.days || daysArr(s.days).indexOf(wd[1]) !== -1);
      }).length;
      grid.appendChild(cell("ov-total", String(n + dayTrialCount)));
    });

    wrap.appendChild(grid);
    roster.appendChild(wrap);
  }

  function renderDayRegister() {
    var roster = $("roster"); roster.innerHTML = "";
    var wd = parseYMD(state.attDate).getDay();
    var inClass = state.students.filter(function (s) { return s.program === state.attProgram; });
    var list = scheduledFor(wd);

    var counts = { present: 0, absent: 0, late: 0 };
    list.forEach(function (s) {
      var status = state.attMarks[s.id] || "";
      if (counts[status] !== undefined) counts[status]++;
      roster.appendChild(rosterRowEl(s, status, state.attDate));
    });

    var empty = $("rosterEmpty");
    empty.hidden = list.length > 0;
    if (!list.length) {
      empty.textContent = inClass.length
        ? "No " + state.attProgram + " students scheduled on " + WEEKDAY_FULL[wd] + "."
        : "No students in this class yet — tap “Manage students” to add some.";
    }
    $("attSummary").textContent = list.length
      ? WEEKDAY_FULL[wd] + " · Present " + counts.present + " · Absent " + counts.absent + " · Late " + counts.late : "";

    // Trials & Makeups — students not on the regular schedule for today.
    var scheduledIds = list.map(function (s) { return s.id; });
    var guestStudents = state.students.filter(function (s) {
      return s.program === state.attProgram
        && scheduledIds.indexOf(s.id) === -1
        && (state.attMarks[s.id] === "trial" || state.attMarks[s.id] === "makeup" || state.attMarks[s.id] === "other");
    });
    if (guestStudents.length) {
      var gdiv = document.createElement("div");
      gdiv.className = "guest-divider";
      gdiv.textContent = "Trials & Makeups";
      roster.appendChild(gdiv);
      guestStudents.forEach(function (s) {
        roster.appendChild(guestRowEl(s, state.attMarks[s.id], state.attDate));
      });
    }
    var guestIds = guestStudents.map(function (s) { return s.id; });
    var available = state.students.filter(function (s) {
      return s.program === state.attProgram
        && scheduledIds.indexOf(s.id) === -1
        && guestIds.indexOf(s.id) === -1
        && s.days !== "x";
    });
    if (available.length) {
      var addRow = document.createElement("div");
      addRow.className = "guest-add-row";
      var nameSelect = document.createElement("select");
      nameSelect.className = "guest-select";
      available.forEach(function (s) {
        var o = document.createElement("option");
        o.value = s.id; o.textContent = s.name;
        nameSelect.appendChild(o);
      });
      var typeSelect = document.createElement("select");
      typeSelect.className = "guest-type-select";
      ["Makeup", "Other"].forEach(function (t) {
        var o = document.createElement("option");
        o.value = t.toLowerCase(); o.textContent = t;
        typeSelect.appendChild(o);
      });
      var addBtn = document.createElement("button");
      addBtn.className = "btn-primary btn-sm";
      addBtn.textContent = "+ Add";
      addBtn.onclick = function () { setMark(nameSelect.value, state.attDate, typeSelect.value); };
      addRow.appendChild(nameSelect);
      addRow.appendChild(typeSelect);
      addRow.appendChild(addBtn);
      roster.appendChild(addRow);
    }
    // Trials section — one-time visitors, stored separately from the roster.
    var trialsToday = state.trials.filter(function (t) { return t.program === state.attProgram; });
    if (trialsToday.length) {
      var trialDiv = document.createElement("div");
      trialDiv.className = "guest-divider";
      trialDiv.textContent = "Trials";
      roster.appendChild(trialDiv);
      trialsToday.forEach(function (t) {
        var row = document.createElement("div");
        row.className = "roster-row";
        row.innerHTML = '<span class="roster-name">' + esc(t.name) +
          ' <span class="guest-badge guest-badge-trial">Trial</span></span>' +
          '<button class="guest-remove" title="Remove">&#x2715;</button>';
        row.querySelector(".guest-remove").onclick = function () {
          LuanaAuth.api("trials", { method: "DELETE", body: JSON.stringify({ id: t.id }) })
            .then(function () { return loadTrials(); }).catch(function () {});
        };
        roster.appendChild(row);
      });
    }
    var trialRow = document.createElement("div");
    trialRow.className = "trial-add-row";
    var trialNameInput = document.createElement("input");
    trialNameInput.type = "text";
    trialNameInput.placeholder = "Trial student name";
    trialNameInput.className = "guest-select";
    var trialBtn = document.createElement("button");
    trialBtn.className = "btn-primary btn-sm";
    trialBtn.textContent = "+ Trial";
    (function (ni) {
      trialBtn.onclick = function () {
        var n = ni.value.trim();
        if (!n) return;
        ni.value = "";
        LuanaAuth.api("trials", { method: "POST", body: JSON.stringify({
          name: n, program: state.attProgram, date: state.attDate
        }) }).then(function () { return loadTrials(); }).catch(function () {});
      };
      ni.addEventListener("keydown", function (e) { if (e.key === "Enter") trialBtn.click(); });
    })(trialNameInput);
    trialRow.appendChild(trialNameInput);
    trialRow.appendChild(trialBtn);
    roster.appendChild(trialRow);
  }

  function renderWeekAttendance() {
    $("attSummary").textContent = "";
    $("rosterEmpty").hidden = true;
    var roster = $("roster"); roster.innerHTML = "";
    var ws = startOfWeek(parseYMD(state.attDate));
    var today = fmtYMD(new Date());

    for (var i = 1; i <= 5; i++) {
      var d = addDays(ws, i);
      var ymd = fmtYMD(d);
      var wd = d.getDay();
      var marks = state.weekMarks[ymd] || {};
      var list = scheduledFor(wd);

      var card = document.createElement("div");
      card.className = "week-att-day" + (ymd === today ? " is-today" : "");
      var head = document.createElement("div");
      head.className = "week-att-head";
      head.textContent = WEEKDAY_FULL[wd] + " · " + (d.getMonth() + 1) + "/" + d.getDate() + (list.length ? "  (" + list.length + ")" : "");
      card.appendChild(head);

      if (!list.length) {
        var none = document.createElement("p"); none.className = "week-none"; none.textContent = "—";
        card.appendChild(none);
      } else {
        list.forEach(function (s) { card.appendChild(rosterRowEl(s, marks[s.id] || "", ymd)); });
      }
      roster.appendChild(card);
    }
  }

  function setMark(studentId, date, status) {
    if (date === state.attDate) {
      if (status) state.attMarks[studentId] = status; else delete state.attMarks[studentId];
    }
    state.weekMarks[date] = state.weekMarks[date] || {};
    if (status) state.weekMarks[date][studentId] = status; else delete state.weekMarks[date][studentId];
    renderAttendance();
    LuanaAuth.api("attendance", { method: "POST", body: JSON.stringify({
      student_id: studentId, date: date, status: status, marked_by: me
    }) }).catch(function () { loadAttendance(); });
  }

  function loadTrials() {
    return LuanaAuth.api("trials?date=" + encodeURIComponent(state.attDate)).then(function (res) {
      state.trials = res.trials || [];
      if (state.calendar === "students") renderAttendance();
    }).catch(function () {});
  }

  function loadAttendance() {
    if (state.attView === "overview") {
      var ws = startOfWeek(parseYMD(state.attDate));
      var wFrom = fmtYMD(ws), wTo = fmtYMD(addDays(ws, 6));
      return Promise.all([
        LuanaAuth.api("attendance?from=" + wFrom + "&to=" + wTo).then(function (res) {
          state.weekMarks = res.byDate || {};
        }).catch(function () {}),
        LuanaAuth.api("trials?from=" + wFrom + "&to=" + wTo).then(function (res) {
          state.weekTrials = {};
          (res.trials || []).forEach(function (t) {
            if (!state.weekTrials[t.date]) state.weekTrials[t.date] = [];
            state.weekTrials[t.date].push(t);
          });
        }).catch(function () {})
      ]).then(function () {
        if (state.calendar === "students") renderAttendance();
      });
    }
    loadTrials();
    if (state.attView === "week") {
      var ws = startOfWeek(parseYMD(state.attDate));
      return LuanaAuth.api("attendance?from=" + fmtYMD(ws) + "&to=" + fmtYMD(addDays(ws, 6))).then(function (res) {
        state.weekMarks = res.byDate || {};
        if (state.calendar === "students") renderAttendance();
      }).catch(function () {});
    }
    return LuanaAuth.api("attendance?date=" + encodeURIComponent(state.attDate)).then(function (res) {
      state.attMarks = res.marks || {};
      if (state.calendar === "students") renderAttendance();
    }).catch(function () {});
  }

  // ---------- Roster management (students + staff) ----------
  function openRoster(mode) {
    state.rosterMode = mode;
    state.newDays = [];
    $("rosterModalTitle").textContent = mode === "staff" ? "Manage staff" : "Manage students — " + state.attProgram;
    $("rosterAddName").value = "";
    var addDays = $("rosterAddDays");
    addDays.hidden = mode === "staff";
    if (mode !== "staff") {
      renderDayChips(addDays, state.newDays, function (dayNum, btn) {
        var i = state.newDays.indexOf(dayNum);
        if (i === -1) { state.newDays.push(dayNum); btn.classList.add("active"); }
        else { state.newDays.splice(i, 1); btn.classList.remove("active"); }
      });
    }
    renderRosterManage();
    $("rosterModal").hidden = false;
    $("rosterAddName").focus();
  }

  function renderRosterManage() {
    var wrap = $("rosterModalList"); wrap.innerHTML = "";
    var staff = state.rosterMode === "staff";
    var items = staff ? state.staff
      : state.students.filter(function (s) { return s.program === state.attProgram; });
    if (!items.length) { wrap.innerHTML = '<p class="day-empty" style="padding:8px 0">None yet.</p>'; return; }
    items.forEach(function (it) {
      var row = document.createElement("div");
      row.className = "manage-row" + (staff ? "" : " manage-student");
      row.innerHTML = '<div class="manage-top"><span>' + esc(it.name) + '</span><button class="del-btn" title="Remove">✕</button></div>' +
        (staff ? "" : '<div class="day-chips"></div>');
      row.querySelector(".del-btn").onclick = function () { removeRosterItem(it.id); };
      if (!staff) {
        var sel = daysArr(it.days);
        renderDayChips(row.querySelector(".day-chips"), sel, function (dayNum, btn) {
          var i = sel.indexOf(dayNum);
          if (i === -1) { sel.push(dayNum); btn.classList.add("active"); }
          else { sel.splice(i, 1); btn.classList.remove("active"); }
          it.days = sel.join(",");
          LuanaAuth.api("students", { method: "PATCH", body: JSON.stringify({
            id: it.id, name: it.name, program: it.program, days: it.days
          }) }).then(function () { return loadStudents(); });
        });
      }
      wrap.appendChild(row);
    });
  }

  function afterRosterChange() {
    renderRosterManage();
    if (state.rosterMode === "staff") fillStaffSelect();
    else if (state.calendar === "students") renderAttendance();
  }

  function addRosterItem() {
    var name = $("rosterAddName").value.trim();
    if (!name) return;
    var path = state.rosterMode === "staff" ? "staff" : "students";
    var body = state.rosterMode === "staff"
      ? { name: name }
      : { name: name, program: state.attProgram, days: state.newDays.join(",") };
    $("rosterAddName").value = "";
    state.newDays = [];
    if (state.rosterMode !== "staff") {
      renderDayChips($("rosterAddDays"), state.newDays, function (dayNum, btn) {
        var i = state.newDays.indexOf(dayNum);
        if (i === -1) { state.newDays.push(dayNum); btn.classList.add("active"); }
        else { state.newDays.splice(i, 1); btn.classList.remove("active"); }
      });
    }
    LuanaAuth.api(path, { method: "POST", body: JSON.stringify(body) })
      .then(function () { return state.rosterMode === "staff" ? loadStaff() : loadStudents(); })
      .then(afterRosterChange);
    $("rosterAddName").focus();
  }

  function removeRosterItem(id) {
    var path = state.rosterMode === "staff" ? "staff" : "students";
    LuanaAuth.api(path, { method: "DELETE", body: JSON.stringify({ id: id }) })
      .then(function () { return state.rosterMode === "staff" ? loadStaff() : loadStudents(); })
      .then(afterRosterChange);
  }

  // ---------- Staff select ----------
  function fillStaffSelect() {
    var sel = $("fStaff");
    var current = sel.value;
    var opts = ['<option value="">Select staff…</option>'];
    state.staff.forEach(function (s) { opts.push('<option value="' + esc(s.name) + '">' + esc(s.name) + "</option>"); });
    opts.push('<option value="__add__">＋ Add new…</option>');
    sel.innerHTML = opts.join("");
    if (current && current !== "__add__") sel.value = current;
  }
  function setStaffValue(name) {
    fillStaffSelect();
    var sel = $("fStaff");
    if (name && !Array.prototype.some.call(sel.options, function (o) { return o.value === name; })) {
      var o = document.createElement("option"); o.value = name; o.textContent = name;
      sel.insertBefore(o, sel.options[sel.options.length - 1]);
    }
    sel.value = name || "";
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
    var students = state.calendar === "students";
    $("fStaffWrap").hidden = !staff;
    $("fProgramWrap").hidden = !students;
    $("fLessonWrap").hidden = !students;
    $("titleLabel").textContent = staff ? "Note / role (optional)" : "Title";
    $("fTitle").placeholder = staff ? "e.g. Front desk (optional)" : "Event title";
  }
  function syncTimeRow() { $("timeRow").hidden = $("fAllDay").checked; }
  function syncUntilRow() { $("untilRow").hidden = $("fRecur").value === "none"; }

  function openAdd() {
    state.editingId = null;
    $("formTitle").textContent = state.calendar === "staff" ? "New shift" : "New event";
    setStaffValue(""); $("fTitle").value = "";
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
    setStaffValue(ev.staff_name || "");
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
    var students = state.calendar === "students";
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
      program: students ? $("fProgram").value : "",
      lesson_id: students ? $("fLesson").value : "",
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
  function loadStudents() {
    return LuanaAuth.api("students").then(function (res) {
      state.students = res.students || [];
      if (state.calendar === "students") renderAttendance();
    }).catch(function () {});
  }
  function loadStaff() {
    return LuanaAuth.api("staff").then(function (res) {
      state.staff = res.staff || [];
      fillStaffSelect();
    }).catch(function () {});
  }

  // ---------- Wire up ----------
  $("calToggle").onclick = function (e) {
    var b = e.target.closest(".seg-btn"); if (!b) return;
    state.calendar = b.getAttribute("data-cal");
    render();
    if (state.calendar === "students") loadAttendance();
  };
  $("attPrev").onclick = function () { stepAtt(-1); };
  $("attNext").onclick = function () { stepAtt(1); };
  function stepAtt(dir) {
    var n = state.attView === "week" ? 7 : 1;
    state.attDate = fmtYMD(addDays(parseYMD(state.attDate), dir * n));
    renderAttendance(); loadAttendance();
  }
  $("attDate").onchange = function (e) { state.attDate = e.target.value || state.attDate; loadAttendance(); };
  $("attViewToggle").onclick = function (e) {
    var b = e.target.closest(".seg-btn"); if (!b) return;
    state.attView = b.getAttribute("data-attview");
    loadAttendance();
  };
  $("manageStudentsBtn").onclick = function () { openRoster("students"); };
  $("manageStaffBtn").onclick = function () { openRoster("staff"); };
  $("rosterAddBtn").onclick = addRosterItem;
  $("rosterAddName").addEventListener("keydown", function (e) { if (e.key === "Enter") addRosterItem(); });
  $("rosterModalClose").onclick = function () { $("rosterModal").hidden = true; };
  $("rosterModal").onclick = function (e) { if (e.target === $("rosterModal")) $("rosterModal").hidden = true; };
  $("fStaff").onchange = function () {
    if ($("fStaff").value !== "__add__") return;
    var name = prompt("New staff member's name:");
    setStaffValue("");
    if (name && name.trim()) {
      LuanaAuth.api("staff", { method: "POST", body: JSON.stringify({ name: name.trim() }) })
        .then(function () { return loadStaff(); })
        .then(function () { setStaffValue(name.trim()); });
    }
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
  loadStudents();
  loadStaff();
  loadLessons().then(loadEvents);
})();
