// The daily register.
//
// One job: mark who is here. Everything else on the page is something the app
// already knows and hands back for free (allergies in the building, the class
// theme, what is on) so it is worth opening even on a day with nothing to type.
(function () {
  "use strict";

  if (!LuanaAuth.requireLogin()) return;
  LuanaUtils.ping("today");

  var $ = function (id) { return document.getElementById(id); };
  var esc = LuanaUtils.esc;
  var MARKS = [["present", "P", "Present"], ["absent", "A", "Absent"], ["late", "L", "Late"]];

  var state = { date: todayYMD(), data: null, busy: {} };

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function todayYMD() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function shiftDate(ymd, delta) {
    var p = ymd.split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2] + delta);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  // ---------- Render ----------
  function render() {
    var data = state.data;
    $("dayLabel").textContent = state.date === todayYMD() ? "Today · " + data.pretty : data.pretty;
    $("dayToday").hidden = state.date === todayYMD();

    var t = data.totals;
    $("dayCount").textContent = t.expected
      ? t.present + " in · " + t.absent + " out" + (t.late ? " · " + t.late + " late" : "") +
        (t.unmarked ? " · " + t.unmarked + " to mark" : " · all marked")
      : "No classes scheduled";

    renderAlerts(data.allergies);
    renderRegister(data.programs);
    renderEvents(data.events);

    var nothing = !data.programs.length && !data.events.length;
    $("empty").hidden = !nothing;
    if (nothing) $("empty").textContent = "Nothing scheduled on " + data.weekday + ".";
  }

  function renderAlerts(list) {
    $("alerts").hidden = !list.length;
    if (!list.length) return;
    var ul = $("alertsList");
    ul.innerHTML = list.map(function (row) {
      return "<li><strong>" + esc(row.name) + "</strong> — " + esc(row.allergies) + "</li>";
    }).join("");
  }

  function markButton(student, mark) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mark" + (student.status === mark[0] ? " on-" + mark[0] : "");
    btn.textContent = mark[1];
    btn.setAttribute("aria-label", mark[2] + " — " + student.name);
    btn.setAttribute("aria-pressed", student.status === mark[0] ? "true" : "false");
    // Tapping the current status again clears it, so a mis-tap is one tap to undo.
    btn.onclick = function () { setMark(student, student.status === mark[0] ? "" : mark[0]); };
    return btn;
  }

  function studentRow(student, tag) {
    var row = document.createElement("div");
    row.className = "student";

    var name = document.createElement("span");
    name.className = "student-name";
    name.textContent = student.name;
    if (student.allergies) {
      var flag = document.createElement("span");
      flag.className = "student-flag";
      flag.textContent = "⚠";
      flag.title = student.allergies;
      name.appendChild(flag);
    }
    if (tag) {
      var badge = document.createElement("span");
      badge.className = "guest-tag";
      badge.textContent = tag;
      name.appendChild(badge);
    }
    row.appendChild(name);

    var marks = document.createElement("div");
    marks.className = "marks";
    MARKS.forEach(function (mark) { marks.appendChild(markButton(student, mark)); });
    row.appendChild(marks);
    return row;
  }

  function renderRegister(programs) {
    var wrap = $("register");
    wrap.innerHTML = "";

    programs.forEach(function (group) {
      var card = document.createElement("section");
      card.className = "class-card";

      var head = document.createElement("div");
      head.className = "class-head";
      var tally = group.counts.unmarked
        ? group.counts.unmarked + " to mark"
        : (group.expected.length ? "all marked ✓" : "");
      head.innerHTML = '<h2 class="class-name">' + esc(group.program) + "</h2>" +
        '<span class="class-tally' + (group.done ? " is-done" : "") + '">' + esc(tally) + "</span>";
      card.appendChild(head);

      if (group.theme) {
        var theme = document.createElement("p");
        theme.className = "class-theme";
        var bits = "<strong>" + esc(group.theme.title) + "</strong>";
        if (group.theme.song) bits += " · Song: " + esc(group.theme.song);
        theme.innerHTML = bits;
        card.appendChild(theme);
      }

      var roster = document.createElement("div");
      roster.className = "roster";
      group.expected.forEach(function (student) { roster.appendChild(studentRow(student, "")); });

      // Children who are not on this weekday's schedule but turned up anyway.
      var extras = group.guests.length + group.trials.length;
      if (extras) {
        var divider = document.createElement("p");
        divider.className = "guest-head";
        divider.textContent = "Also in today";
        roster.appendChild(divider);
        group.guests.forEach(function (student) {
          roster.appendChild(studentRow(student, student.status === "trial" ? "Trial" : student.status === "makeup" ? "Makeup" : "Other"));
        });
        // Trials live in their own table rather than the roster, so there is no
        // student to mark against — they are shown so the room count is right.
        group.trials.forEach(function (trial) {
          var row = document.createElement("div");
          row.className = "student";
          row.innerHTML = '<span class="student-name">' + esc(trial.name) +
            '<span class="guest-tag">Trial</span></span>' +
            '<span class="student-note">visiting</span>';
          roster.appendChild(row);
        });
      }
      card.appendChild(roster);
      wrap.appendChild(card);
    });
  }

  function renderEvents(events) {
    $("onToday").hidden = !events.length;
    if (!events.length) return;
    $("onTodayList").innerHTML = events.map(function (event) {
      var when = event.start_time
        ? event.start_time + (event.end_time ? "–" + event.end_time : "")
        : "All day";
      var who = event.staff_name ? '<span class="event-who">' + esc(event.staff_name) + "</span>" : "";
      return '<li><span class="event-time">' + esc(when) + "</span><span>" + esc(event.title) + "</span>" + who + "</li>";
    }).join("");
  }

  // ---------- Actions ----------
  // Update the screen first, then persist. A teacher marking a line of children
  // should never wait on the network between taps.
  function setMark(student, status) {
    if (state.busy[student.id]) return;
    var previous = student.status;
    student.status = status;
    recount();
    render();

    state.busy[student.id] = true;
    LuanaAuth.api("attendance", {
      method: "POST",
      body: JSON.stringify({
        student_id: student.id, date: state.date, status: status, marked_by: LuanaAuth.name(),
      }),
    }).catch(function (error) {
      student.status = previous;
      recount();
      render();
      LuanaUtils.reportError(error, "Couldn't save that mark. Nothing was changed.");
    }).then(function () { delete state.busy[student.id]; });
  }

  // Recompute the tallies the server sent us, so the header and per-class
  // counts stay honest after an optimistic change.
  function recount() {
    var totals = { expected: 0, present: 0, absent: 0, late: 0, unmarked: 0, guests: 0, trials: 0 };
    state.data.programs.forEach(function (group) {
      var counts = { present: 0, absent: 0, late: 0, unmarked: 0 };
      group.expected.forEach(function (student) {
        if (counts[student.status] !== undefined) counts[student.status]++;
        else if (!student.status) counts.unmarked++;
      });
      group.counts = counts;
      group.done = group.expected.length > 0 && counts.unmarked === 0;
      totals.expected += group.expected.length;
      totals.present += counts.present;
      totals.absent += counts.absent;
      totals.late += counts.late;
      totals.unmarked += counts.unmarked;
    });
    state.data.totals = totals;
  }

  function load() {
    $("loading").style.display = "block";
    return LuanaAuth.api("today?date=" + encodeURIComponent(state.date))
      .then(function (data) { state.data = data; render(); })
      .catch(function (error) { LuanaUtils.reportError(error, "Couldn't load today."); })
      .then(function () { $("loading").style.display = "none"; });
  }

  function go(date) { state.date = date; load(); }

  // ---------- Summary ----------
  function openDigest() {
    $("digestBtn").disabled = true;
    LuanaAuth.api("summary?date=" + encodeURIComponent(state.date)).then(function (res) {
      $("digestText").textContent = res.text || "";
      $("digest").hidden = false;
    }).catch(function (error) {
      LuanaUtils.reportError(error, "Couldn't build the summary.");
    }).then(function () { $("digestBtn").disabled = false; });
  }

  function copyDigest() {
    var text = $("digestText").textContent;
    var done = function () { LuanaUtils.reportSuccess("Summary copied."); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        LuanaUtils.reportError(null, "Couldn't copy — select the text and copy it manually.");
      });
      return;
    }
    LuanaUtils.reportError(null, "Copying isn't available here — select the text and copy it manually.");
  }

  // ---------- Wiring ----------
  $("signOut").onclick = function () { LuanaAuth.signOut(); location.href = "/"; };

  $("dayPrev").onclick = function () { go(shiftDate(state.date, -1)); };
  $("dayNext").onclick = function () { go(shiftDate(state.date, 1)); };
  $("dayToday").onclick = function () { go(todayYMD()); };

  $("digestBtn").onclick = openDigest;
  $("digestCopy").onclick = copyDigest;
  $("digestClose").onclick = function () { $("digest").hidden = true; };
  $("digest").onclick = function (e) { if (e.target === $("digest")) $("digest").hidden = true; };

  load();
})();
