// Shared authentication for the whole Luana Group App hub.
// Every tool loads this script. Login happens once at the hub; the token and
// name live in localStorage and are read by every tool.
(function (global) {
  "use strict";

  var TOKEN_KEY = "luana_token";
  var NAME_KEY = "luana_name";

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }

  var LuanaAuth = {
    token: function () { return get(TOKEN_KEY); },
    name: function () { return get(NAME_KEY) || "anonymous"; },
    isLoggedIn: function () { return !!get(TOKEN_KEY); },

    // Attempt login. Resolves { ok: true } on success, or
    // { ok: false, error: "..." } with the server's message (wrong password,
    // too many attempts, ...) on failure.
    login: function (password, name, username) {
      return fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password, username: username })
      }).then(function (r) { return r.json(); }).then(function (res) {
        if (!res.token) return { ok: false, error: res.error || "That password didn't work." };
        set(TOKEN_KEY, res.token);
        set(NAME_KEY, res.user ? res.user.name : name);
        if(res.user)set("luana_user",JSON.stringify(res.user));
        if(res.user && res.user.must_change)location.href="/tools/account/";
        return { ok: true };
      });
    },

    signOut: function () { del(TOKEN_KEY); del(NAME_KEY); del("luana_user"); try { Object.keys(sessionStorage).filter(function(k){return k.indexOf("luana_")===0;}).forEach(function(k){sessionStorage.removeItem(k);}); } catch (e) {} },

    // Send a request to the hub API with the auth header attached.
    // On 401 it signs out and bounces to the hub login.
    api: function (path, opts) {
      opts = opts || {};
      opts.headers = opts.headers || {};
      opts.headers["Content-Type"] = "application/json";
      var t = get(TOKEN_KEY);
      if (t) opts.headers["Authorization"] = "Bearer " + t;
      return fetch("/api/" + path, opts).then(function (r) {
        if (r.status === 401) { LuanaAuth.signOut(); LuanaAuth.requireLogin(); throw new Error("unauthorized"); }
        return r.text().then(function (text) {
          var data = {};
          if (text) {
            try { data = JSON.parse(text); }
            catch (e) { if (r.ok) throw new Error("The server returned an invalid response."); }
          }
          if (!r.ok) {
            if(data.password_change_required)location.href="/tools/account/";
            var error = new Error(data.error || ("Request failed (" + r.status + ")."));
            error.status = r.status;
            error.data = data;
            throw error;
          }
          return data;
        });
      });
    },

    // Call at the top of a tool page. If not logged in, redirect to the hub.
    requireLogin: function () {
      if (!LuanaAuth.isLoggedIn()) { location.href = "/"; return false; }
      try{var u=JSON.parse(get("luana_user"));if(u&&u.must_change&&location.pathname!=="/tools/account/"){location.href="/tools/account/";return false;}}catch(e){}
      return true;
    }
  };

  global.LuanaAuth = LuanaAuth;
})(window);
