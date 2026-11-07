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


def fig1_savings_by_network(df: pd.DataFrame, out_dir: Path) -> None:
    base = at_baseline(df)
    strategies = ["reactive", "predictive"]
    metrics = [("energy_saving_pct", "Grid-energy saving (%)"), ("peak_reduction_pct", "Peak grid-power reduction (%)")]
    fig, axes = plt.subplots(1, 2, figsize=(7.2, 3.0), sharey=True)
    width = 0.36
    for ax, (column, ylabel) in zip(axes, metrics):
        for offset, strategy in enumerate(strategies):
            style = STYLE[strategy]
            xs, ys = [], []
            for index, (scenario, _) in enumerate(NETWORKS):
                row = base[(base["scenario"] == scenario) & (base["strategy"] == strategy)]
                if row.empty:
                    continue
                xs.append(index + (offset - 0.5) * (width + 0.02))
                ys.append(float(row[column].iloc[0]))
            bars = ax.bar(
                xs, ys, width, color=style["color"], hatch=style["hatch"], edgecolor="white",
                linewidth=0.6, label=style["label"],
            )
            for bar, value in zip(bars, ys):
                ax.annotate(
                    f"{value:.1f}", (bar.get_x() + bar.get_width() / 2, max(value, 0)),
                    xytext=(0, 2), textcoords="offset points", ha="center", va="bottom", fontsize=8, color=INK,
                )
        ax.set_xticks(range(len(NETWORKS)))
        ax.set_xticklabels([label.replace("Nizhny ", "Nizhny\n").replace("İzmir ", "İzmir\n") for _, label in NETWORKS], fontsize=8.5)
        ax.tick_params(labelleft=True)
        ax.set_ylabel(ylabel, fontsize=9, color=INK)
        ax.axhline(0, color=INK_SECONDARY, linewidth=0.8)
        style_axes(ax)
    top = max(at_baseline(df)[["energy_saving_pct", "peak_reduction_pct"]].astype(float).max()) * 1.15
    axes[0].set_ylim(0, top)
    axes[0].legend(frameon=False, fontsize=8.5, loc="upper left")
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
    for strategy in ("reactive", "predictive"):
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
    ax.legend(frameon=False, fontsize=8.5)
    fig.tight_layout()
    save(fig, out_dir, "fig3_sensitivity_fleet")


def fig4_energy_vs_punctuality(df: pd.DataFrame, out_dir: Path) -> None:
    """Storage cases only: the no-storage reference is 0% saving by definition,
    and the reactive points share its on-time share exactly (stated in the caption)."""
    fig, ax = plt.subplots(figsize=(5.4, 3.4))
    for strategy in ("reactive", "predictive"):
        style = STYLE[strategy]
        rows = df[df["strategy"] == strategy]
        hollow = strategy == "predictive"
        ax.scatter(rows["on_time_pct"].astype(float), rows["energy_saving_pct"].astype(float),
                   s=48 if hollow else 22, marker=style["marker"],
                   facecolor="none" if hollow else style["color"], edgecolor=style["color"],
                   linewidth=1.2 if hollow else 0, label=style["label"], zorder=4 if hollow else 3)
    small = df[(df["strategy"] == "reactive") & (df["on_time_pct"].astype(float) < 70)]
    for _, row in small.iterrows():
        ax.annotate(f"{int(row['tram_count'])} trams", (float(row["on_time_pct"]), float(row["energy_saving_pct"])),
                    xytext=(6, -10), textcoords="offset points", fontsize=8, color=INK_SECONDARY)
    ax.set_xlabel("Trams within ±60 s of their interval, time mean (%)", fontsize=9, color=INK)
    ax.set_ylabel("Grid-energy saving (%)", fontsize=9, color=INK)
    style_axes(ax)
    ax.xaxis.grid(True, color=GRID, linewidth=0.8)
    ax.legend(frameon=False, fontsize=8.5, loc="lower left")
    fig.tight_layout()
    save(fig, out_dir, "fig4_energy_vs_punctuality")


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
    fig4_energy_vs_punctuality(df, args.out)


if __name__ == "__main__":
    main()
