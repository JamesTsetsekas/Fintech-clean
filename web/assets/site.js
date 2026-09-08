const state = {
  manifest: null,
  activeSection: "all",
  activeInteractiveId: null,
  chartDataCache: new Map(),
  query: "",
  interactiveQuery: "",
  currentScale: "log",
  currentPayload: null,
  autoscaleTimer: null,
  isAutoscaling: false,
};

const els = {};

const config = {
  manifestPath: document.body.dataset.manifest || "web/data/site-manifest.json",
  assetPrefix: document.body.dataset.assetPrefix || "",
};

document.addEventListener("DOMContentLoaded", () => {
  Object.assign(els, {
    metricStrip: document.querySelector("#metric-strip"),
    marketTape: document.querySelector("#market-tape"),
    interactiveList: document.querySelector("#interactive-list"),
    interactiveSearch: document.querySelector("#interactive-search"),
    interactiveCount: document.querySelector("#interactive-count"),
    plot: document.querySelector("#plot"),
    plotTitle: document.querySelector("#plot-title"),
    plotSummary: document.querySelector("#plot-summary"),
    plotKicker: document.querySelector("#plot-kicker"),
    scaleActions: document.querySelector("#scale-actions"),
    sectionFilters: document.querySelector("#section-filters"),
    chartGrid: document.querySelector("#chart-grid"),
    search: document.querySelector("#chart-search"),
    dialog: document.querySelector("#image-dialog"),
    dialogClose: document.querySelector("#dialog-close"),
    dialogImage: document.querySelector("#dialog-image"),
    dialogTitle: document.querySelector("#dialog-title"),
    dialogDescription: document.querySelector("#dialog-description"),
  });

  bindStaticEvents();
  loadSite();
});

function bindStaticEvents() {
  els.search.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    renderGallery();
  });

  els.interactiveSearch.addEventListener("input", (event) => {
    state.interactiveQuery = event.target.value.trim().toLowerCase();
    renderInteractiveList();
  });

  els.interactiveList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-chart-id]");
    if (button) selectInteractiveChart(button.dataset.chartId);
  });

  els.scaleActions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-scale]");
    if (!button) return;
    setScale(button.dataset.scale);
  });

  els.dialogClose.addEventListener("click", () => els.dialog.close());
  els.dialog.addEventListener("click", (event) => {
    if (event.target === els.dialog) els.dialog.close();
  });

  window.addEventListener("resize", () => {
    if (els.plot && els.plot.data) Plotly.Plots.resize(els.plot);
  });
}

async function loadSite() {
  try {
    state.manifest = await fetchJson(config.manifestPath);
    renderMetrics();
    renderInteractiveList();
    renderFilters();
    renderGallery();

    const firstInteractive = state.manifest.charts.find((chart) => chart.kind === "interactive");
    if (firstInteractive) {
      selectInteractiveChart(firstInteractive.id);
    } else {
      renderNoInteractive();
    }
  } catch (error) {
    els.plotTitle.textContent = "Site data unavailable";
    els.plotSummary.textContent = error.message;
  }
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Could not load ${path}`);
  }
  return response.json();
}

function renderMetrics() {
  const charts = state.manifest.charts;
  const interactiveCount = charts.filter((chart) => chart.kind === "interactive").length;
  const generatedAt = new Date(state.manifest.generated_at);
  const shortDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(generatedAt);
  const values = [charts.length, interactiveCount, shortDate];

  els.metricStrip.querySelectorAll("dd").forEach((node, index) => {
    node.textContent = values[index];
  });

  const hero = state.manifest.hero || state.manifest.market;
  if (hero) {
    const kicker = hero.kicker || "BTC/USD";
    const value = hero.value_label || hero.price_label || "Loaded";
    const detail = hero.detail || `${hero.date_label} · ${hero.drawdown_label} from ATH`;
    els.marketTape.innerHTML = `
      <span>${escapeHtml(kicker)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    `;
  }
}

function renderInteractiveList() {
  const allCharts = state.manifest.charts.filter((chart) => chart.kind === "interactive");
  const charts = allCharts.filter((chart) => {
    const haystack = `${chart.title} ${chart.section} ${chart.description}`.toLowerCase();
    return !state.interactiveQuery || haystack.includes(state.interactiveQuery);
  });

  els.interactiveCount.textContent = `${charts.length} of ${allCharts.length} interactive charts`;

  if (!charts.length) {
    els.interactiveList.innerHTML = `<p class="empty-state">No interactive charts match this search.</p>`;
    return;
  }

  els.interactiveList.innerHTML = charts.map((chart) => `
    <button type="button" class="interactive-button ${chart.id === state.activeInteractiveId ? "active" : ""}" data-chart-id="${escapeHtml(chart.id)}">
      <strong>${escapeHtml(chart.title)}</strong>
      <span>${escapeHtml(chart.description)}</span>
    </button>
  `).join("");
}

function renderNoInteractive() {
  state.currentPayload = null;
  els.scaleActions.hidden = true;
  setScaleControlsEnabled(false);
  els.plotKicker.textContent = state.manifest.asset_scope || "Library";
  els.plotTitle.textContent = "Interactive charts coming soon";
  els.plotSummary.textContent = "This section currently has generated report cards below. Interactive views can be added chart by chart.";
  els.plot.classList.remove("loading");
  els.plot.innerHTML = `<p class="empty-state">No interactive charts are available for this section yet.</p>`;
}

function renderFilters() {
  const buttons = [
    { id: "all", name: "All" },
    ...state.manifest.sections,
  ];

  els.sectionFilters.innerHTML = buttons.map((section) => `
    <button type="button" class="filter-button ${section.id === state.activeSection ? "active" : ""}" data-section="${escapeHtml(section.id)}">
      ${escapeHtml(section.name)}
    </button>
  `).join("");

  els.sectionFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-section]");
    if (!button) return;
    state.activeSection = button.dataset.section;
    els.sectionFilters.querySelectorAll(".filter-button").forEach((node) => {
      node.classList.toggle("active", node.dataset.section === state.activeSection);
    });
    renderGallery();
  });
}

async function selectInteractiveChart(chartId) {
  const chart = state.manifest.charts.find((item) => item.id === chartId);
  if (!chart || !chart.data_path) return;

  state.activeInteractiveId = chartId;
  state.currentPayload = null;
  clearTimeout(state.autoscaleTimer);
  els.scaleActions.hidden = true;
  setScaleControlsEnabled(false);
  setScaleButtons("linear");
  els.interactiveList.querySelectorAll(".interactive-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.chartId === chartId);
  });

  els.plotTitle.textContent = chart.title;
  els.plotSummary.textContent = chart.description;
  els.plotKicker.textContent = chart.section;
  els.plot.innerHTML = "";
  els.plot.classList.add("loading");

  const data = await getChartData(chart.data_path);
  if (state.activeInteractiveId !== chartId) return;
  renderPlot(data);
}

async function getChartData(path) {
  const resolvedPath = assetPath(path);
  if (!state.chartDataCache.has(resolvedPath)) {
    state.chartDataCache.set(resolvedPath, await fetchJson(resolvedPath));
  }
  return state.chartDataCache.get(resolvedPath);
}

function renderPlot(payload) {
  state.currentPayload = payload;
  els.plot.classList.remove("loading");
  els.plotTitle.textContent = payload.title;
  els.plotSummary.textContent = payload.summary_text || "";
  const scaleEnabled = canToggleScale(payload);
  els.scaleActions.hidden = !scaleEnabled;
  setScaleControlsEnabled(scaleEnabled);
  setScaleButtons(payload.default_scale || "linear");

  const traces = payload.series.map((series) => {
    const { axis, ...plotSeries } = series;
    const traceType = plotSeries.type || "scatter";
    const traceConfig = {
      type: traceType,
      ...plotSeries,
      yaxis: axis || plotSeries.yaxis || "y",
      hovertemplate: plotSeries.hovertemplate || "%{x}<br>%{y}<extra>%{fullData.name}</extra>",
    };
    if (traceType === "scatter" && !traceConfig.mode) traceConfig.mode = "lines";
    return traceConfig;
  });

  const rangeSelector = {
    bgcolor: "rgba(255,255,255,0.04)",
    activecolor: "rgba(245,200,75,0.26)",
    buttons: [
      { count: 1, label: "1Y", step: "year", stepmode: "backward" },
      { count: 4, label: "4Y", step: "year", stepmode: "backward" },
      { count: 8, label: "8Y", step: "year", stepmode: "backward" },
      { step: "all", label: "All" },
    ],
  };
  const xaxis = {
    gridcolor: "rgba(255,255,255,0.08)",
    zerolinecolor: "rgba(255,255,255,0.12)",
    rangeslider: { visible: false },
  };
  if (payload.show_range_selector !== false) xaxis.rangeselector = rangeSelector;

  const layout = {
    autosize: true,
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "IBM Plex Sans, sans-serif", color: "#eef3f8" },
    margin: { l: 72, r: 68, t: 28, b: 96 },
    hovermode: "x unified",
    hoverlabel: {
      bgcolor: "#0b1117",
      bordercolor: "#3a4654",
      font: {
        color: "#eef3f8",
        family: "IBM Plex Mono, monospace",
        size: 12,
      },
    },
    legend: {
      orientation: "h",
      x: 0,
      y: -0.24,
      xanchor: "left",
      yanchor: "top",
      bgcolor: "rgba(0,0,0,0)",
    },
    xaxis,
    yaxis: {
      gridcolor: "rgba(255,255,255,0.08)",
      zerolinecolor: "rgba(255,255,255,0.18)",
      automargin: true,
    },
  };

  const mergedLayout = deepMerge(layout, payload.layout || {});
  Plotly.newPlot(els.plot, traces, mergedLayout, {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
  }).then(() => {
    bindPlotAutoscale();
    scheduleVisibleYAutoscale(0);
  });
}

function setScale(scale) {
  if (!["linear", "log"].includes(scale) || !canToggleScale()) return;
  const axes = state.currentPayload.scale_axes || ["y"];
  const update = {};
  axes.forEach((axisId) => {
    const layoutKey = axisId === "y2" ? "yaxis2" : "yaxis";
    if (els.plot.layout?.[layoutKey]) update[`${layoutKey}.type`] = scale;
  });
  if (!Object.keys(update).length) return;

  state.currentScale = scale;
  setScaleButtons(scale);
  Plotly.relayout(els.plot, update).then(() => scheduleVisibleYAutoscale(0));
}

function setScaleButtons(scale) {
  state.currentScale = scale;
  els.scaleActions.querySelectorAll("[data-scale]").forEach((button) => {
    button.classList.toggle("active", button.dataset.scale === scale);
  });
}

function setScaleControlsEnabled(enabled) {
  els.scaleActions.querySelectorAll("[data-scale]").forEach((button) => {
    button.disabled = !enabled;
  });
}

function canToggleScale(payload = state.currentPayload) {
  return Boolean(payload?.allow_scale_toggle && Array.isArray(payload.scale_axes) && payload.scale_axes.length);
}

function bindPlotAutoscale() {
  if (typeof els.plot.removeAllListeners === "function") {
    els.plot.removeAllListeners("plotly_relayout");
  }
  els.plot.on("plotly_relayout", (eventData) => {
    if (state.isAutoscaling || !eventData || !state.currentPayload) return;
    const changesXRange = Object.keys(eventData).some((key) => (
      key === "xaxis.autorange" || key === "xaxis.range" || key.startsWith("xaxis.range[")
    ));
    if (changesXRange) scheduleVisibleYAutoscale(90);
  });
}

function scheduleVisibleYAutoscale(delay = 80) {
  clearTimeout(state.autoscaleTimer);
  state.autoscaleTimer = setTimeout(() => autoscaleVisibleY(), delay);
}

function autoscaleVisibleY() {
  if (!state.currentPayload || !els.plot.layout) return;
  const xRange = getVisibleXRange();
  const axisIds = new Set(state.currentPayload.series.map((series) => series.axis || "y"));
  const update = {};

  axisIds.forEach((axisId) => {
    const layoutKey = axisId === "y2" ? "yaxis2" : "yaxis";
    const axisLayout = els.plot.layout[layoutKey] || {};
    const scale = axisLayout.type || "linear";
    const range = visibleYRange(state.currentPayload, xRange, axisId, scale);
    if (range) {
      update[`${layoutKey}.autorange`] = false;
      update[`${layoutKey}.range`] = range;
    }
  });

  if (!Object.keys(update).length) return;
  state.isAutoscaling = true;
  Plotly.relayout(els.plot, update).finally(() => {
    state.isAutoscaling = false;
  });
}

function getVisibleXRange() {
  const range = els.plot.layout?.xaxis?.range;
  if (!Array.isArray(range) || range.length < 2) return null;
  if (state.currentPayload?.x_value_type === "number") {
    const start = Number(range[0]);
    const end = Number(range[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return start <= end ? [start, end] : [end, start];
  }
  const start = new Date(range[0]);
  const end = new Date(range[1]);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return start <= end ? [start, end] : [end, start];
}

function visibleYRange(payload, xRange, axisId, scale) {
  const values = [];
  const guards = payload.axis_guards?.[axisId] || {};
  const start = xRange?.[0];
  const end = xRange?.[1];
  const xType = payload.x_value_type || "date";

  payload.series.forEach((series) => {
    if ((series.axis || "y") !== axisId) return;
    const valueArrays = [];
    if (Array.isArray(series.y)) valueArrays.push(series.y);
    ["open", "high", "low", "close"].forEach((key) => {
      if (Array.isArray(series[key])) valueArrays.push(series[key]);
    });

    valueArrays.forEach((seriesValues) => seriesValues.forEach((value, index) => {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) return;
      if (scale === "log" && Number(value) <= 0) return;
      if (start && end) {
        const pointX = xType === "number" ? Number(series.x[index]) : new Date(series.x[index]);
        if (xType === "number" && !Number.isFinite(pointX)) return;
        if (xType !== "number" && Number.isNaN(pointX.getTime())) return;
        if (pointX < start || pointX > end) return;
      }
      values.push(Number(value));
    }));
  });

  if (Array.isArray(guards.include)) {
    guards.include.forEach((value) => {
      if (Number.isFinite(Number(value)) && (scale !== "log" || Number(value) > 0)) values.push(Number(value));
    });
  }

  if (values.length < 2) return null;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (Number.isFinite(Number(guards.floor))) min = Math.min(min, Number(guards.floor));
  if (Number.isFinite(Number(guards.ceiling))) max = Math.max(max, Number(guards.ceiling));
  if (min === max) {
    min = min * 0.95;
    max = max * 1.05;
  }

  if (scale === "log") {
    min = Math.max(min, 1e-12);
    const logMin = Math.log10(min);
    const logMax = Math.log10(max);
    const pad = Math.max((logMax - logMin) * 0.08, 0.04);
    return [logMin - pad, logMax + pad];
  }

  const span = max - min;
  const pad = span > 0 ? span * 0.1 : Math.max(Math.abs(max) * 0.1, 1);
  let lower = min - pad;
  let upper = max + pad;
  if (Number.isFinite(Number(guards.floor))) lower = Math.min(lower, Number(guards.floor));
  if (Number.isFinite(Number(guards.ceiling))) upper = Math.max(upper, Number(guards.ceiling));
  return [lower, upper];
}

function renderGallery() {
  const query = state.query;
  const charts = state.manifest.charts.filter((chart) => {
    const matchesSection = state.activeSection === "all" || chart.section_id === state.activeSection;
    const haystack = `${chart.title} ${chart.section} ${chart.description}`.toLowerCase();
    return matchesSection && (!query || haystack.includes(query));
  });

  if (!charts.length) {
    els.chartGrid.innerHTML = `<p class="empty-state">No charts match the current filters.</p>`;
    return;
  }

  els.chartGrid.innerHTML = charts.map((chart) => {
    const media = chart.image_path ? `
      <button type="button" data-image-path="${escapeHtml(assetPath(chart.image_path))}" data-title="${escapeHtml(chart.title)}" data-description="${escapeHtml(chart.description)}">
        <img src="${escapeHtml(assetPath(chart.image_path))}" alt="${escapeHtml(chart.title)}" loading="lazy">
      </button>
    ` : `
      <button type="button" class="chart-card-placeholder" data-open-chart-id="${escapeHtml(chart.id)}">
        <strong>Interactive</strong>
        <span>Open chart</span>
      </button>
    `;
    return `
      <article class="chart-card">
        ${media}
        <div class="chart-card-body">
          <div class="card-meta">
            <span>${escapeHtml(chart.section)}</span>
            ${chart.kind === "interactive" ? `<span class="badge">Interactive</span>` : ""}
          </div>
          <h3>${escapeHtml(chart.title)}</h3>
          <p>${escapeHtml(chart.description)}</p>
        </div>
      </article>
    `;
  }).join("");

  els.chartGrid.querySelectorAll("[data-image-path]").forEach((button) => {
    button.addEventListener("click", () => openImageDialog(button.dataset));
  });
  els.chartGrid.querySelectorAll("[data-open-chart-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectInteractiveChart(button.dataset.openChartId);
      document.querySelector("#interactive")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function openImageDialog(data) {
  els.dialogImage.src = data.imagePath;
  els.dialogImage.alt = data.title;
  els.dialogTitle.textContent = data.title;
  els.dialogDescription.textContent = data.description;
  els.dialog.showModal();
}

function deepMerge(target, source) {
  const output = { ...target };
  Object.entries(source).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      output[key] = deepMerge(output[key] || {}, value);
    } else {
      output[key] = value;
    }
  });
  return output;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function assetPath(path) {
  if (!path) return "";
  if (/^(https?:)?\/\//.test(path) || path.startsWith("/") || path.startsWith("data:")) {
    return path;
  }
  return `${config.assetPrefix}${path}`;
}
