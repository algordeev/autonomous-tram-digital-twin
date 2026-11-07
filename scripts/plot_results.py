"""Publication figures for docs/RESULTS.md from the sensitivity-sweep outputs.

Requires pandas and matplotlib only:

    python3 -m pip install pandas matplotlib
    python3 scripts/plot_results.py

Reads outputs/sweeps/results.csv and outputs/sweeps/izmir-baseline-grid-power.csv
(written by `npm run benchmark:sweeps`) and writes PNG (300 dpi) and SVG files
to docs/assets/results/. Figures carry no titles; captions live in the docs.
Every series is told apart by colour and by a second cue (hatch, marker or
line style), so the figures stay readable in greyscale.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RESULTS = ROOT / "outputs" / "sweeps" / "results.csv"
DEFAULT_SERIES = ROOT / "outputs" / "sweeps" / "izmir-baseline-grid-power.csv"
DEFAULT_OUT = ROOT / "docs" / "assets" / "results"

NETWORKS = [
    ("izmir-konak", "İzmir Konak"),
    ("nizhny-route-2", "Nizhny Route 2"),
    ("nizhny-routes-2-21", "Nizhny Routes 2+21"),
]
# Fixed categorical order; each strategy also has its own hatch, marker and dash.
STYLE = {
    "none": {"label": "No storage", "color": "#7a7974", "marker": "^", "linestyle": ":", "hatch": ""},
    "reactive": {"label": "Reactive flywheel", "color": "#2a78d6", "marker": "o", "linestyle": "-", "hatch": ""},
    "predictive": {"label": "Predictive controller", "color": "#eb6834", "marker": "s", "linestyle": "--", "hatch": "////"},
}
INK = "#1f1e1c"
INK_SECONDARY = "#52514e"
GRID = "#e4e3dd"

BASELINE = {
    "start_minute": 480,
    "warmup_min": 10,
    "window_min": 60,
    "storage_scale": 1.0,
    "eta_scale": 1.0,
    "timestep_ms": 50,
}


def style_axes(ax) -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(INK_SECONDARY)
        ax.spines[side].set_linewidth(0.8)
    ax.tick_params(colors=INK_SECONDARY, labelcolor=INK, labelsize=9)
    ax.yaxis.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def save(fig, out_dir: Path, name: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for suffix, kwargs in ((".png", {"dpi": 300}), (".svg", {})):
        fig.savefig(out_dir / f"{name}{suffix}", bbox_inches="tight", facecolor="white", **kwargs)
    plt.close(fig)
    print(f"wrote {out_dir / name}.png/.svg")


def at_baseline(df: pd.DataFrame, except_for: str | None = None) -> pd.DataFrame:
    mask = pd.Series(True, index=df.index)
    for column, value in BASELINE.items():
        if column != except_for:
            mask &= df[column].astype(float) == float(value)
    if except_for != "tram_count_requested":
        mask &= df["tram_count_requested"].astype(str) == "default"
    return df[mask]


# Reactive-flywheel metrics, each against the no-storage reference. Colour follows the
# metric in every figure; hatch and marker repeat the distinction for greyscale.
METRICS = [
    {"column": "energy_saving_pct", "label": "Grid-energy saving", "color": "#2a78d6", "hatch": "", "marker": "o", "linestyle": "-"},
    {"column": "peak_15min_reduction_pct", "label": "15-min peak reduction", "color": "#1baf7a", "hatch": "\\\\\\\\", "marker": "D", "linestyle": "-."},
    {"column": "peak_reduction_pct", "label": "Instantaneous peak reduction", "color": "#eb6834", "hatch": "////", "marker": "s", "linestyle": "--"},
]


def fig1_savings_by_network(df: pd.DataFrame, out_dir: Path) -> None:
    """Reactive only: the rule-based predictive variant equals it (caption footnote)."""
    base = at_baseline(df)
    base = base[base["strategy"] == "reactive"]
    fig, ax = plt.subplots(figsize=(7.2, 3.3))
    width = 0.26
    gap = 0.02
    for offset, metric in enumerate(METRICS):
        xs, ys = [], []
        for index, (scenario, _) in enumerate(NETWORKS):
            row = base[base["scenario"] == scenario]
            if row.empty:
                continue
            xs.append(index + (offset - (len(METRICS) - 1) / 2) * (width + gap))
            ys.append(float(row[metric["column"]].iloc[0]))
        bars = ax.bar(xs, ys, width, color=metric["color"], hatch=metric["hatch"], edgecolor="white",
                      linewidth=0.6, label=metric["label"])
        for bar, value in zip(bars, ys):
            ax.annotate(f"{value:.1f}", (bar.get_x() + bar.get_width() / 2, max(value, 0)),
                        xytext=(0, 2), textcoords="offset points", ha="center", va="bottom", fontsize=8, color=INK)
    ax.set_xticks(range(len(NETWORKS)))
    ax.set_xticklabels([label for _, label in NETWORKS], fontsize=8.5)
    ax.set_ylabel("Change relative to no storage (%)", fontsize=9, color=INK)
    ax.axhline(0, color=INK_SECONDARY, linewidth=0.8)
    top = max(base[[m["column"] for m in METRICS]].astype(float).max()) * 1.3
    ax.set_ylim(0, top)
    style_axes(ax)
    ax.legend(frameon=False, fontsize=8.5, loc="upper left", ncol=3)
    fig.tight_layout()
    save(fig, out_dir, "fig1_savings_by_network")


def fig2_izmir_grid_power(series: pd.DataFrame, df: pd.DataFrame, out_dir: Path) -> None:
    """Full window (a) and a zoom around the no-storage peak (b).

    The series is sampled every 1 s, so it can miss the true window peak,
    which the core records at every 50 ms step; the horizontal lines and
    labels use those recorded peaks from results.csv.
    """
    base = at_baseline(df)
    base = base[base["scenario"] == "izmir-konak"]
    peaks = {strategy: float(base[base["strategy"] == strategy]["peak_kw"].iloc[0]) for strategy in ("none", "reactive")}
    minutes = series["t_s"] / 60.0
    peak_minute = float(minutes[series["none_kw"].idxmax()])
    zoom = (max(0.0, peak_minute - 2.5), min(float(minutes.iloc[-1]), peak_minute + 2.5))

    fig, axes = plt.subplots(2, 1, figsize=(7.2, 4.8), gridspec_kw={"height_ratios": [1, 1.15]})
    for panel, (ax, lim, width) in enumerate(zip(axes, [(0.0, float(minutes.iloc[-1])), zoom], [0.5, 1.3])):
        for strategy, column in (("none", "none_kw"), ("reactive", "reactive_kw")):
            style = STYLE[strategy]
            ax.plot(minutes, series[column], color=style["color"], linewidth=width,
                    label=style["label"], zorder=3 if strategy == "reactive" else 2)
            ax.axhline(peaks[strategy], color=style["color"], linewidth=1.0,
                       linestyle=":" if strategy == "none" else "--", zorder=4)
            if panel == 1:
                ax.annotate(f"window peak {peaks[strategy]:.0f} kW", (lim[1], peaks[strategy]), xytext=(4, 0),
                            textcoords="offset points", va="center", fontsize=8, color=INK)
        ax.set_xlim(*lim)
        ax.set_ylim(0, max(peaks.values()) * 1.16)
        ax.set_ylabel("Grid power (kW)", fontsize=9, color=INK)
        ax.text(0.005, 0.97, "(a)" if panel == 0 else "(b)", transform=ax.transAxes, va="top", fontsize=9, color=INK)
        style_axes(ax)
    axes[0].axvspan(*zoom, color=GRID, alpha=0.6, zorder=1, linewidth=0)
    axes[1].set_xlabel("Time into measured window (min)", fontsize=9, color=INK)
    axes[0].legend(frameon=False, fontsize=8.5, loc="lower left", bbox_to_anchor=(0.0, 1.0), ncol=2)
    fig.tight_layout()
    save(fig, out_dir, "fig2_izmir_grid_power")


def fig3_sensitivity_fleet(df: pd.DataFrame, out_dir: Path) -> None:
    fleet = at_baseline(df, except_for="tram_count_requested")
    fleet = fleet[(fleet["scenario"] == "izmir-konak") & (fleet["tram_count_requested"].astype(str) != "default")].copy()
    fleet["tram_count"] = fleet["tram_count"].astype(int)
    fig, ax = plt.subplots(figsize=(5.4, 3.2))
    for strategy in ("reactive",):
        style = STYLE[strategy]
        rows = fleet[fleet["strategy"] == strategy].sort_values("tram_count")
        ax.plot(rows["tram_count"], rows["energy_saving_pct"].astype(float), color=style["color"],
                marker=style["marker"], markersize=6, linestyle=style["linestyle"], linewidth=1.6, label=style["label"])
    counts = sorted(fleet["tram_count"].unique())
    reference = fleet[fleet["strategy"] == "none"].set_index("tram_count")["mean_headway_s"]
    labels = []
    for count in counts:
        headway = pd.to_numeric(reference.get(count), errors="coerce")
        labels.append(f"{count}\n{headway / 60:.1f} min" if pd.notna(headway) else str(count))
    ax.set_xticks(counts)
    ax.set_xticklabels(labels, fontsize=8.5)
    ax.set_xlabel("Trams in service (upper) and mean terminal headway (lower)", fontsize=9, color=INK)
    ax.set_ylabel("Grid-energy saving (%)", fontsize=9, color=INK)
    style_axes(ax)
    fig.tight_layout()
    save(fig, out_dir, "fig3_sensitivity_fleet")


def fig4_storage_size(df: pd.DataFrame, out_dir: Path) -> None:
    """Reactive metrics against İzmir storage size; all are percentages against
    the same no-storage reference, so they share one axis."""
    sizes = at_baseline(df, except_for="storage_scale")
    rows = sizes[(sizes["scenario"] == "izmir-konak") & (sizes["strategy"] == "reactive")].copy()
    rows["storage_scale"] = rows["storage_scale"].astype(float)
    rows = rows.sort_values("storage_scale")
    # Label offsets: the 15-min line runs just above energy, so its labels go above
    # and energy's go below-right; instantaneous labels sit below its line.
    offsets = {"energy_saving_pct": (12, -11), "peak_15min_reduction_pct": (-6, 10), "peak_reduction_pct": (0, -13)}
    fig, ax = plt.subplots(figsize=(5.6, 3.4))
    for metric in METRICS:
        values = rows[metric["column"]].astype(float)
        ax.plot(rows["storage_scale"], values, color=metric["color"], marker=metric["marker"], markersize=6,
                linestyle=metric["linestyle"], linewidth=1.6, label=metric["label"])
        rolling = rows["peak_15min_reduction_pct"].astype(float)
        for x, value, rolling_value in zip(rows["storage_scale"], values, rolling):
            if x == 0:
                continue
            # Where energy and 15-min coincide at label precision, one label serves both.
            if metric["column"] == "energy_saving_pct" and f"{value:.1f}" == f"{rolling_value:.1f}":
                continue
            ax.annotate(f"{value:.1f}", (x, value), xytext=offsets[metric["column"]], textcoords="offset points",
                        ha="center", va="center", fontsize=8, color=INK)
    ax.set_xticks(rows["storage_scale"].tolist())
    ax.set_xticklabels([f"{x:g}×" for x in rows["storage_scale"]], fontsize=8.5)
    ax.set_xlim(-0.08, rows["storage_scale"].max() + 0.12)
    ax.set_ylim(0, rows[[m["column"] for m in METRICS]].astype(float).max().max() * 1.25)
    ax.set_xlabel("Flywheel storage, multiple of the configured banks", fontsize=9, color=INK)
    ax.set_ylabel("Change relative to no storage (%)", fontsize=9, color=INK)
    style_axes(ax)
    ax.legend(frameon=False, fontsize=8.5, loc="upper left")
    fig.tight_layout()
    save(fig, out_dir, "fig4_storage_size")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--results", type=Path, default=DEFAULT_RESULTS)
    parser.add_argument("--series", type=Path, default=DEFAULT_SERIES)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    plt.rcParams.update({"font.family": "DejaVu Sans", "svg.fonttype": "none", "hatch.linewidth": 0.6})
    df = pd.read_csv(args.results, dtype={"tram_count_requested": str})
    if (df["core_runtime"] != "cpp-wasm").any():
        raise SystemExit("results.csv contains rows that did not run on the cpp-wasm core")
    fig1_savings_by_network(df, args.out)
    fig2_izmir_grid_power(pd.read_csv(args.series), df, args.out)
    fig3_sensitivity_fleet(df, args.out)
    fig4_storage_size(df, args.out)


if __name__ == "__main__":
    main()
