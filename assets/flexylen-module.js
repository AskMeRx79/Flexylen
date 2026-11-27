/*
 * Flexylen interactive training module engine.
 * Each module page defines window.FLEXYLEN_MODULE (see README in docs comment below)
 * and loads this script. All rendering happens client-side; progress is saved in
 * localStorage when available and the page still works without it.
 *
 * Module data shape:
 * {
 *   id, title, icon, tone ("blue"|"green"|"red"|"purple"), duration, summary,
 *   reviewStatus, updated,
 *   objectives: [string],
 *   sources: [{ label, url }],
 *   learn: [{ title, html }],
 *   scenarios: [{ title, intro (html), steps: [{ prompt, info? (html), options: [{ text, correct, feedback }] }] }],
 *   emis: [{ title, case (html), headings: [string], model: { heading: text }, checklist: [string] }],
 *   prescriptions: [{ title, case (html), fields: [{ key, label, full?, accept?: [[substring,...], ...] }],
 *                     model: { key: text }, explanation (html) }],
 *   mcq: [{ q, options: [string], answer: index, explanation }],
 *   passMark: number (percent)
 * }
 */
(function () {
  "use strict";
  const M = window.FLEXYLEN_MODULE;
  if (!M) { document.body.textContent = "Module data missing."; return; }

  const SECTIONS = [
    { key: "overview", label: "Overview", icon: "🧭" },
    { key: "learn", label: "Learn", icon: "📖" },
    { key: "scenarios", label: "Clinical scenarios", icon: "🩺" },
    { key: "emis", label: "EMIS documentation", icon: "🗂️" },
    { key: "prescribing", label: "Prescription writing", icon: "℞" },
    { key: "assessment", label: "MCQ assessment", icon: "✅" },
    { key: "certificate", label: "Certificate & CPD", icon: "🎓" },
  ];
  const TRACKED = SECTIONS.filter(s => s.key !== "certificate").map(s => s.key);
  const STORE = "flexylen-module-" + M.id;

  // ---------- state ----------
  const state = load() || { done: {}, mcqBest: null, name: "", reflect: ["", "", ""] };
  function load() { try { return JSON.parse(localStorage.getItem(STORE)); } catch { return null; } }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* storage unavailable */ } }
  function markDone(key) { if (!state.done[key]) { state.done[key] = true; save(); refreshProgress(); } }

  // ---------- helpers ----------
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
    return n;
  };
  const norm = s => String(s || "").toLowerCase().replace(/[‐-―]/g, "-").replace(/\s+/g, " ").trim();
  const matches = (value, accept) => accept.some(group => group.every(part => norm(value).includes(norm(part))));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  // ---------- shell ----------
  document.title = `${M.title} | Flexylen Clinical Training`;
  if (M.tone && M.tone !== "blue") document.body.classList.add("tone-" + M.tone);

  const fill = el("div", { class: "fill" });
  const progLabel = el("div", { class: "label" });
  const hero = el("header", { class: "hero" },
    el("div", { class: "top" },
      el("a", { class: "logo", href: "index.html" }, "Flexylen", el("span", { class: "dot" }, ".")),
      el("a", { class: "back", href: "index.html" }, "← Training portal")),
    el("h1", {}, el("span", { "aria-hidden": "true" }, M.icon || ""), M.title),
    el("p", { class: "sub" }, M.summary),
    el("div", { class: "chips" },
      el("span", { class: "chip" }, "⏱️ " + M.duration),
      M.updated ? el("span", { class: "chip" }, "Updated " + M.updated) : null,
      M.reviewStatus ? el("span", { class: "chip draft" }, M.reviewStatus) : null),
    el("div", { class: "progress" }, el("div", { class: "bar" }, fill), progLabel),
    el("div", { class: "stripe", "aria-hidden": "true",
      html: ["blue", "green", "yellow", "red", "purple", "cyan"].map(c => `<span style="background:var(--fx-${c})"></span>`).join("") }));

  const nav = el("nav", { class: "nav", "aria-label": "Module sections" });
  const main = el("main", { id: "main" });
  const navButtons = {};
  SECTIONS.forEach(s => {
    const b = el("button", { type: "button", onclick: () => show(s.key) },
      el("span", { "aria-hidden": "true" }, s.icon), s.label, el("span", { class: "tick", "aria-label": "completed" }, "✓"));
    navButtons[s.key] = b;
    nav.append(b);
  });

  const root = document.getElementById("app") || document.body;
  root.append(el("div", { class: "wrap" },
    hero,
    el("div", { class: "layout" }, nav, main),
    el("footer", { class: "footer" },
      el("p", {}, el("strong", {}, "Flexylen"), " Clinical Training — for education only; always follow current local and national guidance."),
      M.credits ? el("p", { html: M.credits }) : null)));

  function refreshProgress() {
    const n = TRACKED.filter(k => state.done[k]).length;
    fill.style.width = pct(n, TRACKED.length) + "%";
    progLabel.textContent = `${n} of ${TRACKED.length} sections complete` + (state.mcqBest != null ? ` · best assessment score ${state.mcqBest}%` : "");
    SECTIONS.forEach(s => navButtons[s.key].classList.toggle("done", !!state.done[s.key] || (s.key === "certificate" && passed())));
  }
  const passed = () => state.mcqBest != null && state.mcqBest >= (M.passMark || 80);

  function show(key) {
    SECTIONS.forEach(s => navButtons[s.key].setAttribute("aria-current", s.key === key ? "true" : "false"));
    main.innerHTML = "";
    RENDER[key]();
    try { history.replaceState(null, "", "#" + key); } catch { /* file:// or sandbox */ }
    const top = hero.getBoundingClientRect().bottom < 0;
    if (top) main.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const next = (key, label) => el("div", { class: "actions" },
    el("button", { class: "btn btn-primary", type: "button", onclick: () => show(key) }, label || "Continue →"));

  // ---------- sections ----------
  const RENDER = {
    overview() {
      markDone("overview");
      main.append(el("section", { class: "card" },
        el("h2", {}, "About this module"),
        el("p", {}, M.summary),
        el("h3", {}, "Learning objectives"),
        el("ul", {}, M.objectives.map(o => el("li", {}, o))),
        el("h3", {}, "How this module works"),
        el("ol", {},
          el("li", {}, "Learn — key guidance, thresholds and drug information."),
          el("li", {}, "Clinical scenarios — step through realistic cases and make decisions."),
          el("li", {}, "EMIS documentation — write the consultation record, then compare with a model note."),
          el("li", {}, "Prescription writing — complete prescriptions and check them."),
          el("li", {}, `MCQ assessment — pass mark ${M.passMark || 80}%.`),
          el("li", {}, "Certificate & CPD — record your reflection and print a certificate.")),
        M.reviewStatus ? el("div", { class: "callout key" }, el("strong", {}, "Content status: "), M.reviewStatus +
          ". Check doses and thresholds against the current BNF and NICE guidance before applying in practice.") : null,
        el("h3", {}, "Key sources"),
        el("ul", {}, M.sources.map(s => el("li", {}, el("a", { href: s.url, target: "_blank", rel: "noopener" }, s.label)))),
        next("learn", "Start learning →")));
    },

    learn() {
      const card = el("section", { class: "card" }, el("h2", {}, "Learn"),
        el("p", { class: "section-intro" }, "Work through each topic. Tables scroll sideways on small screens."));
      M.learn.forEach(t => card.append(el("h3", {}, t.title), el("div", { html: t.html })));
      card.querySelectorAll("table").forEach(tb => { const w = el("div", { class: "table-scroll" }); tb.replaceWith(w); w.append(tb); });
      card.append(el("div", { class: "actions" },
        el("button", { class: "btn btn-primary", type: "button", onclick: () => { markDone("learn"); show("scenarios"); } }, "Mark as read and continue →")));
      main.append(card);
    },

    scenarios() {
      let firstTry = 0, total = 0, finished = 0;
      const summary = el("div", { class: "score" });
      main.append(el("section", { class: "card" }, el("h2", {}, "Clinical scenarios"),
        el("p", { class: "section-intro" }, "Choose the best option at each step. Wrong answers explain why — try again until you find the best choice."), summary));
      M.scenarios.forEach((sc, si) => {
        const card = el("section", { class: "card" }, el("h3", { style: "margin-top:0" }, `Case ${si + 1}: ${sc.title}`),
          el("div", { class: "case", html: sc.intro }));
        const stepsBox = el("div");
        card.append(stepsBox);
        main.append(card);
        total += sc.steps.length;
        const renderStep = (i) => {
          if (i >= sc.steps.length) {
            stepsBox.append(el("div", { class: "feedback good" }, "Case complete."));
            finished++;
            if (finished === M.scenarios.length) {
              markDone("scenarios");
              summary.textContent = `All cases complete — ${firstTry}/${total} decisions right first time.`;
              main.append(next("emis", "Go to EMIS documentation →"));
            }
            return;
          }
          const st = sc.steps[i];
          const box = el("div", { class: "q" },
            el("div", { class: "step-label" }, `Step ${i + 1} of ${sc.steps.length}`),
            st.info ? el("div", { class: "case", html: st.info }) : null,
            el("div", { class: "stem" }, st.prompt));
          const opts = el("div", { class: "options" });
          const fb = el("div");
          let attempts = 0;
          st.options.forEach(o => {
            const b = el("button", { class: "opt", type: "button" }, o.text);
            b.addEventListener("click", () => {
              attempts++;
              b.classList.add(o.correct ? "correct" : "wrong");
              fb.className = "feedback " + (o.correct ? "good" : "bad");
              fb.textContent = (o.correct ? "✓ " : "✗ ") + o.feedback;
              if (o.correct) {
                if (attempts === 1) firstTry++;
                opts.querySelectorAll("button").forEach(x => x.disabled = true);
                renderStep(i + 1);
              } else b.disabled = true;
            });
            opts.append(b);
          });
          box.append(opts, fb);
          stepsBox.append(box);
        };
        renderStep(0);
      });
    },

    emis() {
      main.append(el("section", { class: "card" }, el("h2", {}, "EMIS documentation practice"),
        el("p", { class: "section-intro" }, "Read the consultation, write your note under each EMIS heading, then compare with the model note and tick the key elements you included.")));
      let compared = 0;
      M.emis.forEach((ex, ei) => {
        const inputs = {};
        const grid = el("div", { class: "emis-grid" });
        ex.headings.forEach(h => {
          const ta = el("textarea", { rows: 3, "aria-label": h, placeholder: `${h}…` });
          inputs[h] = ta;
          grid.append(el("div", { class: "emis-row" }, el("label", {}, h), ta));
        });
        const result = el("div");
        const btn = el("button", { class: "btn btn-primary", type: "button" }, "Compare with model note");
        btn.addEventListener("click", () => {
          grid.innerHTML = "";
          ex.headings.forEach(h => {
            grid.append(el("div", {}, el("label", {}, h),
              el("div", { class: "emis-row compare" },
                inputs[h],
                el("div", {}, el("div", { class: "model-label" }, "Model note"), el("div", { class: "model" }, ex.model[h] || "—")))));
          });
          const score = el("div", { class: "score" });
          const boxes = ex.checklist.map(item => el("input", { type: "checkbox" }));
          const upd = () => { const n = boxes.filter(b => b.checked).length; score.textContent = `${n}/${boxes.length} key elements documented`; };
          boxes.forEach(b => b.addEventListener("change", upd));
          result.innerHTML = "";
          result.append(el("h4", {}, "Did your note include…"),
            el("ul", { class: "checklist" }, ex.checklist.map((item, i) => el("li", {}, el("label", { style: "font-weight:normal;display:flex;gap:.5rem" }, boxes[i], item)))),
            score);
          upd();
          btn.disabled = true;
          compared++;
          if (compared === M.emis.length) { markDone("emis"); main.append(next("prescribing", "Go to prescription writing →")); }
        });
        main.append(el("section", { class: "card" },
          el("h3", { style: "margin-top:0" }, `Exercise ${ei + 1}: ${ex.title}`),
          el("div", { class: "case", html: ex.case }),
          grid, el("div", { class: "actions" }, btn), result));
      });
    },

    prescribing() {
      main.append(el("section", { class: "card" }, el("h2", {}, "Prescription writing"),
        el("p", { class: "section-intro" }, "Complete each prescription as you would on the clinical system. Use generic names, full directions and a sensible quantity. Check your answer to see the model prescription.")));
      let checked = 0;
      M.prescriptions.forEach((rx, ri) => {
        const inputs = {}, results = {};
        const grid = el("div", { class: "rx-grid" });
        rx.fields.forEach(f => {
          const inp = el("input", { type: "text", "aria-label": f.label, autocomplete: "off" });
          inputs[f.key] = inp;
          results[f.key] = el("div", { class: "field-result" });
          grid.append(el("div", { class: f.full ? "full" : "" }, el("label", {}, f.label), inp, results[f.key]));
        });
        const out = el("div");
        let counted = false;
        const btn = el("button", { class: "btn btn-primary", type: "button" }, "Check prescription");
        btn.addEventListener("click", () => {
          let ok = 0, auto = 0;
          rx.fields.forEach(f => {
            const r = results[f.key];
            if (f.accept && f.accept.length) {
              auto++;
              const good = matches(inputs[f.key].value, f.accept);
              if (good) ok++;
              r.className = "field-result " + (good ? "good" : "bad");
              r.textContent = good ? "✓ Correct" : `✗ Expected: ${rx.model[f.key]}`;
            } else {
              r.className = "field-result";
              r.textContent = `Model: ${rx.model[f.key]}`;
            }
          });
          out.innerHTML = "";
          out.append(el("div", { class: "score " + (ok === auto ? "pass" : "fail") }, `${ok}/${auto} checked fields correct`),
            el("div", { class: "callout green" }, el("strong", {}, "Model prescription: "),
              rx.fields.map(f => `${f.label}: ${rx.model[f.key]}`).join(" · ")),
            el("div", { class: "callout", html: rx.explanation }));
          if (!counted) { counted = true; checked++; }
          if (checked === M.prescriptions.length && !state.done.prescribing) { markDone("prescribing"); main.append(next("assessment", "Go to the MCQ assessment →")); }
        });
        main.append(el("section", { class: "card" },
          el("h3", { style: "margin-top:0" }, `Prescription ${ri + 1}: ${rx.title}`),
          el("div", { class: "case", html: rx.case }),
          el("div", { class: "rx" }, el("div", { class: "rx-head" }, el("span", {}, "℞ Prescription"), el("span", { class: "muted" }, "Acute / repeat as appropriate")), grid),
          el("div", { class: "actions" }, btn), out));
      });
    },

    assessment() {
      const picks = new Array(M.mcq.length).fill(null);
      const card = el("section", { class: "card" }, el("h2", {}, "MCQ assessment"),
        el("p", { class: "section-intro" }, `${M.mcq.length} questions · pass mark ${M.passMark || 80}%. Answer every question, then submit.`));
      const qEls = M.mcq.map((q, qi) => {
        const opts = el("div", { class: "options", role: "radiogroup", "aria-label": `Question ${qi + 1}` });
        const btns = q.options.map((o, oi) => {
          const b = el("button", { class: "opt", type: "button", role: "radio", "aria-checked": "false" }, `${String.fromCharCode(65 + oi)}. ${o}`);
          b.addEventListener("click", () => {
            picks[qi] = oi;
            btns.forEach((x, xi) => { x.classList.toggle("selected", xi === oi); x.setAttribute("aria-checked", xi === oi ? "true" : "false"); });
          });
          opts.append(b);
          return b;
        });
        const fb = el("div");
        card.append(el("div", { class: "q" }, el("div", { class: "stem" }, el("span", { class: "num" }, `Q${qi + 1}.`), q.q), opts, fb));
        return { btns, fb };
      });
      const result = el("div");
      const submit = el("button", { class: "btn btn-primary", type: "button" }, "Submit answers");
      const retry = el("button", { class: "btn btn-ghost", type: "button", hidden: true, onclick: () => show("assessment") }, "Retake assessment");
      submit.addEventListener("click", () => {
        const missing = picks.findIndex(p => p === null);
        if (missing !== -1) {
          result.innerHTML = "";
          result.append(el("div", { class: "feedback bad" }, `Please answer question ${missing + 1} (and any others left blank) before submitting.`));
          qEls[missing].btns[0].focus();
          return;
        }
        let right = 0;
        M.mcq.forEach((q, qi) => {
          const ok = picks[qi] === q.answer;
          if (ok) right++;
          qEls[qi].btns.forEach((b, bi) => {
            b.disabled = true;
            if (bi === q.answer) b.classList.add("correct");
            else if (bi === picks[qi]) b.classList.add("wrong");
          });
          qEls[qi].fb.className = "feedback " + (ok ? "good" : "bad");
          qEls[qi].fb.textContent = (ok ? "✓ Correct. " : `✗ Answer: ${String.fromCharCode(65 + q.answer)}. `) + q.explanation;
        });
        const score = pct(right, M.mcq.length);
        const pass = score >= (M.passMark || 80);
        state.mcqBest = Math.max(state.mcqBest ?? 0, score);
        if (pass) state.done.assessment = true;
        save(); refreshProgress();
        result.innerHTML = "";
        result.append(el("div", { class: "score " + (pass ? "pass" : "fail") },
          `${right}/${M.mcq.length} (${score}%) — ${pass ? "Pass. Well done!" : "Not yet passed. Review the explanations and retake."}`));
        if (pass) result.append(next("certificate", "Get your certificate →"));
        submit.hidden = true; retry.hidden = false;
        result.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      card.append(el("div", { class: "actions" }, submit, retry), result);
      main.append(card);
    },

    certificate() {
      if (!passed()) {
        main.append(el("section", { class: "card" }, el("h2", {}, "Certificate & CPD"),
          el("p", {}, `Pass the MCQ assessment (${M.passMark || 80}% or more) to unlock your certificate.`),
          next("assessment", "Go to the assessment →")));
        return;
      }
      const prompts = ["What did I learn?", "How will I apply this in my practice?", "What further learning do I need?"];
      const name = el("input", { type: "text", value: state.name || "", placeholder: "Your name and profession, e.g. Jane Smith, Clinical Pharmacist" });
      const refl = prompts.map((p, i) => el("textarea", { rows: 3, placeholder: p }, state.reflect?.[i] || ""));
      const certWho = el("div", { class: "who" });
      const certRefl = el("div", { class: "reflection" });
      const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
      const update = () => {
        state.name = name.value; state.reflect = refl.map(r => r.value); save();
        certWho.textContent = name.value || "Your name";
        certRefl.innerHTML = "";
        prompts.forEach((p, i) => certRefl.append(el("h4", {}, p), el("div", {}, refl[i].value || " ")));
      };
      [name, ...refl].forEach(x => x.addEventListener("input", update));
      update();
      main.append(
        el("section", { class: "card no-print" }, el("h2", {}, "Certificate & CPD"),
          el("p", { class: "section-intro" }, "Add your name and a short reflection for your CPD record, then print or save as PDF."),
          el("label", {}, "Name"), name,
          ...prompts.flatMap((p, i) => [el("label", { style: "margin-top:.7rem" }, p), refl[i]]),
          el("div", { class: "actions" }, el("button", { class: "btn btn-primary", type: "button", onclick: () => {
            document.body.classList.add("printing-cert"); window.print(); document.body.classList.remove("printing-cert");
          } }, "Print / save as PDF"))),
        el("section", { class: "card" },
          el("div", { class: "cert" },
            el("div", { class: "logo" }, "Flexylen", el("span", { class: "dot" }, ".")),
            el("h2", {}, "Certificate of Completion"),
            el("p", {}, "This certifies that"),
            certWho,
            el("p", {}, "has completed the interactive training module"),
            el("h3", {}, M.title),
            el("p", { class: "muted" }, `Assessment score: ${state.mcqBest}% · Estimated learning time: ${M.duration} · ${today}`),
            certRefl)));
    },
  };

  refreshProgress();
  const start = (location.hash || "").slice(1);
  show(SECTIONS.some(s => s.key === start) ? start : "overview");
})();
