"use strict";

/*
 * Vault-declared ranked metrics (firstpair.triptych-metrics.v1), shared by
 * FirstPair Triptych and the FirstPair Reader.
 *
 * <book>/_data/<metrics file> holds the definitions and the numbers
 * (page key -> edition -> metric key -> value).  Nothing here is prose.
 */

const METRICS_SCHEMA = "firstpair.triptych-metrics.v1";
const METRIC_FORMATS = new Set(["integer", "decimal1", "decimal2", "percent"]);
const SAFE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function parseMetrics(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;
  if (!data || data.schema !== METRICS_SCHEMA || !Array.isArray(data.metrics)) {
    throw new Error("unsupported triptych metrics file");
  }
  const seen = new Set();
  const metrics = data.metrics.map((raw, index) => {
    const key = String(raw.key || "");
    if (!SAFE_KEY_RE.test(key) || seen.has(key)) throw new Error(`invalid metric key ${key}`);
    seen.add(key);
    return {
      key,
      letter: String(raw.letter || key[0]).slice(0, 3),
      label: raw.label || {},
      description: raw.description || {},
      better: raw.better === "higher" ? "higher" : "lower",
      format: METRIC_FORMATS.has(raw.format) ? raw.format : "decimal1",
      warn: Number.isFinite(raw.warn) ? raw.warn : null,
      bad: Number.isFinite(raw.bad) ? raw.bad : null,
      rank: Number.isFinite(raw.rank) ? raw.rank : index + 1,
    };
  });
  const values = data.values && typeof data.values === "object" ? data.values : {};
  return { metrics, values };
}

function metricText(metric, field, lang = "en") {
  const table = field === "label" ? metric.label : metric.description;
  if (typeof table === "string") return table;
  return table[lang] || table.en || (field === "label" ? metric.key : "");
}

function formatMetric(metric, value) {
  if (!Number.isFinite(value)) return "—";
  if (metric.format === "integer") return String(Math.round(value));
  if (metric.format === "percent") return `${Math.round(value)}%`;
  if (metric.format === "decimal2") return value.toFixed(2);
  return value.toFixed(1);
}

// "bad", "warn", or "" for a value under the metric's thresholds.
function metricSeverity(metric, value) {
  if (!Number.isFinite(value)) return "";
  const worse = (limit) => limit !== null && (
    metric.better === "lower" ? value >= limit : value <= limit
  );
  if (worse(metric.bad)) return "bad";
  if (worse(metric.warn)) return "warn";
  return "";
}

// Worst first: the order in which an editor should look.
function worstFirst(metric) {
  return (left, right) => (
    metric.better === "lower" ? right.value - left.value : left.value - right.value
  );
}

// Declared metrics in the reader's chosen order, then by rank.
function rankedMetrics(metrics, order = [], hidden = {}, includeHidden = false) {
  const position = (metric) => {
    const index = order.indexOf(metric.key);
    return index < 0 ? order.length + metric.rank : index;
  };
  return [...metrics]
    .sort((left, right) => position(left) - position(right) || left.rank - right.rank)
    .filter((metric) => includeHidden || !hidden[metric.key]);
}

module.exports = {
  METRICS_SCHEMA, formatMetric, metricSeverity, metricText, parseMetrics, rankedMetrics, worstFirst,
};
