// The old hub, demoted to a second screen. Today is the front door now; these
// are the tools you go looking for rather than the ones you land on.
(function () {
  "use strict";

  if (!LuanaAuth.requireLogin()) return;
  LuanaUtils.ping("tools");

  document.getElementById("signOut").onclick = function () {
    LuanaAuth.signOut();
    location.href = "/";
  };
})();
