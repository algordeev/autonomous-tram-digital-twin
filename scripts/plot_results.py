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
        ax.set_xticklabels([label for _, label in NETWORKS], fontsize=8.5)
        ax.set_ylabel(ylabel, fontsize=9, color=INK)
        ax.axhline(0, color=INK_SECONDARY, linewidth=0.8)
        style_axes(ax)
    top = max(at_baseline(df)[["energy_saving_pct", "peak_reduction_pct"]].astype(float).max()) * 1.15
    axes[0].set_ylim(0, top)
    axes[0].legend(frameon=False, fontsize=8.5, loc="upper left")
    fig.tight_layout()
    save(fig, out_dir, "fig1_savings_by_network")


def fig2_izmir_grid_power(series: pd.DataFrame, out_dir: Path) -> None:
    fig, ax = plt.subplots(figsize=(7.2, 3.0))
    minutes = series["t_s"] / 60.0
    for strategy, column in (("none", "none_kw"), ("reactive", "reactive_kw")):
        style = STYLE[strategy]
        values = series[column]
        ax.plot(minutes, values, color=style["color"], linewidth=0.7, linestyle="-",
                alpha=0.9 if strategy == "reactive" else 0.75, label=style["label"], zorder=3 if strategy == "reactive" else 2)
        peak = values.max()
        ax.axhline(peak, color=style["color"], linewidth=1.0, linestyle=style["linestyle"] if strategy == "none" else "--")
        ax.annotate(f"peak {peak:.0f} kW", (minutes.iloc[-1], peak), xytext=(4, 0), textcoords="offset points",
                    va="center", fontsize=8, color=INK)
    ax.set_xlim(0, minutes.iloc[-1])
    ax.set_ylim(bottom=0)
    ax.set_xlabel("Time into measured window (min)", fontsize=9, color=INK)
    ax.set_ylabel("Network grid power (kW)", fontsize=9, color=INK)
    style_axes(ax)
    ax.legend(frameon=False, fontsize=8.5, loc="upper left", ncol=2)
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
    fig, ax = plt.subplots(figsize=(5.4, 3.4))
    for strategy in ("none", "reactive", "predictive"):
        style = STYLE[strategy]
        rows = df[df["strategy"] == strategy]
        ax.scatter(rows["on_time_pct"].astype(float), rows["energy_saving_pct"].astype(float), s=30,
                   marker=style["marker"], facecolor=style["color"] if strategy != "none" else "white",
                   edgecolor=style["color"] if strategy == "none" else "white", linewidth=0.8,
                   label=style["label"], zorder=3)
    ax.set_xlabel("Trams within ±60 s of their interval, time mean (%)", fontsize=9, color=INK)
    ax.set_ylabel("Grid-energy saving (%)", fontsize=9, color=INK)
    style_axes(ax)
    ax.xaxis.grid(True, color=GRID, linewidth=0.8)
    ax.legend(frameon=False, fontsize=8.5, loc="center left")
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
    fig2_izmir_grid_power(pd.read_csv(args.series), args.out)
    fig3_sensitivity_fleet(df, args.out)
    fig4_energy_vs_punctuality(df, args.out)


if __name__ == "__main__":
    main()
