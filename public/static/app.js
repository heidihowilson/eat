/**
 * eat — client JS (placeholder).
 *
 * The app is server-rendered with no hydration; this is the only client script
 * (the ui renderer escapes inline <script> bodies, so all client JS must live
 * here). Feature agents add delegated DOM listeners below, keyed off CSS classes
 * or data-* attributes. Example pattern:
 *
 *   document.addEventListener("click", (e) => {
 *     const el = e.target.closest("[data-confirm]");
 *     if (el && !confirm(el.dataset.confirm)) e.preventDefault();
 *   });
 */
(function () {
  "use strict";
  // Confirm-on-submit for destructive actions: add data-confirm="Are you sure?"
  // to a <form> or <button>.
  document.addEventListener("submit", function (e) {
    const form = e.target;
    const msg = form && form.getAttribute && form.getAttribute("data-confirm");
    if (msg && !window.confirm(msg)) e.preventDefault();
  });
})();
