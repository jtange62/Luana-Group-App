(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };

  function showHub() { $("gate").style.display = "none"; $("hub").hidden = false; }

  function enter() {
    var pw = $("pwInput").value.trim();
    var name = $("gateName").value.trim();
    var err = $("gateError");
    err.hidden = true;
    if (!pw || !name) { err.textContent = "Enter both the password and your name."; err.hidden = false; return; }
    $("enterBtn").disabled = true;
    LuanaAuth.login(pw, name).then(function (res) {
      $("enterBtn").disabled = false;
      if (!res.ok) {
        err.textContent = res.error === "wrong password" ? "That password didn't work." : res.error;
        err.hidden = false; return;
      }
      showHub();
    }).catch(function () {
      $("enterBtn").disabled = false;
      err.textContent = "Couldn't reach the server. Try again.";
      err.hidden = false;
    });
  }

  $("enterBtn").onclick = enter;
  $("pwInput").addEventListener("keydown", function (event) { if (event.key === "Enter") $("gateName").focus(); });
  $("gateName").addEventListener("keydown", function (event) { if (event.key === "Enter") enter(); });
  $("signOut").onclick = function () { LuanaAuth.signOut(); location.reload(); };
  if (LuanaAuth.isLoggedIn()) showHub();
})();
