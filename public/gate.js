// The sign-in gate.
//
// This used to live inside board.js, which meant every visit to the login
// screen downloaded and parsed the whole feed — 37KB of posts, drafts, the
// lightbox, curriculum filing — before anyone could type a password. None of
// that is needed until there is a session. So the gate stands alone and pulls
// board.js in only once someone is signed in.
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var loginMode = null;
  var boardRequest = null;

  function load(tag, attrs) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement(tag);
      Object.keys(attrs).forEach(function (k) { el[k] = attrs[k]; });
      el.onload = resolve;
      el.onerror = function () { reject(new Error(tag + " failed to load")); };
      document.head.appendChild(el);
    });
  }

  // Fetch the board's script and stylesheet once, then hand control over. The
  // board markup stays hidden until start() runs, so waiting for the stylesheet
  // costs nothing visible and avoids a flash of unstyled feed.
  function startBoard() {
    if (!boardRequest) {
      boardRequest = Promise.all([
        window.LuanaBoard ? null : load("script", { src: "/board.js" }),
        document.querySelector('link[href="/board.css"]') ? null : load("link", { rel: "stylesheet", href: "/board.css" }),
      ]).then(function () {
        if (!window.LuanaBoard) throw new Error("board script loaded without an entry point");
      }).catch(function (error) {
        boardRequest = null;  // let a retry re-request them
        throw error;
      });
    }
    return boardRequest.then(function () { window.LuanaBoard.start(); });
  }

  function failToStart() {
    var err = $("gateError");
    err.textContent = "Signed in, but the staff room didn't load. Refresh to try again.";
    err.hidden = false;
    $("enterBtn").disabled = false;
  }

  // The markup ships in "accounts" shape (username + password), which is what
  // AUTH_MODE is set to. This only has to undo that for a legacy shared-password
  // deployment, so there is no flash of the wrong form in the normal case.
  function applyLoginMode(mode) {
    var accounts = mode === "accounts";
    loginMode = mode;
    $("username").hidden = $("usernameLabel").hidden = !accounts;
    $("gateName").hidden = $("gateNameLabel").hidden = accounts;
    $("loginHint").textContent = accounts
      ? "Sign in with your staff username and password."
      : "Staff tools — enter the shared password to continue";
    $("pwLabel").textContent = accounts ? "Password" : "Staff password";
    $("pwInput").placeholder = accounts ? "Your password" : "Enter the shared password";
    $("enterBtn").disabled = false;
  }

  function enter() {
    var pw = $("pwInput").value;
    var name = $("gateName").value.trim();
    var err = $("gateError");
    err.hidden = true;
    var username = $("username").value.trim();
    if (!loginMode) return;
    if (!pw || (loginMode === "accounts" ? !username : !name)) {
      err.textContent = loginMode === "accounts"
        ? "Enter your username and password."
        : "Enter both the password and your name.";
      err.hidden = false; return;
    }
    $("enterBtn").disabled = true;
    LuanaAuth.login(pw, name, username).then(function (res) {
      if (!res.ok) {
        $("enterBtn").disabled = false;
        err.textContent = res.error === "wrong password" ? "That password didn't work." : res.error;
        err.hidden = false; return;
      }
      return startBoard().catch(failToStart);
    }).catch(function () {
      $("enterBtn").disabled = false;
      err.textContent = "Couldn't reach the server. Try again.";
      err.hidden = false;
    });
  }

  $("enterBtn").onclick = enter;
  $("pwInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { if (loginMode === "accounts") enter(); else $("gateName").focus(); }
  });
  $("gateName").addEventListener("keydown", function (e) { if (e.key === "Enter") enter(); });

  if (LuanaAuth.isLoggedIn()) {
    // Already signed in: skip the form entirely and go straight to the board.
    startBoard().catch(function () {
      $("gateError").textContent = "The staff room didn't load. Refresh to try again.";
      $("gateError").hidden = false;
    });
  } else {
    fetch("/api/login")
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (data) { applyLoginMode(data.mode); })
      .catch(function () {
        $("gateError").textContent = "Could not load sign-in. Refresh to retry.";
        $("gateError").hidden = false;
      });
  }
})();
