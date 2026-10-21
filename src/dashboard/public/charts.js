// Draws the three analytics charts on the overview page (Objective 5)
(function () {
  const data = JSON.parse(document.getElementById('analytics-data').textContent);
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  const SEVERITY_COLORS = { Critical: v('--critical'), Major: v('--major'), Minor: v('--minor') };

  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  Chart.defaults.color = v('--muted');
  Chart.defaults.borderColor = v('--grid');
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.maintainAspectRatio = false;

  const integerAxis = { beginAtZero: true, ticks: { precision: 0 }, grid: { color: v('--grid') }, border: { display: false } };
  const categoryAxis = { grid: { display: false }, border: { color: v('--axis') } };
  const tooltip = { mode: 'index', intersect: false };

  new Chart(document.getElementById('moduleChart'), {
    type: 'bar',
    data: {
      labels: data.perModule.map((r) => r.module),
      datasets: [{ label: 'Bugs', data: data.perModule.map((r) => r.count), backgroundColor: v('--series-1'),
        borderRadius: 4, maxBarThickness: 40 }],
    },
    options: { scales: { y: integerAxis, x: categoryAxis }, plugins: { tooltip } },
  });

  new Chart(document.getElementById('severityChart'), {
    type: 'bar',
    data: {
      labels: data.severity.map((r) => r.severity),
      datasets: [{ label: 'Bugs', data: data.severity.map((r) => r.count),
        backgroundColor: data.severity.map((r) => SEVERITY_COLORS[r.severity]), borderRadius: 4, maxBarThickness: 32 }],
    },
    options: { indexAxis: 'y', scales: { x: integerAxis, y: categoryAxis }, plugins: { tooltip } },
  });

  new Chart(document.getElementById('trendChart'), {
    type: 'bar',
    data: {
      labels: data.trend.map((r) => r.date.slice(5)),
      datasets: ['Critical', 'Major', 'Minor'].map((s) => ({
        label: s,
        data: data.trend.map((r) => r[s]),
        backgroundColor: SEVERITY_COLORS[s],
        borderColor: v('--surface'),
        borderWidth: { top: 2 },
        borderSkipped: false,
        maxBarThickness: 36,
      })),
    },
    options: {
      scales: { x: { ...categoryAxis, stacked: true }, y: { ...integerAxis, stacked: true } },
      plugins: { tooltip: { ...tooltip, callbacks: { title: (items) => data.trend[items[0].dataIndex].date } } },
    },
  });
})();
