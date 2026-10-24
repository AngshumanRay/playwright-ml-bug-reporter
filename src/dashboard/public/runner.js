// Test Runner page: start a run, follow it live, show the result.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };
  const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };

  // ---------------------------------------------------------------- suite dropdown
  const suite = $('suite');
  const wanted = new URLSearchParams(location.search).get('suite') || store.get('runner.suite');
  if (wanted && [...suite.options].some((o) => o.value === wanted)) suite.value = wanted;
  function showSuite() {
    const opt = suite.selectedOptions[0];
    $('suite-desc').textContent = opt.dataset.desc;
    $('suite-count').textContent = opt.dataset.count ? `${opt.dataset.count} tests` : 'all tests';
  }
  suite.addEventListener('change', () => { showSuite(); store.set('runner.suite', suite.value); });
  const headed = $('headed');
  if (store.get('runner.headed') === 'no') headed.checked = false;
  headed.addEventListener('change', () => store.set('runner.headed', headed.checked ? 'yes' : 'no'));
  showSuite();

  // ---------------------------------------------------------------- email chips
  const box = $('email-box');
  const input = $('email-input');
  let emails = (store.get('runner.emails') || '').split(',').filter(Boolean);
  const emailReady = form_ready();
  function form_ready() { return document.getElementById('run-form').dataset.emailReady === 'yes'; }
  function renderChips() {
    box.querySelectorAll('.chip').forEach((c) => c.remove());
    $('email-not-ready').style.display = !emailReady && emails.length ? '' : 'none';
    emails.forEach((e, i) => {
      const chip = document.createElement('span');
      chip.className = 'chip' + (isEmail(e) ? '' : ' invalid');
      chip.title = isEmail(e) ? e : 'Not a valid email address';
      chip.innerHTML = `<span>${esc(e)}</span><button type="button" aria-label="Remove ${esc(e)}">×</button>`;
      chip.querySelector('button').addEventListener('click', () => { emails.splice(i, 1); renderChips(); input.focus(); });
      box.insertBefore(chip, input);
    });
    store.set('runner.emails', emails.filter(isEmail).join(','));
  }
  function addFromInput() {
    const parts = input.value.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
    parts.forEach((p) => { if (!emails.includes(p.toLowerCase())) emails.push(p.toLowerCase()); });
    input.value = '';
    renderChips();
  }
  input.addEventListener('keydown', (e) => {
    if (['Enter', ',', ' ', ';', 'Tab'].includes(e.key) && input.value.trim()) { e.preventDefault(); addFromInput(); }
    else if (e.key === 'Enter') e.preventDefault();
    else if (e.key === 'Backspace' && !input.value && emails.length) { emails.pop(); renderChips(); }
  });
  input.addEventListener('blur', () => { if (input.value.trim()) addFromInput(); });
  input.addEventListener('paste', () => setTimeout(addFromInput, 0));
  box.addEventListener('click', (e) => { if (e.target === box) input.focus(); });
  renderChips();

  // ---------------------------------------------------------------- start a run
  const form = $('run-form');
  const runBtn = $('run-btn');
  const formError = $('form-error');
  function setBusy(busy) {
    runBtn.disabled = busy;
    runBtn.querySelector('span').textContent = busy ? 'Run in progress…' : 'Run tests';
    form.querySelectorAll('select, input').forEach((el) => { el.disabled = busy; });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (input.value.trim()) addFromInput();
    formError.textContent = '';
    const bad = emails.filter((x) => !isEmail(x));
    if (bad.length) { formError.textContent = `Please fix or remove: ${bad.join(', ')}`; return; }
    setBusy(true);
    try {
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suite: suite.value, emails: emails.join(','), emailMode: form.emailMode.value, headed: headed.checked }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start the run');
      follow(data.runId);
    } catch (err) {
      formError.textContent = err.message;
      setBusy(false);
    }
  });

  // ---------------------------------------------------------------- follow a run live
  let timer = null;
  let afterEnd = 0;
  function follow(runId) {
    setBusy(true);
    $('live').classList.add('show');
    $('done-slot').innerHTML = '';
    $('live-spinner').style.display = '';
    $('stop-btn').style.display = '';
    $('stop-btn').onclick = async () => {
      $('stop-btn').disabled = true;
      await fetch(`/api/runs/${runId}/stop`, { method: 'POST' });
    };
    $('live-open').href = `/runs/${runId}`;
    afterEnd = 0;
    clearInterval(timer);
    poll(runId);
    timer = setInterval(() => poll(runId), 1000);
    $('live').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function poll(runId) {
    let d;
    try { d = await (await fetch(`/api/runs/${runId}/live`)).json(); } catch { return; }
    const planned = d.planned || d.done || 0;
    $('live-name').textContent = d.name;
    $('st-done').textContent = d.done;
    $('st-planned').textContent = planned || '–';
    $('st-pass').textContent = d.passed;
    $('st-fail').textContent = d.failed;
    $('st-time').textContent = fmt(d.elapsedMs);
    $('bar-pass').style.width = planned ? `${(d.passed / planned) * 100}%` : '0';
    $('bar-fail').style.width = planned ? `${(d.failed / planned) * 100}%` : '0';
    $('live-list').innerHTML = d.results.slice().reverse().map((r) => `
      <li><span class="status-icon ${r.status}">${r.status === 'passed' ? '✓' : r.status === 'failed' ? '✕' : '–'}</span>
        <span class="title"><span class="tag">${esc(r.module)}</span> ${esc(r.title)}</span>
        <span class="muted" style="font-size:12px">${fmt(r.duration)}</span></li>`).join('')
      || '<li><span class="spinner"></span><span>Starting the browser and the demo application…</span><span></span></li>';
    const con = $('console');
    const nearBottom = con.scrollTop + con.clientHeight >= con.scrollHeight - 20;
    con.textContent = d.log.join('\n');
    if (nearBottom) con.scrollTop = con.scrollHeight;

    if (!d.active && d.status !== 'running') {
      // keep polling briefly so the email result can arrive
      afterEnd++;
      if (d.emailStatus || afterEnd > 8) {
        clearInterval(timer);
        finished(d);
      }
    }
  }

  function finished(d) {
    setBusy(false);
    $('live-spinner').style.display = 'none';
    $('stop-btn').style.display = 'none';
    const kind = d.status === 'stopped' ? 'stopped' : d.failed || d.status !== 'passed' ? 'failed' : 'passed';
    const headline = kind === 'stopped' ? 'Run stopped' : kind === 'passed' ? `All ${d.done} tests passed` : `${d.failed} of ${d.done} tests failed`;
    const notSent = d.emailStatus && /^NOT SENT/.test(d.emailStatus);
    $('done-slot').innerHTML = `
      <div class="done-banner ${kind}">
        <div><div class="big">${esc(headline)}</div>
          <div class="muted" style="font-size:13px">Finished in ${fmt(d.elapsedMs)}</div>
          ${d.emailStatus ? `<div style="font-size:13px;margin-top:2px" class="${notSent ? 'email-warn' : ''}">Email: ${esc(d.emailStatus)}</div>` : ''}</div>
        <div class="actions">
          <a class="btn" href="/runs/${d.id}">Open full report</a>
          ${d.failed ? `<button type="button" class="ghost" id="rerun-btn">Re-run ${d.failed} failed test${d.failed === 1 ? '' : 's'}</button>` : ''}
          <a class="btn ghost" href="/runs/${d.id}/download">Download</a>
        </div>
      </div>`;
    const rerun = $('rerun-btn');
    if (rerun) rerun.addEventListener('click', () => rerunFailed(d.id, rerun));
    refreshRecent();
  }

  async function rerunFailed(runId, btn) {
    btn.disabled = true;
    formError.textContent = '';
    try {
      const res = await fetch(`/api/runs/${runId}/rerun-failed`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start the re-run');
      follow(data.runId);
    } catch (err) {
      formError.textContent = err.message;
      btn.disabled = false;
    }
  }

  async function refreshRecent() {
    try {
      const runs = await (await fetch('/api/runs/recent')).json();
      $('recent').innerHTML = runs.map((r) => {
        const p = r.total ? (r.passed / r.total) * 100 : 0;
        const f = r.total ? (r.failed / r.total) * 100 : 0;
        return `<li><a class="run-item run-${esc(r.status)}" href="/runs/${r.id}"><span class="stripe"></span>
          <span style="min-width:0"><span class="when">${esc(r.date)} ${esc(r.time)}</span><br><span class="what">${esc(r.suite)} · Run #${r.id}</span></span>
          <span class="score">${r.status === 'running' ? 'running…' : `${r.passed}/${r.total} passed`}
          <span class="mini-bar"><span class="p" style="width:${p}%"></span><span class="f" style="width:${f}%"></span></span></span></a></li>`;
      }).join('');
    } catch { /* keep the current list */ }
  }

  // resume a run that is already in progress (e.g. after a page refresh)
  fetch('/api/runs/active').then((r) => r.json()).then((d) => { if (d.runId) follow(d.runId); }).catch(() => {});
})();
